/**
 * Put back ONE missing row: the lesson the family is due next.
 *
 * "Today projection missing lesson rows" is not a read bug. On 2026-09-13 the
 * founder found 23 live curricula across 2 families where the row for
 * `current_lesson + 1` did not exist at all: lesson 15 completed, lesson 17
 * scheduled, nothing in between. Every one was created by a single Schedule
 * Builder save, and in every case the vanished row was the one the projector
 * had dated the save day itself. She put them back by hand.
 *
 * Filing a Sentry event for that is the wrong answer twice over. The family
 * opens Today and their next lesson is simply absent, and nobody is served by
 * a warning that describes it. The projector knows which slot is empty and what
 * date it belongs on, so Today can write the row and render it.
 *
 * SCOPE, deliberately narrow. This heals the FIRST projected slot and only
 * when the goal already holds other rows. A goal missing everything is the
 * empty-goal state `healEmptyGoal` exists for, and a goal missing rows deeper
 * in its queue is a different shape that still deserves a human. One row, the
 * one in the way.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { captureSupabaseError } from "../../lib/sentry-error.ts";

export type NextRowGoal = {
  id: string;
  child_id: string | null;
  curriculum_name: string | null;
  current_lesson: number;
  total_lessons: number | null;
};

export type PlannedNextRow = {
  user_id: string;
  child_id: string | null;
  curriculum_goal_id: string;
  lesson_number: number;
  queue_position: number;
  title: string;
  scheduled_date: string;
  date: string;
  scheduled_source: string;
  completed: boolean;
  completed_at: null;
  is_backfill: boolean;
  hours: number;
};

/**
 * The row to write, or null when this goal is not a case for the heal.
 *
 * Pure, so the shape is testable without a database. `slot` and `date` come
 * from the projector's own first emission, which is what keeps the healed row
 * on the day the rest of the schedule expects it.
 */
export function planNextRow(args: {
  goal: NextRowGoal;
  userId: string;
  /** The slot the projection asked for, and the date it gave that slot. */
  slot: number;
  date: string;
  /** How many rows the goal holds. Zero is healEmptyGoal's job, not this one. */
  existingRowCount: number;
}): PlannedNextRow | null {
  const { goal, slot, date } = args;
  if (args.existingRowCount <= 0) return null;
  if (!Number.isInteger(slot) || slot <= 0) return null;
  if (goal.total_lessons != null && goal.total_lessons > 0 && slot > goal.total_lessons) return null;
  // Only the lesson that is actually in the way. A deeper hole is a different
  // shape and keeps its warning.
  if (slot !== goal.current_lesson + 1) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const name = (goal.curriculum_name ?? "Lesson").trim() || "Lesson";
  return {
    user_id: args.userId,
    child_id: goal.child_id,
    curriculum_goal_id: goal.id,
    lesson_number: slot,
    // Never null: a goal-attached row with no slot falls through both of
    // Today's hydration queries and becomes invisible instead of missing.
    queue_position: slot,
    title: `${name} — Lesson ${slot}`,
    scheduled_date: date,
    date,
    scheduled_source: "today_self_heal",
    // Not history and not done. The family has not done this lesson; the row
    // simply stopped existing.
    completed: false,
    completed_at: null,
    is_backfill: false,
    hours: 0,
  };
}

/**
 * Write the planned row. Returns true when a row landed.
 *
 * A conflict means something else put the row back between the projection and
 * this insert, which is a good outcome and not worth reporting. Anything else
 * is reported, matching how the empty-goal heal reports its own failures.
 */
export async function healNextRow(
  supabase: SupabaseClient,
  planned: PlannedNextRow,
): Promise<boolean> {
  const { data, error } = await supabase.from("lessons").insert(planned).select("id");
  if (error) {
    // 23505 is the unique index on (curriculum_goal_id, lesson_number) or its
    // queue_position twin: the row exists again, which is what we wanted.
    if ((error as { code?: string }).code === "23505") return false;
    captureSupabaseError("Today self-heal could not write the next lesson row", error, {
      level: "warning",
      tags: { phase: "next_row_self_heal", goal_id: planned.curriculum_goal_id },
      extra: { lesson_number: planned.lesson_number, scheduled_date: planned.scheduled_date },
    });
    return false;
  }
  return (data ?? []).length > 0;
}
