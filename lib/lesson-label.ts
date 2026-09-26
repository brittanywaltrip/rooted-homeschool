/* ============================================================================
 * lesson-label.ts: what a curriculum calls its lessons, for display only.
 *
 * Some books are written in weeks with several lessons each (Math with
 * Confidence: Week 12.1, 12.2, 12.3, 12.4), and a family asked to see those
 * words instead of "Lesson 47". A curriculum can now say what its lessons are
 * called (lesson, week, day, unit, chapter) and how many lessons make one of
 * those units. Lesson 47 of a 4-a-week book reads "Week 12.3".
 *
 * THE NUMBER NEVER CHANGES. lessons.lesson_number stays the whole number 1..N:
 * queue_position, current_lesson, the projector, pins, skips, make-ups, the
 * orphan cleanup and every other rule in docs/CURRICULUM-SCHEDULING.md keep
 * counting it exactly as before. This file only turns that number into words
 * at the moment it is shown. Nothing here is stored, and stored titles
 * ("{name} — Lesson {n}", which Reports and removed-curriculum detection parse)
 * are never rewritten.
 *
 * A curriculum with no setting (both columns null, every curriculum before
 * this change) reads exactly as it always did: "Lesson 47".
 *
 * Pure, no "@/" imports: node --test is strip-only.
 * ==========================================================================*/

/** The words a family can choose. A fixed list, so every sentence reads right. */
export const LESSON_UNIT_LABELS = ["lesson", "week", "day", "unit", "chapter"] as const;
export type LessonUnitLabel = (typeof LESSON_UNIT_LABELS)[number];

/** The most lessons one unit can hold (a week of daily lessons is 5 to 7). */
export const MAX_LESSONS_PER_UNIT = 20;

const NOUN: Record<LessonUnitLabel, { one: string; many: string }> = {
  lesson: { one: "Lesson", many: "Lessons" },
  week: { one: "Week", many: "Weeks" },
  day: { one: "Day", many: "Days" },
  unit: { one: "Unit", many: "Units" },
  chapter: { one: "Chapter", many: "Chapters" },
};

/** A curriculum's wording, normalised. Null means "Lesson N", the default. */
export type LessonUnit = { label: LessonUnitLabel; perUnit: number };

function isLabel(v: unknown): v is LessonUnitLabel {
  return typeof v === "string" && (LESSON_UNIT_LABELS as readonly string[]).includes(v);
}

/**
 * Read a curriculum row's two columns. Anything that is not a known word, or a
 * setting that would read exactly like the default ("Lesson", one per unit),
 * is null, so every caller has one question to ask: is there a unit or not.
 */
export function lessonUnitFromGoal(
  goal: { lesson_unit_label?: string | null; lessons_per_unit?: number | null } | null | undefined,
): LessonUnit | null {
  if (!goal || !isLabel(goal.lesson_unit_label)) return null;
  const raw = goal.lessons_per_unit;
  const perUnit = typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= MAX_LESSONS_PER_UNIT ? raw : 1;
  // "Lesson" with parts would read "Lesson 12.3" for lesson 47: not a thing
  // any book says. The word "Lesson" always means one lesson.
  if (goal.lesson_unit_label === "lesson") return null;
  return { label: goal.lesson_unit_label, perUnit };
}

/** Where lesson n sits: unit 12, part 3 for lesson 47 at 4 a unit. */
export function lessonPosition(n: number, perUnit: number): { unit: number; part: number } {
  const per = Math.max(1, Math.floor(perUnit));
  return { unit: Math.floor((n - 1) / per) + 1, part: ((n - 1) % per) + 1 };
}

/** The inverse: Week 12, part 1 at 4 a week is lesson 45. */
export function lessonNumberFor(unit: number, part: number, perUnit: number): number {
  const per = Math.max(1, Math.floor(perUnit));
  return (unit - 1) * per + part;
}

/** How many units hold `total` lessons: 120 lessons at 4 a week is 30 weeks. */
export function unitCount(total: number, perUnit: number): number {
  return Math.ceil(total / Math.max(1, Math.floor(perUnit)));
}

/**
 * The words for lesson n. "Lesson 47" with no unit; "Week 12.3" at 4 a week;
 * "Week 12" at 1 a week. `lower` gives "week 12.3" for the middle of a
 * sentence. A lesson number that is not a positive whole number is shown as
 * it is: this never hides a number it cannot place.
 */
export function formatLessonLabel(n: number, unit: LessonUnit | null, opts: { lower?: boolean } = {}): string {
  const word = unit ? NOUN[unit.label].one : NOUN.lesson.one;
  const shown = opts.lower ? word.toLowerCase() : word;
  if (!unit || !Number.isInteger(n) || n < 1) return `${shown} ${n}`;
  if (unit.perUnit === 1) return `${shown} ${n}`;
  const { unit: u, part } = lessonPosition(n, unit.perUnit);
  return `${shown} ${u}.${part}`;
}

