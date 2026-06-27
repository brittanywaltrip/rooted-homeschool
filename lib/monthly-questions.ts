// ─── One Question a Month ────────────────────────────────────────────────────
// Once a month the family answers ONE gentle question. The question for a given
// month is deterministic (a fixed rotation by calendar month) so it's the same
// in the Today prompt, the editor, and the year-end spread — and so it's pure +
// unit-testable. NO AI anywhere: the year-end page shows the family's real words.

export const MONTHLY_QUESTIONS: string[] = [
  "What made you laugh this month?",
  "What challenged you?",
  "What surprised you?",
  "What are you thankful for?",
  "What was your favorite day?",
  "What's something you'll never forget?",
  "What did you learn that you didn't expect?",
  "What made you proud this month?",
  "What was the hardest part?",
  "Who did you spend the most time with?",
  "What are you looking forward to?",
  "What felt like home this month?",
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "YYYY-MM" → 1..12, or NaN if malformed. */
export function monthNumber(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return NaN;
  const n = Number(m[2]);
  return n >= 1 && n <= 12 ? n : NaN;
}

/** The "YYYY-MM" key for a given date. */
export function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** The deterministic question for a calendar month ("YYYY-MM"). */
export function questionForMonth(month: string): string {
  const n = monthNumber(month);
  if (Number.isNaN(n)) return MONTHLY_QUESTIONS[0];
  return MONTHLY_QUESTIONS[(n - 1) % MONTHLY_QUESTIONS.length];
}

/** "2025-09" → "September 2025". */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return month ?? "";
  const n = Number(m[2]);
  if (n < 1 || n > 12) return month;
  return `${MONTH_NAMES[n - 1]} ${m[1]}`;
}

/**
 * The 12 calendar months ("YYYY-MM") that a school-year yearbook spans, in
 * order. yearbookKey is "2025-26"; the homeschool year runs Aug → Jul, matching
 * the reader's school-year-start (month index >= 7) convention.
 */
export function yearbookMonths(yearbookKey: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(yearbookKey ?? "");
  if (!m) return [];
  const startYear = Number(m[1]);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex = 7 + i; // 7 = August (0-based)
    const year = startYear + Math.floor(monthIndex / 12);
    const mm = String((monthIndex % 12) + 1).padStart(2, "0");
    out.push(`${year}-${mm}`);
  }
  return out;
}
