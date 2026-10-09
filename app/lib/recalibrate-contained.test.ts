import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {recalibrateContained,planContainedRecalibration} from './recalibrate-contained.ts';
const snapshot={goal:{id:'g',total_lessons:3,current_lesson:0,lessons_per_day:1,school_days:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],start_date:'2026-01-01'},rows:[1,2,3].map(n=>({id:String(n),lesson_number:n,queue_position:n,completed:false,skipped:false,queue_pinned:false,queue_preserved:false,is_backfill:false,continues_lesson_id:null,date:`2026-01-0${n}`,scheduled_date:`2026-01-0${n}`})),vacations:[]};
const state={status:'ready',mode:'atomic_v2',snapshot,localDay:'2026-01-01',dayStartIso:'2026-01-01T00:00:00Z',dayEndIso:'2026-01-02T00:00:00Z'};
const success={status:'applied',gapCount:1,keptPinned:[],estimates:[],unscheduled:['1'],respread:['2','3'],bookOrderRestored:false};
test('projection uses canonical day, queue order and only fixed tail dates',()=>{
 assert.deepEqual(planContainedRecalibration(state as never,2),[{id:'2',date:'2026-01-01'},{id:'3',date:'2026-01-02'}]);
 assert.equal(planContainedRecalibration(state as never,2.5),null);
 assert.deepEqual(planContainedRecalibration({...state,snapshot:{...snapshot,rows:snapshot.rows.slice(1)}} as never,2),[{id:'2',date:'2026-01-01'},{id:'3',date:'2026-01-02'}]);
});
test('lost response retries retained exact operation; different intent cannot replace it',async()=>{
 const requests:unknown[]=[];let calls=0;let reads=0;
 const client={rpc:async(name:string,args:unknown)=>{
  if(name==='read_scheduler_state'){reads++;return {data:state,error:null};}
  requests.push(args);if(calls++<2)throw new Error('lost');return {data:{...success,status:'already_applied'},error:null};
 }} as unknown as SupabaseClient;
 const opts={goalId:'g',newCurrentLesson:2};
 await assert.rejects(recalibrateContained(client,opts),/could not confirm/);
 await assert.rejects(recalibrateContained(client,{...opts,newCurrentLesson:3}),/could not confirm/);
 const result=await recalibrateContained(client,opts);assert.equal(result?.newCountDone,1);assert.equal(reads,1);assert.equal(new Set(requests.map(x=>JSON.stringify(x))).size,1);
});
test('only explicit legacy/missing state RPC permits legacy writer',async()=>{
 for(const response of [{data:{status:'ready',mode:'legacy'},error:null},{data:null,error:{code:'PGRST202'}}]) {
  const client={rpc:async()=>response} as unknown as SupabaseClient;assert.equal(await recalibrateContained(client,{goalId:'g',newCurrentLesson:2}),null);
 }
 const paused={rpc:async()=>({data:{...state,mode:'paused'},error:null})} as unknown as SupabaseClient;
 await assert.rejects(recalibrateContained(paused,{goalId:'g',newCurrentLesson:2}),/paused/);
});
test('definite busy refusal retains no pending action and allows fresh read',async()=>{
 let reads=0;
 const client={rpc:async(name:string)=>{if(name==='read_scheduler_state'){reads++;return {data:state,error:null};}return {data:{status:'busy'},error:null};}} as unknown as SupabaseClient;
 await assert.rejects(recalibrateContained(client,{goalId:'g',newCurrentLesson:2}),/still saving/);
 await assert.rejects(recalibrateContained(client,{goalId:'g',newCurrentLesson:2}),/still saving/);assert.equal(reads,2);
});

test('ordinary selected pin releases in projection while other pins and extras stay held',()=>{
 const changed=structuredClone(state);changed.snapshot.rows[1].queue_pinned=true;changed.snapshot.rows[2].queue_pinned=true;assert.deepEqual(planContainedRecalibration(changed as never,2),[{id:'2',date:'2026-01-01'}]);assert.equal(changed.snapshot.rows[1].queue_pinned,true);
});
test('unknown recalibration retires a proven local-day rejection before a fresh request',async()=>{
 let calls=0,reads=0;const c={rpc:async(name:string)=>{if(name==='read_scheduler_state'){reads++;return{data:state,error:null};}if(calls++<2)throw Error('lost');if(calls===3)return{data:{status:'stale',reason:'local_day_changed'},error:null};return{data:success,error:null};}} as unknown as SupabaseClient;const intent={goalId:'g',newCurrentLesson:2};await assert.rejects(recalibrateContained(c,intent),/could not confirm/);await assert.rejects(recalibrateContained(c,intent),/Nothing changed/);assert.ok(await recalibrateContained(c,intent));assert.equal(reads,2);
});

test('recalibration never proposes writes for an unfinished backfill row',()=>{const changed=structuredClone(state);changed.snapshot.rows[2].is_backfill=true;assert.deepEqual(planContainedRecalibration(changed as never,2),[{id:'2',date:'2026-01-01'}]);});

test('explicit resume releases only the selected preserved pin and keeps input immutable',()=>{
 const changed=structuredClone(state);changed.snapshot.rows[1].queue_preserved=true;changed.snapshot.rows[1].queue_pinned=true;changed.snapshot.rows[2].queue_preserved=true;
 assert.deepEqual(planContainedRecalibration(changed as never,2),[{id:'2',date:'2026-01-01'}]);
 assert.equal(changed.snapshot.rows[1].queue_preserved,true);assert.equal(changed.snapshot.rows[1].queue_pinned,true);
});
test('preserved gap remains uncompleted even when history is requested',()=>{
 const changed=structuredClone(state);changed.snapshot.rows[0].queue_preserved=true;
 assert.deepEqual(planContainedRecalibration(changed as never,2,true),[{id:'2',date:'2026-01-01'},{id:'3',date:'2026-01-02'}]);
});
test('unresumable preserved rows refuse before sending a mutation',async()=>{
 for(const patch of [{queue_position:null},{queue_position:8},{skipped:true},{is_backfill:true}]){
  const changed=structuredClone(state);Object.assign(changed.snapshot.rows[1],{queue_preserved:true},patch);
  let writes=0;const client={rpc:async(name:string)=>{if(name==='read_scheduler_state')return{data:changed,error:null};writes++;return{data:success,error:null};}} as unknown as SupabaseClient;
  await assert.rejects(recalibrateContained(client,{goalId:'g',newCurrentLesson:2}),/queue position needs review/);assert.equal(writes,0);
 }
});
test('retry of an undone resume reports the outcome rather than reapplying it',async()=>{
 const client={rpc:async(name:string)=>({data:name==='read_scheduler_state'?state:{status:'already_undone'},error:null})} as unknown as SupabaseClient;
 await assert.rejects(recalibrateContained(client,{goalId:'g',newCurrentLesson:2}),/already undone/);
});
