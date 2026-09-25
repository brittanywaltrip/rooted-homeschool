/* ============================================================================
 * lesson-minutes.ts: how long one completed lesson counts for, everywhere.
 *
 * Every total of lesson time goes through here: Reports, the Plan stats bar,
 * the Years card, the transcript, the progress report PDF, the year-end
 * summary, the year-close keepsake and a filed past year's archive. Before this
 * file they disagreed about a lesson with no minutes: Reports and the Years
 * card said 30, the transcript 45, the progress report the curriculum's
 * default, and the year-end summary, the close keepsake and the past-year
 * archive 0. The same four lessons read as 1.67, 2, 2.67 and 0.67 hours.
 *
 * The rule, in order:
 *
 *   1. minutes_spent is a number: that is what the family recorded, and it is
 *      used as it is. INCLUDING 0. A family who says a lesson took no time is
 *      never re-billed at the fallback. (`??` gets this right and `||` gets it
 *      wrong, which is why no reader is allowed to write its own fallback.)
 *   2. minutes_spent is missing but the older `hours` column holds a positive
 *      value: that value was saved, so it counts as recorded. `hours` of 0 is
 *      NOT a recorded zero: insert paths write `hours: 0` whenever minutes are
 *      blank, so 0 there only means "nothing was entered".
 *   3. Otherwise the lesson has no recorded time, and it counts as
 *      ESTIMATED_MINUTES_PER_LESSON, flagged as an estimate so a surface can
 *      say so.
 *
 * Pure and dependency-free so node --test (strip-only) can load it, and so the
 * server routes, the client pages and lib/progress-report.ts share one copy.
 * ==========================================================================*/

/**
 * What a completed lesson with no recorded time counts as.
 *
 * PROPOSED, NOT APPROVED FOR RELEASE (2026-09-22). 30 is what Reports, the
 * Years card and the Plan stats bar already use, so it moves none of those
 * numbers. It does move the transcript (was 45), the progress report (was the
 * curriculum's default minutes) and the year-end, close and past-year figures
 * (were 0). The measured effect is in the PR that introduced this file.
 */
export const ESTIMATED_MINUTES_PER_LESSON = 30;

/** Where a lesson's minutes came from. Only "estimated" was made up. */
export type LessonMinutesSource = "recorded" | "recorded_hours" | "estimated";

export interface LessonTimeFields {
  minutes_spent?: number | null;
  hours?: number | null;
}

export interface LessonMinutes {
  minutes: number;
  source: LessonMinutesSource;
  /** True only for source "estimated". */
  estimated: boolean;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** How long one completed lesson counts for. See the file header for the rule. */
export function lessonMinutes(l: LessonTimeFields): LessonMinutes {
  if (isNumber(l.minutes_spent)) {
    return { minutes: l.minutes_spent, source: "recorded", estimated: false };
  }
  if (isNumber(l.hours) && l.hours > 0) {
    return { minutes: Math.round(l.hours * 60), source: "recorded_hours", estimated: false };
  }
  return { minutes: ESTIMATED_MINUTES_PER_LESSON, source: "estimated", estimated: true };
}

export interface LessonMinutesTotal {
  /** Everything: recorded plus estimated. */
  minutes: number;
  /** The part the family (or a saved hours value) actually recorded. */
  recordedMinutes: number;
  /** The part that is ESTIMATED_MINUTES_PER_LESSON per lesson with no time. */
  estimatedMinutes: number;
  /** How many lessons fell back to the estimate. */
  estimatedCount: number;
}

/** Sum of lessonMinutes over rows the caller has already filtered to completed. */
export function sumLessonMinutes(rows: readonly LessonTimeFields[]): LessonMinutesTotal {
  let recordedMinutes = 0;
  let estimatedMinutes = 0;
  let estimatedCount = 0;
  for (const r of rows) {
    const m = lessonMinutes(r);
    if (m.estimated) {
      estimatedMinutes += m.minutes;
      estimatedCount++;
    } else {
      recordedMinutes += m.minutes;
    }
  }
  return {
    minutes: recordedMinutes + estimatedMinutes,
    recordedMinutes,
    estimatedMinutes,
    estimatedCount,
  };
}
