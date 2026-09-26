import { formatLessonLabel, type LessonUnit } from "../../../lib/lesson-label.ts";

/**
 * The words a lesson row leads with on Plan, shared by the week rows and the
 * missed-lessons banner so the two cannot drift.
 *
 * Subject leads: "Math · Lesson 8". The stored title is the curriculum's
 * "The Good and the Beautiful — Lesson 8" (a data convention that
 * lessonReportSubject parses, so it stays in the database as it is), and a
 * family with three books from one publisher read the same words down the
 * whole day. The curriculum name goes on the muted line beneath.
 *
 * A one-off lesson logged through the "+" has no number and no goal, so its
 * own title is the answer.
 */
export function lessonRowTitle(args: {
  lessonNumber: number | null | undefined;
  title: string | null | undefined;
  subject: string | null | undefined;
  curriculumName: string | null | undefined;
  /**
   * The curriculum a lesson came from, ONLY when its removal is established
   * (removedCurriculumName in lib/progress-report-rows.ts). Never pass a name
   * merely read off a title.
   */
  removedCurriculum?: string | null;
  completed?: boolean;
  /**
   * What the curriculum calls its lessons (lib/lesson-label.ts), or null for
   * "Lesson N". Display only: the number is always lessons.lesson_number.
   */
  unit?: LessonUnit | null;
}): string {
  const subject = args.subject?.trim() || null;
  const curriculum = args.curriculumName?.trim() || null;
  const removed = args.removedCurriculum?.trim() || null;
  const own = args.title?.trim() || null;
  const nothing = args.completed ? "Completed lesson" : "Lesson";
  if (args.lessonNumber != null) {
    const lead = subject ?? curriculum ?? (removed ? `${removed} (removed curriculum)` : null);
    if (lead) return `${lead} · ${formatLessonLabel(args.lessonNumber, args.unit ?? null)}`;
    // A numbered lesson with no subject and no curriculum: one kept after its
    // curriculum was deleted, or a standalone lesson given a number. Nothing
    // establishes which, so it shows its own saved title rather than the
    // literal "Lesson · Lesson 12" it used to.
    return own ?? `${nothing} ${args.lessonNumber}`;
  }
  return own ?? subject ?? curriculum ?? nothing;
}

/**
 * The muted line under a lessonRowTitle: what the title does not already say.
 * The curriculum under a numbered lesson ("Math · Lesson 44" over "The Good and
 * the Beautiful Math 3"), the subject under a one-off, and nothing when that
 * would only repeat the title (a one-off with no name of its own already fell
 * back to its subject; a lesson with no subject already leads with its
 * curriculum). Shared by the missed-lessons banner, Today's Upcoming
 * and Past cards, and the lesson card in Plan's day panel.
 */
export function lessonRowSubtitle(args: {
  lessonNumber: number | null | undefined;
  title: string | null | undefined;
  subject: string | null | undefined;
  curriculumName: string | null | undefined;
  unit?: LessonUnit | null;
}): string | null {
  const heading = lessonRowTitle(args);
  const raw = (args.lessonNumber != null ? args.curriculumName : args.subject)?.trim() || null;
  if (!raw || raw === heading || heading.startsWith(`${raw} · `)) return null;
  return raw;
}
