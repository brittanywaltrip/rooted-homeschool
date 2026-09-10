// "Add a past year": the arithmetic behind filing a school year a family
// finished before they found Rooted.
//
// Everything here is pure. The day walk itself is schoolDaysBetween in
// app/lib/scheduler.ts (Invariant 8); this module takes that list of days and
// decides how the lessons sit on it, checks the year against the family's
// other years, shapes the rows the flow inserts, and writes the review
// sentence. app/dashboard/years/add/page.tsx is the only caller that writes.
//
// The rows this produces belong to a school year whose status is 'archived'
// and to goals whose archived flag is true, so the Today projector, the queue
// reconciler and the catch-up flows never see them. They are history, filed
// by the family, the same claim the Schedule Builder's start-date backfill
// makes and in the same shape (completed = true, is_backfill = true, noon UTC
// completed_at, the "{name} — Lesson {n}" title lessonReportSubject reads).

import { capitalizeName } from "../../lib/utils.ts";
import { batches as splitBatches, LESSON_INSERT_BATCH } from "./batches.ts";

export const PAST_YEAR_SOURCE = "past_year";
export const PAST_YEAR_LESSON_BATCH = LESSON_INSERT_BATCH;
export const DEFAULT_SCHOOL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * Spread `count` lessons across `days` (school days, ascending) so they stay
 * in lesson order with non-decreasing dates. Fewer lessons than days spreads
 * them out with gaps; more stacks them, at most ceil(count / days) per day,
 * every day used. Zero lessons is zero rows. No days for a positive count
 * is a mistake and throws rather than silently placing nothing.
 */
export function spreadLessonDates(count: number, days: readonly string[]): string[] {
  if (!Number.isInteger(count) || count < 0) throw new Error(`spreadLessonDates: bad count ${count}`);
  if (count === 0) return [];
  if (days.length === 0) throw new Error("spreadLessonDates: no school days in the range");
  const out: string[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = days[Math.floor((i * days.length) / count)];
  }
  return out;
}

export type ExistingYear = { id: string; name: string; start_date: string; end_date: string; status: string };

function fmtLong(ymd: string): string {
  return new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Why a proposed past year cannot be added, in words, or null when it can.
 *
 * Rules: dates must be real and in order; the year must end before the active
 * year starts (before today when there is no active year); and it may not
 * overlap any year the family already has, touching included.
 */
/** The longest span a single filed year may cover. Longer is a typo in the year. */
export const MAX_PAST_YEAR_DAYS = 400;

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 86400000);
}

