import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {commitBulkCompletion,runCompletionGroups} from './scheduler-bulk-completion.ts';
const day='2026-10-09';
const rows=[{id:'one',curriculum_goal_id:'goal',queue_position:1,scheduled_date:day,queue_pinned:false,skipped:false,completed:false}];
const items=[{lessonId:'one',dateStr:day,choice:'today' as const}];
function fake(responses:unknown[],mode='atomic_v2') {
 const requests:Array<{name:string;args:Record<string,unknown>}>=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  requests.push({name,args});
  if(name==='read_scheduler_state')return {data:{status:'ready',mode,localDay:day,snapshot:{rows,goal:{},vacations:[]}}};
  const result=responses.shift();if(result instanceof Error)throw result;return result;
 }} as unknown as SupabaseClient;
 return {client,requests};
}
test('ambiguous then busy retains UUID/preimage; next check resolves original receipt',async()=>{
 const {client,requests}=fake([new Error('lost'),{data:{status:'busy'}},{data:{status:'already_applied'}}]);
 assert.equal((await commitBulkCompletion(client,'goal',items,day)).status,'unknown');
 assert.equal((await commitBulkCompletion(client,'goal',items,day)).status,'already_applied');
 const calls=requests.filter(x=>x.name==='commit_scheduler_bulk_completion');assert.equal(calls.length,3);
 assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[0],calls[2]);
 assert.equal(requests.filter(x=>x.name==='read_scheduler_state').length,1);
});
test('new choice cannot be inferred as success of ambiguous batch',async()=>{
 const {client,requests}=fake([new Error('lost'),new Error('lost')]);
 await commitBulkCompletion(client,'goal',items,day);
 const count=requests.length;
 assert.equal((await commitBulkCompletion(client,'goal',[{...items[0],choice:'planned'}],day)).status,'unknown');
 assert.equal(requests.length,count);
});
test('server day mismatch and already-completed state refuse before commit',async()=>{
 const {client,requests}=fake([]);
 assert.equal((await commitBulkCompletion(client,'goal',items,'2026-10-08')).status,'stale');
 assert.equal(requests.length,1);
});
test('definite SQL failure is not retained as ambiguous; missing commit cannot downgrade protected mode',async()=>{
 const {client,requests}=fake([{error:{code:'P0001',message:'suppressed'}},{error:{code:'PGRST202'}}]);
 assert.equal((await commitBulkCompletion(client,'goal',items,day)).status,'invalid');
 assert.equal((await commitBulkCompletion(client,'goal',items,day)).status,'invalid');
 assert.equal(requests.filter(x=>x.name==='read_scheduler_state').length,2);
});
test('legacy is a sentinel with no fixed RPC mutation',async()=>{
 const {client,requests}=fake([],'legacy');
 assert.equal((await commitBulkCompletion(client,'goal',items,day)).status,'legacy');assert.equal(requests.length,1);
});
test('same-goal items run serially in grouped callback; another goal proceeds independently',async()=>{
 const seen:string[]=[];
 await runCompletionGroups(['a1','b1','a2'],x=>x[0],async(group,goal)=>{
  seen.push('start'+goal);
  for(const item of group){seen.push(item);await Promise.resolve();}
  seen.push('end'+goal);
 });
 assert.ok(seen.indexOf('a1')<seen.indexOf('a2'));assert.equal(seen.filter(x=>x==='starta').length,1);assert.ok(seen.includes('b1'));
});
