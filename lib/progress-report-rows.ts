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
  subjects: { name: string | null } | null;
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
export function lessonReportSubject(l: ReportLessonRow): string {
  return (
    l.subjects?.name ||
    l.curriculum_goals?.subject_label ||
    l.curriculum_goals?.curriculum_name ||
    "General"
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
