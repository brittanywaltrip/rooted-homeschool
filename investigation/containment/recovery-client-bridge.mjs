import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {answerMissedYes,MissedCompletionError} from '../../app/lib/missed-work-answers.ts';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
assert.equal(input.url,'http://127.0.0.1:54321');
const client=createClient(input.url,input.anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${input.token}`}}});
const rpc=client.rpc.bind(client);const seen=[];let dropped=0;const events=[];
client.rpc=async function(name,args){
 const result=await rpc(name,args);
 if(name==='commit_scheduler_history_heal'){
  seen.push(JSON.stringify(args));
  if(dropped++<2){assert.equal(result.error,null);throw new Error('Synthetic response lost after catch-up insert');}
 }
 return result;
};
const row={goal_id:input.goal,lesson_number:1,date:input.date,choice:'planned'};
const deps={supabase:client,userId:input.user,todayStr:input.day,entriesByGoal:new Map([[input.goal,[row]]]),goals:[{id:input.goal,child_id:input.child,curriculum_name:'Synthetic recovery',subject_label:null}],subjects:[],track:(event)=>events.push(event)};
await assert.rejects(answerMissedYes(deps,[row]),MissedCompletionError);
const before=await rpc('read_scheduler_state',{p_goal_id:input.goal});
const saved=before.data.snapshot.rows.find(r=>r.queue_position===1);
assert.equal(saved.scheduled_source,'completion_planned');assert.equal(saved.date,input.date);
assert.deepEqual(await answerMissedYes(deps,[row]),{completedCount:1});
const after=await rpc('read_scheduler_state',{p_goal_id:input.goal});
assert.deepEqual(after.data.snapshot.rows.find(r=>r.queue_position===1),saved);
assert.equal(new Set(seen).size,1);assert.equal(events.filter(e=>e==='lesson_completed').length,1);
const next=after.data.snapshot.rows.find(r=>r.queue_position===2);assert.equal(next.scheduled_date,input.day);
const existingRow={goal_id:input.goal,lesson_number:2,date:input.day,choice:'planned'};
const existingDeps={...deps,entriesByGoal:new Map([[input.goal,[existingRow]]])};
let existingDropped=0;const existingSeen=[];
client.rpc=async function(name,args){
 const result=await rpc(name,args);
 if(name==='commit_scheduler_action'){
  existingSeen.push(JSON.stringify(args));
  if(existingDropped++<2){assert.equal(result.error,null);throw new Error('Synthetic lost existing completion');}
 }
 return result;
};
await assert.rejects(answerMissedYes(existingDeps,[existingRow]),MissedCompletionError);
const existingBefore=await rpc('read_scheduler_state',{p_goal_id:input.goal});
const existingSaved=existingBefore.data.snapshot.rows.find(r=>r.queue_position===2);
assert.equal(existingSaved.completed,true);
assert.deepEqual(await answerMissedYes(existingDeps,[existingRow]),{completedCount:1});
const existingAfter=await rpc('read_scheduler_state',{p_goal_id:input.goal});
assert.deepEqual(existingAfter.data.snapshot.rows.find(r=>r.queue_position===2),existingSaved);
assert.equal(new Set(existingSeen).size,1);assert.equal(existingSeen.length,3);
assert.equal(events.filter(e=>e==='lesson_completed').length,2);
console.log(JSON.stringify({existing_completion_replay:true,real_yes_replay:true,identical_requests:seen.length,source_preserved:true,history_unchanged:true,tail_respready:true}));
