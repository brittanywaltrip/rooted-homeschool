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
