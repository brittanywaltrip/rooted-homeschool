import { joinNames } from "./garden-config.ts";
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
import { sumLessonMinutes } from "../../lib/lesson-minutes.ts";

export const PAST_YEAR_SOURCE = "past_year";
/**
 * PostgREST `or` filter for lessons NOT filed through Add a past year. A plain
 * neq would also drop the rows whose scheduled_source is NULL, so both halves
 * are spelled out. Badge counts read it: a filed year earns no badges.
 */
export const NOT_FILED_PAST_YEAR = `scheduled_source.is.null,scheduled_source.neq.${PAST_YEAR_SOURCE}`;
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

/**
 * The days a family actually schooled, chosen evenly from every school day in
 * the range: every Nth day, the first and the last included, so the year still
 * spans the dates the family gave. Asked on the add flow and on the Years page
 * because spreading a year's lessons over EVERY school day marks every one of
 * them present, and attendance is the number a family keeps for the state. A
 * mother who filed her kindergarten year saw 180 days present in a year that
 * had sick days in it (reported 2026-09-14).
 *
 * `count` at or above `days.length` returns every day. Never a duplicate, never
 * fewer than `count` days while `count <= days.length`: consecutive picks are at
 * least one day apart before rounding, so rounding cannot land two on one day.
 */
export function pickAttendedDays(days: readonly string[], count: number): string[] {
  if (!Number.isInteger(count) || count < 0) throw new Error(`pickAttendedDays: bad count ${count}`);
  if (count === 0 || days.length === 0) return [];
  if (count >= days.length) return [...days];
  if (count === 1) return [days[0]];
  const last = days.length - 1;
  const out: string[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = days[Math.round((i * last) / (count - 1))];
  }
  return out;
}

/**
 * The distinct days a filed year's lessons land on once each curriculum is
 * spread over `attendedDays`. This is exactly what Reports counts as days
 * present (a day with a completed lesson), so it is the number stored as
 * days_attended. It equals attendedDays.length whenever one curriculum holds at
 * least that many lessons, which is the ordinary year; a year whose every
 * curriculum is shorter than the days typed fills fewer, and the flow says so.
 */
export function pastYearFilledDays(completedPerCurriculum: readonly number[], attendedDays: readonly string[]): string[] {
  const filled = new Set<string>();
  for (const n of completedPerCurriculum) {
    if (n <= 0) continue;
    for (const d of spreadLessonDates(n, attendedDays)) filled.add(d);
  }
  return [...filled].sort();
}

/** The in-place message for the days-attended field, or null when it is fine. */
export function daysAttendedProblem(value: string, schoolDaysInRange: number): string | null {
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (trimmed === "" || !Number.isInteger(n) || n < 1 || n > schoolDaysInRange) {
    return `Between 1 and ${schoolDaysInRange} for these dates and days.`;
  }
  return null;
}

/** "(there are 180 Mondays to Fridays between your dates)" */
export function schoolDaysInRangeHint(count: number, schoolDays: readonly string[]): string {
  if (count === 1) return "(there is 1 school day between your dates)";
  const described = describeSchoolDays(schoolDays);
  const noun = described === "every day" ? "days" : described;
  return `(there are ${count.toLocaleString("en-US")} ${noun} between your dates)`;
}

/**
 * How a filed year's lessons move when its day count changes on the Years
 * page. Each curriculum's lessons, in lesson order, are re-spread over the new
 * attended days with the same spreadLessonDates the add flow used, and the
 * writes are grouped by date so a year costs one update per day, not per
 * lesson. `restore` puts every row back exactly as it was.
 */
export type RespreadLesson = {
  id: string;
  curriculum_goal_id: string | null;
  lesson_number: number | null;
  date: string | null;
  scheduled_date: string | null;
  completed_at: string | null;
};
export type DateWrite = { date: string | null; scheduled_date: string | null; completed_at: string | null; ids: string[] };

export function planPastYearRespread(lessons: readonly RespreadLesson[], attendedDays: readonly string[]): {
  writes: DateWrite[];
  restore: DateWrite[];
  filledDays: number;
} {
  const byGoal = new Map<string, RespreadLesson[]>();
  for (const l of lessons) {
    const key = l.curriculum_goal_id ?? "";
    const list = byGoal.get(key) ?? [];
    list.push(l);
    byGoal.set(key, list);
  }
  const newDateById = new Map<string, string>();
  for (const list of byGoal.values()) {
    const ordered = [...list].sort((a, b) => (a.lesson_number ?? 0) - (b.lesson_number ?? 0) || a.id.localeCompare(b.id));
    const dates = spreadLessonDates(ordered.length, attendedDays);
    ordered.forEach((l, i) => newDateById.set(l.id, dates[i]));
  }
  const group = (key: (l: RespreadLesson) => { date: string | null; scheduled_date: string | null; completed_at: string | null }) => {
    const map = new Map<string, DateWrite>();
    for (const l of lessons) {
      const v = key(l);
      const k = `${v.date}|${v.scheduled_date}|${v.completed_at}`;
      const w = map.get(k) ?? { ...v, ids: [] };
      w.ids.push(l.id);
      map.set(k, w);
    }
    return [...map.values()];
  };
  const writes = group((l) => {
    const d = newDateById.get(l.id)!;
    return { date: d, scheduled_date: d, completed_at: `${d}T12:00:00Z` };
  });
  const restore = group((l) => ({ date: l.date, scheduled_date: l.scheduled_date, completed_at: l.completed_at }));
  return { writes, restore, filledDays: new Set(newDateById.values()).size };
}

