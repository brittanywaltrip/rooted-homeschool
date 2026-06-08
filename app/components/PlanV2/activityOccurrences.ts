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
 *   - biweekly → matching weekday on every other week, anchored on created_at
 *     (falls back to start_date, then the epoch) so the cadence matches Today.
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

/** Anchor day-number for biweekly cadence: created_at, else start_date, else
 *  the epoch (matches the prompt's Math.floor(daysSinceEpoch / 7) % 2 fallback). */
function biweeklyAnchorDayNumber(activity: PlanV2Activity): number {
  const raw = activity.created_at ?? activity.start_date;
  if (!raw) return 0;
  const anchor = new Date(raw);
  if (Number.isNaN(anchor.getTime())) return 0;
  return dayNumber(anchor);
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
    case "biweekly": {
      const diffWeeks = Math.floor((dayNumber(date) - biweeklyAnchorDayNumber(activity)) / 7);
      // Normalize for dates before the anchor so parity stays correct.
      return (((diffWeeks % 2) + 2) % 2) === 0;
    }
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
