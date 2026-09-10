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
