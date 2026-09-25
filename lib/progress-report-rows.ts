/* ============================================================================
 * How one completed lesson reads on a printed report.
 *
 * Its own module, with no imports, for two reasons. progress-report.ts pulls in
 * the Supabase client at module scope, so `node --test` (which strips types but
 * does not resolve the "@/" alias) cannot load it at all — the one part worth
 * testing was the part nothing could reach. And a family prints this as
 * DOCUMENTATION: what a row says about their year deserves to be decided in one
 * place and checked.
 * ==========================================================================*/

/** The lesson fields a printed row reads. */
export type ReportLessonRow = {
  title: string | null;
  /** Optional: the attendance page's rows carry no subjects join. */
  subjects?: { name: string | null } | null;
  /** NULL for a standalone log, which is what makes rule 4 safe. */
  curriculum_goal_id?: string | null;
  curriculum_goals?: {
    subject_label?: string | null;
    curriculum_name?: string | null;
  } | null;
  is_backfill?: boolean;
};

export interface DailyLogRow {
  childName: string;
  subject: string;
  description: string;
  minutes: number;
  type: string;
  estimated: boolean;
}

/**
 * The subject a lesson prints under.
 *
 * Curriculum lessons carry `subject_id` NULL — the subject lives on the goal,
 * as `curriculum_goals.subject_label`. Reading only `subjects.name` therefore
 * printed "General" for essentially every curriculum lesson a family ever did:
 * 138 of 139 on the account this was found on. The reports page already
 * resolved it this way; the PDF did not.
 *
 * `curriculum_name` is the last resort before "General", because a goal with no
 * subject label still has a name the family chose, and their own words beat
 * ours.
 */
/** The separator the add-lesson sheet writes: "Subject · Title". */
const TITLE_SUBJECT_SEPARATOR = " \u00b7 ";

/** Longer than this and the prefix is a sentence, not a subject. */
const MAX_TITLE_SUBJECT_LENGTH = 40;

/**
 * The separator every goal-generated lesson carries: the Schedule Builder
 * titles them `${curriculum_name} \u2014 Lesson ${n}`, so the curriculum's own
 * name is sitting in the title of every row it ever wrote.
 */
const TITLE_LESSON_SEPARATOR = " \u2014 Lesson ";

/**
 * The subject a standalone log carries in its own title.
 *
 * A log with no curriculum usually has no subject_id either, so both of the
 * rules above come back empty and it printed as "General" — even though the
 * family had already said what it was. The add-lesson sheet bakes the subject
 * into the title as "Subject · Title" ("Music · Cello Lesson"), so the subject
 * is right there in the row.
 *
 * Guarded three ways, because this is the one rule that INFERS rather than
 * reads:
 *   - only for a row with no curriculum. A curriculum lesson is titled
 *     "{curriculum_name} — Lesson {n}" and cannot contain the separator, but
 *     the guard is explicit rather than relying on that.
 *   - only the spaced middle dot, which is what the sheet writes. A plain
 *     hyphen or an unspaced dot would match half the titles in the database.
 *   - 1 to 40 characters. Across the 193 rows in this shape, exactly one
 *     prefix is longer ("Financial Literacy and Entrepreneur Practice", 44),
 *     and a prefix that long is a description, not a subject heading.
 */
function subjectFromTitle(l: ReportLessonRow): string | null {
  if (l.curriculum_goal_id) return null;
  const title = l.title ?? "";
  const at = title.indexOf(TITLE_SUBJECT_SEPARATOR);
  if (at < 0) return null;
  const prefix = title.slice(0, at).trim();
  if (prefix.length < 1 || prefix.length > MAX_TITLE_SUBJECT_LENGTH) return null;
  return prefix;
}

