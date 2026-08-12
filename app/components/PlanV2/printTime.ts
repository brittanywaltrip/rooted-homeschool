/* ============================================================================
 * printTime — one formatter for the clock times the print sheets render.
 *
 * Both `curriculum_goals.scheduled_start_time` and
 * `activities.scheduled_start_time` are Postgres `time without time zone`, so
 * they arrive as "HH:MM:SS" (occasionally "HH:MM"). Neither carries a date, so
 * there is nothing to convert: the string IS the wall-clock time the family
 * typed into the Schedule Builder.
 *
 * Never route these through `new Date(...)`. A bare time string parses as
 * Invalid Date, and pinning it to an arbitrary day would drag DST into a value
 * that has no timezone to begin with.
 * ==========================================================================*/

/**
 * "09:00:00" → "9:00 AM". Returns null for null/empty/malformed input so
 * callers can render nothing at all rather than a placeholder: a goal without
 * a time must print exactly as it did before times existed.
 */
export function formatPrintTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  const h12 = ((h + 11) % 12) + 1;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

/**
 * Sort key for "timed first, ascending; untimed after, in their existing
 * order". Minutes since midnight, or null when there is no usable time.
 */
export function timeSortKey(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Order a day's items so the timed ones lead in clock order and the untimed
 * ones follow in the order they arrived.
 *
 * Decorate-sort-undecorate on the original index rather than relying on
 * Array.prototype.sort's stability, so the "untimed keep their current order"
 * guarantee is explicit in the code instead of implicit in the engine.
 */
export function sortByTimeThenOriginal<T>(
  items: T[],
  getTime: (item: T) => string | null | undefined,
): T[] {
  return items
    .map((item, index) => ({ item, index, key: timeSortKey(getTime(item)) }))
    .sort((a, b) => {
      if (a.key != null && b.key != null) {
        return a.key !== b.key ? a.key - b.key : a.index - b.index;
      }
      if (a.key != null) return -1; // timed sorts ahead of untimed
      if (b.key != null) return 1;
      return a.index - b.index;     // both untimed: original order
    })
    .map((d) => d.item);
}
