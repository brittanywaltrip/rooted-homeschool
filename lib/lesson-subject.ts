/**
 * Resolves a lesson's subject name from the two possible sources.
 *
 * Lessons in the DB have two ways to know what subject they're for:
 *   1. lessons.subject_id → subjects(name, color)  — preferred
 *   2. lessons.curriculum_goal_id → curriculum_goals.subject_label  — fallback
 *
 * Some lessons (~6% of production rows) have subject_id = NULL while
 * their curriculum_goal.subject_label IS populated. Older lessons created
 * before subject_id existed, or by code paths that didn't set it. The
 * loaders historically read only the joined subjects(name) and these rows
 * displayed as empty / "Untitled".
 *
 * This helper formalizes the fallback. Pass both columns from the lesson
 * row; get back a non-empty string, or null if neither source has a value.
 *
 * Whitespace-only strings count as absent. The subjects table is the
 * curated source (also has color), so it wins ties — even if subject_label
 * is set, we still prefer the subjects.name when present.
 */
export function resolveLessonSubject(
  subjectsName: string | null | undefined,
  goalSubjectLabel: string | null | undefined,
): string | null {
  const fromSubjects = (subjectsName ?? "").trim();
  if (fromSubjects) return fromSubjects;
  const fromGoal = (goalSubjectLabel ?? "").trim();
  if (fromGoal) return fromGoal;
  return null;
}
