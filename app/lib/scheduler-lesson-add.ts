import {durableSchedulerRpc} from './scheduler-recovery-journal.ts';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {SchedulerResult} from './scheduler-contained.ts';
import {isDefinitiveSchedulerRejection} from './scheduler-terminal-result.ts';
export type LessonAddValues={title:string;child_id:string;lesson_number:number|null;minutes_spent:number|null;notes:string|null;scheduled_date:string;completed:boolean};
type Result=SchedulerResult&{row?:Record<string,unknown>|null;updatedExisting?:boolean};
type Attempt={operation:string;expected:unknown;values:LessonAddValues;key:string;ambiguous?:boolean};
const pending=new WeakMap<SupabaseClient,Map<string,Attempt>>();
export async function commitLessonAdd(client:SupabaseClient,goal:string,values:LessonAddValues):Promise<Result>{
 let retained=pending.get(client);if(!retained){retained=new Map();pending.set(client,retained);}
 let attempt=retained.get(goal);const key=JSON.stringify(values);
 if(attempt&&attempt.key!==key)return{status:'unknown',reason:'pending_previous_add'};
 if(!attempt){
  let response;try{response=await client.rpc('read_scheduler_state',{p_goal_id:goal});}catch{return{status:'invalid',reason:'state_unavailable'};}
  const {data,error}=response;if(error)return{status:error.code==='PGRST202'?'legacy':'invalid'};
  if(data?.status!=='ready')return{status:'invalid'};if(data.mode==='legacy'||data.mode==='paused')return{status:data.mode};
  if(data.mode!=='atomic_v2'||!Array.isArray(data.snapshot?.rows))return{status:'invalid'};
  attempt={operation:crypto.randomUUID(),expected:data.snapshot,values,key};retained.set(goal,attempt);
 }
 const invoke=async():Promise<Result>=>{
  try{
   const {data,error}=await durableSchedulerRpc(client, 'commit_scheduler_add',{p_operation_id:attempt.operation,p_goal_id:goal,p_expected:attempt.expected,p_values:attempt.values});
   if(error){const code=error.code??'';return {status:['55P03','57014','PGRST003'].includes(code)||code.startsWith('40')?'busy':['P0001','42501','PGRST202'].includes(code)||code.startsWith('22')||code.startsWith('23')?'invalid':'unknown',reason:error.message};}
   if(!data||!['applied','already_applied','already_undone','busy','stale','invalid','paused'].includes(data.status))return{status:'unknown'};
   if(['applied','already_applied'].includes(data.status)&&(!('row' in data)||typeof data.updatedExisting!=='boolean'))return{status:'unknown'};
   return data;
  }catch{return{status:'unknown'};}
 };
 let result=await invoke();if(result.status==='unknown'){attempt.ambiguous=true;result=await invoke();}
 const confirmed=['applied','already_applied','already_undone'].includes(result.status);
 if(attempt.ambiguous&&!confirmed&&!isDefinitiveSchedulerRejection(result))return{status:'unknown',operationId:attempt.operation};
 retained.delete(goal);return{...result,operationId:attempt.operation};
}
