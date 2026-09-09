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
 * The curriculum name still readable in an ORPHANED lesson's title.
 *
 * When a family deletes a curriculum, its completed lessons are kept as history
 * (item 5 of the 2026-09-08 queue-slot brief) and the FK sets their
 * curriculum_goal_id to NULL, so rules 2 and 3 below go empty and work the
 * child really did printed as "General" on a document handed to a school
 * district. The delete path copies the goal's subject onto the row's subject_id
 * first, which is rule 1 and the answer the family actually chose; this is the
 * fallback for the rows where no `subjects` row matched, and for the 357 rows
 * already orphaned before that code existed.
 *
 * Guarded exactly like subjectFromTitle, for the same reasons: only a row with
 * no curriculum, only the spaced em dash the builder writes, and 1 to 40
 * characters.
 */
function subjectFromLessonTitle(l: ReportLessonRow): string | null {
  if (l.curriculum_goal_id) return null;
  const title = l.title ?? "";
  const at = title.indexOf(TITLE_LESSON_SEPARATOR);
  if (at < 0) return null;
  const prefix = title.slice(0, at).trim();
  if (prefix.length < 1 || prefix.length > MAX_TITLE_SUBJECT_LENGTH) return null;
  return prefix;
}

/**
 * The subject a lesson prints under, in order:
 *
 *   1. an explicit subject_id
 *   2. the goal's subject_label
 *   3. the goal's curriculum_name, which the family chose
 *   4. the "Subject · " prefix a standalone log carries in its title
 *   5. the "Curriculum — Lesson n" prefix an orphaned goal row carries
 *   6. the fallback
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
): string {
  return (
    l.subjects?.name ||
    l.curriculum_goals?.subject_label ||
    l.curriculum_goals?.curriculum_name ||
    subjectFromTitle(l) ||
    subjectFromLessonTitle(l) ||
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
}): DailyLogRow {
  return {
    childName: args.childName,
    subject: lessonReportSubject(args.lesson),
    description: lessonReportDescription(args.lesson),
    minutes: args.minutes,
    type: "Lesson",
    estimated: args.estimated,
  };
}
