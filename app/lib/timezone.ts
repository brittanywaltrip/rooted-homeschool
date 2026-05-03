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

/** Returns the wall-clock date (YYYY-MM-DD) in the given timezone. */
export function todayInTz(timezone: string | null | undefined): string {
  const tz = timezone || DEFAULT_TZ;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA gives YYYY-MM-DD reliably.
  return fmt.format(new Date());
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
