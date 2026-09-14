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
}): string {
  const subject = args.subject?.trim() || null;
  const curriculum = args.curriculumName?.trim() || null;
  if (args.lessonNumber != null) {
    return `${subject ?? curriculum ?? "Lesson"} · Lesson ${args.lessonNumber}`;
  }
  const own = args.title?.trim() || null;
  return own ?? subject ?? curriculum ?? "Lesson";
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
}): string | null {
  const heading = lessonRowTitle(args);
  const raw = (args.lessonNumber != null ? args.curriculumName : args.subject)?.trim() || null;
  if (!raw || raw === heading || heading.startsWith(`${raw} · `)) return null;
  return raw;
}
