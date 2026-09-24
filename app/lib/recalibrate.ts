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
import { queueOutOfBookOrder, restoreQueueBookOrder } from "./move-keep-slot.ts";

/* ============================================================================
 * recalibrate.ts — shared "I'm actually on lesson X" recalibration.
 *
 * Called from both the Plan curriculum panel (PlanV2/index.tsx) and the
 * Schedule Builder (app/dashboard/plan/schedule/page.tsx). Audit-log writes
 * are the caller's concern — Plan fires its in-memory + DB event combo,
 * Schedule fires logPlanEvent directly. The utility itself only owns the
 * DB writes and projector resync so the two surfaces never drift.
 *
 * Behaviour, numbered by the "Phase N" headers in the code below:
 *   Phases 1-2. Fetch the goal's pacing fields, the incomplete gap rows (lesson_number
 *      < clamped, not yet completed), and the anchor for the gap-fill window
 *      (latest real completion's completed_at) — in two trips so the gap
 *      filter can use the clamped value.
 *   Phase 3. UPDATE curriculum_goals.current_lesson / start_at_lesson. The orphan-
 *      cleanup trigger fires here and UNSCHEDULES notes-less, unpinned gap rows
 *      (scheduled_date = NULL). It completes nothing: see
 *      supabase/migrations/20260907000000_no_server_side_lesson_completion.sql.
 *      start_at_lesson is what holds the pointer when Phase 4 does not run:
 *      recompute_curriculum_current_lesson is GREATEST(start_at_lesson - 1,
 *      MAX(queue_position) over completed rows).
 *   Phase 4. ONLY when the family asked for it (`recordHistory`). Saying "I'm
 *      on lesson 12" places them in the book; it does not say Rooted holds
 *      lessons 1 to 11, and writing those as done put hours on reports nobody
 *      logged. Without the opt-in the gap rows stay unfinished, which is the
 *      state the Schedule Builder leaves when a family raises an existing goal's
 *      lesson number (Invariant 23 holds them behind the pointer, undeleted).
 *      With it: evenly distribute gap lessons across [anchor + 1 day, yesterday] in
 *      lesson_number order, stamping each with scheduled_source =
 *      'recalibrate_estimate' so the Plan lesson card surfaces them as
 *      estimates and a later move_lesson_to_date clears the flag. Each row
 *      KEEPS its queue_position, so it counts toward current_lesson exactly
 *      like a real completion (see the Phase 4 comment).
 *   Phase 5. Re-project upcoming lessons from today via writeParentProjectedDates
 *      (scheduled_source 'recalibrate_respread') so lesson `clamped` lands on
 *      the next valid school day instead of its wizard-assigned future date.
 *      This is a parent's action, so it is NOT gated by the automatic
 *      NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED switch, and it never writes
 *      'queue_resync'.
 *
 * Phases 4 and 5 report what actually landed (`estimates`, `respread`). The
 * pointer from Phase 3 is already committed by then, so a partial failure is
 * not rolled back: callers must say so instead of reporting success.
 *
 * Before fix/scheduler-containment, Phase 5 called syncProjectedScheduledDates
 * and wrote 'queue_resync'. That is the ONLY phase an old bundle sends in the
 * shape the lessons_block_stale_resync trigger refuses; Phases 3 and 4 always
 * land (Phase 4 writes completed rows as 'recalibrate_estimate').
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

/** The fields the gap rule reads. The form and the recalibration read the same ones. */
export interface RecalibrateGapRow {
  id: string;
  lesson_number: number | null;
  queue_position: number | null;
  queue_pinned?: boolean | null;
  skipped?: boolean | null;
  completed?: boolean | null;
  scheduled_date?: string | null;
}

/**
 * Which lessons "I'm actually on lesson X" is about, and which of them a Yes
 * would mark done. ONE rule, read by the form (to word the question and the
 * hours) and by the recalibration (to write), so the question can never name a
 * lesson the write leaves alone, or the other way round.
 *
 *   gap: unfinished lessons after the saved position and before X. A row at or
 *     below the old position, by number or by slot, is a reopened make-up
 *     (Invariant 23) and is never part of it.
 *   toComplete: the gap minus what the family has already decided about:
 *     - a lesson they PINNED keeps the day they moved it to. Marking it done
 *       would turn a placement into a past completion nobody logged.
 *     - a SKIPPED lesson is never counted done (Invariant 22).
 *   keptPinned: the pinned ones, so the form can say they keep their day.
 */
