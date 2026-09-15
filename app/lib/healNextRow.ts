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

/** Why the heal declined a goal. Sentry tag `heal_skipped_because`. */
export type NextRowSkipReason =
  | "empty_goal"
  | "bad_slot"
  | "past_end"
  | "skipped_slot"
  | "not_next_lesson"
  | "below_completed"
  | "bad_date";

export type NextRowDecision = { row: PlannedNextRow } | { skip: NextRowSkipReason };

export type PlanNextRowArgs = {
  goal: NextRowGoal;
  userId: string;
  /** The slot the projection asked for, and the date it gave that slot. */
  slot: number;
  date: string;
  /** How many rows the goal holds. Zero is healEmptyGoal's job, not this one. */
  existingRowCount: number;
  /**
   * The goal's skipped queue slots. A skipped lesson's row is still there, so
   * it is never a missing row, and the lesson "in the way" is the first slot
   * past current_lesson the family has not skipped.
   */
  skippedSlots?: ReadonlySet<number>;
  /**
   * Highest queue_position among the goal's completed rows. A slot below it is
   * history: the family deleted that lesson or worked past it, and writing it
   * back would put a lesson they never wanted in front of one they finished.
   * Omit when unknown; the pointer guard still applies.
   */
  maxCompletedQueuePosition?: number | null;
};

/**
 * The row to write, or the reason there is none.
 *
 * Pure, so the shape is testable without a database. `slot` and `date` come
 * from the projector's own first emission, which is what keeps the healed row
 * on the day the rest of the schedule expects it.
 */
export function planNextRowDecision(args: PlanNextRowArgs): NextRowDecision {
  const { goal, slot, date } = args;
  const skipped = args.skippedSlots ?? new Set<number>();
  if (args.existingRowCount <= 0) return { skip: "empty_goal" };
  if (!Number.isInteger(slot) || slot <= 0) return { skip: "bad_slot" };
  if (goal.total_lessons != null && goal.total_lessons > 0 && slot > goal.total_lessons) return { skip: "past_end" };
  if (skipped.has(slot)) return { skip: "skipped_slot" };
  if (args.maxCompletedQueuePosition != null && args.maxCompletedQueuePosition > slot) {
    return { skip: "below_completed" };
  }
  // Only the lesson that is actually in the way. A deeper hole is a different
  // shape and keeps its warning.
  let next = goal.current_lesson + 1;
  while (skipped.has(next)) next++;
  if (slot !== next) return { skip: "not_next_lesson" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { skip: "bad_date" };

  const name = (goal.curriculum_name ?? "Lesson").trim() || "Lesson";
  return {
    row: {
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
    },
  };
}

/** The row to write, or null when this goal is not a case for the heal. */
export function planNextRow(args: PlanNextRowArgs): PlannedNextRow | null {
  const decision = planNextRowDecision(args);
  return "row" in decision ? decision.row : null;
}

/** What one goal looks like right now, re-read after the load that saw the gap. */
export type NextRowFacts = {
  currentLesson: number;
  maxCompletedQueuePosition: number | null;
  /** Slots, among those asked about, where the goal holds a row in any state. */
  slotsHeld: Set<number>;
};

/**
 * Re-read the three facts the gap classification needs, for the few goals a
 * load flagged. A goal whose reads fail is left out, and a goal left out is
 * neither healed nor reported: a failed read is not evidence of a missing row,
 * which is the mistake this whole path used to make.
 */
export async function readNextRowFacts(
  supabase: SupabaseClient,
  goalIds: readonly string[],
  slots: readonly number[],
): Promise<Map<string, NextRowFacts>> {
  const out = new Map<string, NextRowFacts>();
  if (goalIds.length === 0 || slots.length === 0) return out;
  try {
    const [goalsRes, heldRes, ...maxRes] = await Promise.all([
      supabase.from("curriculum_goals").select("id, current_lesson").in("id", goalIds as string[]),
      supabase
        .from("lessons")
        .select("curriculum_goal_id, queue_position")
        .in("curriculum_goal_id", goalIds as string[])
        .in("queue_position", slots as number[]),
      ...goalIds.map((id) =>
        supabase
          .from("lessons")
          .select("queue_position")
          .eq("curriculum_goal_id", id)
          .eq("completed", true)
          .not("queue_position", "is", null)
          .order("queue_position", { ascending: false })
          .limit(1),
      ),
    ]);
    if (goalsRes.error || heldRes.error) return out;
    const pointer = new Map<string, number>();
    for (const g of (goalsRes.data ?? []) as { id: string; current_lesson: number | null }[]) {
      if (typeof g.current_lesson === "number") pointer.set(g.id, g.current_lesson);
    }
    const held = new Map<string, Set<number>>();
    for (const r of (heldRes.data ?? []) as { curriculum_goal_id: string | null; queue_position: number | null }[]) {
      if (!r.curriculum_goal_id || r.queue_position == null) continue;
      const set = held.get(r.curriculum_goal_id) ?? new Set<number>();
      set.add(r.queue_position);
      held.set(r.curriculum_goal_id, set);
    }
    goalIds.forEach((id, i) => {
      const res = maxRes[i];
      const currentLesson = pointer.get(id);
      if (!res || res.error || currentLesson === undefined) return;
      const top = ((res.data ?? []) as { queue_position: number | null }[])[0]?.queue_position ?? null;
      out.set(id, {
        currentLesson,
        maxCompletedQueuePosition: top,
        slotsHeld: held.get(id) ?? new Set<number>(),
      });
    });
  } catch {
    // A thrown read (a dropped connection) answers nothing, so nothing acts.
  }
  return out;
}

/** What the insert did. `conflict` means the row exists again, a good outcome. */
export type NextRowWriteOutcome = "written" | "conflict" | "failed";

/**
 * Write the planned row.
 *
 * A conflict means something else put the row back between the projection and
 * this insert, which is a good outcome and not worth reporting. Anything else
 * is reported, matching how the empty-goal heal reports its own failures.
 */
export async function healNextRow(
  supabase: SupabaseClient,
  planned: PlannedNextRow,
): Promise<NextRowWriteOutcome> {
  const { data, error } = await supabase.from("lessons").insert(planned).select("id");
  if (error) {
    // 23505 is the unique index on (curriculum_goal_id, lesson_number) or its
    // queue_position twin: the row exists again, which is what we wanted.
    if ((error as { code?: string }).code === "23505") return "conflict";
    captureSupabaseError("Today self-heal could not write the next lesson row", error, {
      level: "warning",
      tags: { phase: "next_row_self_heal", goal_id: planned.curriculum_goal_id },
      extra: { lesson_number: planned.lesson_number, scheduled_date: planned.scheduled_date },
    });
    return "failed";
  }
  return (data ?? []).length > 0 ? "written" : "failed";
}
