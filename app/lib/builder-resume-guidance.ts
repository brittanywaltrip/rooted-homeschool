import type { SupabaseClient } from '@supabase/supabase-js';
import { planContainedRecalibration } from './recalibrate-contained.ts';

/** Read-only advice. The actual action must still reread and validate at Save. */
export async function canOfferProtectedLessonResume(client: SupabaseClient, goalId: string, lesson: number): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('read_scheduler_state', { p_goal_id: goalId });
    if (error || data?.status !== 'ready' || data.mode !== 'atomic_v2' || data.snapshot?.goal?.id !== goalId) return false;
    const selected = data.snapshot.rows.filter((row: { lesson_number: number; completed: boolean }) => row.lesson_number === lesson && !row.completed);
    if (selected.length !== 1) return false;
    const dates = planContainedRecalibration(data, lesson, false);
    return dates?.some(row => row.id === selected[0].id) === true;
  } catch {
    return false;
  }
}
