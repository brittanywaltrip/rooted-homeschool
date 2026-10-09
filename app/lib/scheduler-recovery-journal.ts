import type {SupabaseClient} from '@supabase/supabase-js';
import {isDefinitiveSchedulerRejection} from './scheduler-terminal-result.ts';

type Reply = Awaited<ReturnType<SupabaseClient['rpc']>>;
export type RecoveryEntry = {version:1;owner:string;operation:string;rpc:string;args:Record<string,unknown>;goal:string|null;phase:'issued'|'tail'|'confirmed';uncertain:boolean;covers?:string[];tailSource?:'completion_respread'|'catchup_spread';undoRpc?:string;deferred?:boolean};
const prefix='rooted:scheduler-recovery:v1:';
const allowed=new Set(['commit_scheduler_reassign','undo_scheduler_reassign','commit_scheduler_action','commit_scheduler_add','commit_scheduler_retire','commit_scheduler_history_heal','commit_scheduler_bulk_completion','commit_scheduler_respread','commit_scheduler_calendar','commit_scheduler_recalibration','commit_cascade_shift','undo_scheduler_action','undo_scheduler_calendar','undo_scheduler_continuation','undo_cascade_shift']);
const key=(entry:Pick<RecoveryEntry,'owner'|'operation'|'rpc'>)=>`${prefix}${entry.owner}:${entry.rpc}:${entry.operation}`;
function signal(){window.dispatchEvent(new Event('rooted:scheduler-recovery-changed'));}
function save(entry:RecoveryEntry){const value=JSON.stringify(entry);window.localStorage.setItem(key(entry),value);if(window.localStorage.getItem(key(entry))!==value)throw Error('recovery_storage');signal();}
function remove(entry:RecoveryEntry){window.localStorage.removeItem(key(entry));signal();}
export function readSchedulerRecovery(owner:string):RecoveryEntry[]{
 const entries:RecoveryEntry[]=[];
 for(let i=0;i<window.localStorage.length;i++){
  const name=window.localStorage.key(i);if(!name?.startsWith(prefix+owner+':'))continue;
  const entry=JSON.parse(window.localStorage.getItem(name)!);
  if(entry.version!==1||entry.owner!==owner||!allowed.has(entry.rpc)||typeof entry.operation!=='string'||!entry.args||!['issued','tail','confirmed'].includes(entry.phase)||key(entry)!==name)throw Error('recovery_storage');
  entries.push(entry);
 }
 return entries;
}
const refusal=(message:string):Reply=>({data:null,error:{name:'PostgrestError',code:'SCHEDULER_RECOVERY_REQUIRED',message,details:'',hint:''},count:null,status:409,statusText:'Conflict'});
async function ownerOf(client:SupabaseClient){const {data,error}=await client.auth.getUser();if(error||!data.user?.id)throw Error('recovery_owner');return data.user.id;}
function goalOf(args:Record<string,unknown>):string|null{return typeof args.p_goal_id==='string'?args.p_goal_id:null;}
function tailSource(entry:RecoveryEntry){
 const action=entry.args.p_action as {kind?:string;origin?:string}|undefined;
 if(entry.rpc==='commit_scheduler_action'&&action?.kind==='complete')return 'completion_respread' as const;
 if(entry.rpc==='commit_scheduler_history_heal'&&action?.kind==='history_insert')return action.origin==='prior_card'?'completion_respread' as const:'catchup_spread' as const;
}
function undoRpc(entry:RecoveryEntry,result:Record<string,unknown>){
 if(entry.rpc==='commit_scheduler_reassign')return 'undo_scheduler_reassign';
 if(entry.rpc==='commit_cascade_shift')return 'undo_cascade_shift';
 if(entry.rpc==='commit_scheduler_calendar')return 'undo_scheduler_calendar';
 if(entry.rpc==='commit_scheduler_bulk_completion')return 'undo_scheduler_action';
 if(entry.rpc==='commit_scheduler_add'&&result.updatedExisting===false)return 'undo_scheduler_action';
 const kind=(entry.args.p_action as {kind?:string})?.kind;
 if(entry.rpc==='commit_scheduler_action'&&['single_move','place_selected','edit','skip','set_skipped'].includes(kind??''))return 'undo_scheduler_action';
 if(entry.rpc==='commit_scheduler_history_heal'&&kind==='continue')return 'undo_scheduler_continuation';
}
function terminal(entry:RecoveryEntry,result:{status?:string;reason?:string}){
 if(isDefinitiveSchedulerRejection({status:result.status??'',reason:result.reason}))return true;
 if(['commit_cascade_shift','undo_cascade_shift'].includes(entry.rpc)&&result.status==='failed'&&result.reason==='transaction')return true;
 // Exact Undo replays look up undone receipts before these final refusals.
 return entry.rpc.startsWith('undo_')&&(result.status==='expired'||result.status==='stale'&&result.reason!=='busy'||result.status==='invalid'&&['expired','undo_expired'].includes(result.reason??''));
}
/** Persist BEFORE issuing a mutation. An unresolved request never expires locally.
 * Full requests stay on this origin only until resolved; never analytics or logs.
 * Entries use separate keys, so concurrent courses cannot overwrite each other. */
