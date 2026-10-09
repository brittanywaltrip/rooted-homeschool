import { isDefinitiveSchedulerRejection } from './scheduler-terminal-result.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParentRespreadSource } from './scheduler.ts';

type Outcome = {status: 'legacy'|'applied'|'already_applied'|'busy'|'stale'|'invalid'|'paused'|'unknown'; written: number; writtenIds: string[]; reason?: string};
type Attempt = {operation: string; goal: string; source: ParentRespreadSource; expected: unknown; day: string; ambiguous?: boolean};
const pending = new WeakMap<SupabaseClient, Map<string, Attempt>>();
const refused = (status: Outcome['status'], reason?: string): Outcome => ({status, written: 0, writtenIds: [], reason});
/** Server-derived parent projection; no caller-supplied row/date patches. */
export async function respreadContainedGoal(client: SupabaseClient, goal: string, source: ParentRespreadSource): Promise<Outcome> {
  let retained = pending.get(client);
  if (!retained) {retained = new Map(); pending.set(client, retained);}
  let attempt = retained.get(goal);
  if (attempt && attempt.source !== source) return refused('unknown', 'pending_previous_respread');
  if (!attempt) {
    try {
      const {data, error} = await client.rpc('read_scheduler_state', {p_goal_id: goal});
      if (error?.code === 'PGRST202') return refused('legacy');
      if (error || data?.status !== 'ready') return refused('invalid', 'state_unavailable');
      if (data.mode === 'legacy') return refused('legacy');
      if (data.mode === 'paused') return refused('paused');
      if (data.mode !== 'atomic_v2' || !data.snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(data.localDay ?? '')) return refused('invalid', 'state_unavailable');
      attempt = {operation: crypto.randomUUID(), goal, source, expected: data.snapshot, day: data.localDay};
      retained.set(goal, attempt);
    } catch {return refused('invalid', 'state_unavailable');}
  }
  const invoke = async (): Promise<Outcome> => {
    try {
      const {data, error} = await client.rpc('commit_scheduler_respread', {p_operation_id: attempt.operation, p_goal_id: attempt.goal, p_expected: attempt.expected, p_source: attempt.source, p_day: attempt.day});
      if (error) {
        const code = error.code ?? '';
        if (['55P03','57014','PGRST003'].includes(code) || code.startsWith('40')) return refused('busy');
        if (['P0001','42501','PGRST202','PGRST301','PGRST302','PGRST303'].includes(code) || code.startsWith('22') || code.startsWith('23')) return refused('invalid');
        return refused('unknown');
      }
      if (data?.status === 'applied' || data?.status === 'already_applied') {
        if (!Array.isArray(data.writtenIds) || !data.writtenIds.every((id: unknown) => typeof id === 'string') || data.written !== data.writtenIds.length) return refused('unknown');
        return data;
      }
      return ['busy','stale','invalid','paused'].includes(data?.status) ? refused(data.status, data.reason) : refused('unknown');
    } catch {return refused('unknown');}
  };
  let result = await invoke();
  if (result.status === 'unknown') {attempt.ambiguous = true; result = await invoke();}
  const confirmed = result.status === 'applied' || result.status === 'already_applied';
  if (attempt.ambiguous && !confirmed && !isDefinitiveSchedulerRejection(result)) return refused('unknown');
  retained.delete(goal);
  return result;
}
