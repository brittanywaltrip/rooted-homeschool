import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as edits from "./builder-edit-intent.ts";
import { changedSettings, scheduleSnapshot, markNotApplied } from "./builder-settings-restore.ts";
import { phase2Expected } from "./phase2-commit.ts";

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
  const context={...edits,pending:pending?{before:goal,settings:{lessons_per_day:2}}:null,supabase:{from:()=>q},goalId:"g",storedPointer:0,currentLesson:0,row:{total_lessons:10},freshGoals:new Map([["g",goal]]),editPatches:new Map([["g",ownPatch]]),changedSettings,scheduleSnapshot,markNotApplied,dayStart:new Date("2026-10-08T00:00:00Z"),dayEnd:new Date("2026-10-09T00:00:00Z"),phase2Expected,actualBeforeRows:[],beforeRows:[],todayMid:new Date("2026-10-08T00:00:00Z"),ymd:()=>"2026-10-08",requestIdFor:()=>"synthetic"};
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
