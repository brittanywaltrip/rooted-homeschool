import { isDefinitiveSchedulerRejection } from './scheduler-terminal-result.ts';
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCompletionPayload, completesInPlace, type CompletionChoice } from "./completeLessonOnDate.ts";
import type { SchedulerResult } from "./scheduler-contained.ts";

export type BulkCompletionItem = {lessonId:string; dateStr:string; choice:CompletionChoice};
type Attempt = {operation:string; expected:unknown; items:unknown[]; key:string; localDay:string; ambiguous?:boolean};
const pending = new WeakMap<SupabaseClient, Map<string, Attempt>>();
/** Fixed per-goal transaction, including its tail projection and exact receipt Undo. */
export async function commitBulkCompletion(client:SupabaseClient, goal:string, items:BulkCompletionItem[], todayStr:string):Promise<SchedulerResult> {
  let retained=pending.get(client);
  if (!retained) {retained=new Map();pending.set(client,retained);}
  const key=JSON.stringify([...items].sort((a,b)=>a.lessonId.localeCompare(b.lessonId)));
  let attempt=retained.get(goal);
  if (attempt && attempt.key!==key) return {status:"unknown",reason:"pending_previous_completion"};
  if (!attempt) {
    let response;
    try {response=await client.rpc("read_scheduler_state",{p_goal_id:goal});}
    catch {return {status:"invalid",reason:"state_unavailable"};}
    if (response.error) return {status:response.error.code==="PGRST202"?"legacy":"invalid",reason:"state_unavailable"};
    const state=response.data;
    if (state?.status!=="ready") return {status:"invalid",reason:"state_unavailable"};
    if (state.mode==="legacy") return {status:"legacy"};
    if (state.mode==="paused") return {status:"paused"};
    if (state.mode!=="atomic_v2" || !Array.isArray(state.snapshot?.rows)) return {status:"invalid",reason:"invalid_state"};
    if (state.localDay !== todayStr) return {status:"stale",reason:"local_day_changed"};
    if (!items.length || items.length>100 || new Set(items.map(x=>x.lessonId)).size!==items.length) return {status:"invalid",reason:"batch_size"};
    const writes=[];
    for (const item of items) {
      const row=state.snapshot.rows.find((r:Record<string,unknown>)=>r.id===item.lessonId);
      if (!row || row.completed || row.skipped) return {status:"stale",reason:"lesson_changed"};
      const inPlace=completesInPlace(row);
      const payload=buildCompletionPayload({dateStr:inPlace?row.scheduled_date:item.dateStr,choice:inPlace?"planned":item.choice,todayStr});
      writes.push({lessonId:item.lessonId,payload:inPlace?{completed:true,completed_at:payload.completed_at}:payload,
        placement:{curriculum_goal_id:row.curriculum_goal_id,queue_position:row.queue_position,scheduled_date:row.scheduled_date,queue_pinned:row.queue_pinned,skipped:row.skipped,completed:row.completed}});
    }
    attempt={operation:crypto.randomUUID(),expected:state.snapshot,items:writes,key,localDay:state.localDay};
    retained.set(goal,attempt);
  }
  const invoke=async():Promise<SchedulerResult>=>{
    try {
      const {data,error}=await client.rpc("commit_scheduler_bulk_completion",{p_operation_id:attempt.operation,p_goal_id:goal,p_expected:attempt.expected,p_items:attempt.items,p_local_day:attempt.localDay});
      if(error) {
        const code=error.code??"";
        if(["55P03","57014","PGRST003"].includes(code)||code.startsWith("40"))return {status:"busy"};
        if(["P0001","42501","PGRST202","PGRST301","PGRST302","PGRST303"].includes(code)||code.startsWith("22")||code.startsWith("23"))return {status:"invalid",reason:error.message};
        return {status:"unknown"};
      }
      return data&&["applied","already_applied","already_undone","busy","stale","invalid","paused","legacy"].includes(data.status)?data:{status:"unknown"};
    }catch{return {status:"unknown"};}
  };
  let result=await invoke();
  if(result.status==="unknown"){attempt.ambiguous=true;result=await invoke();}
  const confirmed=["applied","already_applied","already_undone"].includes(result.status);
  if(attempt.ambiguous&&!confirmed&&!isDefinitiveSchedulerRejection(result))result={status:"unknown",reason:result.reason};
  if(!attempt.ambiguous||confirmed||isDefinitiveSchedulerRejection(result))retained.delete(goal);
  return {...result,operationId:attempt.operation};
}

/** Serialize within a goal; independent goals may proceed concurrently. */
export async function runCompletionGroups<T>(items:T[],goalOf:(item:T)=>string,run:(group:T[],goal:string)=>Promise<void>):Promise<void> {
  const groups=new Map<string,T[]>();
  for(const item of items){const key=goalOf(item);groups.set(key,[...(groups.get(key)??[]),item]);}
  await Promise.all([...groups].map(([goal,group])=>run(group,goal)));
}