/**
 * ORPHANED LESSONS. When a family deletes a curriculum, its completed lessons
 * are kept as history (item 5 of the 2026-09-08 queue-slot brief) and the FK
 * sets their curriculum_goal_id to NULL. The delete path copies the goal's
 * subject onto the row's subject_id first when a matching `subjects` row
 * exists, which is rule 1 below and the answer the family actually chose
 * (33 of the 44 such rows on 2026-09-22). For the rest, the curriculum name in
 * the title is only called a removed curriculum when removal is established.
 *
 * What we KNOW about curricula a family has removed, from stored records only.
 *
 * `deleted`: names from the family's own `curriculum_goal.deleted` app_events
 * (recorded by the Plan delete since 2026-05-15). `current`: names of every
 * curriculum the family still has, archived included. Both are lowercased and
 * trimmed by curriculumKey.
 */
export interface RemovalContext {
  deleted: ReadonlySet<string>;
  current: ReadonlySet<string>;
}

export function curriculumKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

export function buildRemovalContext(
  deletedNames: readonly (string | null | undefined)[],
  currentNames: readonly (string | null | undefined)[],
): RemovalContext {
  const keys = (xs: readonly (string | null | undefined)[]) => new Set(xs.map(curriculumKey).filter((k) => k.length > 0));
  return { deleted: keys(deletedNames), current: keys(currentNames) };
}

/** How a lesson from an established-removed curriculum is labelled. */
export function removedCurriculumLabel(name: string): string {
  return `${name} (removed curriculum)`;
}

/**
 * The name of the curriculum an orphaned lesson came from, ONLY when its
 * removal is established. Otherwise null.
 *
 * A lesson with no curriculum is not evidence of a removal on its own: a
 * standalone lesson has none either, and the add-lesson sheet lets a family
 * type both a lesson number and a title of any shape. So all three must hold:
 *   - the row has no curriculum (`curriculum_goal_id` null);
 *   - its title is exactly the builder's "{name} — Lesson {n}", name 1 to 40
 *     characters;
 *   - the family's own records say a curriculum by that name was deleted, and
 *     no curriculum by that name exists now, live or archived (a same-named
 *     curriculum could be the one this row was detached from, not a removal).
 * With no context, removal cannot be established and the answer is null.
 */
export function removedCurriculumName(
  l: Pick<ReportLessonRow, "curriculum_goal_id" | "title">,
  ctx?: RemovalContext | null,
): string | null {
  if (!ctx || l.curriculum_goal_id) return null;
  const title = l.title ?? "";
  const at = title.indexOf(TITLE_LESSON_SEPARATOR);
  if (at < 0) return null;
  if (!/^\d+$/.test(title.slice(at + TITLE_LESSON_SEPARATOR.length))) return null;
  const name = title.slice(0, at).trim();
  if (name.length < 1 || name.length > MAX_TITLE_SUBJECT_LENGTH) return null;
  const key = curriculumKey(name);
  if (!ctx.deleted.has(key) || ctx.current.has(key)) return null;
  return name;
}

/**
 * The subject a lesson prints under, in order:
 *
 *   1. an explicit subject_id
 *   2. the goal's subject_label
 *   3. the goal's curriculum_name, which the family chose
 *   4. the "Subject · " prefix a standalone log carries in its title
 *   5. "{curriculum} (removed curriculum)", only when removedCurriculumName
 *      establishes the removal from the family's own records
 *   6. the fallback
 *
 * A curriculum name is never printed as if it were a subject. Rule 5 used to
 * read the "Curriculum — Lesson n" title prefix of any orphaned row and print
 * it in the subject column; that presented a curriculum as a subject and
 * claimed a removal nothing had established. The row's saved title still
 * prints in full as its description.
 *
 * Curriculum lessons carry `subject_id` NULL — the subject lives on the goal —
 * so reading only `subjects.name` printed "General" for essentially every
 * curriculum lesson a family ever did.
 *
 * `fallback` differs by report: the Progress Report says "General", the
 * Attendance Log's subject grouping says "Unassigned". A parameter rather than
 * a second copy of the rule, so the two cannot disagree about anything else.
 */
export function lessonReportSubject(
  l: ReportLessonRow,
  fallback = "General",
  removal?: RemovalContext | null,
): string {
  const removed = removedCurriculumName(l, removal);
  return (
    l.subjects?.name ||
    l.curriculum_goals?.subject_label ||
    l.curriculum_goals?.curriculum_name ||
    subjectFromTitle(l) ||
    (removed ? removedCurriculumLabel(removed) : null) ||
    fallback
  );
}

