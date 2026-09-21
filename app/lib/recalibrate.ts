import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeNextLessonsForGoal,
  writeParentProjectedDates,
  confirmedLessonsUpdate,
  mergeOutcomes,
  NO_WRITES,
  PARENT_RESPREAD_SOURCE,
  queueHoldsFromRows,
  type ConfirmedWriteOutcome,
  type CurriculumGoalConfig,
  type VacationBlock,
} from "./scheduler.ts";

/* ============================================================================
 * recalibrate.ts — shared "I'm actually on lesson X" recalibration.
 *
 * Called from both the Plan curriculum panel (PlanV2/index.tsx) and the
 * Schedule Builder (app/dashboard/plan/schedule/page.tsx). Audit-log writes
 * are the caller's concern — Plan fires its in-memory + DB event combo,
 * Schedule fires logPlanEvent directly. The utility itself only owns the
 * DB writes and projector resync so the two surfaces never drift.
 *
 * Behaviour:
 *   1. Fetch the goal's pacing fields, the incomplete gap rows (lesson_number
 *      < clamped, not yet completed), and the anchor for the gap-fill window
 *      (latest real completion's completed_at) — in two trips so the gap
 *      filter can use the clamped value.
 *   2. UPDATE curriculum_goals.current_lesson / start_at_lesson. The orphan-
 *      cleanup trigger fires here, marking notes-less gap rows complete with
 *      completed_at = NOW() - 1 day.
 *   3. Evenly distribute gap lessons across [anchor + 1 day, yesterday] in
 *      lesson_number order, stamping each with scheduled_source =
 *      'recalibrate_estimate' so the Plan lesson card surfaces them as
 *      estimates and a later move_lesson_to_date clears the flag. Each row
 *      KEEPS its queue_position, so it counts toward current_lesson exactly
 *      like a real completion (see the Phase 4 comment).
 *   4. Re-project upcoming lessons from today via writeParentProjectedDates
 *      (scheduled_source 'recalibrate_respread') so lesson `clamped` lands on
 *      the next valid school day instead of its wizard-assigned future date.
 *      This is a parent's action, so it is NOT gated by the automatic
 *      NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED switch, and it never writes
 *      'queue_resync'.
 *
 * Steps 3 and 4 report what actually landed (`estimates`, `respread`). The
 * pointer in step 2 is already committed by then, so a partial failure is not
 * rolled back: callers must say so instead of reporting success.
 *
 * Untouched (per spec): forward projector, orphan-cleanup trigger, recalibration
 * arithmetic (current_lesson = userInput - 1), real-history completions
 * (filtered out of the gap snapshot pre-UPDATE).
 * ==========================================================================*/

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Does an estimate row keep its queue slot? Only when the slot exists and sits
 * at or below the new pointer, so the row can hold current_lesson up but never
 * push it past the lesson the family typed. Pure, exported for the tests.
 */
export function estimateKeepsSlot(queuePosition: number | null, newCountDone: number): boolean {
  return queuePosition != null && queuePosition <= newCountDone;
}

export interface RecalibrateResult {
  /** Lesson the user said they're on, clamped to [1, total_lessons]. */
  clamped: number;
  /** current_lesson value written to DB (= clamped - 1). */
  newCountDone: number;
  /** Gap rows that were re-stamped with estimated dates. */
  gapCount: number;
  /** Step 3: gap rows asked to become estimates vs rows that did. */
  estimates: ConfirmedWriteOutcome;
  /** Step 4: upcoming rows asked to move vs rows that did. */
  respread: ConfirmedWriteOutcome;
  /** Step 4 could not read the upcoming lessons, so it moved nothing. */
  respreadReadFailed: boolean;
}

/** True when every write the recalibration asked for landed. */
export function recalibrateFullyApplied(r: RecalibrateResult): boolean {
  return (
    r.estimates.failedIds.length === 0 &&
    r.respread.failedIds.length === 0 &&
    !r.respreadReadFailed
  );
}

