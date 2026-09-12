/**
 * The order lessons appear in within ONE day on the Plan page.
 *
 * Every Plan surface that renders a day reads this: the week list, the day
 * detail panel and the month cell's pills. It is a different question from
 * `lessonListSort.ts`, which orders one goal's lessons across dates, and the
 * two must not be merged.
 *
 * WHY IT EXISTS. A two-child, two-subject day rendered as Language Arts Emma,
 * Language Arts Zoe, Math Zoe, Math Emma. That is what sorting by
 * `lesson_number` then `curriculum_goal_id` produces, and neither key means
 * anything to a family: it interleaves the children, so a mother working with
 * one child at a time reads every other row. Nobody teaches in that order.
 *
 * THE ORDER, in the words the family would use:
 *
 *   1. One child at a time, in the order their children are listed.
 *   2. Within a child, anything with a set time comes first, earliest first.
 *   3. Then everything else, subject A to Z, and a subject's own lessons in
 *      lesson order.
 *   4. A one-off lesson, logged with no curriculum behind it, comes after that
 *      child's curriculum work. A row belonging to no child comes last.
 *
 * The child order is `children` as handed in. That is the family's own order
 * and it already exists; adding a sort column to store it again would be a
 * second source of truth for something that has one.
 *
 * Ordering lives here and nowhere else. It used to be inline in WeekListView,
 * which is exactly how the month cell and the day panel came to disagree with
 * the week list about the same day.
 */

import { resolveLessonSubject } from "../../../lib/lesson-subject.ts";

/** The fields the ordering reads. Narrow so a test needs no whole lesson. */
export type OrderableLesson = {
  id: string;
  // Optional where the surfaces disagree: TodayLessonCardLesson types
  // child_id as non-null and leaves the goal link optional, PlanV2Lesson does
  // the reverse. Widening here rather than casting at the call sites keeps one
  // helper serving both without either lying about its own rows.
  child_id?: string | null;
  curriculum_goal_id?: string | null;
  lesson_number?: number | null;
  title?: string | null;
  subjects?: { name: string; color: string | null } | null;
  curriculum_goals?: { subject_label: string | null } | null;
};

export type OrderableChild = { id: string };

export type OrderableGoal = {
  id: string;
  subject_label: string | null;
  /** "HH:MM" or "HH:MM:SS" from curriculum_goals. Null means anytime. */
  scheduled_start_time: string | null;
};

