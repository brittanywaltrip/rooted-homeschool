import {durableSchedulerRpc} from './scheduler-recovery-journal.ts';
import { isDefinitiveSchedulerRejection } from './scheduler-terminal-result.ts';
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeNextLessonsForGoal, toGoalConfig } from "./scheduler.ts";
import type { SchedulerResult } from "./scheduler-contained.ts";

export type HistoryHealIntent =
  | { kind: "history_insert"; slot: number; date: string; choice?: "planned" | "picked" | "today"; origin?: "prior_card" }
  | { kind: "heal_next"; slot: number; date: string }
  | { kind: "heal_empty" }
  | { kind: "continue"; parentLessonId: string; targetDate: string };
type Attempt = { operation: string; goal: string; expected: unknown; action: Record<string, unknown>; key: string; ambiguous?: boolean };
const pending = new WeakMap<SupabaseClient, Map<string, Attempt>>();
/** Resolve an ambiguous insert before looking up rows it may already have created. */
export function hasPendingHistoryHeal(client: SupabaseClient, goal: string): boolean {
  return pending.get(client)?.has(goal) ?? false;
}
/** Separate fixed insert contract. No caller-supplied row contents reach the RPC. */
export async function commitHistoryHeal(client: SupabaseClient, goal: string, intent: HistoryHealIntent): Promise<SchedulerResult & { written?: number; row?: Record<string, unknown> }> {
  let retained = pending.get(client);
  if (!retained) { retained = new Map(); pending.set(client, retained); }
  const key = JSON.stringify(intent);
  let attempt = retained.get(goal);
  if (attempt && attempt.key !== key) return {status: "unknown", reason: "pending_previous_insert"};
  if (!attempt) {
    let response;
    try { response = await client.rpc("read_scheduler_state", {p_goal_id: goal}); }
    catch { return {status: "invalid", reason: "state_unavailable"}; }
    if (response.error) return {status: response.error.code === "PGRST202" ? "legacy" : "invalid", reason: "state_unavailable"};
    const state = response.data;
    if (state?.status !== "ready") return {status: "invalid", reason: "state_unavailable"};
    if (state.mode === "legacy") return {status: "legacy"};
    if (state.mode === "paused") return {status: "paused"};
    if (state.mode !== "atomic_v2" || !state.snapshot || !Array.isArray(state.snapshot.rows)) return {status: "invalid", reason: "invalid_state"};
    const action: Record<string, unknown> = {...intent, localDay: state.localDay};
    if (intent.kind === "heal_empty") {
      if (state.snapshot.rows.length) return {status: "stale", reason: "goal_not_empty"};
      const projected = computeNextLessonsForGoal(toGoalConfig(state.snapshot.goal), new Date(`${state.localDay}T00:00:00`), 3650, state.snapshot.vacations);
      action.slots = projected.map(row => ({slot: row.lesson_number, date: row.date}));
    }
    attempt = {operation: crypto.randomUUID(), goal, expected: state.snapshot, action, key};
    retained.set(goal, attempt);
  }
  const invoke = async (): Promise<SchedulerResult & {written?: number; row?: Record<string, unknown>}> => {
    try {
      const {data, error} = await durableSchedulerRpc(client, "commit_scheduler_history_heal", {p_operation_id: attempt.operation, p_goal_id: goal, p_expected: attempt.expected, p_action: attempt.action});
      if (error) {
        const code = error.code ?? "";
        if (code === "55P03" || code === "57014" || code.startsWith("40")) return {status: "busy"};
        if (code === "P0001" || code === "42501" || code.startsWith("22") || code.startsWith("23") || ["PGRST202", "PGRST301", "PGRST302", "PGRST303"].includes(code)) return {status: "invalid", reason: error.message};
        return {status: "unknown"};
      }
      if (!data || !["applied", "already_applied", "already_undone", "busy", "stale", "invalid", "paused"].includes(data.status)) return {status: "unknown"};
      return data;
    } catch { return {status: "unknown"}; }
  };
  let result = await invoke();
  if (result.status === "unknown") { attempt.ambiguous = true; result = await invoke(); }
  const confirmed = result.status === "applied" || result.status === "already_applied" || result.status === "already_undone";
  if (attempt.ambiguous && !confirmed && !isDefinitiveSchedulerRejection(result)) result = {status: "unknown"};
  if (!attempt.ambiguous || confirmed || isDefinitiveSchedulerRejection(result)) retained.delete(goal);
  return {...result, operationId: attempt.operation};
}

/** Only the untouched row created by a continuation receipt may be removed. */
export async function undoHistoryContinuation(client: SupabaseClient, operationId: string): Promise<SchedulerResult> {
  try {
    const {data,error} = await durableSchedulerRpc(client, "undo_scheduler_continuation", {p_operation_id: operationId});
    if (error) return {status: error.code === "55P03" ? "busy" : "unknown"};
    return data && ["undone","already_undone","stale","busy","invalid","paused"].includes(data.status) ? data : {status:"unknown"};
  } catch { return {status:"unknown"}; }
}