async function ownerLock<T>(owner:string,work:()=>Promise<T>):Promise<T>{
 if(!window.navigator?.locks)throw Error('recovery_lock_unavailable');
 return window.navigator.locks.request('rooted:scheduler-recovery:'+owner,work);
}
export async function durableSchedulerRpc(client:SupabaseClient,rpc:string,args:Record<string,unknown>):Promise<Reply>{
 if(typeof window==='undefined')return await client.rpc(rpc,args);
 let owner:string;try{owner=await ownerOf(client);}catch{return refusal('Reconnect before making a scheduling change.');}
 try{return await ownerLock(owner,()=>issueLocked(client,rpc,args,owner));}catch(error){if(error instanceof Error&&error.message==='recovery_lock_unavailable')return refusal('This browser cannot safely recover scheduling changes. Use a current browser before retrying.');throw error;}
}
async function issueLocked(client:SupabaseClient,rpc:string,args:Record<string,unknown>,owner:string):Promise<Reply>{
 if(!allowed.has(rpc)||typeof args.p_operation_id!=='string')return refusal('This change could not retain a recovery token. Nothing was sent.');
 let entry:RecoveryEntry;
 try{
  if(await ownerOf(client)!==owner)return refusal('The signed-in account changed. Reload before retrying.');const entries=readSchedulerRecovery(owner);const old=entries.find(e=>e.rpc===rpc&&e.operation===args.p_operation_id);
  if(old?.phase==='tail'||old?.phase==='confirmed')return {data:{status:'already_applied',operationId:old.operation},error:null,count:null,status:200,statusText:'OK'};
  if(old&&JSON.stringify(old.args)!==JSON.stringify(args))return refusal('The original change still needs checking. Reload to check saved changes.');
  let goal=goalOf(args);
  if(!old&&rpc==='undo_cascade_shift'){
   // This legacy ledger cascades with course deletion. Retain its owned goal
   // before issuing Undo so a later deletion can supersede an unknown outcome.
   const {data,error}=await client.rpc('read_scheduler_recovery',{p_operation_id:args.p_operation_id,p_rpc:rpc,p_goal_id:null});
   if(error||data?.status!=='ready'||!data.receiptPresent||typeof data.goalId!=='string')return refusal('Undo could not be checked safely. Reload before retrying.');
   goal=data.goalId;
  }
  if(entries.some(e=>e.phase==='issued'&&e!==old&&(e.goal===goal||!e.goal||!goal)))return refusal('An earlier change still needs checking. Reload to check saved changes.');
  entry=old??{version:1,owner,operation:args.p_operation_id,rpc,args:structuredClone(args),goal,phase:'issued',uncertain:false};
  if(!old&&rpc==='commit_scheduler_respread')entry.covers=entries.filter(e=>e.phase==='tail'&&e.goal===goal).map(key);
  // A confirmed completion waiting only for its tail must not be sent again.
  if(entry.phase==='tail')return {data:{status:'already_applied',operationId:entry.operation},error:null,count:null,status:200,statusText:'OK'};
  save({...entry,uncertain:true});
 }catch{return refusal('This browser could not retain the change safely. No new change was sent; check saved changes before retrying.');}
 return invoke(client,entry);
}
async function invoke(client:SupabaseClient,entry:RecoveryEntry,recovering=false):Promise<Reply>{
 let reply:Reply;
 try{reply=await client.rpc(entry.rpc,entry.args);}catch(error){entry.uncertain=true;save(entry);throw error;}
 const result=reply.data as {status?:string;reason?:string}|null;
 const confirmed=!!result&&['applied','already_applied','undone','already_undone'].includes(result.status??'');
 try{
  if(confirmed){
   if(entry.rpc==='commit_scheduler_retire'&&entry.args.p_kind==='delete'&&entry.goal)clearSchedulerTail(entry.owner,entry.goal,readSchedulerRecovery(entry.owner).filter(e=>e.phase==='tail'&&e.goal===entry.goal).map(key));
   if(tailSource(entry)&&result!.status!=='already_undone'){
    // Keep only the receipt identity after success, not the full lesson snapshot.
    entry={...entry,tailSource:tailSource(entry),phase:'tail',args:{},uncertain:false};save(entry);
   }else if(recovering&&result!.status!=='already_undone'&&undoRpc(entry,reply.data)){save({...entry,phase:'confirmed',args:{},undoRpc:undoRpc(entry,reply.data),uncertain:false});}
   else remove(entry);
   if(entry.rpc==='commit_scheduler_respread'&&entry.goal)clearSchedulerTail(entry.owner,entry.goal,entry.covers??[]);
  }else if(result&&terminal(entry,result))remove(entry);
  else if(!entry.uncertain&&((result&&['busy','invalid','paused','legacy'].includes(result.status??''))||(reply.error&&/^(22|23|40|55P03$|57014$|P0001$|42501$|PGRST20[23]$|PGRST30[123]$)/.test(reply.error.code))))remove(entry);
  else {entry.uncertain=true;save(entry);}
 }catch{
  // The server response remains authoritative; retaining an older entry is safe:
  // replay uses the same receipt token. Never label a committed write as failed.
 }
 return reply;
}
export function clearSchedulerTail(owner:string,goal:string,covered:string[]){for(const e of readSchedulerRecovery(owner))if(e.goal===goal&&e.phase==='tail'&&covered.includes(key(e)))remove(e);}
export function dismissRecoveredChange(entry:RecoveryEntry){if(entry.phase==='confirmed')remove(entry);}
export async function undoRecoveredChange(client:SupabaseClient,entry:RecoveryEntry){
 if(entry.phase!=='confirmed'||!entry.undoRpc||await ownerOf(client)!==entry.owner)return 'unknown' as const;
 const reply=await durableSchedulerRpc(client,entry.undoRpc,{p_operation_id:entry.operation});
 if(reply.data&&['undone','already_undone'].includes(reply.data.status)){remove(entry);return 'undone' as const;}
 if(reply.data&&terminal({...entry,rpc:entry.undoRpc},reply.data)){remove(entry);return 'refused' as const;}return 'unknown' as const;
}
/** Explicit recovery only. Never creates a second completion/add/delete request. */
export async function recoverSchedulerEntry(client:SupabaseClient,entry:RecoveryEntry):Promise<boolean>{
 const owner=await ownerOf(client);if(owner!==entry.owner)return false;
 const current=readSchedulerRecovery(owner).find(e=>key(e)===key(entry));if(!current)return true;
 if(current.phase==='confirmed')return true;
 if(current.phase==='tail'){
  const lifecycle=await ownerLock(owner,async()=>{
   if(await ownerOf(client)!==owner)return 'unknown';
   const latest=readSchedulerRecovery(owner).find(e=>key(e)===key(current));if(!latest)return 'deleted_verified';
   const {data,error}=await client.rpc('read_scheduler_recovery',{p_operation_id:latest.operation,p_rpc:latest.rpc,p_goal_id:latest.goal});
   if(error||data?.status!=='ready')return 'unknown';
   if(data.goalState==='deleted_verified'){remove(latest);return data.goalState;}
   // An archived course retains its compact tail for explicit recovery after
   // unarchiving. Never reissue its confirmed completion or erase the obligation.
   if(data.goalState==='archived'){save({...latest,deferred:true});return 'archived';}
   if(data.goalState!=='active'||!data.receiptPresent)return 'unknown';
   if(latest.deferred)save({...latest,deferred:false});return 'active';
  });
  if(lifecycle==='deleted_verified')return true;
  if(lifecycle!=='active')return false;
  const {respreadContainedGoal}=await import('./parent-respread-contained.ts');
  const result=await respreadContainedGoal(client,current.goal!,current.tailSource??'completion_respread');
  return result.status==='applied'||result.status==='already_applied';
 }
 return ownerLock(owner,async()=>{
  if(await ownerOf(client)!==owner)return false;
  const latest=readSchedulerRecovery(owner).find(e=>key(e)===key(current));
  if(!latest||latest.phase!=='issued')return true;
  const reply=await invoke(client,latest,true);const result=reply.data as {status?:string;reason?:string}|null;
  if(latest.goal&&readSchedulerRecovery(owner).some(e=>key(e)===key(latest)&&e.phase==='issued')){
   const {data,error}=await client.rpc('read_scheduler_recovery',{p_operation_id:latest.operation,p_rpc:latest.rpc,p_goal_id:latest.goal});
   if(!error&&data?.status==='ready'){
    if(data.goalState==='deleted_verified'){remove(latest);return true;}
    if(data.goalState==='archived')save({...latest,deferred:true});
   }
  }
  return !!result&&(['applied','already_applied','undone','already_undone'].includes(result.status??'')||terminal(latest,result));
 });
}
export async function schedulerRecoveryForClient(client:SupabaseClient){return readSchedulerRecovery(await ownerOf(client));}