/**
 * What the row calls the lesson.
 *
 * Deliberately NOT marked "(imported)" for `is_backfill` rows. That flag stopped
 * meaning "brought in from before this family used Rooted" a long time ago:
 * completeLessonOnDate sets it on every completion dated to a day other than
 * today, because the reconciler reads it to leave the row on the day the family
 * chose. The catch-up paths and the Schedule Builder set it too. On the account
 * this was found on, 42 of 139 completed lessons carried it, every one a lesson
 * the family did and logged themselves — and every one would have printed as
 * "(imported)" on a document they hand to a school district.
 *
 * There is no clean line to recover from `scheduled_source` either; the flag has
 * been overloaded for weeks and the existing data cannot be split honestly. So
 * the marker is gone. A completed lesson is a lesson.
 */
export function lessonReportDescription(l: ReportLessonRow): string {
  return l.title || "Lesson";
}

/** One row of the printed daily log. */
export function lessonDailyLogRow(args: {
  lesson: ReportLessonRow;
  childName: string;
  minutes: number;
  estimated: boolean;
  removal?: RemovalContext | null;
}): DailyLogRow {
  return {
    childName: args.childName,
    subject: lessonReportSubject(args.lesson, "General", args.removal),
    description: lessonReportDescription(args.lesson),
    minutes: args.minutes,
    type: "Lesson",
    estimated: args.estimated,
  };
}

/**
 * The days the Hours & Attendance Log counts as present: every day with a
 * completed lesson, plus every day with a completed school appointment, each
 * once.
 *
 * A lesson's own DAY, not the UTC instant it was checked off at. completed_at
 * is a timestamp: a family in Central time who checks off Friday's lesson at
 * 8pm Friday has a completed_at of Saturday 02:00 UTC, so Saturday was counted
 * present and Friday was absent unless something else happened to be logged
 * that day. 38 of 139 completed lessons on the account this was found on have
 * a UTC date that differs from the lesson's date, and this number goes on an
 * attendance record. Invariant 16 made lessons.date the day the family saw and
 * agreed to, so it is the honest answer; `date ?? scheduled_date` is the same
 * rule the page uses to filter lessons into the range.
 *
 * A year filed through Add a past year is dated on exactly the days the family
 * said they schooled, so for that year this count is its days_attended.
 */
export function attendancePresentDates(
  completedLessons: readonly { date?: string | null; scheduled_date?: string | null }[],
  appointmentDates: readonly string[],
): Set<string> {
  const present = new Set<string>();
  for (const l of completedLessons) {
    const day = l.date ?? l.scheduled_date;
    if (day) present.add(day);
  }
  for (const d of appointmentDates) present.add(d);
  return present;
}

/**
 * The per-child subject table on the Progress Report PDF: one line per subject,
 * with its lesson count, minutes, and whether any minutes were estimated.
 *
 * Grouped by lessonReportSubject, the same rule the day-by-day log in the same
 * PDF prints with. The table read only `subjects.name`, and curriculum lessons
 * carry subject_id NULL (the subject lives on the goal), so nearly every
 * curriculum lesson a family did printed under "General" while the log beneath
 * it named Math and Reading. "General" is now only the answer for a one-off
 * with no subject anywhere.
 */
export function subjectTableTotals<L extends ReportLessonRow>(
  lessons: readonly L[],
  minutesFor: (l: L) => { m: number; e: boolean },
  removal?: RemovalContext | null,
): { name: string; count: number; minutes: number; estimated: boolean }[] {
  const agg = new Map<string, { count: number; minutes: number; estimated: boolean }>();
  for (const l of lessons) {
    const name = lessonReportSubject(l, "General", removal);
    const row = agg.get(name) ?? { count: 0, minutes: 0, estimated: false };
    const r = minutesFor(l);
    row.count++;
    row.minutes += r.m;
    if (r.e) row.estimated = true;
    agg.set(name, row);
  }
  return [...agg.entries()].map(([name, v]) => ({ name, ...v }));
}
