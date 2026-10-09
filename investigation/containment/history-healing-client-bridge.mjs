import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {commitHistoryHeal,undoHistoryContinuation} from '../../app/lib/scheduler-history-healing.ts';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
assert.equal(input.url,'http://127.0.0.1:54321');
const client=createClient(input.url,input.anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${input.token}`}}});
const rpc=client.rpc.bind(client);const seen=[];let dropped=0;
client.rpc=async function(name,args){
 const result=await rpc(name,args);
 if(name==='commit_scheduler_history_heal'){
  seen.push(JSON.stringify(args));
  if(dropped++<2){assert.equal(result.error,null);throw new Error('Synthetic response lost after real server commit');}
 }
 return result;
};
assert.equal((await commitHistoryHeal(client,input.goal,input.action)).status,'unknown');
const retry=await commitHistoryHeal(client,input.goal,input.action);
assert.equal(retry.status,'already_applied');
assert.equal(new Set(seen).size,1);
assert.equal(retry.row.continues_lesson_id,input.action.parentLessonId);
assert.equal((await undoHistoryContinuation(client,retry.operationId)).status,'undone');
console.log(JSON.stringify({unknown_then_same_operation_replay:true,identical_requests:seen.length,undo:true}));
