// Helpers for rolling a school-year name forward when a year is closed.
//
// The old close route parsed the end year with `name.split("-")`, which
// silently failed on en dashes: a name like "2025–2026" (U+2013) does not
// split on "-", so parseInt("2025–2026") returned 2025 and the "new" year
// was named 2025-2026 again — the very year that was just closed. These
// helpers parse by digits instead of by separator, so hyphen, en dash,
// slash, and space all behave the same.

/**
 * Extract the ending year from a school-year name.
 *
 * Every 4-digit run in the name is considered; the LAST one is treated as
 * the end year. "2025-2026" and "2025–2026" both yield 2026. Names with no
 * 4-digit run (e.g. "My Homeschool Year") fall back to `currentYear` so the
 * new year still lands somewhere sensible instead of throwing.
 *
 * Note: only 4-digit runs count. "2025/26" has a single run ("2025"), so it
 * resolves to 2025 — the 2-digit suffix is intentionally not parsed.
 */
export function deriveEndYear(name: string | null | undefined, currentYear: number): number {
  const matches = (name ?? "").match(/\d{4}/g);
  if (!matches || matches.length === 0) return currentYear;
  return parseInt(matches[matches.length - 1], 10);
}

/**
 * The name for the new active year after a rollover: "<end>-<end+1>".
 * Always hyphen-joined so we never reintroduce an en dash that a future
 * parser could choke on.
 */
export function rolloverYearName(name: string | null | undefined, currentYear: number): string {
  const endYear = deriveEndYear(name, currentYear);
  return `${endYear}-${endYear + 1}`;
}
