/* ============================================================================
 * Two states hide behind "Today projection missing lesson rows".
 *
 * WHAT WENT WRONG. On 2026-09-10 one family's page load filed 22 of these
 * warnings in the same second. Every one of them was a goal the empty-goal
 * self-heal filled in on that same load: the report fires at detection, the
 * heal runs a few lines later, and a state the app fixes by itself filed a
 * warning per goal per load. Sentry is only useful if what is in it is real.
 *
 * THE SPLIT. A goal whose EVERY projected slot came back without a row is the
 * zero-row state healEmptyGoal exists for (see its header comment). It is a
 * heal candidate, not news, and it is only worth a warning if the heal did not
 * resolve it. A goal where SOME slots have rows and some do not is different:
 * healEmptyGoal will not touch a goal that holds any row, by design, so
 * nothing fixes it on its own. That one is the real signal and keeps reporting
 * at detection.
 *
 * Pure on purpose. No Sentry, no Supabase, no clock — the caller files what
 * comes back, so the split itself can be checked directly in scheduler.test.ts
 * without stubbing a reporter.
 * ==========================================================================*/

/* ============================================================================
 * WHAT COUNTS AS MISSING.
 *
 * On 2026-09-15 this report fired 58 times for 7 families in 19 hours and not
 * one of those goals was missing a row. Every event filed every goal a family
 * has in the same second, at local midnight or on the first load of a laptop
 * tab left open overnight. The 5-minute poll called the loadData closure from
 * the tab's first render, so `today` was still yesterday; the projector dated
 * today's slot with a fresh clock; and the display filter that drops rows dated
 * after `today` dropped every row Today had just fetched. The gap check walked
 * that filtered list and called the rows missing.
 *
 * The display may filter. The gap check may not. A slot is missing only when
 * the goal has no row at that queue_position in ANY state (done, skipped,
 * dated tomorrow, dated last year). missingProjectedSlots is that rule.
 * ==========================================================================*/

/** The two columns that say whether a goal holds a row at a slot. */
export interface SlotRow {
  curriculum_goal_id: string | null;
  queue_position: number | null;
}

/**
 * The projected slots with no row at all, per goal, in projection order.
 *
 * `rows` is every row the read returned for the projected goals, BEFORE any
 * display filtering. A goal with every slot covered is absent from the result.
 */
export function missingProjectedSlots(
  projected: readonly { goal_id: string; lesson_number: number }[],
  rows: readonly SlotRow[],
): Map<string, number[]> {
  const held = new Set<string>();
  for (const r of rows) {
    if (r.curriculum_goal_id && r.queue_position != null) {
      held.add(`${r.curriculum_goal_id}|${r.queue_position}`);
    }
  }
  const out = new Map<string, number[]>();
  for (const p of projected) {
    if (held.has(`${p.goal_id}|${p.lesson_number}`)) continue;
    const list = out.get(p.goal_id) ?? [];
    if (!list.includes(p.lesson_number)) list.push(p.lesson_number);
    out.set(p.goal_id, list);
  }
  return out;
}

/**
 * Why a slot came back without a row. Sentry tag `gap_kind`.
 *
 * - `below_completed`: the family has completed a lesson past this slot. The
 *   hole is history (a lesson deleted on purpose, or skipped over by hand), not
 *   a missing next lesson. Nothing to heal and nothing to report.
 * - `transient_after_completion`: the pointer moved between the load and the
 *   check, or already counts this slot as done. The load projected from a
 *   pointer that a check-off was still settling. The next load is right.
 * - `next_row_missing`: the lesson the family is due has no row. The heal's
 *   case, and the only one worth a warning when the heal cannot close it.
 */
export type GapKind = "below_completed" | "next_row_missing" | "transient_after_completion";

export interface MissingSlotFacts {
  /** The slot the projection emitted that had no row. */
  slot: number;
  /** Re-read after the load: does the goal hold a row at `slot` now, in any state? */
  rowExistsNow: boolean;
  /** Highest queue_position among the goal's completed rows, re-read. Null for none. */
  maxCompletedQueuePosition: number | null;
  /** current_lesson as the projection saw it. */
  loadedCurrentLesson: number;
  /** current_lesson re-read after the load. */
  freshCurrentLesson: number;
}

/** The gap's kind, or null when there is no gap after all. Pure. */
export function classifyMissingSlot(f: MissingSlotFacts): GapKind | null {
  if (f.rowExistsNow) return null;
  if (f.maxCompletedQueuePosition != null && f.maxCompletedQueuePosition > f.slot) {
    return "below_completed";
  }
  if (f.freshCurrentLesson !== f.loadedCurrentLesson || f.slot <= f.freshCurrentLesson) {
    return "transient_after_completion";
  }
  return "next_row_missing";
}

