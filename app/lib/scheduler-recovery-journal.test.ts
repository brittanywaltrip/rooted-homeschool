import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {durableSchedulerRpc,readSchedulerRecovery,recoverSchedulerEntry,undoRecoveredChange} from './scheduler-recovery-journal.ts';
function browser(){const items=new Map<string,string>();const original=globalThis.window;let lock=Promise.resolve();Object.defineProperty(globalThis,'window',{configurable:true,value:{navigator:{locks:{request(_name:string,run:()=>Promise<unknown>){const next=lock.then(run);lock=next.then(()=>{},()=>{});return next;}}},dispatchEvent(){},localStorage:{get length(){return items.size;},key:(i:number)=>[...items.keys()][i]??null,getItem:(k:string)=>items.get(k)??null,setItem:(k:string,v:string)=>items.set(k,v),removeItem:(k:string)=>items.delete(k)}}});return {items,restore(){Object.defineProperty(globalThis,'window',{configurable:true,value:original});}};}
const request={p_operation_id:'op',p_goal_id:'g',p_expected:{goal:{user_id:'owner'},rows:[]},p_values:{title:'Original'}};
const client=(rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>,owner='owner')=>({auth:{async getUser(){return{data:{user:{id:owner}},error:null};}},rpc}) as unknown as SupabaseClient;
test('lost committed addition reloads with exact token/payload and never duplicates',async()=>{
 const b=browser();try{let writes=0,calls=0;const ledger=new Map();const rpc=async(_n:string,args:Record<string,unknown>)=>{calls++;assert.deepEqual(args,request);if(!ledger.has(args.p_operation_id)){writes++;ledger.set(args.p_operation_id,true);throw Error('lost response');}return{data:{status:'already_applied',row:{id:'l'},updatedExisting:false},error:null};};
 await assert.rejects(durableSchedulerRpc(client(rpc),'commit_scheduler_add',request));const recovered=JSON.parse(JSON.stringify(readSchedulerRecovery('owner')[0]));
 assert.equal(recovered.uncertain,true);assert.equal(await recoverSchedulerEntry(client(rpc),recovered),true);assert.equal(writes,1);assert.equal(calls,2);const saved=readSchedulerRecovery('owner')[0];assert.equal(saved.phase,'confirmed');assert.deepEqual(saved.args,{});assert.equal(saved.undoRpc,'undo_scheduler_action');assert.equal(await undoRecoveredChange(client(async(name,args)=>{assert.equal(name,'undo_scheduler_action');assert.deepEqual(args,{p_operation_id:'op'});return{data:{status:'undone'},error:null};}),saved),'undone');assert.equal(readSchedulerRecovery('owner').length,0);
 }finally{b.restore();}
});
test('reload cannot replace an unknown operation with a fresh UUID, even after midnight',async()=>{
 const b=browser();try{let calls=0;const c=client(async()=>{calls++;throw Error('offline');});await assert.rejects(durableSchedulerRpc(c,'commit_scheduler_add',request));const reply=await durableSchedulerRpc(client(async()=>{calls++;throw Error('must not send');}),'commit_scheduler_add',{...request,p_operation_id:'new'});assert.equal(reply.error?.code,'SCHEDULER_RECOVERY_REQUIRED');assert.equal(calls,1);assert.equal(readSchedulerRecovery('owner')[0].operation,'op');}finally{b.restore();}
});
test('confirmed completion survives reload as tail-only work without sensitive snapshot',async()=>{
 const b=browser();try{let completions=0,refreshes=0;const c=client(async(name)=>{if(name==='read_scheduler_recovery')return{data:{status:'ready',goalState:'active',receiptPresent:true},error:null};if(name==='commit_scheduler_action'){completions++;return{data:{status:'applied'},error:null};}if(name==='read_scheduler_state')return{data:{status:'ready',mode:'atomic_v2',localDay:'2026-10-09',snapshot:{rows:[]}},error:null};if(name==='commit_scheduler_respread'){refreshes++;return{data:{status:'applied',written:0,writtenIds:[]},error:null};}throw Error(name);});
 await durableSchedulerRpc(c,'commit_scheduler_action',{...request,p_action:{kind:'complete',lessonId:'l',payload:{completed:true}}});const entry=readSchedulerRecovery('owner')[0];assert.equal(entry.phase,'tail');assert.deepEqual(entry.args,{});assert.equal(await recoverSchedulerEntry(c,entry),true);assert.equal(completions,1);assert.equal(refreshes,1);assert.equal(readSchedulerRecovery('owner').length,0);
 }finally{b.restore();}
});
test('lost before delivery then stale recovery clears only after definitive no-commit',async()=>{
 const b=browser();try{await assert.rejects(durableSchedulerRpc(client(async()=>{throw Error('not delivered');}),'commit_scheduler_add',request));const entry=readSchedulerRecovery('owner')[0];assert.equal(await recoverSchedulerEntry(client(async()=>({data:{status:'busy'},error:null})),entry),false);assert.equal(readSchedulerRecovery('owner').length,1);assert.equal(await recoverSchedulerEntry(client(async()=>({data:{status:'stale',reason:'schedule_changed'},error:null})),entry),true);assert.equal(readSchedulerRecovery('owner').length,0);}finally{b.restore();}
});
test('storage failure issues no mutation; account switch cannot replay another owner',async()=>{
 const b=browser();try{let calls=0;const c=client(async()=>{calls++;throw Error('lost');});await assert.rejects(durableSchedulerRpc(c,'commit_scheduler_add',request));const entry=readSchedulerRecovery('owner')[0];assert.equal(await recoverSchedulerEntry(client(async()=>{calls++;},'other'),entry),false);assert.equal(calls,1);window.localStorage.setItem=()=>{throw Error('quota');};const reply=await durableSchedulerRpc(c,'commit_scheduler_add',{...request,p_goal_id:'other',p_operation_id:'second'});assert.equal(reply.error?.code,'SCHEDULER_RECOVERY_REQUIRED');assert.equal(calls,1);}finally{b.restore();}
});

