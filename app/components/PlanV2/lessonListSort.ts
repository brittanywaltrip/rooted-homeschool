/**
 * Ordering + month grouping for the expanded lesson list inside
 * CurriculumGroupsPanel.
 *
 * These three functions are one unit and have to stay that way, because the
 * bug they exist to prevent only shows up when you look at them together.
 *
 * `groupLessonsByMonth` is a RUN-LENGTH scan: it opens a new month header
 * every time a row's month differs from the PREVIOUS row's. That is cheap and
 * preserves whatever order it is handed, but it is only correct if the input
 * is already sorted so each month forms one contiguous run. The list used to
 * be sorted by lesson_number, so any goal whose dates were not monotonic in
 * lesson order rendered repeating, jumping headers:
 *
 *     August 2026 | October 2026 | August 2026 | September 2026 | August 2026
 *
 * Reported by a family in August 2026. Sorting by date fixes it without
 * touching the grouper.
 *
 * If you ever change the sort back to lesson_number, you MUST replace the
 * grouper with a keyed bucket at the same time, or the repeating headers come
 * straight back. The test file next to this one pins both halves.
 *
 * Out-of-order dates are shown truthfully. If lesson 34 is dated before lesson
 * 33, the list renders 34 first rather than hiding the discrepancy; repairing
 * the underlying dates is a separate, data-side job.
 */

// Type-only import, erased at runtime. Explicit .ts extension so this module
// resolves under both the Next.js bundler and the raw `node --test` runner,
// same convention as handleVacationSave.shift.ts.
import type { PlanV2Lesson } from "./types.ts";

/** The fields the ordering actually reads. Keeps the helpers usable from a
 *  test without constructing a whole PlanV2Lesson. */
export type SortableLesson = Pick<
  PlanV2Lesson,
  "lesson_number" | "scheduled_date" | "date"
>;

/**
 * lesson_number ASC with nulls last. One-off rows logged via the unified "+"
 * carry no number and sort to the end so they don't break a numeric run.
 */
export function cmpLessonNumber(a: SortableLesson, b: SortableLesson): number {
  const an = a.lesson_number;
  const bn = b.lesson_number;
  if (an == null && bn == null) return 0;
  if (an == null) return 1;
  if (bn == null) return -1;
  return an - bn;
}

/**
 * The list's ordering: calendar date ASC, lesson_number as the tiebreaker,
 * undated rows last. `scheduled_date` wins over the legacy `date` column.
 */
export function cmpLessonForList(a: SortableLesson, b: SortableLesson): number {
  const ad = a.scheduled_date ?? a.date;
  const bd = b.scheduled_date ?? b.date;
  if (ad == null && bd == null) return cmpLessonNumber(a, b);
  if (ad == null) return 1;
  if (bd == null) return -1;
  if (ad !== bd) return ad < bd ? -1 : 1;
  return cmpLessonNumber(a, b);
}

/**
 * Sort a goal's lessons for display. Returns a NEW array: the caller's input
 * is the array held inside the panel's `lessonsByGoal` memo, and sorting it in
 * place reordered the memo's own buckets as a side effect of rendering.
 */
export function sortLessonsForList<T extends SortableLesson>(lessons: T[]): T[] {
  return [...lessons].sort(cmpLessonForList);
}

/** Month header label for a row's date, or "Unscheduled" when it has none. */
export function monthKey(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unscheduled";
  const [y, m] = dateStr.split("-").map(Number);
  if (!y || !m) return "Unscheduled";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Group already-sorted lessons into contiguous month runs. Pair it with
 * `sortLessonsForList`; see the module comment for why the pairing matters.
 */
export function groupLessonsByMonth<T extends SortableLesson>(
  lessons: T[],
): { key: string; rows: T[] }[] {
  const groups: { key: string; rows: T[] }[] = [];
  let current: { key: string; rows: T[] } | null = null;
  for (const l of lessons) {
    const key = monthKey(l.scheduled_date ?? l.date);
    if (!current || current.key !== key) {
      current = { key, rows: [] };
      groups.push(current);
    }
    current.rows.push(l);
  }
  return groups;
}
