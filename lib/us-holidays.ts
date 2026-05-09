/**
 * US federal + commonly observed holidays — pure computation, no network.
 * Ported from the legacy plan page's inline helper so PlanV2 and any
 * future consumer share the same rules.
 *
 * Holiday display is informational only — these are NOT vacation_blocks.
 * They don't block scheduling or shift lessons; they just surface a small
 * subtitle label in the day cell.
 *
 * Date strings are always local-calendar "YYYY-MM-DD".
 */

export type UsHolidayMap = Map<string, string>;

function nthDayOfMonth(year: number, month: number, dayOfWeek: number, nth: number): number {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dt.getDay() === dayOfWeek) {
      count++;
      if (count === nth) return d;
    }
  }
  return 1;
}

function lastDayOfMonth(year: number, month: number, dayOfWeek: number): number {
  let last = 1;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dt.getDay() === dayOfWeek) last = d;
  }
  return last;
}

/** Anonymous Gregorian algorithm for Easter Sunday in `year`. */
function computeEaster(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function fmt(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Return a Map keyed by YYYY-MM-DD of US holidays for `year`, including
 * fixed-date and day-of-week-computed holidays + Easter. Values are the
 * display label (leading emoji + name).
 */
export function getUSHolidaysForYear(year: number): UsHolidayMap {
  const easter = computeEaster(year);
  const m = new Map<string, string>();

  // Fixed-date
  m.set(fmt(year, 0, 1), "🎉 New Year's Day");
  m.set(fmt(year, 1, 2), "🦫 Groundhog Day");
  m.set(fmt(year, 1, 14), "💕 Valentine's Day");
  m.set(fmt(year, 2, 17), "☘️ St. Patrick's Day");
  m.set(fmt(year, 3, 22), "🌎 Earth Day");
  m.set(fmt(year, 4, 5), "🎊 Cinco de Mayo");
  m.set(fmt(year, 5, 19), "✊ Juneteenth");
  m.set(fmt(year, 6, 4), "🇺🇸 4th of July");
  m.set(fmt(year, 9, 31), "🎃 Halloween");
  m.set(fmt(year, 10, 11), "🇺🇸 Veterans Day");
  m.set(fmt(year, 11, 25), "🎄 Christmas");
  m.set(fmt(year, 11, 31), "🎆 New Year's Eve");

  // Computed moving holidays
  m.set(fmt(year, 0, nthDayOfMonth(year, 0, 1, 3)), "✊ MLK Day");
  m.set(fmt(year, 1, nthDayOfMonth(year, 1, 1, 3)), "🇺🇸 Presidents' Day");
  m.set(fmt(year, easter.month, easter.day), "🐣 Easter");
  m.set(fmt(year, 4, nthDayOfMonth(year, 4, 0, 2)), "💐 Mother's Day");
  m.set(fmt(year, 4, lastDayOfMonth(year, 4, 1)), "🇺🇸 Memorial Day");
  m.set(fmt(year, 5, nthDayOfMonth(year, 5, 0, 3)), "👔 Father's Day");
  m.set(fmt(year, 8, nthDayOfMonth(year, 8, 1, 1)), "📚 Labor Day");
  m.set(fmt(year, 9, nthDayOfMonth(year, 9, 1, 2)), "🧭 Columbus Day");
  m.set(fmt(year, 10, nthDayOfMonth(year, 10, 4, 4)), "🦃 Thanksgiving");

  return m;
}

/**
 * Convenience: month-scoped emoji indicator for the toolbar month/year
 * label. Winter ❄️ · Spring 🌷 · Summer ☀️ · Autumn 🍂.
 */
export function getSeasonalEmoji(month0: number): string {
  if (month0 === 11 || month0 === 0 || month0 === 1) return "❄️";
  if (month0 >= 2 && month0 <= 4) return "🌷";
  if (month0 >= 5 && month0 <= 7) return "☀️";
  return "🍂";
}