export function planRecalibrateGap<T extends RecalibrateGapRow>(
  rows: readonly T[],
  oldCountDone: number,
  clamped: number,
): { gap: T[]; toComplete: T[]; keptPinned: T[] } {
  const gap = rows.filter(
    (r) =>
      !r.completed &&
      r.lesson_number != null &&
      r.lesson_number > oldCountDone &&
      r.lesson_number < clamped &&
      (r.queue_position == null || r.queue_position > oldCountDone),
  );
  return {
    gap,
    toComplete: gap.filter((r) => !r.queue_pinned && !r.skipped),
    keptPinned: gap.filter((r) => !!r.queue_pinned && !r.skipped),
  };
}

/**
 * "lesson 12", "lessons 11 and 12", "lessons 11 to 14 and 16 to 18". Runs of
 * three or more read as a range; shorter runs are listed. `capital` for the
 * start of a sentence.
 */
export function formatLessonList(numbers: readonly number[], capital = false): string {
  const ns = [...new Set(numbers)].sort((a, b) => a - b);
  if (ns.length === 0) return "";
  const items: string[] = [];
  let i = 0;
  while (i < ns.length) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    if (j - i >= 2) items.push(`${ns[i]} to ${ns[j]}`);
    else for (let k = i; k <= j; k++) items.push(String(ns[k]));
    i = j + 1;
  }
  const list =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  const word = ns.length === 1 ? "lesson" : "lessons";
  return `${capital ? word[0].toUpperCase() + word.slice(1) : word} ${list}`;
}

/**
 * What an estimate adds to Reports. Estimates carry no minutes, and Reports
 * counts a completed lesson with none as 30 (app/dashboard/reports/page.tsx).
 * If the shared lesson-minutes rule lands (PR #96), read its constant instead.
 */
export const ESTIMATE_REPORT_MINUTES = 30;

/** "30 minutes", "1 hour", "3 hours 30 minutes". */
export function formatAddedTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : `${h} ${h === 1 ? "hour" : "hours"}`;
  const mins = m === 0 ? "" : `${m} ${m === 1 ? "minute" : "minutes"}`;
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

/**
 * A Yes was refused before anything was written, because the lessons it would
 * mark done are not the ones the family was shown and agreed to. The form
 * lists them (and the hours they add) when it opens; if another tab completed,
 * pinned, skipped or moved one in the meantime, writing now would complete a
 * different set, or add different hours, from the ones she said yes to.
 */
export class RecalibrateListChangedError extends Error {
  constructor() {
    super(
      "Your lessons changed since you opened this. Close it and choose \u201cI\u2019m actually on\u2026\u201d again to see the current list.",
    );
    this.name = "RecalibrateListChangedError";
  }
}

/** Same set, order ignored. */
export function sameLessonIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === a.length && b.every((id) => set.has(id));
}

export interface RecalibrateResult {
  /** Lesson the user said they're on, clamped to [1, total_lessons]. */
  clamped: number;
  /** current_lesson value written to DB (= clamped - 1). */
  newCountDone: number;
  /** Unfinished rows below the new position. Re-stamped as estimates only when `recordedHistory`. */
  gapCount: number;
  /** Did Phase 4 run, i.e. did the family ask for the gap to be written as done? */
  recordedHistory: boolean;
  /** Pinned lessons in the gap. Yes leaves them unfinished, on their day. */
  keptPinned: number[];
  /** Phase 4: gap rows asked to become estimates vs rows that did. */
  estimates: ConfirmedWriteOutcome;
  /** Phase 4 on No: dated, unpinned gap rows asked to be unscheduled vs rows that were. */
  unscheduled: ConfirmedWriteOutcome;
  /** Phase 5: upcoming rows asked to move vs rows that did. */
  respread: ConfirmedWriteOutcome;
  /** Phase 5 could not read the upcoming lessons, so it moved nothing. */
  respreadReadFailed: boolean;
  /** Phase 0 put a drifted queue back in book order first. */
  bookOrderRestored: boolean;
  /** The lesson the family is on was pinned elsewhere; its pin was released so it is due now. */
  releasedPin: ConfirmedWriteOutcome;
}

/** True when every write the recalibration asked for landed. */
export function recalibrateFullyApplied(r: RecalibrateResult): boolean {
  return (
    r.estimates.failedIds.length === 0 &&
    r.unscheduled.failedIds.length === 0 &&
    r.respread.failedIds.length === 0 &&
    r.releasedPin.failedIds.length === 0 &&
    !r.respreadReadFailed
  );
}

