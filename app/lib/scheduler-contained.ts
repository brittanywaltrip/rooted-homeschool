import { countSchoolDaysInRange, nthSchoolDayBefore, type VacationRange } from "../../lib/school-days.ts";
import { mapLessonDateAcrossVacation } from "../components/PlanV2/handleVacationSave.shift.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeNextLessonsForGoal, queueHoldsFromRows, type CurriculumGoalConfig, type VacationBlock } from "./scheduler.ts";
import { countDoneToday } from "./phase2-commit.ts";
import type { CascadeRow } from "./cascade-shift-plan.ts";

export type SchedulerAction =
  | { kind: "single_move"; lessonId: string; targetDate: string; localDay: string }
  | { kind: "complete"; lessonId: string; payload: Record<string, unknown>; onlyIfIncomplete?: boolean; placement?: Record<string, unknown> }
  | { kind: "skip" | "delete"; lessonId: string }
  | { kind: "set_skipped"; lessonIds: string[]; skipped: boolean; restoreDates?: Record<string, string>; localDay?: string; writes?: Array<{id:string;date:string;queue_pinned?:boolean}> };
export type SchedulerRetry = { ambiguous?: boolean; operationId: string; goalId: string; expected: unknown; action: SchedulerAction };
export type SchedulerResult = {
  status: "legacy" | "applied" | "already_applied" | "undone" | "already_undone" | "busy" | "stale" | "invalid" | "paused" | "unknown";
  held?: number | unknown[];
  action?: SchedulerAction;
  reason?: string;
  operationId?: string;
  retry?: SchedulerRetry;
};
// Keep ambiguous operations for this browser client until the server gives a
// definite answer. A repeated tap must never create a second operation.
const pending = new WeakMap<SupabaseClient, Map<string, SchedulerRetry>>();
export function pendingContainedAction(client: SupabaseClient, lessonId: string): SchedulerRetry | undefined {
  return pending.get(client)?.get(lessonId);
}
function actionLessonIds(action: SchedulerAction): string[] {
  return action.kind === "set_skipped" ? action.lessonIds : [action.lessonId];
}
function sameIntent(a: SchedulerAction, b: SchedulerAction): boolean {
  const normalized = (action: SchedulerAction) => {
    if (action.kind === "set_skipped") {
      const {writes: _writes, ...intent} = action;
      void _writes;
      return {...intent, lessonIds: [...intent.lessonIds].sort()};
    }
    if (action.kind !== "complete") return action;
    // The clock and freshly read placement may differ on the retry. Neither
    // changes the parent's intent; the retained payload/preimage stays exact.
    const payload = { ...action.payload };
    delete payload.completed_at;
    return {kind: action.kind, lessonId: action.lessonId, payload, onlyIfIncomplete: !!action.onlyIfIncomplete};
  };
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}
async function retainedAttempt(client: SupabaseClient, retry: SchedulerRetry): Promise<SchedulerResult> {
  let operations = pending.get(client);
  if (!operations) { operations = new Map(); pending.set(client, operations); }
  for (const id of actionLessonIds(retry.action)) operations.set(id, retry);
  let result = await retrySchedulerAction(client, retry);
  if (result.status === "unknown") {
    retry.ambiguous = true;
    result = await retrySchedulerAction(client, retry);
  }
  const confirmed = result.status === "applied" || result.status === "already_applied" || result.status === "already_undone";
  // A busy/stale/invalid replay cannot disprove an earlier request still
  // committing. Keep its token until the receipt confirms the outcome.
  if (retry.ambiguous && !confirmed) result = {status: "unknown", reason: result.reason, operationId: retry.operationId, retry};
  if (!retry.ambiguous || confirmed) for (const id of actionLessonIds(retry.action)) operations.delete(id);
  return {...result, action: retry.action};
}
const accepted = new Set(["legacy", "applied", "already_applied", "undone", "already_undone", "busy", "stale", "invalid", "paused"]);
export function schedulerRefusalMessage(result: SchedulerResult): string {
  if (result.status === "already_undone") return "This change was already undone. Reload to review the current schedule.";
  if (result.reason === "undo_expired") return "The Undo window has ended. Your current schedule was left unchanged.";
  if (result.reason === "calendar_plan") return "This calendar change could not be planned safely. Nothing changed; review the dates and preserved lessons.";
  if (result.status === "unknown") return "We could not confirm the change. Reload to check the schedule before trying again.";
  if (result.status === "busy") return "Another change is still saving. Reload the schedule and try again.";
  if (result.status === "paused") return "Schedule changes are temporarily paused. Your saved work is safe.";
  return "The schedule changed or this action is unavailable. Reload and review it before trying again.";
}
function parsed(data: unknown): SchedulerResult {
  if (!data || typeof data !== "object" || !accepted.has(String((data as {status?: unknown}).status))) return {status:"invalid",reason:"invalid_response"};
  return data as SchedulerResult;
}
function definiteRpcRefusal(error: {code?: string; message?: string}): SchedulerResult | null {
  const code = error.code ?? "";
  // These codes prove PostgreSQL/PostgREST rejected or rolled back the call.
  // Missing/unknown codes, network loss and gateway failures stay ambiguous.
  if (code === "55P03" || code === "57014" || code.startsWith("40") || code === "PGRST003") {
    return {status: "busy", reason: error.message ?? code};
  }
  if (code === "P0001" || code === "42501" || code.startsWith("22") || code.startsWith("23") ||
      code === "PGRST202" || code === "PGRST301" || code === "PGRST302" || code === "PGRST303") {
    return {status: "invalid", reason: error.message ?? code};
  }
  return null;
}
/** The returned retry retains the original operation and preimage after an ambiguous transport failure. */
export async function retrySchedulerAction(client: SupabaseClient, retry: SchedulerRetry): Promise<SchedulerResult> {
  try {
    const {data,error} = await client.rpc("commit_scheduler_action", {p_operation_id:retry.operationId,p_goal_id:retry.goalId,p_expected:retry.expected,p_action:retry.action});
    if (error) {
      const refusal = definiteRpcRefusal(error);
      return refusal ? {...refusal, operationId: retry.operationId} : {status:"unknown",reason:error.message,operationId:retry.operationId,retry};
    }
    const result = parsed(data);
    if (result.reason === "invalid_response") return {status: "unknown", reason: result.reason, operationId: retry.operationId, retry};
    return {...result, status: result.status === "legacy" ? "stale" : result.status, operationId:retry.operationId};
  } catch {
    return {status:"unknown",operationId:retry.operationId,retry};
  }
}
export function planContainedSkip(state: {snapshot?: {goal: CurriculumGoalConfig; rows: CascadeRow[]; vacations: VacationBlock[]}; localDay?: string; dayStartIso?: string; dayEndIso?: string}, action: Extract<SchedulerAction,{kind:"set_skipped"}>): Extract<SchedulerAction,{kind:"set_skipped"}> | null {
  const snapshot = state.snapshot;
  if (!snapshot || !state.localDay || !state.dayStartIso || !state.dayEndIso || action.localDay !== state.localDay ||
      !Number.isFinite(Date.parse(state.dayStartIso)) || !Number.isFinite(Date.parse(state.dayEndIso)) ||
      !Array.isArray(snapshot.vacations) || snapshot.rows.some(row => row.queue_position == null)) return null;
  const selected = new Set(action.lessonIds);
  if (!selected.size || selected.size !== action.lessonIds.length ||
      action.lessonIds.some(id => !snapshot.rows.some(row => row.id === id && !row.completed))) return null;
  const rows = snapshot.rows.map(row => ({...row}));
  for (const row of rows) {
    if (!selected.has(row.id)) continue;
    row.skipped = action.skipped;
    if (action.skipped) { row.scheduled_date = null; row.queue_pinned = false; }
    else if (row.queue_position! <= snapshot.goal.current_lesson) {
      const date = action.restoreDates?.[row.id];
      if (date !== state.localDay) return null;
      row.date = date; row.scheduled_date = date; row.queue_pinned = true;
    }
  }
  const projection = computeNextLessonsForGoal(snapshot.goal, new Date(`${state.localDay}T00:00:00`), 3650,
    snapshot.vacations, countDoneToday(rows, state.dayStartIso, state.dayEndIso), queueHoldsFromRows(rows, snapshot.goal.id));
  const bySlot = new Map(projection.map(item => [item.lesson_number,item.date]));
  const writes: Array<{id:string;date:string;queue_pinned?:boolean}> = [];
  for (const row of rows) {
    if (row.completed || row.skipped || row.is_backfill || row.continues_lesson_id) continue;
    if (row.queue_position! <= snapshot.goal.current_lesson) {
      if (selected.has(row.id) && !action.skipped) writes.push({id:row.id,date:row.scheduled_date!,queue_pinned:true});
      continue;
    }
    const date = bySlot.get(row.queue_position!);
    if (!date) return null;
    // Manual/preserved work must remain exactly placed, never folded into a tail rewrite.
    if (row.queue_pinned || row.queue_preserved) {
      if (row.scheduled_date !== date) return null;
      continue;
    }
    if (row.scheduled_date !== date || row.date !== date) writes.push({id:row.id,date});
  }
  return {...action,writes};
}
async function prepareContainedAction(client: SupabaseClient, goalId: string | null | undefined, action: SchedulerAction): Promise<SchedulerResult | SchedulerRetry> {
  const retained = actionLessonIds(action).map(id => pendingContainedAction(client, id)).find(Boolean);
  if (retained) {
    if (retained.goalId !== goalId || !sameIntent(retained.action, action)) {
      return {status: "unknown", reason: "pending_previous_action", operationId: retained.operationId, retry: retained};
    }
    return retained;
  }
  if (!goalId) return {status:"legacy"};
  let response;
  try { response = await client.rpc("read_scheduler_state", {p_goal_id:goalId}); }
  catch { return {status:"invalid",reason:"state_unavailable"}; }
  if (response.error) return response.error.code === "PGRST202" ? {status:"legacy"} : {status:"invalid",reason:response.error.message};
  const state = response.data;
  if (state?.status !== "ready") return {status:"invalid",reason:"state_unavailable"};
  if (state.mode === "legacy") return {status:"legacy"};
  if (state.mode === "paused") return {status:"paused"};
  if (state.mode !== "atomic_v2" || !state.snapshot || !Array.isArray(state.snapshot.rows)) return {status:"invalid",reason:"invalid_state"};
  if (action.kind === "complete" && action.placement) {
    const lessonId = action.lessonId;
    const row = state.snapshot.rows.find((r: {id?: string}) => r.id === lessonId);
    if (!row || Object.entries(action.placement).some(([k,v]) => (row[k] ?? null) !== (v ?? null))) return {status:"stale",reason:"placement_changed"};
    if (action.onlyIfIncomplete && row.completed) return {status:"stale",reason:"already_completed"};
  }
  if (action.kind === "set_skipped") {
    const planned = planContainedSkip(state, action);
    if (!planned) return {status: "invalid", reason: "skip_projection_unavailable"};
    action = planned;
  }
  return {operationId:crypto.randomUUID(),goalId,expected:state.snapshot,action};
}
export async function commitContainedAction(client: SupabaseClient, goalId: string | null | undefined, action: SchedulerAction): Promise<SchedulerResult> {
  const prepared = await prepareContainedAction(client, goalId, action);
  return "expected" in prepared ? retainedAttempt(client, prepared) : prepared;
}
/** Read every goal before writing the first; each goal commits independently. */
export async function commitContainedGroups(client: SupabaseClient, groups: Array<{goalId: string; action: SchedulerAction}>): Promise<Array<{goalId: string; action: SchedulerAction; result: SchedulerResult}>> {
  const prepared = await Promise.all(groups.map(group => prepareContainedAction(client, group.goalId, group.action)));
  const outcomes = [];
  for (let i = 0; i < groups.length; i++) {
    const entry = prepared[i];
    const result = "expected" in entry ? await retainedAttempt(client, entry) : entry;
    outcomes.push({...groups[i], result});
  }
  return outcomes;
}
export async function undoContainedAction(client: SupabaseClient, operationId: string): Promise<SchedulerResult> {
  try {
    const {data,error} = await client.rpc("undo_scheduler_action",{p_operation_id:operationId});
    return error ? {...(definiteRpcRefusal(error) ?? {status: "unknown" as const, reason: error.message}),operationId} : {...parsed(data),operationId};
  } catch { return {status:"unknown",operationId}; }
}