export function pastYearProblem(
  start: string,
  end: string,
  existing: readonly ExistingYear[],
  today: string,
): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(start) || !iso.test(end)) return "Pick a start date and an end date.";
  if (end <= start) return "The end date needs to come after the start date.";
  if (daysBetween(start, end) > MAX_PAST_YEAR_DAYS) {
    return `That is more than ${MAX_PAST_YEAR_DAYS} days. Add each school year on its own.`;
  }
  const active = existing.find((y) => y.status === "active");
  if (!active && end >= today) return "A past year has to end before today.";

  // Every year the range touches, so a family who is told about one does not
  // fix it only to be told about the next. The active year counts as touched
  // from its start date onward, whatever its end date says.
  const touched = existing
    .filter((y) => {
      if (y.status === "active") return end >= y.start_date;
      return start <= y.end_date && end >= y.start_date;
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const describe = (y: ExistingYear) =>
    y.status === "active"
      ? `your ${y.name} year (starts ${fmtLong(y.start_date)})`
      : `your ${y.name} year (${fmtLong(y.start_date)} to ${fmtLong(y.end_date)})`;
  if (touched.length === 0) return null;
  if (touched.length === 1) {
    const y = touched[0];
    return y.status === "active"
      ? `That overlaps ${describe(y)}. Pick an end date before it.`
      : `That overlaps ${describe(y)}. Pick dates that don't touch it.`;
  }
  const names = touched.map(describe);
  return `That overlaps ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}. Pick dates that don't touch either.`;
}

/** "2025-2026" from the dates; the two years, or one when they match. */
export function defaultYearName(start: string, end: string): string {
  const a = start.slice(0, 4);
  const b = end.slice(0, 4);
  return a === b ? a : `${a}-${b}`;
}

export type PastYearRow = {
  childId: string;
  curriculumName: string;
  subjectLabel: string;
  totalLessons: number;
  completedLessons: number;
  minutesPerLesson: number | null;
};

/** A row counts when it has a name and at least one completed lesson. */
export function usableRows(rows: readonly PastYearRow[]): PastYearRow[] {
  return rows.filter((r) => r.curriculumName.trim().length > 0 && r.completedLessons > 0);
}

/** A row that cannot be filed as typed, in words, or null. */
export function rowProblem(r: PastYearRow): string | null {
  if (!r.curriculumName.trim() || r.completedLessons <= 0) return null; // ignored, not an error
  if (!Number.isInteger(r.totalLessons) || r.totalLessons <= 0) return `Give ${r.curriculumName.trim()} a total number of lessons.`;
  if (!Number.isInteger(r.completedLessons)) return `Lessons completed for ${r.curriculumName.trim()} needs to be a whole number.`;
  if (r.completedLessons > r.totalLessons) return `${r.curriculumName.trim()} can't have more lessons completed (${r.completedLessons}) than its total (${r.totalLessons}).`;
  if (r.minutesPerLesson != null && (!Number.isInteger(r.minutesPerLesson) || r.minutesPerLesson <= 0)) return `Minutes per lesson for ${r.curriculumName.trim()} needs to be a whole number above zero.`;
  return null;
}

export type PastYearGoalInsert = {
  user_id: string;
  school_year_id: string;
  school_year: string;
  child_id: string;
  curriculum_name: string;
  subject_label: string | null;
  total_lessons: number;
  current_lesson: number;
  start_at_lesson: 1;
  lessons_per_day: 1;
  lessons_per_day_overrides: null;
  school_days: string[];
  start_date: string;
  default_minutes: number;
  archived: true;
  completed_at: string | null;
};

/** The curriculum_goals row for one usable past-year row. Mirrors the builder's payload. */
export function buildPastYearGoal(args: {
  userId: string;
  schoolYearId: string;
  yearName: string;
  yearStart: string;
  yearEnd: string;
  schoolDays: string[];
  row: PastYearRow;
}): PastYearGoalInsert {
  const { row } = args;
  const finished = row.completedLessons >= row.totalLessons;
  return {
    user_id: args.userId,
    school_year_id: args.schoolYearId,
    // The legacy text column the transcript labels courses by.
    school_year: args.yearName,
    child_id: row.childId,
    curriculum_name: capitalizeName(row.curriculumName.trim()),
    subject_label: row.subjectLabel.trim() || null,
    total_lessons: row.totalLessons,
    current_lesson: row.completedLessons,
    start_at_lesson: 1,
    lessons_per_day: 1,
    lessons_per_day_overrides: null,
    school_days: args.schoolDays.length > 0 ? args.schoolDays : DEFAULT_SCHOOL_DAYS,
    start_date: args.yearStart,
    // default_minutes is NOT NULL; the builder falls back to 30 too.
    default_minutes: row.minutesPerLesson ?? 30,
    archived: true,
    completed_at: finished ? `${args.yearEnd}T12:00:00Z` : null,
  };
}

export type PastYearLessonInsert = {
  user_id: string;
  school_year_id: string;
  school_year: string;
  child_id: string;
  curriculum_goal_id: string;
  lesson_number: number;
  queue_position: number;
  title: string;
  date: string;
  scheduled_date: string;
  scheduled_source: typeof PAST_YEAR_SOURCE;
  completed: true;
  completed_at: string;
  is_backfill: true;
  queue_pinned: true;
  minutes_spent: number | null;
  hours: number;
};

/**
 * One lesson row per completed lesson, dated by spreadLessonDates. The title
 * is the builder's "{name} — Lesson {n}" convention (lessonReportSubject's
 * rule 5 reads the curriculum name back out of it) and completed_at is noon
 * UTC of the day, the way every historical row in the app is stamped.
 */
export function buildPastYearLessons(args: {
  userId: string;
  schoolYearId: string;
  yearName: string;
  goalId: string;
  childId: string;
  curriculumName: string;
  completedLessons: number;
  minutesPerLesson: number | null;
  schoolDaysInYear: readonly string[];
}): PastYearLessonInsert[] {
  const dates = spreadLessonDates(args.completedLessons, args.schoolDaysInYear);
  const name = capitalizeName(args.curriculumName.trim());
  return dates.map((date, i) => ({
    user_id: args.userId,
    school_year_id: args.schoolYearId,
    school_year: args.yearName,
    child_id: args.childId,
    curriculum_goal_id: args.goalId,
    lesson_number: i + 1,
    queue_position: i + 1,
    title: `${name} — Lesson ${i + 1}`,
    date,
    scheduled_date: date,
    scheduled_source: PAST_YEAR_SOURCE,
    completed: true,
    completed_at: `${date}T12:00:00Z`,
    is_backfill: true,
    queue_pinned: true,
    minutes_spent: args.minutesPerLesson,
    hours: args.minutesPerLesson != null ? args.minutesPerLesson / 60 : 0,
  }));
}

/** Split rows into insert batches. The same helper the Schedule Builder uses. */
export function batches<T>(rows: readonly T[], size = PAST_YEAR_LESSON_BATCH): T[][] {
  return splitBatches(rows, size);
}

export type PastYearSummary = {
  lessons: number;
  subjects: number;
  children: number;
};

/** Counts for the review step: completed lessons, distinct subjects, children touched. */
export function summarizePastYear(rows: readonly PastYearRow[]): PastYearSummary {
  const usable = usableRows(rows);
  const subjects = new Set(usable.map((r) => (r.subjectLabel.trim() || r.curriculumName.trim()).toLowerCase()));
  const children = new Set(usable.map((r) => r.childId));
  return {
    lessons: usable.reduce((n, r) => n + r.completedLessons, 0),
    subjects: subjects.size,
    children: children.size,
  };
}

const DAY_FULL: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

/** "Mondays to Fridays", "Mondays, Wednesdays and Fridays", "every day". */
export function describeSchoolDays(days: readonly string[]): string {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const chosen = order.filter((d) => days.includes(d));
  if (chosen.length === 7) return "every day";
  if (chosen.length === 0) return "no days";
  const plural = (d: string) => `${DAY_FULL[d]}s`;
  // A single unbroken run reads as a range.
  const idx = chosen.map((d) => order.indexOf(d));
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous && chosen.length > 2) return `${plural(chosen[0])} to ${plural(chosen[chosen.length - 1])}`;
  if (chosen.length === 1) return plural(chosen[0]);
  const names = chosen.map(plural);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The plain-words sentence on the review step. */
export function pastYearReviewSentence(args: {
  yearName: string;
  start: string;
  end: string;
  schoolDays: readonly string[];
  rows: readonly PastYearRow[];
  childNames: Record<string, string>;
  activeYearName: string | null;
}): string {
  const s = summarizePastYear(args.rows);
  const usable = usableRows(args.rows);
  const kids = Array.from(new Set(usable.map((r) => args.childNames[r.childId] ?? "your child")));
  const who = kids.length === 1 ? kids[0] : kids.length === 2 ? `${kids[0]} and ${kids[1]}` : `${kids.slice(0, -1).join(", ")} and ${kids[kids.length - 1]}`;
  const subjectWord = s.subjects === 1 ? "subject" : "subjects";
  const lessonWord = s.lessons === 1 ? "lesson" : "lessons";
  const first = `This adds ${s.lessons.toLocaleString("en-US")} completed ${lessonWord} across ${s.subjects} ${subjectWord} for ${who}, dated between ${fmtLong(args.start)} and ${fmtLong(args.end)}, on ${describeSchoolDays(args.schoolDays)}.`;
  const second = `It will show under Years, on Reports for those dates, and on the year-end summary.`;
  const third = args.activeYearName ? ` Your ${args.activeYearName} year is not changed.` : "";
  return `${first} ${second}${third}`;
}