/**
 * "Lesson 47 of 120", or "Week 12.3 of 30" (the total counted in units: a
 * family reads "of 30 weeks", not "of 120").
 */
export function formatLessonOfTotal(n: number, total: number, unit: LessonUnit | null): string {
  const of = unit ? unitCount(total, unit.perUnit) : total;
  return `${formatLessonLabel(n, unit)} of ${of}`;
}

/** "Lessons 11 to 18", "Week 3.3 to Week 5.2", or one label when a equals b. */
export function formatLessonRange(a: number, b: number, unit: LessonUnit | null, opts: { lower?: boolean } = {}): string {
  if (a === b) return formatLessonLabel(a, unit, opts);
  if (!unit) {
    const word = opts.lower ? "lessons" : "Lessons";
    return `${word} ${a} to ${b}`;
  }
  return `${formatLessonLabel(a, unit, opts)} to ${formatLessonLabel(b, unit, opts)}`;
}

/** The plural noun, for "30 weeks" and "Weeks per book". */
export function unitNounPlural(unit: LessonUnit | null, opts: { lower?: boolean } = {}): string {
  const w = unit ? NOUN[unit.label].many : NOUN.lesson.many;
  return opts.lower ? w.toLowerCase() : w;
}

/** The singular noun ("Week"), for labels and pickers. */
export function unitNoun(label: LessonUnitLabel, opts: { lower?: boolean } = {}): string {
  const w = NOUN[label].one;
  return opts.lower ? w.toLowerCase() : w;
}

/**
 * A stored lesson title, shown in the curriculum's own words.
 *
 * Curriculum lessons are stored as "{name} — Lesson {n}" (the Schedule Builder,
 * the heals, Add a past year) or "{label}: Lesson {n}" (the catch-up paths).
 * Reports, removed-curriculum detection and the reusable-title picker parse
 * that text, so it is never rewritten. This changes only what is DRAWN: the
 * trailing "Lesson {n}" becomes "Week 12.3", and only when all of these hold:
 *   - the curriculum has a unit (otherwise the title is returned untouched);
 *   - the title ends in exactly one of the two stored shapes;
 *   - the number in the title is this row's lesson_number. A title that says
 *     something else (a family's own title, or a number that no longer matches
 *     the row) is shown exactly as it was saved.
 */
export function displayLessonTitle(
  title: string | null | undefined,
  lessonNumber: number | null | undefined,
  unit: LessonUnit | null,
): string {
  const saved = title ?? "";
  if (!unit || lessonNumber == null || !saved) return saved;
  const m = /^(.*)( — |: )Lesson (\d+)$/.exec(saved);
  if (!m || Number(m[3]) !== lessonNumber) return saved;
  return `${m[1]}${m[2]}${formatLessonLabel(lessonNumber, unit)}`;
}

/**
 * Missed-work entries carry a projected queue slot, not a saved lesson's book
 * number. A manual reorder can make those different. Never call the slot a
 * "Week 12.3" (or another custom unit) unless the book number is known.
 */
export function formatProjectedWorkLabel(slot: number, unit: LessonUnit | null): string {
  return unit ? "Planned work" : formatLessonLabel(slot, null);
}

/**
 * What the Schedule Builder writes for a curriculum's wording. "Lesson" (or
 * nothing chosen) writes nulls, exactly what a curriculum that never set it
 * holds, so choosing the default never leaves a trace. Anything else writes
 * the word and a whole lessons-per-unit from 1 to MAX_LESSONS_PER_UNIT.
 */
export function lessonUnitColumns(
  label: string | null | undefined,
  perUnit: number | null | undefined,
): { lesson_unit_label: LessonUnitLabel | null; lessons_per_unit: number | null } {
  if (!isLabel(label) || label === "lesson") return { lesson_unit_label: null, lessons_per_unit: null };
  const per = typeof perUnit === "number" && Number.isInteger(perUnit) && perUnit >= 1 && perUnit <= MAX_LESSONS_PER_UNIT ? perUnit : 1;
  return { lesson_unit_label: label, lessons_per_unit: per };
}

/** Which of a family's curricula have wording, keyed by curriculum id. */
export function lessonUnitMap(
  rows: readonly { id: string; lesson_unit_label?: string | null; lessons_per_unit?: number | null }[],
): Map<string, LessonUnit> {
  const out = new Map<string, LessonUnit>();
  for (const r of rows) {
    const unit = lessonUnitFromGoal(r);
    if (unit) out.set(r.id, unit);
  }
  return out;
}
