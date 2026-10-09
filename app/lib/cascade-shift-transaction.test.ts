import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftCurriculumSessions, undoCurriculumShift } from './cascade-shift-transaction.ts';
const args = {operationId:'op',goalId:'g',lessonId:'L1',from:'2026-09-22',to:'2026-09-29',localDay:'2026-09-22',dayStartIso:'2026-09-22T00:00:00Z',dayEndIso:'2026-09-23T00:00:00Z'};
const snapshot = () => ({userId:'u',goal:{id:'g',user_id:'u',total_lessons:2,current_lesson:0,lessons_per_day:1,school_days:['Tue'],start_date:'2026-09-22'},rows:['2026-09-22','2026-09-29'].map((d,i)=>({id:`L${i+1}`,user_id:'u',curriculum_goal_id:'g',lesson_number:i+1,queue_position:i+1,scheduled_date:d,date:d,queue_pinned:false,scheduled_source:'wizard_create',completed:false,skipped:false,is_backfill:false,continues_lesson_id:null,updated_at:'v1'})),rowCount:2,vacations:[],localDay:args.localDay,dayStartIso:args.dayStartIso,dayEndIso:args.dayEndIso});
type Response = {data?: unknown; error?: {code:string}} | Error;
function fake(responses:Response[]) {
  const calls:{name:string,payload:unknown}[]=[];
  const client={rpc:async(name:string,payload:unknown)=>{calls.push({name,payload});const next=responses.shift();if(next instanceof Error)throw next;assert.ok(next,'unexpected RPC');return next;}} as unknown as SupabaseClient;
  return {client,calls};
}
const ready=()=>({data:{status:'ready',snapshot:snapshot()}});
test('coordinator never falls back when atomic RPC is unavailable',async()=>{
  const f=fake([{error:{code:'PGRST202'}}]);assert.deepEqual(await shiftCurriculumSessions(f.client,args),{status:'refused',reason:'unavailable'});assert.deepEqual(f.calls.map(x=>x.name),['read_cascade_snapshot']);
});
test('lost commit response retries exactly the original operation and payload',async()=>{
  const f=fake([ready(),new Error('response lost'),{data:{status:'already_applied'}}]);
  assert.deepEqual(await shiftCurriculumSessions(f.client,args),{status:'applied',operationId:'op',writtenIds:['L1','L2']});
  assert.equal(f.calls.length,3);assert.equal(f.calls[1].name,'commit_cascade_shift');assert.strictEqual(f.calls[1].payload,f.calls[2].payload);
});
for(const status of ['stale','invalid','failed','already_undone'])test(`server ${status} cannot be mistaken for success`,async()=>{
 const f=fake([ready(),{data:{status}}]);const result=await shiftCurriculumSessions(f.client,args);assert.equal(result.status,'refused');assert.equal(f.calls.length,2);
});
test('two uncertain commit responses return unknown, never claim nothing moved',async()=>{
 const f=fake([ready(),new Error('offline'),new Error('offline')]);assert.deepEqual(await shiftCurriculumSessions(f.client,args),{status:'unknown',operationId:'op'});assert.equal(f.calls.length,3);
});
test('malformed or incomplete snapshot cannot cause a write',async()=>{
 for(const bad of [{},{...snapshot(),rowCount:3},{...snapshot(),vacations:undefined}]){
  const f=fake([{data:{status:'ready',snapshot:bad}}]);assert.equal((await shiftCurriculumSessions(f.client,args)).status,'refused');assert.equal(f.calls.length,1);
 }
});
test('Undo retries the same receipt after lost response and recognizes idempotent success',async()=>{
 const f=fake([new Error('response lost'),{data:{status:'already_undone'}}]);assert.equal(await undoCurriculumShift(f.client,'op'),'undone');assert.deepEqual(f.calls,[{name:'undo_cascade_shift',payload:{p_operation_id:'op'}},{name:'undo_cascade_shift',payload:{p_operation_id:'op'}}]);
});
test('stale Undo does not attempt a client restore',async()=>{
 const f=fake([{data:{status:'stale'}}]);assert.equal(await undoCurriculumShift(f.client,'op'),'stale');assert.equal(f.calls.length,1);
});
