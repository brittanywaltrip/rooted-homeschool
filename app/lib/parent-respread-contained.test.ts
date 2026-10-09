import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {respreadContainedGoal} from './parent-respread-contained.ts';
const state = {status:'ready',mode:'atomic_v2',localDay:'2026-10-09',snapshot:{goal:{id:'g'},rows:[],vacations:[]}};
const client = (rpc: (name: string, args: unknown) => Promise<unknown>) => ({rpc}) as unknown as SupabaseClient;
test('protected respread only sends a fresh full expectation and fixed source',async()=>{
 const calls: Array<[string,unknown]> = [];
 const c=client(async(n,a)=>{calls.push([n,a]);return {data:n==='read_scheduler_state'?state:{status:'applied',written:1,writtenIds:['row']},error:null};});
 const r=await respreadContainedGoal(c,'g','completion_respread');assert.equal(r.status,'applied');assert.equal(r.written,1);
 const p=calls[1][1] as Record<string,unknown>;assert.deepEqual(p.p_expected,state.snapshot);assert.equal(p.p_day,state.localDay);assert.equal(p.p_source,'completion_respread');assert.equal('p_writes' in p,false);
});
test('legacy and paused modes never invoke protected commit',async()=>{
 for(const mode of ['legacy','paused']) {let commits=0;const c=client(async(n)=>{if(n!=='read_scheduler_state')commits++;return{data:{...state,mode},error:null};});assert.equal((await respreadContainedGoal(c,'g','catchup_spread')).status,mode);assert.equal(commits,0);}
});
test('lost reply then busy retains exact operation through subsequent retry',async()=>{
 const requests: unknown[]=[];let reads=0;
 const c=client(async(n,a)=>{if(n==='read_scheduler_state'){reads++;return{data:state,error:null};}requests.push(a);if(requests.length===1)throw Error('lost response');if(requests.length===2)return{data:{status:'busy'},error:null};return{data:{status:'already_applied',written:1,writtenIds:['row']},error:null};});
 assert.equal((await respreadContainedGoal(c,'g','completion_respread')).status,'unknown');
 assert.equal((await respreadContainedGoal(c,'g','catchup_spread')).status,'unknown');
 assert.equal((await respreadContainedGoal(c,'g','completion_respread')).status,'already_applied');assert.equal(reads,1);assert.deepEqual(requests[0],requests[2]);
});
test('missing protected commit endpoint is refusal, never legacy fallback',async()=>{
 const c=client(async n=>n==='read_scheduler_state'?{data:state,error:null}:{data:null,error:{code:'PGRST202'}});
 assert.equal((await respreadContainedGoal(c,'g','completion_respread')).status,'invalid');
});
