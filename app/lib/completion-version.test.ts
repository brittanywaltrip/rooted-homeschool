import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {completeLessonOnDate} from './completeLessonOnDate.ts';
const completed={curriculum_goal_id:'g',queue_position:1,scheduled_date:'2026-10-05',queue_pinned:true,skipped:false,completed:true,completed_at:'2026-10-05T12:00:00Z'};
const args={lessonId:'l',dateStr:'2026-10-04',choice:'picked' as const,todayStr:'2026-10-09',surface:'plan' as const};
function reader(row:unknown){let writes=0;const chain={select(){return chain;},eq(){return chain;},async maybeSingle(){return{data:row,error:null};},update(){writes++;throw Error('unexpected write');}};return{client:{from:()=>chain,rpc:async()=>{writes++;throw Error('unexpected RPC');}} as unknown as SupabaseClient,writes:()=>writes};}
test('stale initial check-off never changes the winning completion',async()=>{const c=reader(completed);const result=await completeLessonOnDate(c.client,{...args,onlyIfIncomplete:true});assert.equal(result.error?.code,'already_completed');assert.equal(c.writes(),0);});
test('date correction refuses a changed completion timestamp or planned date before mutation',async()=>{
 for(const expectedCompletion of [{completed_at:'2026-10-03T12:00:00Z',scheduled_date:completed.scheduled_date},{completed_at:completed.completed_at,scheduled_date:'2026-10-03'}]){
 const c=reader(completed);const result=await completeLessonOnDate(c.client,{...args,expectedCompletion});assert.equal(result.error?.code,'placement_changed');assert.equal(c.writes(),0);
 }
});
test('correction refuses a lesson reopened after the chooser was opened',async()=>{const c=reader({...completed,completed:false});const result=await completeLessonOnDate(c.client,{...args,expectedCompletion:{completed_at:completed.completed_at,scheduled_date:completed.scheduled_date}});assert.equal(result.error?.code,'placement_changed');assert.equal(c.writes(),0);});