/** UI preflight only; database guards still arbitrate activation races. */
export async function assertLegacySchedulingEdit(client: SupabaseClient, goalIds: string[], message: string): Promise<void> {
  for (const goalId of goalIds) {
    const {data,error} = await client.rpc("read_scheduler_state",{p_goal_id:goalId});
    if (error?.code === "PGRST202") continue;
    if (error || data?.status !== "ready") throw new Error("Couldn't check the schedule. Nothing changed; reload and try again.");
    if (data.mode !== "legacy") throw new Error(message);
  }
}
export async function assertLegacyCalendarEdit(client: SupabaseClient, userId: string): Promise<void> {
  const goalIds: string[] = [];
  // Include goals outside the currently displayed school year and archived
  // goals; a global calendar change can affect any protected course.
  for (let offset = 0; ; offset += 100) {
    const {data,error} = await client.from("curriculum_goals").select("id")
      .eq("user_id",userId).order("id").range(offset,offset+99);
    if (error || !data) throw new Error("Couldn't check the calendar. Nothing changed; reload and try again.");
    goalIds.push(...data.map(row => row.id as string));
    if (data.length < 100) break;
  }
  await assertLegacySchedulingEdit(client,goalIds,
    "Calendar changes are unavailable while a protected course is active. Nothing changed.");
}

