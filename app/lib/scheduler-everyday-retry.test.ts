import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {commitLessonAdd} from './scheduler-lesson-add.ts';
import {commitGoalRetire} from './scheduler-goal-retire.ts';
const values={title:'Synthetic',child_id:'c',lesson_number:6,minutes_spent:17,notes:null,scheduled_date:'2026-10-09',completed:false};
for(const kind of ['add','retire'] as const){
 const run=(c:SupabaseClient,other=false)=>kind==='add'?commitLessonAdd(c,'g',{...values,title:other?'Other':'Synthetic'}):commitGoalRetire(c,'g',other?'delete':'stop');
 test(`${kind}: uncertain busy keeps original request and blocks a different intent`,async()=>{
  let reads=0;const calls:Record<string,unknown>[]=[];
  const c={async rpc(name:string,args:Record<string,unknown>){
   if(name==='read_scheduler_state'){reads++;return{data:{status:'ready',mode:'atomic_v2',snapshot:{rows:[]}},error:null};}
   calls.push(args);if(calls.length===1)throw Error('response lost');
   return{data:calls.length===2?{status:'busy'}:{status:'already_applied',row:{id:'l'},updatedExisting:false},error:null};
  }} as unknown as SupabaseClient;
  assert.equal((await run(c)).status,'unknown');assert.equal(calls.length,2);
  assert.equal((await run(c,true)).status,'unknown');assert.equal(calls.length,2);
  assert.equal((await run(c)).status,'already_applied');assert.equal(reads,1);assert.deepEqual(calls[0],calls[2]);
 });
 test(`${kind}: definitive stale after uncertain delivery permits a fresh explicit attempt`,async()=>{
  let reads=0;const calls:Record<string,unknown>[]=[];
  const c={async rpc(name:string,args:Record<string,unknown>){
   if(name==='read_scheduler_state'){reads++;return{data:{status:'ready',mode:'atomic_v2',snapshot:{revision:reads,rows:[]}},error:null};}
   calls.push(args);if(calls.length===1)throw Error('not delivered');
   return{data:calls.length===2?{status:'stale',reason:'schedule_changed'}:{status:'applied',row:{id:'l'},updatedExisting:false},error:null};
  }} as unknown as SupabaseClient;
  assert.equal((await run(c)).status,'stale');assert.equal((await run(c)).status,'applied');
  assert.equal(reads,2);assert.deepEqual(calls[0],calls[1]);assert.notEqual(calls[0].p_operation_id,calls[2].p_operation_id);
 });
 test(`${kind}: missing protected endpoint never returns legacy`,async()=>{
  const c={async rpc(name:string){return name==='read_scheduler_state'?{data:{status:'ready',mode:'atomic_v2',snapshot:{rows:[]}},error:null}:{data:null,error:{code:'PGRST202',message:'missing'}};}} as unknown as SupabaseClient;
  assert.equal((await run(c)).status,'invalid');
 });
}
