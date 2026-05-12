/**
 * Timezone helpers for the curriculum scheduler.
 *
 * Invariant 9 (docs/CURRICULUM-SCHEDULING.md) requires that every "today"
 * in the scheduler is computed in the user's local timezone. These helpers
 * are the only sanctioned way to do that.
 *
 * Do not use `new Date()` for "today" anywhere in scheduler code. Use
 * `todayInTz(timezone)` instead.
 */

const DEFAULT_TZ = 'America/New_York';

/** Returns the YYYY-MM-DD that the given Date instant maps to in the given
 * timezone. Pure: no `new Date()` inside, so tests can pass a fixed instant
 * (e.g., late-evening Pacific) and assert the expected wall-clock date. */
export function ymdInTz(date: Date, timezone: string | null | undefined): string {
  const tz = timezone || DEFAULT_TZ;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA gives YYYY-MM-DD reliably.
  return fmt.format(date);
}

/** Returns the wall-clock date (YYYY-MM-DD) in the given timezone, "now". */
export function todayInTz(timezone: string | null | undefined): string {
  return ymdInTz(new Date(), timezone);
}

/** Returns ISO day-of-week (1=Mon..7=Sun) for a YYYY-MM-DD string. */
export function isoDowFromYmd(ymd: string): number {
  // Force the date to be interpreted as UTC midnight so DOW is stable
  // regardless of where the server clock is.
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

/** Adds N days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/**
 * Returns the UTC instant corresponding to 00:00:00 wall-clock on `ymd`
 * in `tz`, as a Date. Use this when bounding "completed_at >= start of
 * day in user's TZ" type queries — it's the right replacement for
 * `new Date(ymdLocal + "T00:00:00").toISOString()` which silently uses
 * whatever the JS runtime's local TZ happens to be (often wrong).
 *
 * Algorithm: anchor at noon UTC on the same date (well clear of any DST
 * spring-forward / fall-back jump), read the wall-clock that anchor maps
 * to in `tz`, derive the offset, then apply that offset to ymd 00:00.
 */
export function startOfDayInTzAsUtc(ymd: string, timezone: string | null | undefined): Date {
  const tz = timezone || DEFAULT_TZ;
  const [y, m, d] = ymd.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(anchor);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? '0');
  const wallY = get('year');
  const wallM = get('month');
  const wallD = get('day');
  // Some Intl impls return 24 for midnight; normalize to 0.
  const wallH = get('hour') === 24 ? 0 : get('hour');
  const wallMin = get('minute');
  const wallS = get('second');
  const wallAsUtcMs = Date.UTC(wallY, wallM - 1, wallD, wallH, wallMin, wallS);
  const offsetMs = wallAsUtcMs - anchor.getTime();
  const ymdMidnightAsUtcIfLocal = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(ymdMidnightAsUtcIfLocal - offsetMs);
}
