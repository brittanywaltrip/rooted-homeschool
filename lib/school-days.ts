/**
 * School-day arithmetic helpers — shared by catch-up, push-back, and
 * vacation-block flows in PlanV2.
 *
 * Day-name convention matches profiles.school_days (string array like
 * ["Mon","Tue","Wed","Thu","Fri"]). Date strings are always local-calendar
 * "YYYY-MM-DD" — we never mix ISO timestamps into these helpers, so there
 * are no timezone footguns across DST boundaries.
 *
 * Vacation blocks are treated as non-school days. Every helper accepts a
 * blocks array and returns results consistent with "skip any date that
 * falls inside a block."
 */

export type VacationRange = { start_date: string; end_date: string };

/** Default when a profile has no school_days configured. */
export const DEFAULT_SCHOOL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const DAY_NAME: Record<number, string> = {
  0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
};

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateStr(dateStr: string): Date {
  // Noon local so daylight-saving transitions don't kick the date off-by-one
  // when we repeatedly call setDate().
  return new Date(`${dateStr}T12:00:00`);
}

/** True if the date is in the user's configured school_days. */
export function isSchoolDayDate(dateStr: string, schoolDays: string[]): boolean {
  const d = parseDateStr(dateStr);
  return schoolDays.includes(DAY_NAME[d.getDay()]);
}

/** True if `dateStr` falls inside any vacation block range (inclusive). */
export function isInVacation(dateStr: string, blocks: VacationRange[]): boolean {
  for (const b of blocks) {
    if (dateStr >= b.start_date && dateStr <= b.end_date) return true;
  }
  return false;
}

/** True if the date is a school day AND not blocked by a vacation. */
export function isTeachingDay(
  dateStr: string,
  schoolDays: string[],
  blocks: VacationRange[],
): boolean {
  return isSchoolDayDate(dateStr, schoolDays) && !isInVacation(dateStr, blocks);
}

/**
 * Return the Nth teaching day after `afterDateStr` (1-indexed — N=1 returns
 * the next teaching day). Skips weekends, non-school days, and vacation
 * blocks. Bounded by 365 iterations so a pathological config never loops
 * forever (returns the cursor at the limit).
 */
export function nthSchoolDay(
  afterDateStr: string,
  schoolDays: string[],
  n: number,
  blocks: VacationRange[] = [],
): string {
  if (n <= 0) return afterDateStr;
  const cursor = parseDateStr(afterDateStr);
  let found = 0;
  for (let i = 0; i < 365; i++) {
    cursor.setDate(cursor.getDate() + 1);
    const s = toDateStr(cursor);
    if (isSchoolDayDate(s, schoolDays) && !isInVacation(s, blocks)) {
      found++;
      if (found === n) return s;
    }
  }
  return toDateStr(cursor);
}

/** Convenience: the next teaching day strictly after `afterDateStr`. */
export function nextSchoolDay(
  afterDateStr: string,
  schoolDays: string[],
  blocks: VacationRange[] = [],
): string {
  return nthSchoolDay(afterDateStr, schoolDays, 1, blocks);
}

/**
 * Count teaching days in an inclusive date range. Both endpoints are
 * included if they're teaching days. Used by the vacation-shift flow to
 * compute the forward shift amount.
 */
export function countSchoolDaysInRange(
  startDateStr: string,
  endDateStr: string,
  schoolDays: string[],
  blocks: VacationRange[] = [],
): number {
  if (startDateStr > endDateStr) return 0;
  const cursor = parseDateStr(startDateStr);
  const end = parseDateStr(endDateStr);
  let n = 0;
  while (cursor <= end) {
    const s = toDateStr(cursor);
    if (isSchoolDayDate(s, schoolDays) && !isInVacation(s, blocks)) n++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return n;
}

/**
 * Today in local-calendar YYYY-MM-DD. Provided so components don't have
 * to duplicate the formatter.
 */
export function todayDateStr(): string {
  return toDateStr(new Date());
}
