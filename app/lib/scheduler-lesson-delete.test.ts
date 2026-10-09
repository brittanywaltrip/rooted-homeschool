import test from 'node:test';import assert from 'node:assert/strict';
import {prepareLessonDelete} from './scheduler-lesson-delete.ts';
import type {SupabaseClient} from '@supabase/supabase-js';
test('Undo cancellation performs no delete; commit uses pre-delay snapshot',async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];let revision=1;
 const c={async rpc(name:string,args:Record<string,unknown>){calls.push({name,args});return {error:null,data:name==='read_scheduler_state'?{status:'ready',mode:'atomic_v2',snapshot:{revision,rows:[]}}:{status:'stale',reason:'schedule_changed'}};}} as unknown as SupabaseClient;
 const commit=await prepareLessonDelete(c,[{id:'lesson',curriculum_goal_id:'goal'}]);assert.equal(calls.length,1);revision=2;
 await assert.rejects(commit,/schedule changed/);assert.equal(calls.length,2);assert.deepEqual(calls[1].args.p_expected,{revision:1,rows:[]});
});
test('all goals are prepared before a delete can run and failed preparation writes nothing',async()=>{
 const calls:string[]=[];const c={async rpc(name:string,args:Record<string,unknown>){calls.push(name);return {error:null,data:{status:'ready',mode:args.p_goal_id==='b'?'paused':'atomic_v2',snapshot:{rows:[]}}};}} as unknown as SupabaseClient;
 await assert.rejects(prepareLessonDelete(c,[{id:'1',curriculum_goal_id:'a'},{id:'2',curriculum_goal_id:'b'}]),/paused/);assert.deepEqual(calls,['read_scheduler_state','read_scheduler_state']);
});
test('lost deletion reply retries same operation without rereading a deleted lesson',async()=>{
 const calls:Array<Record<string,unknown>>=[];let reads=0;
 const c={async rpc(name:string,args:Record<string,unknown>){if(name==='read_scheduler_state'){reads++;return {data:{status:'ready',mode:'atomic_v2',snapshot:{rows:[]}},error:null};}calls.push(args);if(calls.length===1)throw Error('reply lost');return{data:{status:'already_applied'},error:null};}} as unknown as SupabaseClient;
 await (await prepareLessonDelete(c,[{id:'1',curriculum_goal_id:'a'}]))();assert.equal(reads,1);assert.deepEqual(calls[0],calls[1]);
});
