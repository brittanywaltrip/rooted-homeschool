import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {isBuilderNameOnlySave, sameSetting} from './builder-edit-intent.ts';

// Execute the actual page's phase-2 runner, including its retry and settlement
// branches. Persistence here is a synthetic in-memory fixture, not hosted SQL.
const source=readFileSync(process.env.BUILDER_PAGE_SOURCE ?? new URL('../dashboard/plan/schedule/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let runner='',classifier='';
function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='runPhase2ForGoal')runner=n.initializer!.getText(ast);if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='nameOnlySave')classifier=n.initializer!.getText(ast);ts.forEachChild(n,visit);}
visit(ast);assert.ok(runner);
const classifyJs=ts.transpileModule(`return (${classifier||'false'});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const classify=(rows:unknown[],saved:unknown[]=[])=>new Function('rows','dbRowsRef','isBuilderNameOnlySave','sameSetting','curriculumEditableValues','startAtLessonTouched',classifyJs)(rows,{current:saved},isBuilderNameOnlySave,sameSetting,(row:{form:object})=>({...row.form}),(row:{touched?:boolean})=>!!row.touched);
const curriculum=()=>({type:'curriculum',dbId:'g',previouslySavedAs:'curriculum_goals',readOnly:false,pendingDelete:false,_originalSchedule:{total_lessons:6},_editBaseline:{form:{curriculum_name:'old',total_lessons:6,start_at_lesson:1}},form:{curriculum_name:'new',total_lessons:6,start_at_lesson:1},record_history:false,unit_touched:false});
const js=ts.transpileModule(`return (${runner});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function runSave(nameOnlySave:boolean, options:{rename?:boolean;replay?:boolean;fail?:boolean}={}) {
 const records=new Map(['rename','sibling','paused','child2'].map(id=>[id,{id,name:id,rows:[{id:id+'-done',completed:true,notes:'kept',minutes:30},{id:id+'-next',completed:false,notes:null,minutes:0}]}]));
 if(options.rename)records.get('rename')!.name='renamed';
 const before=structuredClone(records),calls:string[]=[],settled:string[]=[],failures:unknown[]=[];
 const apply=async(id:string)=>{calls.push(id);if(id==='paused'||options.fail)throw Error('scheduler_paused');records.get(id)!.rows[1].id=id+'-replacement';};
 const replayed:string[]=[];
 const replay=new Map(options.replay?[['rename',async()=>{replayed.push('rename');}]]:[]);
 class Refusal extends Error{};
 const execute=new Function('nameOnlySave','uncertainCommits','applyPhase2ForGoal','freshGoals','editPatches','curriculumEditableValues','settledCurriculumRow','setRows','isDeterministicPhase2Failure','LateInvariant21Error','ScheduleRefusedError','captureSupabaseError','phase2Failures',js)(nameOnlySave,replay,apply,new Map([...records].map(([id,g])=>[id,g])),new Map(),()=>({}),(_r:unknown,id:string)=>{settled.push(id);return {localId:id};},(fn:(rows:{localId:string}[])=>unknown)=>fn([...records].map(([id])=>({localId:id}))),()=>true,Refusal,Refusal,()=>{},failures);
 await Promise.all([...records].map(([id])=>execute({id,row:{localId:id}})));
 return {before,records,calls,settled,failures,replayed};
}
const field=(form:Record<string,unknown>,baseline:Record<string,unknown>= {curriculum_name:'old',total_lessons:6})=>({eligible:true,baseline,form});

test('ordinary rename does not rebuild renamed, untouched paused, or second-child rows',async()=>{
 const result=await runSave(isBuilderNameOnlySave([field({curriculum_name:'new',total_lessons:6}),field({curriculum_name:'old',total_lessons:6})]),{rename:true});
 assert.deepEqual(result.calls,[],'rename must issue zero lesson rebuilds');
 assert.deepEqual(result.records,result.before);assert.equal(result.failures.length,0);assert.equal(result.settled.length,4);
});
test('name-only retry whose metadata already landed still skips lesson generation',async()=>{
 // Intent remains name-only even when resolveBuilderEdits returns an empty DB patch.
 assert.equal(isBuilderNameOnlySave([field({curriculum_name:'new',total_lessons:6})]),true);
 const result=await runSave(true);assert.deepEqual(result.calls,[]);assert.equal(result.settled.length,4);
});
test('no-op repair save retains the existing generation path',async()=>{
 const nameOnly=isBuilderNameOnlySave([field({curriculum_name:'old',total_lessons:6})]);assert.equal(nameOnly,false);
 const result=await runSave(nameOnly);assert.equal(result.calls.length,4);assert.equal(result.failures.length,1);
});
test('failed earlier non-name intent is not hidden by a convergent DB patch',()=>{
 for(const key of ['total_lessons','default_minutes','scheduled_start_time','child_id','subject_label','start_at_lesson','school_days']){
  const baseline={curriculum_name:'old',[key]:'before'},form={curriculum_name:'new',[key]:'after'};
  assert.equal(isBuilderNameOnlySave([field(form,baseline)]),false,key);
 }
});
test('new, converted, pending-generation, deleted, or changed activity rows disable fast path',()=>{
 for(const reason of ['new','converted','pending-generation','deleted','activity']){
  assert.equal(isBuilderNameOnlySave([field({curriculum_name:'new',total_lessons:6}),{eligible:false,baseline:{},form:{}}]),false,reason);
 }
 assert.equal(isBuilderNameOnlySave([{eligible:true,form:{curriculum_name:'new'}}]),false,'unknown baseline');
});
test('unchanged activity can coexist with rename; real activity or unit edit falls back',()=>{
 assert.equal(isBuilderNameOnlySave([field({curriculum_name:'new',total_lessons:6}),{eligible:sameSetting({name:'music'},{name:'music'}),baseline:{},form:{}}]),true);
 assert.equal(isBuilderNameOnlySave([field({curriculum_name:'new',total_lessons:6}),{eligible:false,baseline:{},form:{}}]),false);
});
test('pending exact response replay takes precedence even on name-only fast path',async()=>{
 const result=await runSave(true,{replay:true});assert.deepEqual(result.replayed,['rename']);assert.deepEqual(result.calls,[]);assert.equal(result.settled.length,4);
});
test('real rebuild failure remains reported and is not settled as successful',async()=>{
 const result=await runSave(false,{fail:true});assert.equal(result.calls.length,4);assert.equal(result.failures.length,4);assert.equal(result.settled.length,0);
});
test('actual pre-refresh classifier preserves partial-new-course retry and earlier non-name intent',()=>{
 assert.equal(classify([curriculum()]),true);
 const pending=curriculum();pending._originalSchedule=null as never;pending.form={...pending._editBaseline.form};
 assert.equal(classify([curriculum(),pending]),false,'phase1 landed but generation never completed');
 const earlier=curriculum();earlier.form.total_lessons=8;
 assert.equal(classify([curriculum(),earlier]),false,'metadata may already match DB; original intent survives');
 assert.equal(classify([{...curriculum(),dbId:null,record_history:true}]),false,'only new rows can request history');
 assert.equal(classify([{...curriculum(),unit_touched:true}]),false);
 assert.equal(classify([{...curriculum(),pendingDelete:true}]),false);
});
test('actual activity baseline check permits unchanged rows and rejects edits/conversions',()=>{
 const activity={type:'activity',dbId:'a',previouslySavedAs:'activities',name:'Music',readOnly:false,pendingDelete:false};
 assert.equal(classify([curriculum(),activity],[activity]),true);
 assert.equal(classify([curriculum(),{...activity,name:'New'}],[activity]),false);
 assert.equal(classify([curriculum(),{...activity,previouslySavedAs:'curriculum_goals'}],[activity]),false);
});
