import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canOfferProtectedLessonResume } from './builder-resume-guidance.ts';
const fixture = () => ({status:'ready',mode:'atomic_v2',localDay:'2026-10-10',dayStartIso:'2026-10-10T00:00:00Z',dayEndIso:'2026-10-11T00:00:00Z',snapshot:{goal:{id:'g',total_lessons:4,current_lesson:3,start_at_lesson:1,lessons_per_day:1,school_days:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],start_date:'2026-10-01'},rows:[1,2,3,4].map(n=>({id:String(n),curriculum_goal_id:'g',lesson_number:n,queue_position:n,completed:n===1||n===3,completed_at:n===1||n===3?'2026-10-08T18:00:00Z':null,skipped:false,is_backfill:false,queue_pinned:false,queue_preserved:n===2,date:'2026-10-09',scheduled_date:'2026-10-09'})),vacations:[]}});
function client(data: unknown, error: unknown=null) {
 return {rpc:async(name:string,args:unknown)=>{assert.equal(name,'read_scheduler_state');assert.deepEqual(args,{p_goal_id:'g'});return {data,error};}} as unknown as SupabaseClient;
}
test('offers existing protected resume for an unfinished earlier lesson, without mutating snapshot',async()=>{
 const state=fixture(),before=structuredClone(state);assert.equal(await canOfferProtectedLessonResume(client(state),'g',2),true);assert.deepEqual(state,before);
});
for(const mode of ['legacy','paused','unknown'])test(`does not direct ${mode} course to protected resume`,async()=>{assert.equal(await canOfferProtectedLessonResume(client({...fixture(),mode}),'g',2),false);});
for(const patch of [{queue_position:null},{queue_position:8},{skipped:true},{is_backfill:true},{completed:true}])test(`does not promise unavailable target ${JSON.stringify(patch)}`,async()=>{
 const state=fixture();Object.assign(state.snapshot.rows[1],patch);assert.equal(await canOfferProtectedLessonResume(client(state),'g',2),false);
});
test('missing, malformed, failed and wrong-goal reads fail closed',async()=>{
 const wrong=fixture();wrong.snapshot.goal.id='other';
 for(const data of [null,{},wrong,{status:'ready',mode:'atomic_v2',snapshot:{goal:{id:'g'}}}])assert.equal(await canOfferProtectedLessonResume(client(data),'g',2),false);
 assert.equal(await canOfferProtectedLessonResume(client(null,{code:'PGRST202'}),'g',2),false);
});
