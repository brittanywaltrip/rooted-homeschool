import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {logPastDayLessons} from '../../app/lib/logPastDayLessons.ts';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
assert.equal(input.url,'http://127.0.0.1:54321');
const client=createClient(input.url,input.anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${input.token}`}}});
const rpc=client.rpc.bind(client);const seen=[];let dropped=0;let events=0;let forbidden=0;
client.rpc=async function(name,args){
 if(name==='commit_scheduler_action')forbidden++;
 const result=await rpc(name,args);
 if(name==='commit_scheduler_history_heal'){
  seen.push(JSON.stringify(args));
  if(dropped++<2){assert.equal(result.error,null);throw new Error('Synthetic response lost after real history insert');}
 }
 return result;
};
const run=()=>logPastDayLessons(client,input.user,[{goal_id:input.goal,lesson_number:1,date:input.day}],[],{todayStr:input.day,track:()=>events++});
assert.deepEqual(await run(),{okCount:0,failedCount:1});
const before=await rpc('read_scheduler_state',{p_goal_id:input.goal});
assert.deepEqual(await run(),{okCount:1,failedCount:0});
const after=await rpc('read_scheduler_state',{p_goal_id:input.goal});
assert.deepEqual(after.data.snapshot,before.data.snapshot);
assert.equal(new Set(seen).size,1);assert.equal(forbidden,0);assert.equal(events,1);
console.log(JSON.stringify({public_wrapper_replay:true,identical_requests:seen.length,unchanged_completion:true,events}));
