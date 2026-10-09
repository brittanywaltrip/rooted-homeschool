import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {assertLegacyLessonAction,checkedLessonWrite} from './scheduler-refusal.ts';
const client=(rows:unknown[],mode='atomic_v2')=>({from:()=>({select:()=>({in:async()=>({data:rows,error:null})})}),rpc:async()=>({data:{status:'ready',mode},error:null})}) as unknown as SupabaseClient;
test('mixed legacy/protected intent is refused before caller starts any writes',async()=>{
 let writes=0;
 await assert.rejects(async()=>{await assertLegacyLessonAction(client([{id:'a',curriculum_goal_id:null},{id:'b',curriculum_goal_id:'g'}]),['a','b']);writes++;},/protected curriculum/);
 assert.equal(writes,0);
});
test('one-off and explicitly legacy lesson operations remain available',async()=>{
 await assertLegacyLessonAction(client([{id:'a',curriculum_goal_id:null}]),['a']);
 await assertLegacyLessonAction(client([{id:'b',curriculum_goal_id:'g'}],'legacy'),['b']);
});
test('missing target read fails closed rather than partially executing batch',async()=>{
 await assert.rejects(assertLegacyLessonAction(client([{id:'a',curriculum_goal_id:null}]),['a','missing']),/every lesson/);
});
test('resolved PostgREST refusal throws and does not reach success callback',async()=>{
 let success=false;
 await assert.rejects(async()=>{await checkedLessonWrite(Promise.resolve({error:{code:'P0001',message:'scheduler_client_upgrade_required'}}));success=true;},/protected curriculum/);
 assert.equal(success,false);
});
