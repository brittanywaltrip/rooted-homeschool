// Did a Schedule Builder save lose lesson rows it had no reason to?
//
// The phase 2 row-count check used to compare the before and after counts and
// excuse a drop only when total_lessons went down. That fired "Curriculum save
// phase 2 lost lesson rows" for a family whose data was fine: she moved
// start_at_lesson from 3 to 5, so the two uncompleted rows in slots 3 and 4
// were correctly removed and 57 rows became 55.
//
// The honest comparison is against what the goal is EXPECTED to hold. A goal
// holds one row per lesson from start_at_lesson through total_lessons, plus
// any completed rows below start_at_lesson, which every save keeps. A save may
// shrink a goal by exactly the difference between the expectation before and
// the expectation after, and no more.
//
// Two deliberate non-triggers, both of which are healthy goals:
//   - A goal holding fewer rows than expected on both sides and losing nothing.
//     The projector only writes from current_lesson forward, so an ungenerated
//     tail is normal and the next save fills it in.
//   - A goal with an ungenerated tail whose start moved forward. The drop is
//     the expected drop, whatever the absolute counts are.
//
// Pure, no I/O: the page counts rows and passes the numbers in.

export type LessonRowCounts = {
  totalLessons: number;
  startAtLesson: number;
  /** Completed rows whose lesson_number is below startAtLesson. Kept by every save. */
  completedBelowStart: number;
  /** Rows the goal actually holds. */
  rows: number;
};

export type LostLessonRowsReport = {
  expectedBefore: number;
  expectedAfter: number;
  /** Rows the save was allowed to remove. */
  allowedDrop: number;
  /** Rows it actually removed. */
  actualDrop: number;
};

/** Rows the goal should hold: start_at_lesson..total_lessons plus kept history. */
export function expectedLessonRowCount(c: Pick<LessonRowCounts, "totalLessons" | "startAtLesson" | "completedBelowStart">): number {
  const start = Math.max(1, c.startAtLesson);
  const span = Math.max(0, c.totalLessons - start + 1);
  return span + Math.max(0, c.completedBelowStart);
}

/**
 * A report when the goal came out of the save holding fewer rows than it
 * should and the drop is larger than the save had any reason to make. Null
 * when the counts are explained.
 */
export function lostLessonRows(before: LessonRowCounts, after: LessonRowCounts): LostLessonRowsReport | null {
  const expectedBefore = expectedLessonRowCount(before);
  const expectedAfter = expectedLessonRowCount(after);
  const allowedDrop = Math.max(0, expectedBefore - expectedAfter);
  const actualDrop = before.rows - after.rows;
  if (after.rows >= expectedAfter) return null;
  if (actualDrop <= allowedDrop) return null;
  return { expectedBefore, expectedAfter, allowedDrop, actualDrop };
}

/** Completed rows sitting below start_at_lesson, from a row snapshot. */
export function countCompletedBelowStart(
  rows: readonly { lesson_number: number | null; completed: boolean | null }[],
  startAtLesson: number,
): number {
  let n = 0;
  for (const r of rows) {
    if (r.completed && r.lesson_number != null && r.lesson_number < startAtLesson) n += 1;
  }
  return n;
}
