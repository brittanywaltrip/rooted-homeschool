// Who owns a transcript course's hours and credits.
//
// Until this existed, the transcript page recalculated every linked course
// from its lessons each time it opened and wrote the result over whatever was
// stored, including hours and credits a family had typed into the course form.
// Nothing recorded which of the two had written a value, so a typed number
// survived only until the next page open.
//
// transcript_courses.hours_source records it:
//   'calculated'  the page owns hours_logged and credits_earned and keeps them
//                 in step with the lessons.
//   'family'      a family typed them. Never recalculated.
//   null          not classified. Also never recalculated. Rows that existed
//                 before the column are left null unless a read-only
//                 classification proves the stored value is the page's own
//                 calculation, so an unproven value is protected, not labelled.
//
// Pure: no Supabase, no "@/" imports, so node --test can load it.

export type HoursSource = "calculated" | "family" | null;

/** A family can always tell the page to own the numbers again. */
export const USE_CALCULATED_LABEL = "Use hours from lessons";

export function calculateCreditsFromHours(hours: number): number {
  if (hours <= 0) return 0.5;
  const raw = Math.round((hours / 120) * 2) / 2;
  return Math.max(0.5, raw);
}

/** Rounded hours from a total of lesson minutes, the way the page stores them. */
export function hoursFromMinutes(totalMinutes: number): number {
  return Math.round(totalMinutes / 60);
}

type RefreshableCourse = {
  hours_source: HoursSource;
  hours_logged: number | null;
  credits_earned: number;
  grade_letter: string | null;
};

/**
 * What the page-open refresh may write for one linked course, or null for
 * "leave it alone".
 *
 * Only a 'calculated' row is ever written. 'family' and null are both left
 * exactly as stored, which is the whole safeguard.
 *
 * For a calculated row the rules are the ones the page always used: hours
 * follow the lessons, and credits follow the hours unless the course is graded
 * and its credits already differ from what its stored hours would give (the
 * old "credits set by hand" heuristic, kept so this change can only protect
 * more, never less).
 */
export function planLinkedCourseRefresh(
  course: RefreshableCourse,
  totalMinutes: number,
): { hours_logged: number | null; credits_earned?: number } | null {
  if (course.hours_source !== "calculated") return null;
  const newHours = hoursFromMinutes(totalMinutes);
  if (newHours === (course.hours_logged || 0)) return null;
  const creditsSetByHand =
    !!course.grade_letter && course.credits_earned !== calculateCreditsFromHours(course.hours_logged || 0);
  return creditsSetByHand
    ? { hours_logged: newHours || null }
    : { hours_logged: newHours || null, credits_earned: calculateCreditsFromHours(newHours) };
}

type FormNumbers = { hours_logged: number | null; credits_earned: number };

/**
 * The hours_source a course form save should write.
 *
 * - "Use hours from lessons" was chosen and not undone: 'calculated'.
 * - The family changed hours or credits from what the form opened with:
 *   'family'. That is the newly entered value the page must never overwrite.
 * - A brand-new course linked to a curriculum with nothing typed: 'calculated',
 *   so it picks up its lessons like an imported course does.
 * - Anything else (a rename, a grade, a new link on an existing course):
 *   the source it already had. Linking an existing course does NOT hand its
 *   stored hours to the refresh; the family chooses that explicitly.
 */
export function hoursSourceOnSave(args: {
  opened: FormNumbers;
  saved: FormNumbers & { curriculum_goal_id: string | null };
  previous: HoursSource;
  isNew: boolean;
  useCalculated: boolean;
}): HoursSource {
  const { opened, saved, previous, isNew, useCalculated } = args;
  if (useCalculated && saved.curriculum_goal_id) return "calculated";
  const typed =
    (opened.hours_logged ?? null) !== (saved.hours_logged ?? null) ||
    opened.credits_earned !== saved.credits_earned;
  if (typed) return "family";
  if (isNew) return saved.curriculum_goal_id ? "calculated" : null;
  return previous;
}

/** Hours and credits "Use hours from lessons" puts into the form. */
export function calculatedNumbers(totalMinutes: number): { hours_logged: number | null; credits_earned: number } {
  const hours = hoursFromMinutes(totalMinutes);
  return { hours_logged: hours || null, credits_earned: calculateCreditsFromHours(hours) };
}
