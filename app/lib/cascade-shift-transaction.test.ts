import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftCurriculumSessions, undoCurriculumShift, previewCurriculumShift } from './cascade-shift-transaction.ts';
const args = {operationId:'op',goalId:'g',lessonId:'L1',from:'2026-09-22',to:'2026-09-29',localDay:'2026-09-22',dayStartIso:'2026-09-22T00:00:00Z',dayEndIso:'2026-09-23T00:00:00Z'};
const snapshot = () => ({userId:'u',goal:{id:'g',user_id:'u',total_lessons:2,current_lesson:0,lessons_per_day:1,school_days:['Tue'],start_date:'2026-09-22'},rows:['2026-09-22','2026-09-29'].map((d,i)=>({id:`L${i+1}`,user_id:'u',curriculum_goal_id:'g',lesson_number:i+1,queue_position:i+1,scheduled_date:d,date:d,queue_pinned:false,scheduled_source:'wizard_create',completed:false,skipped:false,is_backfill:false,continues_lesson_id:null,updated_at:'v1',completed_at:null,notes:null,minutes_spent:null,hours:null})),rowCount:2,vacations:[],localDay:args.localDay,dayStartIso:args.dayStartIso,dayEndIso:args.dayEndIso});
type Response = {data?: unknown; error?: {code:string}} | Error;
function fake(responses:Response[]) {
  const calls:{name:string,payload:unknown}[]=[];
  const client={rpc:async(name:string,payload:unknown)=>{calls.push({name,payload});const next=responses.shift();if(next instanceof Error)throw next;assert.ok(next,'unexpected RPC');return next;}} as unknown as SupabaseClient;
  return {client,calls};
}
const ready=()=>({data:{status:'ready',snapshot:snapshot()}});
test('coordinator never falls back when atomic RPC is unavailable',async()=>{
  const f=fake([{error:{code:'PGRST202'}}]);assert.deepEqual(await shiftCurriculumSessions(f.client,{...args,previewSnapshot:snapshot()}),{status:'refused',reason:'unavailable'});assert.deepEqual(f.calls.map(x=>x.name),['read_cascade_snapshot']);
});
test('lost commit response retries exactly the original operation and payload',async()=>{
  const f=fake([ready(),new Error('response lost'),{data:{status:'already_applied'}}]);
  assert.deepEqual(await shiftCurriculumSessions(f.client,{...args,previewSnapshot:snapshot()}),{status:'applied',operationId:'op',writtenIds:['L1','L2']});
  assert.equal(f.calls.length,3);assert.equal(f.calls[1].name,'commit_cascade_shift');assert.strictEqual(f.calls[1].payload,f.calls[2].payload);
});
for(const status of ['stale','invalid','failed','already_undone'])test(`server ${status} cannot be mistaken for success`,async()=>{
 const f=fake([ready(),{data:{status}}]);const result=await shiftCurriculumSessions(f.client,{...args,previewSnapshot:snapshot()});assert.equal(result.status,'refused');assert.equal(f.calls.length,2);
});
test('two uncertain commit responses return unknown, never claim nothing moved',async()=>{
 const f=fake([ready(),new Error('offline'),new Error('offline')]);assert.deepEqual(await shiftCurriculumSessions(f.client,{...args,previewSnapshot:snapshot()}),{status:'unknown',operationId:'op'});assert.equal(f.calls.length,3);
});
test('malformed or incomplete snapshot cannot cause a write',async()=>{
 for(const bad of [{},{...snapshot(),rowCount:3},{...snapshot(),vacations:undefined}]){
  const f=fake([{data:{status:'ready',snapshot:bad}}]);assert.equal((await shiftCurriculumSessions(f.client,{...args,previewSnapshot:snapshot()})).status,'refused');assert.equal(f.calls.length,1);
 }
});
test('Undo retries the same receipt after lost response and recognizes idempotent success',async()=>{
 const f=fake([new Error('response lost'),{data:{status:'already_undone'}}]);assert.equal(await undoCurriculumShift(f.client,'op'),'undone');assert.deepEqual(f.calls,[{name:'undo_cascade_shift',payload:{p_operation_id:'op'}},{name:'undo_cascade_shift',payload:{p_operation_id:'op'}}]);
});
test('stale Undo does not attempt a client restore',async()=>{
 const f=fake([{data:{status:'stale'}}]);assert.equal(await undoCurriculumShift(f.client,'op'),'stale');assert.equal(f.calls.length,1);
});

test('confirmation cannot expand the previewed suffix after another lesson is added',async()=>{
 const preview=snapshot();const changed=snapshot();changed.goal.total_lessons=3;changed.rows.push({...changed.rows[1],id:'L3',lesson_number:3,queue_position:3,date:'2026-10-06',scheduled_date:'2026-10-06'});changed.rowCount=3;
 const f=fake([{data:{status:'ready',snapshot:changed}},{data:{status:'applied'}}]);
 const result=await shiftCurriculumSessions(f.client,{...args,previewSnapshot:preview});
 assert.equal(result.status,'refused');assert.equal(f.calls.some(c=>c.name==='commit_cascade_shift'),false);
});

for(const field of ['settings','notes','date','pin','breaks','membership'] as const)test(`confirmation refuses changed ${field} even when selected date is unchanged`,async()=>{
 const preview=snapshot(),changed=snapshot();
 if(field==='settings')changed.goal.lessons_per_day=2;
 if(field==='notes')Object.assign(changed.rows[1],{notes:'later work'});
 if(field==='date')changed.rows[1].date=changed.rows[1].scheduled_date='2026-10-06';
 if(field==='pin')changed.rows[1].queue_pinned=true;
 if(field==='breaks')Object.assign(changed,{vacations:[{start_date:'2026-12-01',end_date:'2026-12-02'}]});
 if(field==='membership')changed.rows[1].id='replaced-L2';
 const f=fake([{data:{status:'ready',snapshot:changed}}]);
 assert.deepEqual(await shiftCurriculumSessions(f.client,{...args,previewSnapshot:preview}),{status:'refused',reason:'stale'});
 assert.equal(f.calls.length,1);
});
test('preview displays the exact queue-suffix membership and finish from its retained plan',async()=>{
 const s=snapshot();s.goal.lessons_per_day=2;s.goal.total_lessons=3;s.rows[1].scheduled_date=s.rows[1].date=s.rows[0].date;
 s.rows.push({...s.rows[1],id:'L3',lesson_number:3,queue_position:3,date:'2026-09-29',scheduled_date:'2026-09-29'});s.rowCount=3;
 const f=fake([{data:{status:'ready',snapshot:s}}]);const p=await previewCurriculumShift(f.client,args);
 assert.ok(p);assert.equal(p.futureLessonsToShift,2);assert.equal(p.projectedFinishDate,'2026-10-06');assert.equal(p.shiftDays,1);assert.strictEqual(p.snapshot,s);
});

test('unsupported unpinned gaps do not produce an actionable preview',async()=>{
 const s=snapshot();s.rows[1].date=s.rows[1].scheduled_date='2026-10-13';
 const f=fake([{data:{status:'ready',snapshot:s}}]);assert.equal(await previewCurriculumShift(f.client,args),null);
 assert.equal(f.calls.length,1);
});
