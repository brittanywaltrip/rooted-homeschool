import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {commitCalendarAction,undoCalendarAction} from '../../app/lib/scheduler-contained.ts';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
assert.equal(input.url,'http://127.0.0.1:54321');
const client=createClient(input.url,input.anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${input.token}`}}});
const rpc=client.rpc.bind(client);const seen=[];let dropped=0;
client.rpc=async function(name,args){const result=await rpc(name,args);if(name==='commit_scheduler_calendar'){
 seen.push(JSON.stringify(args));if(dropped++<2){assert.equal(result.error,null);assert.ok(['applied','already_applied'].includes(result.data.status),JSON.stringify(result.data));throw new Error('Synthetic response lost');}
}return result;};
assert.equal((await commitCalendarAction(client,input.action)).status,'unknown');
const retry=await commitCalendarAction(client,input.action);assert.equal(retry.status,'already_applied');
assert.equal(new Set(seen).size,1);assert.equal(retry.written,3);
assert.equal((await undoCalendarAction(client,retry.operationId)).status,'undone');
console.log(JSON.stringify({identical_requests:seen.length,undo:true}));
