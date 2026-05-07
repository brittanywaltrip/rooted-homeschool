/**
 * Toast / banner message helpers for the "Push my schedule back N school
 * days" reschedule actions on Today and Plan. Pure formatters — no DB
 * I/O, no scheduling decisions. The scheduler still owns the actual
 * date math; this file just turns the (before, after) lesson set into
 * a human-readable diff.
 */

/**
 * Format a YYYY-MM-DD string as "Thu May 7" — short weekday, short
 * month, no zero-pad on day, no comma, no year. Empty input returns
 * an empty string so callers can fall through cleanly when a snapshot
 * row is missing a date.
 */
export function formatPushBackDate(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const d = new Date(ymd + "T12:00:00");
  if (Number.isNaN(d.getTime())) return ymd;
  return d
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .replace(",", "");
}

/**
 * Build the toast message for a push-back-N reschedule. Pairs each
 * update (id → newDate) with its origin date from oldByLessonId, groups
 * by source date, and produces a human-readable summary.
 *
 *   - If only one source date moved, single-date format:
 *     `You had 2 lessons on Thu May 7. They've been moved to Fri May 8.`
 *   - If multiple source dates moved, list up to 3 (oldest first), then
 *     a `+ X more days` tail when more remain:
 *     `Lessons moved back 1 day. 2 on Thu May 7 → Fri May 8,
 *      1 on Fri May 8 → Mon May 12, + 2 more days.`
 *   - If nothing actually moved (the rare empty-update case), falls
 *     back to the legacy generic line so the toast still says
 *     something useful.
 *
 * Lessons whose old date matches the new date (no-op) are filtered
 * out. Lessons missing an old date (e.g., catch-up placements that
 * had no scheduled_date before the push) are also filtered — they're
 * placements, not shifts, and the user doesn't think of them as
 * "moved from a date".
 */
export function buildPushBackMessage(
  oldByLessonId: Map<string, string>,
  updates: { id: string; newDate: string }[],
  daysPushed: number,
): string {
  type Group = { count: number; newDate: string };
  const groups = new Map<string, Group>();
  for (const { id, newDate } of updates) {
    const oldDate = oldByLessonId.get(id);
    if (!oldDate) continue;
    if (oldDate === newDate) continue;
    const existing = groups.get(oldDate);
    if (existing) {
      existing.count++;
    } else {
      groups.set(oldDate, { count: 1, newDate });
    }
  }
  const entries = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dayWord = (n: number) => (n === 1 ? "day" : "days");

  if (entries.length === 0) {
    return `Schedule pushed back ${daysPushed} ${dayWord(daysPushed)}`;
  }

  if (entries.length === 1) {
    const [oldDate, { count, newDate }] = entries[0];
    const lessonWord = count === 1 ? "lesson" : "lessons";
    const subject = count === 1 ? "It's" : "They've";
    return `You had ${count} ${lessonWord} on ${formatPushBackDate(oldDate)}. ${subject} been moved to ${formatPushBackDate(newDate)}.`;
  }

  const shown = entries.slice(0, 3);
  const more = entries.length - shown.length;
  const parts = shown.map(
    ([oldDate, { count, newDate }]) =>
      `${count} on ${formatPushBackDate(oldDate)} → ${formatPushBackDate(newDate)}`,
  );
  let msg = `Lessons moved back ${daysPushed} ${dayWord(daysPushed)}. ${parts.join(", ")}`;
  if (more > 0) msg += `, + ${more} more ${dayWord(more)}`;
  msg += ".";
  return msg;
}
