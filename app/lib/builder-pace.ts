/**
 * How the Schedule Builder says a curriculum's pace out loud, and the rules the
 * one "Lessons a day" control runs on.
 *
 * The builder used to ask the same question twice: a row of seven day chips,
 * then a second list of all seven days with a stepper each, even for a family
 * doing one lesson a day. Fourteen controls for a one-number answer. A family
 * nudged Wednesday to 2 in that list without meaning to and wrote in to ask why
 * two lessons kept turning up on Wednesdays.
 *
 * So the days are asked once (the chips), the count is one stepper that applies
 * to every day that is on, and a family who really does want a heavier
 * Wednesday opens "Different on some days?" and says so. This module is the
 * pure half of that: what the shared number is, whether the days disagree, and
 * the sentence under the control.
 *
 * Pure on purpose: no React, no "@/" imports, so node --test runs it directly.
 * The SAVED SHAPE IS UNTOUCHED. compactCurriculumPerDay still turns
 * active_days + per_day_counts into lessons_per_day, lessons_per_day_overrides
 * and school_days exactly as it did; the expander is a different view of the
 * same two arrays.
 */

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The two arrays a builder row carries, index 0..6 = Mon..Sun. */
export type PerDayShape = {
  activeDays: readonly boolean[];
  counts: readonly number[];
};

/** Days whose chip is ON, whatever their count (0 included: a chosen day, skipped). */
export function onDayIndices(p: PerDayShape): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) if (p.activeDays[i]) out.push(i);
  return out;
}

/** Days that actually produce lessons: chip on AND count above zero. */
export function lessonDayIndices(p: PerDayShape): number[] {
  return onDayIndices(p).filter((i) => (p.counts[i] ?? 0) > 0);
}

export function lessonsPerWeek(p: PerDayShape): number {
  return onDayIndices(p).reduce((sum, i) => sum + Math.max(0, p.counts[i] ?? 0), 0);
}

/**
 * The number the single stepper shows, or null when the on-days disagree and it
 * reads "varies" instead.
 */
export function sharedLessonCount(p: PerDayShape): number | null {
  const on = onDayIndices(p);
  if (on.length === 0) return null;
  const first = p.counts[on[0]] ?? 0;
  return on.every((i) => (p.counts[i] ?? 0) === first) ? first : null;
}

/** Do the on-days disagree? The expander opens on load when they do. */
export function hasVariedCounts(p: PerDayShape): boolean {
  return sharedLessonCount(p) === null && onDayIndices(p).length > 0;
}

/**
 * The count the varied days are measured against: the most common one, and the
 * lowest of those when it is a tie. It decides which chips get a numeral badge
 * and which days the sentence annotates, and it is what "Same on every day"
 * resets to.
 */
export function baselineCount(p: PerDayShape): number {
  const shared = sharedLessonCount(p);
  if (shared !== null) return shared;
  // Measured over the days that TEACH. A day at 0 is called out as skipped in
  // its own clause, so letting zeros vote here made "Mon (1) and Tue (1)" out
  // of a plain two-day week with two days off.
  const voters = lessonDayIndices(p);
  const tally = new Map<number, number>();
  for (const i of voters) {
    const c = Math.max(0, p.counts[i] ?? 0);
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  let best = 1;
  let bestN = -1;
  for (const [count, n] of [...tally].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) {
      best = count;
      bestN = n;
    }
  }
  return best;
}

/** Does this day need a numeral badge on its chip? Only an on-day that differs. */
export function dayNeedsBadge(p: PerDayShape, dayIdx: number): boolean {
  if (!p.activeDays[dayIdx]) return false;
  if (!hasVariedCounts(p)) return false;
  return (p.counts[dayIdx] ?? 0) !== baselineCount(p);
}

/** Every on-day set back to one number. Off-days keep their parked value. */
export function withSameCountEveryDay(p: PerDayShape, count: number): number[] {
  const next = [...p.counts];
  for (const i of onDayIndices(p)) next[i] = count;
  return next;
}

/** One on-day changed, clamped to 0..3. 0 means "chosen, but skipped". */
export function withDayCount(p: PerDayShape, dayIdx: number, count: number): number[] {
  const next = [...p.counts];
  next[dayIdx] = Math.max(0, Math.min(3, Math.floor(count)));
  return next;
}

/** Oxford comma, because "Mon, Tue and Wed" reads as two items to some people. */
function joinDays(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

/**
 * The sentence under the control, built from the same two arrays the save
 * compacts, so the pace a family reads and the pace that gets written can never
 * disagree.
 *
 *   "5 lessons a week, Mon to Fri."
 *   "4 lessons a week: Mon, Tue, and Wed (2)."
 *   "3 lessons a week: Mon, Tue, and Thu. Wed is skipped."
 *
 * A day annotated "(n)" is one that differs from the baseline; a day at 0 is
 * named as skipped rather than silently dropped, because the family chose it.
 */
export function paceSentence(p: PerDayShape): string {
  const on = onDayIndices(p);
  if (on.length === 0) return "No school days picked yet.";

  const teaching = on.filter((i) => (p.counts[i] ?? 0) > 0);
  const skipped = on.filter((i) => (p.counts[i] ?? 0) === 0);
  const total = lessonsPerWeek(p);
  if (teaching.length === 0) {
    return `No lessons a week: ${joinDays(skipped.map((i) => DAY_SHORT[i]))} ${skipped.length === 1 ? "is" : "are"} skipped.`;
  }

  const base = baselineCount(p);
  const head = `${plural(total, "lesson")} a week`;
  const isMonFri = teaching.length === 5 && teaching.every((i, n) => i === n);
  const allSame = teaching.every((i) => (p.counts[i] ?? 0) === (p.counts[teaching[0]] ?? 0));

  let body: string;
  if (isMonFri && allSame && skipped.length === 0) {
    body = `${head}, Mon to Fri.`;
  } else {
    const labels = teaching.map((i) => {
      const c = p.counts[i] ?? 0;
      return c === base ? DAY_SHORT[i] : `${DAY_SHORT[i]} (${c})`;
    });
    body = `${head}: ${joinDays(labels)}.`;
  }

  if (skipped.length === 0) return body;
  const names = joinDays(skipped.map((i) => DAY_SHORT[i]));
  return `${body} ${names} ${skipped.length === 1 ? "is" : "are"} skipped.`;
}
