import type { SupabaseClient } from "@supabase/supabase-js";
import { batches, LESSON_INSERT_BATCH } from "./batches.ts";
import {
  computeNextLessonsForGoal,
  planPhase2LessonInserts,
  recomputeCurrentLesson,
  toGoalConfig,
  type GoalConfigRow,
  type VacationBlock,
} from "./scheduler.ts";
import { captureSupabaseError } from "../../lib/sentry-error.ts";

/* ============================================================================
 * A curriculum with settings and no lessons heals itself.
 *
 * THE STATE. The Schedule Builder saves in two phases: curriculum_goals first,
 * lessons second. When the connection drops between them — Sentry caught the
 * shape on 2026-08-27 03:28 UTC, "recomputeCurrentLesson: current_lesson update
 * failed: TypeError: Load failed" from /dashboard/plan/schedule — the goal
 * survives with zero lesson rows and the family opens Today to an empty
 * subject. The only recovery was a soft "save again to sync" notice at the
 * bottom of a page they had already navigated away from, and the family this
 * was found on never saw it. One save left six goals that way.
 *
 * scripts/repair-empty-goals.ts fixes the rows that exist. This stops the state
 * from needing a person at all: the next time anyone opens Today or Plan, the
 * goal fills itself in.
 *
 * THE PLANNER IS THE APP'S. computeNextLessonsForGoal projects the dates and
 * planPhase2LessonInserts pairs lesson numbers to queue slots — exactly what
 * applyPhase2ForGoal does in the builder and what the repair script does.
 * Nothing here walks days (Invariant 8) or invents a slot assignment ("number
 * taken" and "slot taken" are different questions, and conflating them
 * destroyed a lesson per drifted pin in 6905c4f).
 *
 * WHAT IT WILL NOT TOUCH. A goal with ANY lesson row, completed or not. This
 * heals the zero-row state and nothing else; every goal that has rows already
 * belongs to reconcileGoalScheduleCache. The count that decides is an exact
 * head count on that one goal, never a filtered list — a list can be truncated
 * by PostgREST's row cap, and a truncated read that looks like "no rows" would
 * make this insert a duplicate set over a family's real lessons. That failure
 * mode is the reason the check is shaped this way.
 *
 * ONE COUNT FOR THE WHOLE CANDIDATE SET. Asking that question once per goal
 * cost a family with a dozen active curricula a dozen head requests on every
 * Plan load. countLessonRowsByGoal asks it once for the whole set and each
 * answer may be handed in as `existingLessonCount`. That is still a count and
 * not a list: PostgREST computes the embedded `lessons(count)` in the database
 * and returns one row per GOAL, so there is no row cap to truncate and nothing
 * to miscount. Every other rule above stands — a goal with no answer in that
 * read falls back to its own head count, and a count that could not be read
 * still fails closed.
 * ==========================================================================*/

/** A goal younger than this may be mid-save in another tab. Leave it be. */
export const HEAL_MIN_AGE_MS = 2 * 60 * 1000;

/** Invariant 10: every write to lessons.date names its source. */
export const HEAL_SOURCE = "self_heal";

/** The goal columns the heal needs, beyond the projector's own config. */
export type HealableGoalRow = GoalConfigRow & {
  user_id?: string | null;
  child_id: string | null;
  curriculum_name: string | null;
  created_at?: string | null;
};

export interface PlannedHealRow {
  user_id: string;
  child_id: string | null;
  curriculum_goal_id: string;
  lesson_number: number;
  queue_position: number;
  title: string;
  scheduled_date: string;
  date: string;
  scheduled_source: string;
  completed: false;
  hours: number;
}

/**
 * The rows a zero-row goal should hold. Pure: no database, no clock beyond the
 * `today` handed in, so the shape of a heal can be checked directly.
 *
 * Returns [] when the projector emits nothing — a goal whose `current_lesson`
 * has already reached `total_lessons` has no lessons left to lay, and the
 * repair script reports exactly those as NOTHING-TO-PLAN.
 */
export function planEmptyGoalLessons(args: {
  goal: HealableGoalRow;
  vacationBlocks: VacationBlock[];
  today: Date;
  userId: string;
}): PlannedHealRow[] {
  const cfg = toGoalConfig(args.goal);
  if (!cfg.total_lessons || cfg.total_lessons <= 0) return [];

  // 3650 is the projector's own safety bound; it stops early once the queue
  // runs out. A future start_date is honored inside the projector.
  const upcoming = computeNextLessonsForGoal(
    cfg,
    args.today,
    3650,
    args.vacationBlocks,
  );
  if (upcoming.length === 0) return [];

  // The goal holds no rows, so nothing is taken: every projected slot is free
  // and every lesson number is missing. Routed through the shared planner
  // anyway so this cannot drift from the builder's answer.
  const planned = planPhase2LessonInserts({
    upcoming,
    existingLessonNumbers: [],
    existingQueuePositions: [],
  });

  const name = (args.goal.curriculum_name ?? "Lesson").trim() || "Lesson";
  return planned.map((p) => ({
    user_id: args.userId,
    child_id: args.goal.child_id,
    curriculum_goal_id: args.goal.id,
    lesson_number: p.lesson_number,
    // Invariant: queue_position = lesson_number on a healthy goal. With no
    // drifted rows to work around, the planner returns exactly that.
    queue_position: p.queue_position,
    title: `${name} — Lesson ${p.lesson_number}`,
    scheduled_date: p.date,
    date: p.date,
    scheduled_source: HEAL_SOURCE,
    completed: false as const,
    hours: 0,
  }));
}

/** The shape PostgREST returns for `select("id, lessons(count)")`. */
type GoalLessonCountRow = { id: string; lessons: { count: number }[] | null };

