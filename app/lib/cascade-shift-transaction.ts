import type { SupabaseClient } from '@supabase/supabase-js';
import { planAnchoredCascade, sameCascadeSnapshot, type CascadeSnapshot, type CascadePlanResult } from './cascade-shift-plan.ts';

export type { CascadeSnapshot } from './cascade-shift-plan.ts';

export type CascadeShiftResult =
  | { status: 'applied'; operationId: string; writtenIds: string[] }
  | { status: 'refused'; reason: Extract<CascadePlanResult, {ok:false}>['reason'] | 'stale' | 'unavailable' | 'read' | 'transaction' }
  | { status: 'unknown'; operationId: string };

export async function previewCurriculumShift(client: SupabaseClient, args: {
  goalId: string; lessonId: string; from: string; to: string; localDay: string; dayStartIso: string; dayEndIso: string;
}) {
  try {
    const {data,error}=await client.rpc('read_cascade_snapshot',{p_goal_id:args.goalId,p_local_day:args.localDay,p_day_start:args.dayStartIso,p_day_end:args.dayEndIso});
    if(error || data?.status !== 'ready') return null;
    const snapshot=data.snapshot as CascadeSnapshot;
    if(snapshot.goal.id!==args.goalId || snapshot.localDay!==args.localDay ||
       Date.parse(snapshot.dayStartIso)!==Date.parse(args.dayStartIso) ||
       Date.parse(snapshot.dayEndIso)!==Date.parse(args.dayEndIso)) return null;
    const plan=planAnchoredCascade(snapshot,{lessonId:args.lessonId,from:args.from,to:args.to});
    if(!plan.ok) return null;
    return {snapshot,preservedEarlierCount:plan.plan.preserved.length,shiftDays:plan.plan.days,futureLessonsToShift:plan.plan.writes.length-1,
      projectedFinishDate:plan.plan.writes.reduce((latest,w)=>w.after.date>latest?w.after.date:latest,args.to)};
  } catch { return null; }
}

/** No sequential-write fallback. The server owns commit, retry and Undo. */
export async function shiftCurriculumSessions(client: SupabaseClient, args: {
  previewSnapshot: CascadeSnapshot; operationId: string; goalId: string; lessonId: string; from: string; to: string;
  localDay: string; dayStartIso: string; dayEndIso: string;
}): Promise<CascadeShiftResult> {
  let read;
  try {
    read = await client.rpc('read_cascade_snapshot', { p_goal_id: args.goalId,
      p_local_day: args.localDay, p_day_start: args.dayStartIso, p_day_end: args.dayEndIso });
  } catch { return { status: 'refused', reason: 'read' }; }
  if (read.error || read.data?.status !== 'ready') return { status: 'refused', reason: read.error?.code === 'PGRST202' ? 'unavailable' : 'read' };
  const snapshot = read.data.snapshot as CascadeSnapshot;
  if (snapshot?.goal?.id !== args.goalId || snapshot?.localDay !== args.localDay || !Array.isArray(snapshot.rows)) return { status: 'refused', reason: 'read' };
  if (Date.parse(snapshot.dayStartIso)!==Date.parse(args.dayStartIso) ||
      Date.parse(snapshot.dayEndIso)!==Date.parse(args.dayEndIso)) return { status: 'refused', reason: 'read' };
  try {
    if (!args.previewSnapshot || !sameCascadeSnapshot(snapshot,args.previewSnapshot)) return { status: 'refused', reason: 'stale' };
  } catch { return { status: 'refused', reason: 'read' }; }
  const choice = { lessonId: args.lessonId, from: args.from, to: args.to };
  let planned: CascadePlanResult;
  try { planned = planAnchoredCascade(snapshot, choice); }
  catch { return { status: 'refused', reason: 'read' }; }
  if (!planned.ok) return { status: 'refused', reason: planned.reason };
  // The operation id and exact original payload survive the one retry. If a
  // response was lost after commit, the server recognizes it without moving
  // the schedule for a second time.
  const request = { p_operation_id: args.operationId, p_goal_id: args.goalId,
    p_expected: planned.plan.expected, p_choice: choice, p_moves: planned.plan.writes, p_preserved: planned.plan.preserved };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await client.rpc('commit_cascade_shift', request);
      if (error?.code === 'PGRST202') return { status: 'refused', reason: 'unavailable' };
      if (error) continue;
      if (data?.status === 'applied' || data?.status === 'already_applied') return {
        status: 'applied', operationId: args.operationId, writtenIds: planned.plan.writes.map(w => w.id),
      };
      if (data?.status === 'stale' || data?.status === 'already_undone') return { status: 'refused', reason: 'stale' };
      if (data?.status === 'invalid' || data?.status === 'failed') return { status: 'refused', reason: 'transaction' };
    } catch { /* retry exactly the same operation, never recompute a new shift */ }
  }
  return { status: 'unknown', operationId: args.operationId };
}

export async function undoCurriculumShift(client: SupabaseClient, operationId: string): Promise<'undone' | 'stale' | 'failed' | 'unknown'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await client.rpc('undo_cascade_shift', { p_operation_id: operationId });
      if (error) continue;
      if (data?.status === 'undone' || data?.status === 'already_undone') return 'undone';
      if (data?.status === 'stale' || data?.status === 'expired') return 'stale';
      if (data?.status === 'invalid' || data?.status === 'failed') return 'failed';
    } catch { /* same undo token only */ }
  }
  return 'unknown';
}