export async function recalibrateCurriculumGoal(opts: {
  supabase: SupabaseClient;
  goalId: string;
  newCurrentLesson: number;
  vacationBlocks: VacationBlock[];
  /**
   * Write the unfinished lessons below the new position as DONE estimates?
   * Default NO: the answer that adds nothing to a family's records is the one
   * they get by not deciding, the same default as the Schedule Builder's
   * "Already into it" question.
   */
  recordHistory?: boolean;
  /**
   * Required with recordHistory: the ids of the lessons the family was shown
   * and agreed to mark done (planRecalibrateGap's toComplete, as the form read
   * it). The write recomputes the list and refuses, before writing anything,
   * unless it is exactly this set. A Yes without it is refused too: history is
   * only ever written for a list a person has seen.
   */
  confirmedLessonIds?: readonly string[];
}): Promise<RecalibrateResult> {
  const { supabase, goalId, newCurrentLesson, vacationBlocks } = opts;
  const recordHistory = opts.recordHistory === true;

  // ── Phase 0: book order. ────────────────────────────────────────────────
  // "I'm actually on lesson X" is a statement about the BOOK, but the pointer
  // and every projector count queue slots. A Plan move made with
  // move_lesson_to_date renumbered the slots, so the two disagreed: after
  // moving lesson 4 to a later day, slot 4 held lesson 5, "I'm on lesson 4"
  // wrote current_lesson 3 (which it already was) and Today kept showing
  // lesson 5. After a later lesson was completed in a higher slot, the lesson
  // before it sat behind the pointer, invisible on Today, and no number the
  // family could type brought it back (a family's four tries on 2026-08-26/27).
  // So when the order has drifted it is put back first, in one transaction:
  // the same slots, reassigned in lesson_number order. The form words its
  // question from the same view (bookOrderView), so a Yes names the same
  // lessons this write reads. Nothing is written if this fails.
  const localDay = toDateStr(new Date());
  const { data: orderRows, error: orderErr } = await supabase
    .from("lessons")
    .select("lesson_number, queue_position")
    .eq("curriculum_goal_id", goalId)
    .not("lesson_number", "is", null)
    .not("queue_position", "is", null);
  if (orderErr) throw new Error(orderErr.message);
  let bookOrderRestored = false;
  if (queueOutOfBookOrder((orderRows ?? []) as { lesson_number: number | null; queue_position: number | null }[])) {
    const restored = await restoreQueueBookOrder(supabase, goalId, localDay);
    if (restored.status === "failed") {
      throw new Error("Couldn't put this curriculum's lessons back in order. Nothing was changed. Try again.");
    }
    bookOrderRestored = restored.status === "restored";
  }

  // ── Phase 1: fetch the goal so we can clamp. ────────────────────────────
  const { data: goalRow, error: goalErr } = await supabase
    .from("curriculum_goals")
    .select(
      "total_lessons, lessons_per_day, school_days, start_date, lessons_per_day_overrides, created_at, current_lesson",
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
    current_lesson?: number | null;
  };
  const total = goal.total_lessons ?? 0;
  const clamped = Math.max(
    1,
    total > 0 ? Math.min(total, newCurrentLesson) : newCurrentLesson,
  );
  const newCountDone = Math.max(0, clamped - 1);
  // Where the queue stood before this move. The gap is the lessons AFTER it:
  // the form asks "Should Rooted mark lessons {current + 1} to {X - 1} as
  // done?", so that is exactly what Phase 4 may complete. An unfinished row at
  // or below the old position is a lesson the family reopened (a make-up,
  // Invariant 23). It is theirs, it was never named, and it is never swept up.
  const oldCountDone = Math.max(0, goal.current_lesson ?? 0);

  // ── Phase 2: snapshot the pre-UPDATE state (gap rows + anchor). ─────────
  // The orphan-cleanup trigger fires on the curriculum_goals UPDATE below
  // and overwrites completed=true/completed_at on the notes-less gap rows.
  // We need their IDs and lesson_numbers before that happens.
  const [gapRowsRes, anchorRowRes] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, lesson_number, queue_position, queue_pinned, skipped, scheduled_date")
      .eq("curriculum_goal_id", goalId)
      .eq("completed", false)
      .not("lesson_number", "is", null)
      .lt("lesson_number", clamped)
      .gt("lesson_number", oldCountDone)
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
  // planRecalibrateGap is the one rule for which rows this is about; the form
  // words its question from the same call.
  const { gap: gapLessons, toComplete, keptPinned } = planRecalibrateGap(
    (gapRowsRes.data ?? []) as RecalibrateGapRow[],
    oldCountDone,
    clamped,
  );
  const anchorCompletedAt =
    (anchorRowRes.data as { completed_at: string | null } | null)?.completed_at ?? null;

  // ── The Yes must be for the list the family saw. Nothing is written yet. ──
  if (recordHistory) {
    if (gapRowsRes.error) throw new Error(gapRowsRes.error.message);
    const agreed = opts.confirmedLessonIds;
    if (!agreed || !sameLessonIds(agreed, toComplete.map((r) => r.id))) {
      throw new RecalibrateListChangedError();
    }
  }

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
  if (recordHistory && toComplete.length > 0) {
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
    const N = toComplete.length;
    const D = dates.length;
    // Per date, two id lists: rows that keep their slot and rows that give it
    // up (see the comment above the writes).
    const updatesByDate = new Map<string, { keepSlot: string[]; dropSlot: string[] }>();
    toComplete.forEach((l, i) => {
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

  // ── Phase 4, on No: the lessons passed over keep no date. ───────────────
  // The orphan cleanup (Phase 3's trigger) unschedules the gap rows that carry
  // nothing, and deliberately leaves a row with notes alone. Families plan
  // ahead in those notes: 2,030 unfinished future lessons in 66 curricula held
  // notes on 2026-09-22. Left dated behind the pointer, the next Schedule
  // Builder save reads each one as a reopened lesson and pins it to Today as a
  // make-up (Invariant 23), eight surprise lessons for a family who only said
  // "we're on 19". The family has just said they are past these lessons, so
  // they are unscheduled the same way the trigger unschedules the others:
  // scheduled_date only, notes and minutes kept, never completed, never
  // re-dated. A row the family PINNED is their own placement and is left alone.
  let unscheduled: ConfirmedWriteOutcome = NO_WRITES;
  if (!recordHistory) {
    const stillDated = gapLessons
      .filter((l) => !l.queue_pinned && l.scheduled_date != null)
      .map((l) => l.id);
    if (stillDated.length > 0) {
      // Tagged with recalibrate's own source, as Phase 5's writes are: a row
      // still carrying 'queue_resync' would otherwise be refused by
      // lessons_block_stale_resync unless it happened to see this
      // recalibration's intent.
      unscheduled = await confirmedLessonsUpdate(supabase, stillDated, {
        scheduled_date: null,
        scheduled_source: PARENT_RESPREAD_SOURCE.recalibrate,
      });
    }
  }

  // ── The lesson they are on is due now. ──────────────────────────────────
  // A pin on it (a day the family moved it to, or a day "Move just this
  // lesson" held it on) would keep it off Today while the pointer says it is
  // next. Released, it takes the projector's first open day in Phase 5.
  let releasedPin: ConfirmedWriteOutcome = NO_WRITES;
  const { data: pinnedX } = await supabase
    .from("lessons")
    .select("id")
    .eq("curriculum_goal_id", goalId)
    .eq("lesson_number", clamped)
    .eq("completed", false)
    .eq("queue_pinned", true);
  const pinnedXIds = ((pinnedX ?? []) as { id: string }[]).map((r) => r.id);
  if (pinnedXIds.length > 0) {
    releasedPin = await confirmedLessonsUpdate(supabase, pinnedXIds, {
      queue_pinned: false,
      scheduled_source: PARENT_RESPREAD_SOURCE.recalibrate,
    });
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
    // Keyed by queue slot, which is what the projector emits
    // (ProjectedLesson.lesson_number IS the slot). Keying by lesson_number
    // wrote the date of a different lesson's slot whenever the two differed.
    (r) => (r.queue_position != null ? `${goalId}|${r.queue_position}` : null),
    PARENT_RESPREAD_SOURCE.recalibrate,
  );

  return {
    clamped,
    newCountDone,
    gapCount: gapLessons.length,
    recordedHistory: recordHistory,
    keptPinned: keptPinned.map((r) => r.lesson_number!).filter((n) => n != null),
    estimates,
    unscheduled,
    respread,
    respreadReadFailed: !!rowsErr,
    bookOrderRestored,
    releasedPin,
  };
}
