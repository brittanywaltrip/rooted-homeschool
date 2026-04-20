/* ============================================================================
 * day-of-week.ts — single source of truth for day-index conversions.
 *
 * Three conventions coexist in the codebase. Never do raw arithmetic on day
 * indices — always route through these helpers so the convention being used
 * at each site is explicit.
 *
 *   native        JS Date.getDay()                Sun=0, Mon=1, ..., Sat=6
 *   school        profiles.school_days bool[],    Mon=0, Tue=1, ..., Sun=6
 *                 scheduler.ts helpers
 *   appointment   appointments.recurrence_rule    Sun=0, Mon=1, ..., Sat=6
 *                 .days[] (from api/appointments/route.ts)
 *   activity      activities.days column          Mon=0, Tue=1, ..., Sun=6
 *
 * "appointment" is identical to "native"; the distinctly-named helpers exist
 * so call sites are self-documenting about which convention they're working
 * in. "school" and "activity" are identical to each other but are kept
 * separate because the underlying columns are distinct.
 *
 * Labels (Mon..Sun order) used by scheduler.ts live alongside these helpers.
 * ==========================================================================*/

/** Mon=0..Sun=6 → Sun=0..Sat=6. Shift Mon→1 by adding 1 mod 7. */
export function schoolDayIdxToNative(idx: number): number {
  return (idx + 1) % 7;
}

/** Sun=0..Sat=6 → Mon=0..Sun=6. Shift Sun→6 by adding 6 mod 7. */
export function nativeToSchoolDayIdx(idx: number): number {
  return (idx + 6) % 7;
}

/** Sun=0..Sat=6 → Sun=0..Sat=6. Identity — named for clarity at call sites. */
export function apptDayIdxToNative(idx: number): number {
  return idx;
}

/** Sun=0..Sat=6 → Sun=0..Sat=6. Identity — named for clarity at call sites. */
export function nativeToApptDayIdx(idx: number): number {
  return idx;
}

/** Mon=0..Sun=6 → Sun=0..Sat=6. Same math as schoolDayIdxToNative. */
export function activityDayIdxToNative(idx: number): number {
  return (idx + 1) % 7;
}

/** Sun=0..Sat=6 → Mon=0..Sun=6. Same math as nativeToSchoolDayIdx. */
export function nativeToActivityDayIdx(idx: number): number {
  return (idx + 6) % 7;
}

/** Mon..Sun labels aligned to school-day indices (Mon=0). */
export const SCHOOL_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Sun..Sat labels aligned to native indices (Sun=0). */
export const NATIVE_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