test('an expired recovered Undo retires its token without repeating the change',async()=>{
 const b=browser();try{await assert.rejects(durableSchedulerRpc(client(async()=>{throw Error('lost');}),'undo_scheduler_action',{p_operation_id:'undo'}));const entry=readSchedulerRecovery('owner')[0];assert.equal(await recoverSchedulerEntry(client(async()=>({data:{status:'stale',reason:'later_edit'},error:null})),entry),true);assert.equal(readSchedulerRecovery('owner').length,0);}finally{b.restore();}
});
test('history insertion retains its required catch-up source across reload',async()=>{
 const b=browser();try{await durableSchedulerRpc(client(async()=>({data:{status:'applied'},error:null})),'commit_scheduler_history_heal',{...request,p_action:{kind:'history_insert',origin:'history'}});const entry=readSchedulerRecovery('owner')[0];assert.equal(entry.phase,'tail');assert.equal(entry.tailSource,'catchup_spread');assert.deepEqual(entry.args,{});}finally{b.restore();}
});
test('a delayed respread clears only completion tails it captured before sending',async()=>{
 const b=browser();try{const done=client(async()=>({data:{status:'applied'},error:null}));await durableSchedulerRpc(done,'commit_scheduler_action',{...request,p_action:{kind:'complete'}});let release!:(value:unknown)=>void;const delayed=client(()=>new Promise(resolve=>{release=resolve;}));const refresh=durableSchedulerRpc(delayed,'commit_scheduler_respread',{...request,p_operation_id:'refresh'});while(!release)await Promise.resolve();
 // Simulate a completion acknowledged in another tab after this refresh began.
 const old=readSchedulerRecovery('owner').find(e=>e.phase==='tail')!;const later={...old,operation:'later'};window.localStorage.setItem('rooted:scheduler-recovery:v1:owner:commit_scheduler_action:later',JSON.stringify(later));release({data:{status:'applied'},error:null});await refresh;assert.deepEqual(readSchedulerRecovery('owner').map(e=>e.operation),['later']);}finally{b.restore();}
});

test('cascade transaction rollback is terminal even after transport uncertainty',async()=>{
 const b=browser();try{for(const rpc of ['commit_cascade_shift','undo_cascade_shift']){await assert.rejects(durableSchedulerRpc(client(async()=>{throw Error('lost');}),rpc,request));assert.equal(await recoverSchedulerEntry(client(async()=>({data:{status:'failed',reason:'transaction'},error:null})),readSchedulerRecovery('owner')[0]),true);assert.equal(readSchedulerRecovery('owner').length,0);}}finally{b.restore();}
});

