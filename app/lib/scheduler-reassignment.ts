import type {SupabaseClient} from '@supabase/supabase-js';
import {durableSchedulerRpc} from './scheduler-recovery-journal.ts';
import {isDefinitiveSchedulerRejection} from './scheduler-terminal-result.ts';
import type {SchedulerResult} from './scheduler-contained.ts';
type Changes=Record<string,unknown>;
type Attempt={key:string;args:Record<string,unknown>;uncertain:boolean};
const pending=new WeakMap<SupabaseClient,Map<string,Attempt>>();
export async function reassignContainedLesson(client:SupabaseClient,lesson:string,changes:Changes,originals:Changes):Promise<SchedulerResult>{
 let map=pending.get(client);if(!map){map=new Map();pending.set(client,map);}const key=JSON.stringify({changes,originals});let attempt=map.get(lesson);
 if(attempt&&attempt.key!==key)return{status:'unknown',reason:'pending_previous_reassignment'};
 if(!attempt){
  const {data,error}=await client.rpc('read_scheduler_calendar',{});if(error?.code==='PGRST202'||data?.mode==='legacy')return{status:'legacy'};
  if(error||data?.status!=='ready')return{status:'invalid',reason:'state_unavailable'};
  attempt={key,uncertain:false,args:{p_operation_id:crypto.randomUUID(),p_lesson_id:lesson,p_expected:data.snapshot,p_changes:changes,p_originals:originals}};map.set(lesson,attempt);
 }
 for(let i=0;i<2;i++){
  try{
   const {data,error}=await durableSchedulerRpc(client,'commit_scheduler_reassign',attempt.args);
   if(!error&&data&&['applied','already_applied','already_undone'].includes(data.status)){map.delete(lesson);return{...data,operationId:attempt.args.p_operation_id};}
   if(!error&&data&&(isDefinitiveSchedulerRejection(data)||!attempt.uncertain&&['busy','stale','invalid','paused','legacy'].includes(data.status))){map.delete(lesson);return data;}
   if(error&&!attempt.uncertain&&/^(P0001|42501|22|23|40|55P03|57014)/.test(error.code)){map.delete(lesson);return{status:'invalid',reason:error.message};}
  }catch{/* Retain the original complete request. */}
  attempt.uncertain=true;
 }
 return{status:'unknown',operationId:String(attempt.args.p_operation_id)};
}
export async function undoContainedReassignment(client:SupabaseClient,operation:string):Promise<SchedulerResult>{
 try{const {data,error}=await durableSchedulerRpc(client,'undo_scheduler_reassign',{p_operation_id:operation});return error||!data?{status:'unknown'}:data;}catch{return{status:'unknown'};}
}
