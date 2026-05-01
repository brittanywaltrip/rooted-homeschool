// Relative-date label helper used by Today's InlineScheduleTabs (and any
// other surface that needs "Today / Yesterday / Tomorrow / Mon / Apr 30"
// style output).
//
// ─── Why this lives in its own module ──────────────────────────────────
// Previously inlined inside InlineScheduleTabs. The inline version had a
// timezone bug: it built `today` at local midnight but `target` at local
// noon of a date string, producing a +0.5 day difference for same-date
// inputs which Math.round rounded up to 1 → mislabelled as "Tomorrow"
// (audited 2026-05-01 against Brittany's account: lessons completed
// 12:21 AM local on May 1 displayed as "Tomorrow" while the page header
// said May 1).
//
// Fix: compare LOCAL year-month-day tuples extracted via getFullYear /
// getMonth / getDate on Date objects. Never compare via toISOString
// (UTC) and never let time-of-day enter the comparison. The function
// accepts an optional `now` so unit tests can pin a specific local
// "now" without monkey-patching the global Date.

/**
 * Given a YYYY-MM-DD string (treated as a local-calendar date), return
 * a relative label appropriate for display. Comparison is in the local
 * timezone of the runtime — labels match the user's wall clock.
 *
 *   today     → "Today"
 *   yesterday → "Yesterday"
 *   tomorrow  → "Tomorrow"
 *   2-6 days ahead → weekday short name ("Mon", "Tue", ...)
 *   anything else → "Mon Day" ("Apr 30", "May 12")
 *
 * Pass `now` only in tests. Production callers should rely on the
 * default `new Date()`.
 */
export function formatRelativeDate(dateStr: string, now: Date = new Date()): string {
  // Anchor the target at LOCAL noon to dodge DST edge cases — at noon
  // the calendar day is unambiguous regardless of whether the date
  // crossed a DST boundary at 2 AM.
  const target = new Date(dateStr + "T12:00:00");
  const targetY = target.getFullYear();
  const targetM = target.getMonth();
  const targetD = target.getDate();
  const todayY = now.getFullYear();
  const todayM = now.getMonth();
  const todayD = now.getDate();

  // Build date-only Date objects in local time (constructor with
  // Y, M, D produces local-midnight). Subtracting these gives an
  // exact integer number of calendar days — no time-of-day drift.
  const targetLocal = new Date(targetY, targetM, targetD);
  const todayLocal = new Date(todayY, todayM, todayD);
  const diff = Math.round((targetLocal.getTime() - todayLocal.getTime()) / 86400000);

  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  if (diff >= 2 && diff <= 6) return target.toLocaleDateString("en-US", { weekday: "short" });
  return target.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Convenience: take an ISO timestamp (e.g. lessons.completed_at) and
 * return its label using the LOCAL calendar day. The Past tab uses
 * this so a lesson completed at 2026-05-01T05:21Z (12:21 AM Central
 * on May 1) displays "Today" for a Central user, not "Tomorrow" or
 * "Apr 30".
 *
 * Important: we do NOT slice the ISO string — that would give the UTC
 * date, which in negative-UTC timezones can be one day ahead of the
 * local date. We construct a Date from the full ISO string and read
 * its LOCAL Y-M-D, then format from there.
 */
export function formatRelativeFromTimestamp(iso: string, now: Date = new Date()): string {
  const ts = new Date(iso);
  const y = ts.getFullYear();
  const m = String(ts.getMonth() + 1).padStart(2, "0");
  const d = String(ts.getDate()).padStart(2, "0");
  return formatRelativeDate(`${y}-${m}-${d}`, now);
}
