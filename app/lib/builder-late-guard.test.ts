import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as edits from "./builder-edit-intent.ts";
import { changedSettings, scheduleSnapshot, markNotApplied, isDecidedNotApplied, wasNotApplied } from "./builder-settings-restore.ts";
import { phase2Expected, withBuilderGoalGuard, applyPhase2Commit } from "./phase2-commit.ts";

// Execute the actual page closure. This tests client result handling, not an
// atomic database boundary; a change AFTER this read still needs RPC validation.
const source = fs.readFileSync(new URL("../dashboard/plan/schedule/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration = "";
function visit(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "commitArgs") declaration=n.initializer!.getText(ast);
  ts.forEachChild(n,visit);
}
visit(ast);
const compiled = ts.transpileModule("return "+declaration,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const goal={id:"g",child_id:"a",curriculum_name:"Math",subject_label:"Math",default_minutes:25,archived:false,completed_at:null,total_lessons:10,current_lesson:0,start_at_lesson:1,lessons_per_day:1,lessons_per_day_overrides:null,school_days:["Mon"],start_date:"2026-10-01"};
function closure(mutation: Record<string,unknown>, pending: boolean, ownPatch: Record<string,unknown>={}) {
  const q={select:()=>q,eq:()=>q,single:async()=>({data:{...goal,...ownPatch,...mutation},error:null})};
  const context={...edits,withBuilderGoalGuard,ScheduleRefusedError:Error,ScheduleConflictError:Error,pending:pending?{before:goal,settings:{lessons_per_day:2}}:null,supabase:{from:()=>q},goalId:"g",storedPointer:0,currentLesson:0,row:{total_lessons:10},freshGoals:new Map([["g",goal]]),editPatches:new Map([["g",ownPatch]]),changedSettings,scheduleSnapshot,markNotApplied,dayStart:new Date("2026-10-08T00:00:00Z"),dayEnd:new Date("2026-10-09T00:00:00Z"),phase2Expected,actualBeforeRows:[],beforeRows:[],todayMid:new Date("2026-10-08T00:00:00Z"),ymd:()=>"2026-10-08",requestIdFor:()=>"synthetic"};
  return new Function(...Object.keys(context),compiled)(...Object.values(context));
}
for (const pending of [false,true]) {
  for (const mutation of [{child_id:"b"},{archived:true},{completed_at:"2026-10-08T12:00:00Z"},{curriculum_name:"New name"}]) {
    test(`actual Builder late guard refuses ${JSON.stringify(mutation)} pending=${pending}`, async()=>{
      await assert.rejects(closure(mutation,pending)({inserts:[],redates:[]}),/Reload|stale/);
    });
  }
  test(`own metadata patch is accepted pending=${pending}`,async()=>{
    const result=await closure({},pending,{curriculum_name:"Own edit"})({inserts:[],redates:[]});
    assert.equal(result.goalId,"g"); assert.equal(result.plan.request_id,"synthetic");
  });
}

test("own time edit tolerates PostgreSQL seconds representation", async()=>{
  const result=await closure({scheduled_start_time:"09:00:00"},true,{scheduled_start_time:"09:00"})({inserts:[],redates:[]});
  assert.equal(result.goalId,"g");
});

test("actual Builder sends original schedule plus planned metadata contract",async()=>{
  const result=await closure({},true,{curriculum_name:"Own edit",scheduled_start_time:"09:00:00"})({inserts:[],redates:[]});
  assert.equal(result.expected.builder_guard_version,1);
  assert.equal(result.expected.goal.lessons_per_day,1);
  assert.equal(result.settings.lessons_per_day,2);
  assert.equal(result.expected.goal.curriculum_name,"Own edit");
  assert.equal(result.expected.goal.archived,false);
  assert.equal(result.expected.goal.completed_at,null);
  assert.equal(result.expected.goal.child_id,"a");
});

test("actual result handling makes conflicts, upgrade and pause actionable and non-retryable",()=>{
  let applied="";const declarations:string[]=[];
  function find(n:ts.Node){
    if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==="assertApplied")applied=n.initializer!.getText(ast);
    if(ts.isClassDeclaration(n)&&["ScheduleAssertionError","ScheduleRefusedError","ScheduleConflictError"].includes(n.name?.text??""))declarations.push(n.getText(ast));
    if(ts.isFunctionDeclaration(n)&&n.name?.text==="isDeterministicPhase2Failure")declarations.push(n.getText(ast));
    ts.forEachChild(n,find);
  }
  find(ast);
  const js=ts.transpileModule(declarations.join("\n")+"\nreturn {assertApplied:"+applied+",isDeterministicPhase2Failure};",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const handlers=new Function("markNotApplied",js)(markNotApplied);
  for(const result of [{status:"stale",reason:"goal_lifecycle"},{status:"stale",reason:"goal"},{status:"invalid",reason:"client_upgrade_required"},{status:"refused",reason:"builder_paused"}]){
    assert.throws(()=>handlers.assertApplied(result),(e:unknown)=>{
      assert.ok(e instanceof Error);assert.match(e.message,/Reload|paused/);
      assert.equal(handlers.isDeterministicPhase2Failure(e),true);
      assert.doesNotMatch(e.message,/Nothing about this curriculum changed/);return true;
    });
  }
  assert.doesNotThrow(()=>handlers.assertApplied({status:"applied",inserted:1,redated:0,replayed:true}));
});

for (const lostResponses of [2,4]) for (const lateChange of [{curriculum_name:"Renamed elsewhere"},{archived:true}]) {
  test(`actual issued request replays before late guard after lost responses: ${JSON.stringify(lateChange)} lost=${lostResponses}`,async()=>{
    let commitBody="";let assertion="";const classes:string[]=[];
    function find(n:ts.Node){
      if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==="commitPhase2")commitBody=n.initializer!.getText(ast);
      if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==="assertApplied")assertion=n.initializer!.getText(ast);
      if(ts.isClassDeclaration(n)&&["ScheduleAssertionError","ScheduleRefusedError","ScheduleConflictError"].includes(n.name?.text??""))classes.push(n.getText(ast));
      ts.forEachChild(n,find);
    }find(ast);
    const assertionJs=ts.transpileModule(classes.join("\n")+"\nreturn "+assertion,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const assertApplied=new Function("markNotApplied","isDecidedNotApplied",assertionJs)(markNotApplied,isDecidedNotApplied);
    const js=ts.transpileModule("return "+commitBody,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const uncertainCommits=new Map();let calls=0;let builds=0;let mutate=false;
    let issued:unknown;let committedTotal=6;
    const client={rpc:async(_name:string,args:unknown)=>{
      calls++;if(!issued)issued=args;assert.deepEqual(args,issued);
      committedTotal=8;
      if(calls<=lostResponses)return {data:null,error:{message:"response lost"}};
      assert.equal(mutate,true);return {data:{status:"applied",inserted:8,redated:0,replayed:true},error:null};
    }};
    const context={supabase:client,goalId:"g",uncertainCommits,applyPhase2Commit,isDecidedNotApplied,
      commitArgs:async()=>{builds++;return closure(mutate?lateChange:{},true)({inserts:[],redates:[]});},
      assertApplied};
    const commit=new Function(...Object.keys(context),js)(...Object.values(context));
    await assert.rejects(commit({}),e=>{assert.equal(wasNotApplied(e),false);return true;});
    mutate=true;
    const replay=uncertainCommits.get("g");assert.ok(replay);
    if(lostResponses===4){
      await assert.rejects(replay(),e=>{assert.equal(wasNotApplied(e),false);return true;});
      assert.equal(uncertainCommits.size,1);
    }
    const result=await replay();
    assert.equal(result.replayed,true);assert.equal(builds,1);assert.equal(calls,lostResponses+1);
    assert.equal(committedTotal,8);assert.equal(uncertainCommits.size,0);
    // Pin the actual outer retry wiring: replay precedes another planner/read.
    assert.match(source,/const replay = uncertainCommits.get\(goalId\);\s*if \(replay\) await replay\(\);\s*else await applyPhase2ForGoal/);
  });
}

test("actual notice prioritizes uncertainty and Reload over restored-schedule claims",()=>{
  const start=source.indexOf("        if (failedPhase2GoalId && uncertainCommits.has(failedPhase2GoalId)) setPostSaveNotice(");
  const end=source.indexOf("        // A refusal is the one deterministic failure",start);
  assert.ok(start>0&&end>start);
  const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  class Conflict extends Error {}
  let notice="";
  const show=(err:Error,uncertain:boolean)=>{
    const args={failedPhase2GoalId:"g",uncertainCommits:uncertain?new Map([["g",true]]):new Map(),setPostSaveNotice:(s:string)=>{notice=s;},err,ScheduleConflictError:Conflict,ScheduleAssertionError:Error,ScheduleRefusedError:Error,restoredName:"Math",deterministic:true,pendingSettings:new Map([["g",{}]])};
    new Function(...Object.keys(args),js)(...Object.values(args));return notice;
  };
  assert.match(show(new Conflict("Reload the Builder."),false),/Reload the Builder/);
  assert.doesNotMatch(notice,/nothing about its days|lessons are exactly/);
  assert.match(show(new Error("response lost"),true),/couldn't confirm/);
  assert.doesNotMatch(notice,/nothing about its days|lessons are exactly|did not generate/);
});
