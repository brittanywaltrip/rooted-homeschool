import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {isDefinitiveSchedulerRejection} from './scheduler-terminal-result.ts';
import {respreadContainedGoal} from './parent-respread-contained.ts';
import {commitContainedAction} from './scheduler-contained.ts';
import {commitHistoryHeal,hasPendingHistoryHeal} from './scheduler-history-healing.ts';
import {commitBulkCompletion} from './scheduler-bulk-completion.ts';
const day='2026-10-09';
const row={id:'l',curriculum_goal_id:'g',queue_position:1,scheduled_date:day,queue_pinned:false,completed:false,skipped:false};
for (const kind of ['refresh','completion','catchup','bulk'] as const) {
 test(`${kind}: no commit then concurrent change and definitive stale permits fresh retry`,async()=>{
  let reads=0;const commits:Record<string,unknown>[]=[];
  const c={async rpc(name:string,args:Record<string,unknown>){
   if(name==='read_scheduler_state'){reads++;return {error:null,data:{status:'ready',mode:'atomic_v2',localDay:day,snapshot:{goal:{id:'g',revision:reads},rows:[row],vacations:[]}}};}
   commits.push(args);
   if(commits.length===1)throw Error('transport failure before delivery');
   if(commits.length===2)return {error:null,data:{status:'stale',reason:'schedule_changed'}};
   return {error:null,data:{status:'applied',written:0,writtenIds:[]}};
  }} as unknown as SupabaseClient;
  const run=()=>kind==='refresh'?respreadContainedGoal(c,'g','completion_respread')
   :kind==='completion'?commitContainedAction(c,'g',{kind:'complete',lessonId:'l',payload:{completed:true}})
   :kind==='catchup'?commitHistoryHeal(c,'g',{kind:'history_insert',slot:2,date:day})
   :commitBulkCompletion(c,'g',[{lessonId:'l',dateStr:day,choice:'today'}],day);
  assert.equal((await run()).status,'stale');assert.equal(reads,1);assert.deepEqual(commits[0],commits[1]);
  if(kind==='catchup')assert.equal(hasPendingHistoryHeal(c,'g'),false);
  assert.equal((await run()).status,'applied');assert.equal(reads,2);
  assert.notEqual(commits[0].p_operation_id,commits[2].p_operation_id);
  assert.notDeepEqual(commits[0].p_expected,commits[2].p_expected);
 });
}
test('only known structured no-commit results retire an uncertain attempt',()=>{
 for(const status of ['busy','invalid','unknown','legacy'])assert.equal(isDefinitiveSchedulerRejection({status,reason:'schedule_changed'}),false);
 for(const reason of ['busy','later_edit',undefined,'unknown_future_reason'])assert.equal(isDefinitiveSchedulerRejection({status:'stale',reason}),false);
 assert.equal(isDefinitiveSchedulerRejection({status:'stale',reason:'local_day_changed'}),true);
});