export type CalendarAction =
  | {kind:"add";name:string;startDate:string;endDate:string;shift:boolean}
  | {kind:"edit";id:string;name:string;startDate:string;endDate:string}
  | {kind:"remove";id:string;shift:boolean}
  | {kind:"endnow";id:string};
export type CalendarSnapshot = {
  profile: {id:string;school_days:string[]|null;timezone:string};
  goals: Record<string,unknown>[];
  rows: Array<{id:string;completed:boolean;scheduled_date:string|null;date:string;queue_preserved?:boolean;skipped?:boolean}>;
  vacations: Array<VacationRange&{id:string;name:string;shift_applied?:boolean}>;
};
export function planCalendarWrites(snapshot: CalendarSnapshot, action: CalendarAction): Array<{id:string;date:string}> | null {
  if (action.kind==='edit'||action.kind==='endnow'||!action.shift) return [];
  const old = action.kind==='remove' ? snapshot.vacations.find(block=>block.id===action.id) : undefined;
  if (action.kind==='remove'&&!old) return null;
  if (old && !old.shift_applied) return [];
  const start = action.kind==='add'?action.startDate:old!.start_date;
  const end = action.kind==='add'?action.endDate:old!.end_date;
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (!Number.isFinite(span) || span < 0 || span > 3660) return null;
  const days = snapshot.profile.school_days?.length ? snapshot.profile.school_days : ['Mon','Tue','Wed','Thu','Fri'];
  const without = snapshot.vacations.filter(block=>block.id!==old?.id);
  const count = countSchoolDaysInRange(start,end,days,without);
  if (!count) return [];
  const blocks = action.kind==='add' ? [...without,{start_date:start,end_date:end}] : without;
  const writes=[];
  for(const row of snapshot.rows) {
    if (row.completed||!row.scheduled_date||row.scheduled_date<start) continue;
    const date=action.kind==='add' ? mapLessonDateAcrossVacation(row.scheduled_date,start,end,days,count,blocks) : nthSchoolDayBefore(row.scheduled_date,days,count,blocks);
    if (row.queue_preserved&&!row.skipped&&date!==row.scheduled_date) return null;
    writes.push({id:row.id,date});
  }
  return writes;
}
type CalendarAttempt = {operationId:string;expected:CalendarSnapshot;action:CalendarAction&{localDay:string};writes:Array<{id:string;date:string}>;key:string;ambiguous?:boolean};
const pendingCalendar = new WeakMap<SupabaseClient,CalendarAttempt>();
export async function commitCalendarAction(client: SupabaseClient, action: CalendarAction): Promise<SchedulerResult & {blockId?:string;written?:number}> {
  const key=JSON.stringify(action);
  let attempt=pendingCalendar.get(client);
  if(attempt&&attempt.key!==key)return {status:'unknown',reason:'pending_previous_calendar'};
  if(!attempt){
    let response;
    try { response=await client.rpc('read_scheduler_calendar'); } catch {return {status:'invalid',reason:'calendar_unavailable'};}
    if(response.error)return {status:response.error.code==='PGRST202'?'legacy':'invalid',reason:'calendar_unavailable'};
    const state=response.data;
    if(state?.status!=='ready')return {status:'invalid',reason:'calendar_unavailable'};
    if(state.mode==='legacy')return {status:'legacy'};
    if(state.mode==='paused')return {status:'paused'};
    if(state.mode!=='atomic_v2'||!state.snapshot||!state.localDay)return {status:'invalid',reason:'calendar_unavailable'};
    const writes=planCalendarWrites(state.snapshot,action);
    if(!writes)return {status:'invalid',reason:'calendar_plan'};
    attempt={operationId:crypto.randomUUID(),expected:state.snapshot,action:{...action,localDay:state.localDay},writes,key};
    pendingCalendar.set(client,attempt);
  }
  const call=async():Promise<SchedulerResult & {blockId?:string;written?:number}>=>{
    try{
      const {data,error}=await client.rpc('commit_scheduler_calendar',{p_operation_id:attempt.operationId,p_expected:attempt.expected,p_action:attempt.action,p_writes:attempt.writes});
      if(error)return definiteRpcRefusal(error)??{status:'unknown'};
      if(!data||!['applied','already_applied','already_undone','busy','stale','invalid','paused'].includes(data.status))return {status:'unknown'};
      return data;
    }catch{return {status:'unknown'};}
  };
  let result=await call();
  if(result.status==='unknown'){attempt.ambiguous=true;result=await call();}
  const confirmed=result.status==='applied'||result.status==='already_applied'||result.status==='already_undone';
  if(attempt.ambiguous&&!confirmed)result={status:'unknown'};
  if(!attempt.ambiguous||confirmed)pendingCalendar.delete(client);
  return {...result,operationId:attempt.operationId};
}
export async function undoCalendarAction(client:SupabaseClient,operationId:string):Promise<SchedulerResult>{
  try{
    const {data,error}=await client.rpc('undo_scheduler_calendar',{p_operation_id:operationId});
    return error?{...(definiteRpcRefusal(error)??{status:'unknown' as const}),operationId}:{...parsed(data),operationId};
  }catch{return {status:'unknown',operationId};}
}
