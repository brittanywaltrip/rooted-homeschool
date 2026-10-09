import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {commitHistoryHeal,undoHistoryContinuation} from './scheduler-history-healing.ts';
const intent={kind:'history_insert' as const,slot:1,date:'2026-10-01'};
const ready={data:{status:'ready',mode:'atomic_v2',localDay:'2026-10-10',snapshot:{goal:{},rows:[],vacations:[]}},error:null};
test('ambiguous insert then busy retains exact original operation/preimage until replay resolves',async()=>{
 const calls: unknown[]=[];let reads=0;let writes=0;
 const client={rpc:async(name:string,args:unknown)=>{
  if(name==='read_scheduler_state'){reads++;return ready;}
  calls.push(args);writes++;
  if(writes===1)throw new Error('lost response after possible commit');
  return {data:{status:writes===2?'busy':'already_applied',written:1},error:null};
 }} as unknown as SupabaseClient;
 assert.equal((await commitHistoryHeal(client,'g',intent)).status,'unknown');
 assert.equal((await commitHistoryHeal(client,'g',{...intent,slot:2})).status,'unknown');
 assert.equal((await commitHistoryHeal(client,'g',intent)).status,'already_applied');
 assert.equal(reads,1);assert.equal(calls.length,3);assert.equal(new Set(calls.map(x=>JSON.stringify(x))).size,1);
});
test('only explicit legacy mode or absent state RPC permits legacy writes',async()=>{
 for(const response of [{data:{...ready.data,mode:'legacy'},error:null},{data:null,error:{code:'PGRST202'}}]){
  const client={rpc:async()=>response} as unknown as SupabaseClient;
  assert.equal((await commitHistoryHeal(client,'g',intent)).status,'legacy');
 }
 for(const response of [{data:null,error:{code:'PGRST003'}},{data:{...ready.data,mode:'paused'},error:null},{data:{},error:null}]){
  const client={rpc:async()=>response} as unknown as SupabaseClient;
  assert.notEqual((await commitHistoryHeal(client,'g',intent)).status,'legacy');
 }
});
test('missing insert endpoint refuses and never falls back to direct insert',async()=>{
 const client={rpc:async(name:string)=>name==='read_scheduler_state'?ready:{data:null,error:{code:'PGRST202'}}} as unknown as SupabaseClient;
 assert.equal((await commitHistoryHeal(client,'g',intent)).status,'invalid');
});
test('malformed success remains ambiguous and retains token',async()=>{
 let calls=0;
 const client={rpc:async(name:string)=>{if(name==='read_scheduler_state')return ready;calls++;return {data:{},error:null};}} as unknown as SupabaseClient;
 assert.equal((await commitHistoryHeal(client,'g',intent)).status,'unknown');assert.equal(calls,2);
});
test('continuation helper sends fixed intent, returns server row, and Undo uses only receipt',async()=>{
 const calls: Array<{name:string;args:unknown}>=[];
 const client={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return name==='read_scheduler_state'?ready:{data:name==='undo_scheduler_continuation'?{status:'undone'}:{status:'applied',row:{id:'new'}},error:null};}} as unknown as SupabaseClient;
 const out=await commitHistoryHeal(client,'g',{kind:'continue',parentLessonId:'root',targetDate:'2026-10-11'});
 assert.equal(out.row?.id,'new');assert.ok(out.operationId);
 assert.equal((await undoHistoryContinuation(client,out.operationId!)).status,'undone');
 assert.deepEqual(calls.at(-1),{name:'undo_scheduler_continuation',args:{p_operation_id:out.operationId}});
});
