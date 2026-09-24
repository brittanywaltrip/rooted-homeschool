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

/**
 * The subject a one-off lesson carries in its own title. Plan's Add a lesson
 * and "Plan this week" write a one-off as "Subject · Title" (there is no
 * subjects row or curriculum to read it from), so without this Today filed
 * every one of them under "Untitled". The same split the reusable one-off
 * choices use (app/components/PlanV2/oneOffLessonChoices.ts): the text before
 * the first " · ", at most 40 characters. Null for a curriculum lesson, whose
 * subject comes from resolveLessonSubject, and for a title with no subject.
 */
export function oneOffTitleSubject(
  title: string | null | undefined,
  curriculumGoalId: string | null | undefined,
): string | null {
  if (curriculumGoalId) return null;
  const saved = (title ?? "").trim();
  const split = saved.indexOf(" · ");
  if (split <= 0 || split > 40) return null;
  return saved.slice(0, split).trim() || null;
}