/** Anytime sorts after every set time, the same rule Today's groupItems uses. */
function compareTime(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** "09:00:00" and "09:00" are the same moment; compare them as one. */
export function normalizeStartTime(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value.length === 0) return null;
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hh = parts[0].padStart(2, "0");
  const mm = parts[1].padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * "09:00" -> "9:00 AM", "13:00" -> "1:00 PM".
 *
 * Twelve-hour, because every other surface that renders these same
 * `scheduled_start_time` values does: Today passes timeFormat="12h" with a
 * comment that a lesson reading "9:00" above an activity reading "9 AM" is the
 * one inconsistency worth avoiding, and the print sheets agree. A 1 PM lesson
 * showing as "13:00" on Plan and "1 PM" on Today is the same mistake with the
 * clock face turned the other way.
 */
export function formatStartTime(raw: string | null | undefined): string | null {
  const norm = normalizeStartTime(raw);
  if (!norm) return null;
  const [hh, mm] = norm.split(":").map(Number);
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
}

/**
 * The start time a lesson inherits from its curriculum, or null.
 * Exported because the row renderers show it next to the subject.
 */
export function lessonStartTime(
  lesson: Pick<OrderableLesson, "curriculum_goal_id">,
  goalsById: ReadonlyMap<string, OrderableGoal>,
): string | null {
  if (!lesson.curriculum_goal_id) return null;
  return normalizeStartTime(goalsById.get(lesson.curriculum_goal_id)?.scheduled_start_time);
}

/** Build the lookup once per render rather than per comparison. */
export function goalsById(goals: readonly OrderableGoal[]): Map<string, OrderableGoal> {
  const m = new Map<string, OrderableGoal>();
  for (const g of goals) m.set(g.id, g);
  return m;
}

/**
 * The subject a row is filed under, falling back the same way every other
 * surface does. A row with no subject at all sorts last within its bucket
 * rather than under an empty heading.
 */
export function lessonSubject(
  lesson: OrderableLesson,
  goalsById: ReadonlyMap<string, OrderableGoal>,
): string | null {
  const fromGoal =
    lesson.curriculum_goals?.subject_label ??
    (lesson.curriculum_goal_id ? goalsById.get(lesson.curriculum_goal_id)?.subject_label : null);
  return resolveLessonSubject(lesson.subjects?.name, fromGoal);
}

/**
 * Order one day's lessons. Returns a NEW array: callers hold these arrays
 * inside memos, and sorting in place reorders the memo as a side effect of
 * rendering (the bug `sortLessonsForList` carries the same note about).
 */
export function orderDayLessons<T extends OrderableLesson>(
  lessons: readonly T[],
  children: readonly OrderableChild[],
  goals: readonly OrderableGoal[],
): T[] {
  const byId = goalsById(goals);
  const childRank = new Map<string, number>();
  children.forEach((c, i) => childRank.set(c.id, i));
  // A child the day knows about but the family list does not (a filtered view,
  // a stale row) sorts after every known child but before the no-child bucket.
  const UNKNOWN_CHILD = children.length;
  const NO_CHILD = children.length + 1;

  const key = (l: T) => ({
    child: l.child_id == null ? NO_CHILD : (childRank.get(l.child_id) ?? UNKNOWN_CHILD),
    // Every child the family list does not know shares one rank, so two of
    // them would sort by time and subject and interleave: A, B, A. Callers
    // turn these runs into one header per child, so a repeated child dropped
    // rows and produced duplicate React keys. The id keeps them contiguous.
    childId: l.child_id ?? "",
    // Curriculum work before one-offs, within the child.
    oneOff: l.curriculum_goal_id ? 0 : 1,
    time: lessonStartTime(l, byId),
    subject: lessonSubject(l, byId),
    number: l.lesson_number,
    title: (l.title ?? "").trim(),
  });

  return [...lessons]
    .map((l, i) => ({ l, i, k: key(l) }))
    .sort((a, b) => {
      if (a.k.child !== b.k.child) return a.k.child - b.k.child;
      if (a.k.childId !== b.k.childId) return a.k.childId < b.k.childId ? -1 : 1;
      if (a.k.oneOff !== b.k.oneOff) return a.k.oneOff - b.k.oneOff;
      const t = compareTime(a.k.time, b.k.time);
      if (t !== 0) return t;
      // Subjectless rows last within the bucket, not first under a blank.
      if (a.k.subject !== b.k.subject) {
        if (a.k.subject == null) return 1;
        if (b.k.subject == null) return -1;
        const s = a.k.subject.localeCompare(b.k.subject);
        if (s !== 0) return s;
      }
      if (a.k.number !== b.k.number) {
        if (a.k.number == null) return 1;
        if (b.k.number == null) return -1;
        return a.k.number - b.k.number;
      }
      const t2 = a.k.title.localeCompare(b.k.title);
      if (t2 !== 0) return t2;
      // Input order as the final tiebreak, so the same day never reshuffles
      // between renders on rows that are equal by every key above.
      return a.i - b.i;
    })
    .map((x) => x.l);
}

/**
 * The same rows, split into one run per child, in the order above.
 *
 * The week list and the day panel put the child's name over their run when a
 * family has more than one child, which is what makes "one child at a time"
 * visible rather than merely true. One child needs no header, so callers check
 * `children.length` rather than this returning a different shape.
 */
export function groupDayLessonsByChild<T extends OrderableLesson>(
  lessons: readonly T[],
  children: readonly OrderableChild[],
  goals: readonly OrderableGoal[],
): { childId: string | null; rows: T[] }[] {
  const ordered = orderDayLessons(lessons, children, goals);
  const out: { childId: string | null; rows: T[] }[] = [];
  let current: { childId: string | null; rows: T[] } | null = null;
  for (const l of ordered) {
    const cid = l.child_id ?? null;
    if (!current || current.childId !== cid) {
      current = { childId: cid, rows: [] };
      out.push(current);
    }
    current.rows.push(l);
  }
  return out;
}