/** The memory counts a year archive carries, as the close route counts them. */
export type YearMemoryCounts = { memories: number; photos: number; books: number; fieldTrips: number; wins: number };

/**
 * The school_year_archives row for a filed year, in the close route's shape
 * (app/api/school-year/close/route.ts, steps 2 to 4 and 12) plus days_attended,
 * so the Years page reads one shape for filed and closed years alike. A filed
 * year earned no badges and advanced no grades, so those are zero and null.
 */
export function buildPastYearArchive(args: {
  userId: string;
  schoolYearId: string;
  yearName: string;
  start: string;
  end: string;
  daysAttended: number;
  goals: readonly { id: string; child_id: string; curriculum_name: string; subject_label: string | null; current_lesson: number; total_lessons: number }[];
  lessons: readonly { child_id: string; minutes_spent: number | null; hours?: number | null }[];
  childNames: Record<string, string>;
  memories: YearMemoryCounts;
}) {
  // lib/lesson-minutes.ts, the rule the Years card reads the same lessons with.
  // This used to count a lesson with no minutes as 0 while the Years card
  // counted 30, so a filed year's archive and its own card disagreed.
  const minutes = sumLessonMinutes(args.lessons).minutes;
  const childIds = [...new Set(args.goals.map((g) => g.child_id))];
  return {
    user_id: args.userId,
    school_year_id: args.schoolYearId,
    year_name: args.yearName,
    start_date: args.start,
    end_date: args.end,
    stats: {
      lessons_completed: args.lessons.length,
      total_lessons: args.lessons.length,
      memories_count: args.memories.memories,
      photos_count: args.memories.photos,
      books_count: args.memories.books,
      field_trips_count: args.memories.fieldTrips,
      wins_count: args.memories.wins,
      badges_count: 0,
      hours_logged: Math.round((minutes / 60) * 10) / 10,
      days_attended: args.daysAttended,
    },
    per_child_data: childIds.map((childId) => ({
      child_id: childId,
      child_name: args.childNames[childId] ?? "",
      grade_level: null,
      lessons_completed: args.lessons.filter((l) => l.child_id === childId).length,
      badges_count: 0,
      goals_count: args.goals.filter((g) => g.child_id === childId).length,
      grade_from: null,
      grade_to: null,
    })),
    garden_snapshot: args.goals.map((g) => ({
      goal_id: g.id,
      curriculum_name: g.curriculum_name,
      subject_label: g.subject_label,
      icon_emoji: null,
      child_id: g.child_id,
      current_lesson: g.current_lesson,
      total_lessons: g.total_lessons,
      completion_pct: g.total_lessons > 0 ? Math.round((g.current_lesson / g.total_lessons) * 1000) / 1000 : 0,
    })),
  };
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
/**
 * Why this flow does NOT use `deriveHistoryFromNextLesson`.
 *
 * The Schedule Builder walks BACKWARD from today because a family who is on
 * lesson 11 did lessons 1 to 10 on the ten school days they just had. A past
 * year is the opposite shape: 100 lessons filed against a whole year belong
 * across that year, not bunched into its final 100 school days. Walking back
 * from the year's end date would show a family doing nothing from September to
 * February and everything in the spring, which is false and would print that
 * way on Reports and the transcript.
 *
 * So `spreadLessonDates` stays (see "Adding a past year" in
 * docs/CURRICULUM-SCHEDULING.md: even across the year's school days, in order).
 * What IS shared is every rule that should only exist once: the name joining
 * below, and the review sentence's shape.
 */
export function pastYearReviewSentence(args: {
  yearName: string;
  start: string;
  end: string;
  schoolDays: readonly string[];
  rows: readonly PastYearRow[];
  childNames: Record<string, string>;
  activeYearName: string | null;
  /** The days the lessons are dated on. Omitted, the sentence names the weekdays only. */
  daysAttended?: number | null;
}): string {
  const s = summarizePastYear(args.rows);
  const usable = usableRows(args.rows);
  const kids = Array.from(new Set(usable.map((r) => args.childNames[r.childId] ?? "your child")));
  // One name-joining rule for the whole app. This had its own copy, without
  // the Oxford comma, so three children read as two with a compound name.
  const who = joinNames(kids);
  const subjectWord = s.subjects === 1 ? "subject" : "subjects";
  const lessonWord = s.lessons === 1 ? "lesson" : "lessons";
  const onDays = args.daysAttended != null
    ? `dated on ${args.daysAttended.toLocaleString("en-US")} school ${args.daysAttended === 1 ? "day" : "days"} between ${fmtLong(args.start)} and ${fmtLong(args.end)}`
    : `dated between ${fmtLong(args.start)} and ${fmtLong(args.end)}`;
  const first = `This adds ${s.lessons.toLocaleString("en-US")} completed ${lessonWord} across ${s.subjects} ${subjectWord} for ${who}, ${onDays}, on ${describeSchoolDays(args.schoolDays)}.`;
  const second = `It will show under Years, on Reports for those dates, and on the year-end summary.`;
  const third = args.activeYearName ? ` Your ${args.activeYearName} year is not changed.` : "";
  return `${first} ${second}${third}`;
}
