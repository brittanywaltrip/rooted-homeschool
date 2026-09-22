// Invariant 23: a lesson reopened behind the pointer becomes a make-up.
//
// Unticking a lesson normally hands it back to the queue: the pointer drops and
// the lesson is next again. It cannot drop for a lesson recorded as done
// before the family started tracking (current_lesson never goes below
// start_at_lesson - 1), nor for one the family already finished lessons after.
// Such a row used to sit unfinished behind the pointer where no projection
// could see it: Today never showed it, and the next Schedule Builder save put
// a fresh lesson on the same day and failed (Sentry ROOTED-HOMESCHOOL-1Q).
//
// The family's decision (2026-09-21): unticking such a lesson means "this
// needs to be done again". So it is pinned to the day it is due, which is its
// own day or today, whichever is later. Every projector emits a make-up on
// that day and spends the day's capacity on it; Today shows it, Plan shows it,
// and ticking it again completes it the usual way. Its notes and minutes stay
// on the row; reports ignore them until it is completed. The family's starting
// lesson is not touched.
//
// No "@/" imports at module scope: node --test runs the pure half directly.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The row after its un-complete write. */
export type ReopenRow = {
  queue_position: number | null;
  scheduled_date: string | null;
  completed: boolean;
  skipped?: boolean | null;
};

/**
 * Does this reopened row need to become a make-up, and on which day?
 * Null when it is simply back in the queue (its slot is ahead of the pointer).
 * `currentLesson` is the pointer AFTER the un-complete was recomputed.
 */
export function planReopenMakeUp(a: {
  row: ReopenRow;
  currentLesson: number;
  todayYmd: string;
}): { date: string } | null {
  const { row } = a;
  if (row.completed || row.skipped) return null;
  if (row.queue_position == null || row.queue_position > a.currentLesson) return null;
  const own = row.scheduled_date;
  return { date: own && own > a.todayYmd ? own : a.todayYmd };
}

/**
 * Run after an un-complete and its pointer recompute. Pins the row to its day
 * when it is behind the pointer. Returns the day it now sits on, or null when
 * nothing was needed. Confirms the write: a row the database left alone is an
 * error, not a success.
 */
export async function reopenBehindPointer(
  supabase: SupabaseClient,
  a: { lessonId: string; goalId: string; todayYmd: string },
): Promise<{ date: string | null; error: string | null }> {
  const [{ data: row, error: rowErr }, { data: goal, error: goalErr }] = await Promise.all([
    supabase
      .from("lessons")
      .select("queue_position, scheduled_date, completed, skipped")
      .eq("id", a.lessonId)
      .maybeSingle(),
    supabase.from("curriculum_goals").select("current_lesson").eq("id", a.goalId).maybeSingle(),
  ]);
  if (rowErr || goalErr) return { date: null, error: (rowErr ?? goalErr)?.message ?? "read failed" };
  if (!row || !goal) return { date: null, error: null };
  const decision = planReopenMakeUp({
    row: row as ReopenRow,
    currentLesson: (goal as { current_lesson: number | null }).current_lesson ?? 0,
    todayYmd: a.todayYmd,
  });
  if (!decision) return { date: null, error: null };
  const { data: wrote, error } = await supabase
    .from("lessons")
    .update({
      queue_pinned: true,
      scheduled_date: decision.date,
      date: decision.date,
      scheduled_source: "reopened",
    })
    .eq("id", a.lessonId)
    .eq("completed", false)
    .select("id");
  if (error) return { date: null, error: error.message };
  if ((wrote ?? []).length !== 1) return { date: null, error: "the lesson was not updated" };
  return { date: decision.date, error: null };
}