/** Only this kind is ever filed. The other two are silent by design. */
export function isReportableGapKind(kind: GapKind | null): kind is "next_row_missing" {
  return kind === "next_row_missing";
}

/** The sessionStorage key for "this goal was already reported today in this browser". */
export function gapReportStorageKey(goalId: string, day: string): string {
  return `rooted:projection-gap-reported:${goalId}:${day}`;
}

/** The slice of Storage the claim needs, so a test can hand in a Map. */
export interface GapReportStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * True the first time a goal's gap is claimed for a day in this browser, false
 * after. One report per goal per browser per day: a page mount used to be the
 * only memory, and a family reloading Today filed the same goal again each time.
 *
 * `memo` is the in-page fallback for a browser whose storage is missing or
 * throws (private windows, blocked site data). It is always consulted too.
 */
export function claimGapReport(
  store: GapReportStore | null,
  memo: Set<string>,
  goalId: string,
  day: string,
): boolean {
  const key = gapReportStorageKey(goalId, day);
  if (memo.has(key)) return false;
  memo.add(key);
  if (!store) return true;
  try {
    if (store.getItem(key) === "1") return false;
    store.setItem(key, "1");
  } catch {
    // Storage refused. The memo above still holds the line for this page.
  }
  return true;
}

/** One goal's projection, and how much of it came back with no lesson row. */
export interface ProjectionGap {
  goalId: string;
  /** Slots the projector emitted for this goal on this load. */
  projected: number;
  /** How many of those had no matching lesson row. Always >= 1. */
  missing: number;
}

/** Which of the two states a filed report is about. Sentry tag `gap`. */
export type ProjectionGapKind = "partial" | "unhealed";

export interface ProjectionGapReport extends ProjectionGap {
  kind: ProjectionGapKind;
  /** The Error message the report is titled with. */
  message: string;
}

/**
 * The one message shape, so a partial gap and an unhealed one stay comparable
 * in Sentry and only the `gap` tag tells them apart. Unchanged from the single
 * report this split replaced.
 */
export function projectionGapMessage(gap: ProjectionGap): string {
  return `Goal ${gap.goalId} projected ${gap.projected} lessons but ${gap.missing} had no row`;
}

/**
 * Sort the goals with missing rows into the two states.
 *
 * `partial` is reported at detection. `full` is handed to the heal and is
 * reported only if the heal leaves it as it found it.
 *
 * A goal that projected nothing is in neither list: there is no gap to speak
 * of, and healEmptyGoal is never offered a goal Today did not project.
 */
export function splitProjectionGaps(
  projectedByGoal: ReadonlyMap<string, number>,
  missingByGoal: ReadonlyMap<string, number>,
): { partial: ProjectionGap[]; full: ProjectionGap[] } {
  const partial: ProjectionGap[] = [];
  const full: ProjectionGap[] = [];
  for (const [goalId, missing] of missingByGoal) {
    const projected = projectedByGoal.get(goalId) ?? 0;
    if (projected <= 0 || missing <= 0) continue;
    // Defensive: more missing than projected cannot happen (missing is counted
    // while walking the projection) but if it ever did, treat it as the full
    // state rather than filing a report with a nonsense ratio.
    if (missing >= projected) full.push({ goalId, projected, missing });
    else partial.push({ goalId, projected, missing });
  }
  return { partial, full };
}

/** One report of either kind, for a caller that has already decided to file it. */
export function projectionGapReport(gap: ProjectionGap, kind: ProjectionGapKind): ProjectionGapReport {
  return { ...gap, kind, message: projectionGapMessage(gap) };
}

/** The detection-time reports: partial gaps, and nothing else. */
export function projectionGapReports(gaps: readonly ProjectionGap[]): ProjectionGapReport[] {
  return gaps.map((g) => ({ ...g, kind: "partial" as const, message: projectionGapMessage(g) }));
}

/**
 * The full gaps the heal did not resolve.
 *
 * `written` holds one entry per candidate the heal actually answered for, so a
 * goal missing from it is one whose heal threw — and healEmptyGoal reports its
 * own failures, so reporting it here too would double-count.
 *
 * `skipped` names candidates that were never offered to the heal for a reason
 * that resolves itself: today, a goal saved less than two minutes ago, whose
 * phase 2 may still be in flight in another tab. Warning about a save that is
 * still happening is the same false alarm this file exists to stop.
 */
export function unhealedGapReports(
  candidates: readonly ProjectionGap[],
  written: ReadonlyMap<string, number>,
  skipped: ReadonlySet<string> = new Set(),
): ProjectionGapReport[] {
  const out: ProjectionGapReport[] = [];
  for (const gap of candidates) {
    if (skipped.has(gap.goalId)) continue;
    const rows = written.get(gap.goalId);
    if (rows === undefined || rows > 0) continue;
    out.push({ ...gap, kind: "unhealed" as const, message: projectionGapMessage(gap) });
  }
  return out;
}
