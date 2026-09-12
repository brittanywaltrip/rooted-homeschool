/**
 * The handoff between "Save & build schedule" and the "You're Rooted" screen.
 *
 * The screen has to be full-bleed: no sidebar, no bottom nav, the green ground
 * edge to edge, exactly like onboarding's. Onboarding manages that by living
 * OUTSIDE `app/dashboard`, so it never picks up the dashboard layout, and the
 * only way to reuse that is to be a route outside it too. Rendering the screen
 * inside the builder could not work: `app/dashboard/layout.tsx` wraps every
 * page under it, so the celebration appeared in a content column with the nav
 * still on screen.
 *
 * So the builder writes what the screen needs here and navigates. sessionStorage
 * rather than the URL because these are the family's children's names and there
 * is no reason to put them in a link they might share or paste. It is read once
 * and cleared: a refresh of the screen has nothing to show and sends them on to
 * Today, which is the right place to be by then anyway.
 */
const KEY = "rooted:setup-celebration";

/**
 * The payload, cached the first time it is read.
 *
 * `takeSetupCelebration` clears sessionStorage, and the screen reads it while
 * rendering. React renders at transition priority and may discard and retry a
 * render, remount on Fast Refresh, or double-invoke in StrictMode, and any of
 * those consumed the payload and left the retry with nothing: the family got
 * bounced to Today with no celebration and no way back to it. Caching makes the
 * read idempotent for the life of the navigation; `writeSetupCelebration`
 * clears it so a second save is celebrated too.
 */
let cached: SetupCelebrationData | null | undefined;

export type SetupCelebrationData = {
  childNames: string[];
  subjects: string[];
  firstLessonDate: string | null;
  curriculaCount: number;
};

/**
 * Returns false when storage refused it, so the caller can send the family to
 * the ordinary Plan landing instead of to a screen that will find nothing.
 * Swallowing this silently meant a private window landed on Today and skipped
 * the `?saved=1` reload the Plan page needs after a save.
 */
export function writeSetupCelebration(data: SetupCelebrationData): boolean {
  cached = undefined;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Read and clear. Returns null when there is nothing to celebrate. */
export function takeSetupCelebration(): SetupCelebrationData | null {
  if (cached !== undefined) return cached;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) {
      cached = null;
      return null;
    }
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as Partial<SetupCelebrationData>;
    if (!Array.isArray(parsed.childNames) || !Array.isArray(parsed.subjects)) {
      cached = null;
      return null;
    }
    cached = {
      childNames: parsed.childNames.filter((x): x is string => typeof x === "string"),
      subjects: parsed.subjects.filter((x): x is string => typeof x === "string"),
      firstLessonDate: typeof parsed.firstLessonDate === "string" ? parsed.firstLessonDate : null,
      curriculaCount: typeof parsed.curriculaCount === "number" ? parsed.curriculaCount : 0,
    };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