export async function recalibrateCurriculumGoal(opts: {
  supabase: SupabaseClient;
  goalId: string;
  newCurrentLesson: number;
  vacationBlocks: VacationBlock[];
}): Promise<RecalibrateResult> {
  const { supabase, goalId, newCurrentLesson, vacationBlocks } = opts;

  // ── Phase 1: fetch the goal so we can clamp. ────────────────────────────
  const { data: goalRow, error: goalErr } = await supabase
    .from("curriculum_goals")
    .select(
      "total_lessons, lessons_per_day, school_days, start_date, lessons_per_day_overrides, created_at",
    )
    .eq("id", goalId)
    .maybeSingle();
  if (goalErr) throw new Error(goalErr.message);
  if (!goalRow) throw new Error("Curriculum goal not found");
  const goal = goalRow as {
    total_lessons: number | null;
    lessons_per_day: number | null;
    school_days: string[] | null;
    start_date: string | null;
    lessons_per_day_overrides: Record<string, number> | null;
    created_at: string | null;
  };
  const total = goal.total_lessons ?? 0;
  const clamped = Math.max(
    1,
    total > 0 ? Math.min(total, newCurrentLesson) : newCurrentLesson,
  );
  const newCountDone = Math.max(0, clamped - 1);

  // ── Phase 2: snapshot the pre-UPDATE state (gap rows + anchor). ─────────
  // The orphan-cleanup trigger fires on the curriculum_goals UPDATE below
  // and overwrites completed=true/completed_at on the notes-less gap rows.
  // We need their IDs and lesson_numbers before that happens.
  const [gapRowsRes, anchorRowRes] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, lesson_number, queue_position")
      .eq("curriculum_goal_id", goalId)
      .eq("completed", false)
      .not("lesson_number", "is", null)
      .lt("lesson_number", clamped)
      .order("lesson_number", { ascending: true }),
    supabase
      .from("lessons")
      .select("completed_at")
      .eq("curriculum_goal_id", goalId)
      .eq("completed", true)
      .not("completed_at", "is", null)
      .or("scheduled_source.is.null,scheduled_source.neq.recalibrate_estimate")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const gapLessons = (gapRowsRes.data ?? []) as Array<{
    id: string;
    lesson_number: number;
    queue_position: number | null;
  }>;
  const anchorCompletedAt =
    (anchorRowRes.data as { completed_at: string | null } | null)?.completed_at ?? null;

  // ── Phase 3: pivot the goal pointer. ────────────────────────────────────
  const { error: updErr } = await supabase
    .from("curriculum_goals")
    .update({
      current_lesson: newCountDone,
      start_at_lesson: clamped,
    })
    .eq("id", goalId);
  if (updErr) throw new Error(updErr.message);

  // ── Phase 4: distribute gap lessons across the calendar window. ─────────
  let estimates: ConfirmedWriteOutcome = NO_WRITES;
  if (gapLessons.length > 0) {
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    const yesterdayMid = new Date(todayMid);
    yesterdayMid.setDate(todayMid.getDate() - 1);

    // Anchor fallback chain: most-recent real completion → start_date →
    // created_at → yesterday (last-ditch so the math never blows up).
    let anchorMid: Date | null = null;
    if (anchorCompletedAt) {
      anchorMid = new Date(anchorCompletedAt);
    } else if (goal.start_date) {
      anchorMid = new Date(`${goal.start_date}T00:00:00`);
    } else if (goal.created_at) {
      anchorMid = new Date(goal.created_at);
    }
    if (!anchorMid || Number.isNaN(anchorMid.getTime())) anchorMid = yesterdayMid;
    anchorMid.setHours(0, 0, 0, 0);

    const startMid = new Date(anchorMid);
    startMid.setDate(anchorMid.getDate() + 1);
    const daysAvailable = Math.max(
      0,
      Math.floor((yesterdayMid.getTime() - startMid.getTime()) / 86400000) + 1,
    );

    const dates: string[] = [];
    if (daysAvailable <= 0) {
      // Anchor is yesterday or today — collapse to a single day so every
      // gap lesson lands on yesterday rather than the future.
      dates.push(toDateStr(yesterdayMid));
    } else {
      const cursor = new Date(startMid);
      for (let i = 0; i < daysAvailable; i++) {
        dates.push(toDateStr(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // Even spread: lesson i of N → date index floor(i * (D-1) / (N-1)).
    // For N=1 the formula divides by zero, so anchor to dates[0]. For N > D
    // this clusters in lesson-number order; for D > N it spreads with gaps.
    const N = gapLessons.length;
    const D = dates.length;
    // Per date, two id lists: rows that keep their slot and rows that give it
    // up (see the comment above the writes).
    const updatesByDate = new Map<string, { keepSlot: string[]; dropSlot: string[] }>();
    gapLessons.forEach((l, i) => {
      const idx = N === 1 ? 0 : Math.floor((i * (D - 1)) / (N - 1));
      const d = dates[idx];
      const entry = updatesByDate.get(d) ?? { keepSlot: [], dropSlot: [] };
      if (estimateKeepsSlot(l.queue_position, newCountDone)) entry.keepSlot.push(l.id);
      else entry.dropSlot.push(l.id);
      updatesByDate.set(d, entry);
    });

    // An estimate counts toward current_lesson exactly like a real completion,
    // so it keeps its queue_position whenever that slot is at or below the new
    // pointer. These rows used to be stamped queue_position = null "so the
    // projector ignores them", and nothing needed that: the projector starts at
    // current_lesson + 1, pins and skips are read from incomplete rows only, the
    // cache sync and healGoalIntegrity skip or keep completed rows, and the
    // orphan cleanup only unschedules incomplete ones. What the null DID do was
    // hide the estimates from both pointer recomputes (recomputeCurrentLesson
    // and the lessons trigger), which read MAX(queue_position) over completed
    // rows. The recalibration then held only through the start_at_lesson floor,
    // and a later Schedule Builder save that wrote start_at_lesson back dropped
    // the pointer to the last real completion: goal d1e76670 recalibrated to 19,
    // fell to 10, and the builder renumbered lesson 19 into slot 11
    // (ROOTED-HOMESCHOOL-1J, 8 slots unfilled).
    //
    // A slot ABOVE the new pointer is still given up. After a Plan move
    // (move_lesson_to_date) a lesson number and its slot diverge: lesson 5
    // moved three weeks out sits in slot 20. Recalibrating to 12 selects it by
    // lesson_number, and a completed row holding slot 20 would drive the
    // pointer to 20, past the lesson the family just typed. That row keeps the
    // old null, which is exactly what it had before.
    //
    // queue_position is never SET to lesson_number: on a drifted row that
    // number can belong to another row's slot, and the collision would fail the
    // whole date's batch.
    const estimate = (date: string) => ({
      completed: true,
      completed_at: `${date}T12:00:00Z`,
      scheduled_date: date,
      date: date,
      scheduled_source: "recalibrate_estimate",
    });
    const outcomes = await Promise.all(
      Array.from(updatesByDate.entries()).flatMap(([date, { keepSlot, dropSlot }]) => [
        ...(keepSlot.length > 0
          ? [confirmedLessonsUpdate(supabase, keepSlot, estimate(date))]
          : []),
        ...(dropSlot.length > 0
          ? [confirmedLessonsUpdate(supabase, dropSlot, { ...estimate(date), queue_position: null })]
          : []),
      ]),
    );
    estimates = mergeOutcomes(outcomes);
  }

  // ── Phase 5: re-align cached scheduled_date on the upcoming queue. ──────
  // syncProjectedScheduledDates skips completed + is_backfill rows, so the
  // estimate-stamped gap rows stay put.
  const cfg: CurriculumGoalConfig = {
    id: goalId,
    total_lessons: total,
    lessons_per_day: Math.max(1, goal.lessons_per_day ?? 1),
    school_days: goal.school_days,
    current_lesson: newCountDone,
    start_date: goal.start_date ?? null,
    lessons_per_day_overrides: goal.lessons_per_day_overrides ?? null,
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 1500 days covers a 180-lesson curriculum at 1/week (~3.5 yrs); the
  // projector also stops when total_lessons is reached.
  // Load the tail first: manually-placed rows are an input to the projection
  // (they hold their dates and consume capacity) and are excluded from the
  // write set by syncProjectedScheduledDates. Recalibrating the queue pointer
  // must not silently undo mom's manual moves.
  const { data: rowsData, error: rowsErr } = await supabase
    .from("lessons")
    .select("id, scheduled_date, date, completed, is_backfill, lesson_number, queue_position, queue_pinned, skipped")
    .eq("curriculum_goal_id", goalId)
    .eq("completed", false);
  const rows = (rowsData ?? []) as Array<{
    id: string;
    scheduled_date: string | null;
    date: string | null;
    completed: boolean;
    is_backfill: boolean | null;
    lesson_number: number | null;
    queue_position: number | null;
    queue_pinned: boolean | null;
    skipped: boolean | null;
  }>;
  const projected = computeNextLessonsForGoal(
    cfg,
    today,
    1500,
    vacationBlocks,
    0,
    queueHoldsFromRows(rows),
  );
  const projDateByKey = new Map(
    projected.map((p) => [`${p.goal_id}|${p.lesson_number}`, p.date]),
  );
  const respread = await writeParentProjectedDates(
    supabase,
    rows,
    projDateByKey,
    (r) => (r.lesson_number != null ? `${goalId}|${r.lesson_number}` : null),
    PARENT_RESPREAD_SOURCE.recalibrate,
  );

  return {
    clamped,
    newCountDone,
    gapCount: gapLessons.length,
    estimates,
    respread,
    respreadReadFailed: !!rowsErr,
  };
}
