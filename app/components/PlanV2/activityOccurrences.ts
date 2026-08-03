/* ============================================================================
 * activityOccurrences — decides which calendar dates a recurring activity
 * lands on, and buckets a list of activities by date string for the grid.
 *
 * This MIRRORS the shipping Today read-path (app/dashboard/page.tsx
 * loadTodayActivities) so the Plan calendar and the Today page always agree on
 * which days an activity occurs:
 *   - days[] is stored Mon=0..Sun=6 (ActivitySetupModal convention), NOT JS
 *     getDay() order. Convert with (jsDow + 6) % 7 before comparing.
 *   - weekly   → every matching weekday
 *   - biweekly → matching weekday on every other week, anchored on the
 *     activity's own start_date: the week containing start_date is week 0
 *     (shown), the next week is week 1 (hidden). Rows with no start_date fall
 *     back to the legacy created_at cadence.
 *   - monthly  → only the FIRST occurrence of that weekday in the month.
 *   - start_date / end_date (inclusive) clamp the visible window.
 * ==========================================================================*/

import type { PlanV2Activity } from "./types";

const MS_PER_DAY = 86_400_000;

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** JS Date.getDay() (Sun=0..Sat=6) → activities convention (Mon=0..Sun=6). */
function toMon0(jsDow: number): number {
  return (jsDow + 6) % 7;
}

/** Whole-day count from a UTC-normalized date — DST-safe for week math. */
function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
}

/**
 * Parse a "YYYY-MM-DD" string as a LOCAL calendar date.
 *
 * Never `new Date("2026-10-07")` for a date-only string: that is parsed as UTC
 * midnight, which is Oct 6 in every US timezone, so every date-derived weekday
 * and week index lands one day early.
 */
export function parseLocalYmd(ymd: string | null | undefined): Date | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Day-number of the Monday that opens the local week containing `d`. Weeks run
 * Mon-Sun to match the app's Mon=0..Sun=6 convention, so an activity that runs
 * on e.g. Mon AND Wed keeps both days in the same parity bucket.
 *
 * The difference between two of these is always a whole number of weeks, which
 * is what makes the /7 below exact rather than a floor.
 */
function weekStartDayNumber(d: Date): number {
  return dayNumber(d) - toMon0(d.getDay());
}

/** Fields the biweekly cadence reads. Structural so the Today page can pass
 *  its own activity row shape without importing PlanV2Activity. */
export type BiweeklyCadenceFields = {
  start_date?: string | null;
  created_at?: string | null;
};

/**
 * Does a biweekly activity fall on `date`?
 *
 * Parity is anchored to the activity's own start_date: the week CONTAINING
 * start_date is week 0 (shown), the next week is week 1 (hidden), and so on.
 *
 * Anchoring to created_at (the pre-fix behavior) rendered the alternate weeks
 * for any activity whose start_date sits an odd number of weeks away from the
 * day it was created, which is the normal case when a family sets up a term
 * in advance. Reported live: an activity created in late Sep with start_date
 * 2026-10-07 rendered Oct 14 / Oct 28 instead of Oct 7 / Oct 21.
 *
 * start_date is NULL on older rows. Those keep the legacy created_at cadence
 * so nothing that renders correctly today changes.
 */
export function biweeklyOccursOn(activity: BiweeklyCadenceFields, date: Date): boolean {
  const start = parseLocalYmd(activity.start_date);
  if (start) {
    const weeks = (weekStartDayNumber(date) - weekStartDayNumber(start)) / 7;
    return (((weeks % 2) + 2) % 2) === 0;
  }

  // Legacy fallback: 7-day blocks counted from created_at, epoch when the row
  // has neither date. created_at is a full timestamp, so `new Date` parses it
  // correctly (the UTC-shift trap only applies to date-only strings).
  let anchorDay = 0;
  if (activity.created_at) {
    const anchor = new Date(activity.created_at);
    if (!Number.isNaN(anchor.getTime())) anchorDay = dayNumber(anchor);
  }
  const diffWeeks = Math.floor((dayNumber(date) - anchorDay) / 7);
  return (((diffWeeks % 2) + 2) % 2) === 0;
}

/** True when `activity` should render on `date` (with its YYYY-MM-DD string). */
export function activityOccursOn(
  activity: PlanV2Activity,
  date: Date,
  dateStr: string,
): boolean {
  // Window bounds (inclusive). String compare is valid for YYYY-MM-DD.
  if (activity.start_date && dateStr < activity.start_date) return false;
  if (activity.end_date && dateStr > activity.end_date) return false;

  const dow = toMon0(date.getDay());
  if (!activity.days || !activity.days.includes(dow)) return false;

  switch (activity.frequency) {
    case "weekly":
      return true;
    case "biweekly":
      return biweeklyOccursOn(activity, date);
    case "monthly":
      // First occurrence of this weekday in the month is always within the
      // first 7 days — matches the Today page's "first occurrence" rule.
      return date.getDate() <= 7;
    default:
      return false;
  }
}

/** Bucket activities by YYYY-MM-DD across the supplied visible cells. */
export function buildActivitiesByDate(
  activities: PlanV2Activity[],
  cells: Date[],
): Map<string, PlanV2Activity[]> {
  const map = new Map<string, PlanV2Activity[]>();
  for (const date of cells) {
    const dateStr = toDateStr(date);
    for (const activity of activities) {
      if (!activityOccursOn(activity, date, dateStr)) continue;
      const list = map.get(dateStr) ?? [];
      list.push(activity);
      map.set(dateStr, list);
    }
  }
  return map;
}
