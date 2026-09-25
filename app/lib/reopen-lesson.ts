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

export type UntickResult =
  | { ok: true; status: "made_up" | "requeued"; date: string | null }
  | {
      ok: false;
      /**
       * unavailable: reopen_lesson is not on this database (retryable).
       * failed / invalid: nothing changed, the lesson is still ticked.
       * not_completed: it was not ticked to begin with (another tab).
       */
      status: "unavailable" | "failed" | "invalid" | "not_completed";
      reason: string;
    };

/**
 * Untick a lesson as ONE transaction (public.reopen_lesson): un-complete it,
 * let the pointer recompute, and, when the lesson is now behind the pointer,
 * pin it as a make-up (planReopenMakeUp is this rule's JavaScript mirror).
 * On any failure nothing changes and the lesson stays ticked. There is no
 * client-side fallback: a separate un-complete and pin could leave the lesson
 * unfinished and unpinned behind the pointer, invisible to Today.
 */
export async function untickLesson(
  supabase: SupabaseClient,
  a: { lessonId: string; localDay: string },
): Promise<UntickResult> {
  const { data, error } = await supabase.rpc("reopen_lesson", {
    p_lesson_id: a.lessonId,
    p_local_day: a.localDay,
  });
  if (error) {
    const missing = (error as { code?: string }).code === "PGRST202";
    return {
      ok: false,
      status: missing ? "unavailable" : "failed",
      reason: missing ? "reopen_lesson is not deployed on this database" : (error as { message?: string }).message ?? "rpc error",
    };
  }
  const res = (data ?? {}) as { status?: string; reason?: string; date?: string };
  if (res.status === "made_up" || res.status === "requeued") {
    return { ok: true, status: res.status, date: res.date ?? null };
  }
  const status = res.status === "invalid" || res.status === "not_completed" ? res.status : "failed";
  return { ok: false, status, reason: res.reason ?? res.status ?? "unknown" };
}

/**
 * The ORDER an un-tick must run in, and the one place it is written down:
 *   1. untickLesson: un-complete, pointer recomputed, make-up pinned (one
 *      transaction);
 *   2. only if that succeeded, `after` (the re-date of the rest of the
 *      curriculum), which then projects around the make-up pin.
 * Re-dating first would put the next lesson on the make-up's day; re-dating
 * after a failed un-tick would move lessons for a change that never happened.
 */
export async function untickLessonThen(
  supabase: SupabaseClient,
  a: { lessonId: string; localDay: string },
  after: (result: Extract<UntickResult, { ok: true }>) => Promise<void>,
): Promise<UntickResult> {
  const result = await untickLesson(supabase, a);
  if (result.ok) await after(result);
  return result;
}