test('recovery waits for an original in-flight request and cannot lose its token',async()=>{
 const b=browser();try{let release!:(value:unknown)=>void;let calls=0;const c=client(async()=>{calls++;return new Promise(resolve=>{release=resolve;});});const original=durableSchedulerRpc(c,'commit_scheduler_add',request);while(!release)await Promise.resolve();const entry=readSchedulerRecovery('owner')[0];const recovery=recoverSchedulerEntry(c,entry);await Promise.resolve();await Promise.resolve();assert.equal(calls,1);assert.equal(readSchedulerRecovery('owner').length,1);release({data:{status:'applied',updatedExisting:false},error:null});await original;assert.equal(await recovery,true);assert.equal(calls,1);assert.equal(readSchedulerRecovery('owner').length,0);}finally{b.restore();}
});

test('confirmed course deletion retires only that course completion tails',async()=>{
 const b=browser();try{const done=client(async()=>({data:{status:'applied'},error:null}));for(const goal of ['g','other'])await durableSchedulerRpc(done,'commit_scheduler_action',{...request,p_goal_id:goal,p_operation_id:goal,p_action:{kind:'complete'}});await durableSchedulerRpc(done,'commit_scheduler_retire',{...request,p_operation_id:'delete',p_kind:'delete'});assert.deepEqual(readSchedulerRecovery('owner').map(e=>e.goal),['other']);}finally{b.restore();}
});

test('archived completion tail persists across reload and only resumes after owned active proof',async()=>{
 const b=browser();try{let archived=true,refreshes=0;const c=client(async(name)=>{
  if(name==='read_scheduler_recovery')return{data:{status:'ready',goalState:archived?'archived':'active',receiptPresent:true},error:null};
  if(name==='commit_scheduler_action')return{data:{status:'applied'},error:null};
  if(name==='read_scheduler_state')return{data:{status:'ready',mode:'atomic_v2',localDay:'2026-10-09',snapshot:{rows:[]}},error:null};
  if(name==='commit_scheduler_respread'){refreshes++;return{data:{status:'applied',written:0,writtenIds:[]},error:null};}throw Error(name);
 });await durableSchedulerRpc(c,'commit_scheduler_action',{...request,p_action:{kind:'complete'}});assert.equal(await recoverSchedulerEntry(c,readSchedulerRecovery('owner')[0]),false);assert.equal(readSchedulerRecovery('owner')[0].deferred,true);assert.equal(refreshes,0);archived=false;assert.equal(await recoverSchedulerEntry(c,JSON.parse(JSON.stringify(readSchedulerRecovery('owner')[0]))),true);assert.equal(refreshes,1);assert.equal(readSchedulerRecovery('owner').length,0);
 }finally{b.restore();}
});
test('other-device delete retires only proven superseded work; missing owner never suffices',async()=>{
 const b=browser();try{await assert.rejects(durableSchedulerRpc(client(async()=>{throw Error('lost');}),'commit_scheduler_add',request));let state='unknown';let mutations=0;const c=client(async(name)=>{if(name==='read_scheduler_recovery')return{data:{status:'ready',goalState:state,receiptPresent:false},error:null};mutations++;return{data:{status:'invalid',reason:'owner'},error:null};});let entry=readSchedulerRecovery('owner')[0];assert.equal(await recoverSchedulerEntry(c,entry),false);assert.equal(readSchedulerRecovery('owner').length,1);state='archived';assert.equal(await recoverSchedulerEntry(c,entry),false);assert.equal(readSchedulerRecovery('owner')[0].deferred,true);state='deleted_verified';assert.equal(await recoverSchedulerEntry(c,entry),true);assert.equal(readSchedulerRecovery('owner').length,0);assert.equal(mutations,3);
 await durableSchedulerRpc(client(async()=>({data:{status:'applied'},error:null})),'commit_scheduler_action',{...request,p_action:{kind:'complete'}});entry=readSchedulerRecovery('owner')[0];assert.equal(await recoverSchedulerEntry(c,entry),true);assert.equal(mutations,3);assert.equal(readSchedulerRecovery('owner').length,0);
 }finally{b.restore();}
});