/**
 * How many lesson rows each of these goals holds, in ONE request.
 *
 * The embedded `lessons(count)` is an aggregate the database computes; the
 * response carries one row per goal, so the row cap that makes a filtered
 * lesson list unsafe cannot apply here. Read under the caller's own session,
 * so RLS scopes it exactly the way the per-goal head count is scoped.
 *
 * Returns null when the read failed or came back unusable — a URL too long for
 * an enormous id list included. Null means "no answer", and every caller then
 * lets healEmptyGoal ask for itself. It never means zero.
 */
export async function countLessonRowsByGoal(
  supabase: SupabaseClient,
  goalIds: readonly string[],
): Promise<Map<string, number> | null> {
  if (goalIds.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      .from("curriculum_goals")
      .select("id, lessons(count)")
      .in("id", goalIds as string[]);
    if (error || !data) {
      if (error) {
        captureSupabaseError("Empty-goal self-heal: grouped lesson count failed", error, {
          level: "warning",
          tags: { phase: "empty_goal_self_heal" },
          extra: { goals: goalIds.length },
        });
      }
      return null;
    }
    const counts = new Map<string, number>();
    for (const row of data as unknown as GoalLessonCountRow[]) {
      const n = row?.lessons?.[0]?.count;
      // A goal whose count did not parse is simply left out: no entry means
      // its own head count decides, which is the answer this replaces.
      if (row?.id && typeof n === "number" && Number.isFinite(n) && n >= 0) {
        counts.set(row.id, n);
      }
    }
    return counts;
  } catch (err) {
    captureSupabaseError("Empty-goal self-heal: grouped lesson count failed", err, {
      level: "warning",
      tags: { phase: "empty_goal_self_heal" },
      extra: { goals: goalIds.length },
    });
    return null;
  }
}

/** Is this goal old enough to be sure no save is still in flight for it? */
export function isOldEnoughToHeal(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!createdAt) return false;
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return false;
  return now.getTime() - ms >= HEAL_MIN_AGE_MS;
}

/**
 * Fill in one goal that holds no lessons. Returns the number of rows written,
 * 0 when there was nothing to do or anything went wrong.
 *
 * Never throws: a page load must render whatever happens here. A failure is
 * reported to Sentry under phase "empty_goal_self_heal" and the load carries
 * on with the goal still empty, which is the state it was already in.
 */
export async function healEmptyGoal(
  supabase: SupabaseClient,
  args: {
    goal: HealableGoalRow;
    vacationBlocks: VacationBlock[];
    today: Date;
    userId: string;
    now?: Date;
    /**
     * This goal's lesson-row count, already read for the whole candidate set by
     * countLessonRowsByGoal. Omit it — or pass null / undefined — and the goal
     * is counted here instead. Only a number read from that grouped count may
     * be passed: it answers the same question, in the same session, with the
     * same authority.
     */
    existingLessonCount?: number | null;
  },
): Promise<number> {
  const goalId = args.goal.id;
  try {
    // 1. Age. A goal saved seconds ago may have its phase 2 still in flight in
    //    another tab; healing it would race the builder and duplicate rows.
    if (!isOldEnoughToHeal(args.goal.created_at, args.now ?? new Date())) return 0;

    // 2. Zero rows, asked authoritatively. head + exact count cannot be
    //    truncated the way a selected list can. The caller may have asked the
    //    same question for the whole candidate set already; when it did not,
    //    ask here, because a goal that was never counted is not an empty one.
    let count: number | null;
    if (typeof args.existingLessonCount === "number") {
      count = args.existingLessonCount;
    } else {
      const { count: own, error: countErr } = await supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_goal_id", goalId);
      count = countErr ? null : own;
    }
    // Fail CLOSED. A count we could not read is not evidence of emptiness, and
    // guessing wrong here writes a duplicate curriculum over a real one.
    if (count == null || count > 0) return 0;

    // 3. Plan.
    const rows = planEmptyGoalLessons({
      goal: args.goal,
      vacationBlocks: args.vacationBlocks,
      today: args.today,
      userId: args.userId,
    });
    if (rows.length === 0) return 0;

    // 4. Write, in batches, through the same helper the builder uses.
    let written = 0;
    for (const batch of batches(rows, LESSON_INSERT_BATCH)) {
      const { error } = await supabase.from("lessons").insert(batch);
      if (error) {
        captureSupabaseError("Empty-goal self-heal: insert failed", error, {
          level: "warning",
          tags: { phase: "empty_goal_self_heal", goal_id: goalId },
          extra: { planned: rows.length, writtenBefore: written },
        });
        return written;
      }
      written += batch.length;
    }

    // 5. Same as the builder: let the pointer be recomputed from the rows
    //    rather than assumed. current_lesson is not ours to move.
    //
    //    Its own try/catch, and deliberately not fatal. The rows are already
    //    written at this point; letting a failed recompute fall through to the
    //    outer catch would report 0 written when 250 landed, and the caller
    //    reads that number to decide whether to reload. recomputeCurrentLesson
    //    already bails without writing on a bad read, and the next page load
    //    recomputes anyway.
    try {
      await recomputeCurrentLesson(supabase, goalId);
    } catch (err) {
      captureSupabaseError("Empty-goal self-heal: recompute after insert failed", err, {
        level: "warning",
        tags: { phase: "empty_goal_self_heal", goal_id: goalId },
        extra: { written: rows.length },
      });
    }
    return rows.length;
  } catch (err) {
    captureSupabaseError("Empty-goal self-heal failed", err, {
      level: "warning",
      tags: { phase: "empty_goal_self_heal", goal_id: goalId },
    });
    return 0;
  }
}
