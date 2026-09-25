import { oneOffLessonRows } from "./oneOffLessonRows.ts";

/* ============================================================================
 * weekPlan.ts: the parent-led weekly planner's rules, pure so they are tested
 * without a database.
 *
 * A parent picks a subject, the children doing it, and a title for each day
 * of one week ("Week 12.1" on Monday, "Week 12.2" on Tuesday...). Rooted adds
 * one lesson per child per chosen day. These are the same rows as Plan's
 * shared one-off lesson (oneOffLessonRows, September 24, 2026): no curriculum
 * goal and no queue slot, so no part of the curriculum scheduler reads,
 * re-dates, rebuilds or completes them. The parent's day is the day. Each
 * child has their own row, so each child checks off their own lesson and the
 * minutes count on that child's report only.
 *
 * No "@/" imports at module scope: node --test is strip-only.
 * ==========================================================================*/

/** scheduled_source for a lesson added by "Plan this week" (Invariant 10). */
export const WEEK_PLAN_SOURCE = "week_plan";

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The seven days of the week that starts on `weekStart` (Plan's Monday). */
export function weekDates(weekStart: Date): string[] {
  const out: string[] = [];
  const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  for (let i = 0; i < 7; i++) {
    out.push(ymd(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** "Mon", "Tue"... for a YYYY-MM-DD, the short form profiles.school_days stores. */
export function dayLabel(dateStr: string): string {
  return DAY_LABEL[parseYmd(dateStr).getDay()];
}

export type WeekPlanDayState = {
  date: string;
  /** Before today: a plan cannot be made for a day already gone. */
  past: boolean;
  /** Inside a break the family set: offered, but not chosen by default. */
  onBreak: boolean;
  /** Chosen when the sheet opens: a school day, today or later, not on a break. */
  defaultChosen: boolean;
};

/** How each day of the week starts out in the sheet. */
export function weekPlanDays(args: {
  weekStart: Date;
  today: string;
  schoolDays: readonly string[];
  breaks: readonly { start_date: string; end_date: string }[];
}): WeekPlanDayState[] {
  const school = new Set((args.schoolDays.length > 0 ? args.schoolDays : ["Mon", "Tue", "Wed", "Thu", "Fri"]).map((d) => d.slice(0, 3)));
  return weekDates(args.weekStart).map((date) => {
    const past = date < args.today;
    const onBreak = args.breaks.some((b) => date >= b.start_date && date <= b.end_date);
    return { date, past, onBreak, defaultChosen: !past && !onBreak && school.has(dayLabel(date)) };
  });
}

/**
 * The titles for the chosen days, following the first one the parent typed:
 * the last number in it counts up by one a day. "Week 12.1" gives "Week 12.2",
 * "Week 12.3"; "Chapter 9" gives "Chapter 10"; a title with no number repeats.
 */
export function numberedTitles(first: string, count: number): string[] {
  const m = /^(.*?)(\d+)(\D*)$/.exec(first);
  if (!m) return Array.from({ length: count }, () => first);
  const [, head, digits, tail] = m;
  const start = Number(digits);
  return Array.from({ length: count }, (_, i) => {
    const n = String(start + i);
    // Keep a leading zero's width ("Day 07" -> "Day 08").
    const padded = digits.startsWith("0") ? n.padStart(digits.length, "0") : n;
    return `${head}${padded}${tail}`;
  });
}

/** "Math · Week 12.1", the same "Subject · Title" shape as Add a lesson. */
export function weekPlanTitle(subject: string, title: string): string {
  const s = subject.trim();
  const t = title.trim();
  if (s && t) return `${s} · ${t}`;
  return s || t;
}

export type WeekPlanInput = {
  childIds: readonly string[];
  subject: string;
  minutes: number | null;
  notes: string | null;
  days: readonly { date: string; title: string }[];
};

/** Why a plan cannot be saved, in the words the sheet shows; null when it can. */
export function weekPlanProblem(input: WeekPlanInput, today: string): string | null {
  if (new Set(input.childIds).size === 0) return "Choose at least one child.";
  if (input.days.length === 0) return "Choose at least one day.";
  if (new Set(input.days.map((d) => d.date)).size !== input.days.length) return "Each day can be chosen once.";
  if (input.days.some((d) => d.date < today)) return "A day that has passed can't be planned. Log it as done instead.";
  const missing = input.days.find((d) => !weekPlanTitle(input.subject, d.title));
  if (missing) return `Give ${dayLabel(missing.date)} a title, or add a subject.`;
  if (input.minutes != null && (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 600)) {
    return "Minutes should be a whole number from 1 to 600.";
  }
  return null;
}

/**
 * Every row the plan inserts: one per child per chosen day, built by the
 * shared one-off lesson builder and tagged with the planner's source. Refuses
 * anything weekPlanProblem refuses, so no caller can write a plan the sheet
 * would not have allowed.
 */
export function weekPlanRows(userId: string, input: WeekPlanInput, today: string) {
  const problem = weekPlanProblem(input, today);
  if (problem) throw new Error(problem);
  const childIds = [...new Set(input.childIds)];
  return [...input.days]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .flatMap((day) =>
      oneOffLessonRows(userId, childIds, {
        child_ids: childIds,
        curriculum_goal_id: null,
        title: weekPlanTitle(input.subject, day.title),
        lesson_number: null,
        minutes_spent: input.minutes,
        scheduled_date: day.date,
        notes: input.notes,
      }, false).map((row) => ({ ...row, scheduled_source: WEEK_PLAN_SOURCE })),
    );
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sentence above Save: exactly what Save will add. */
export function weekPlanSummary(dayCount: number, childNames: readonly string[]): string {
  const lessons = dayCount * childNames.length;
  if (lessons === 0) return "Choose the days and children to plan.";
  const days = `${dayCount} ${dayCount === 1 ? "day" : "days"}`;
  if (childNames.length === 1) {
    return `Adds ${lessons} ${lessons === 1 ? "lesson" : "lessons"} for ${childNames[0]}, ${days}.`;
  }
  return `Adds ${lessons} lessons: ${days} each for ${joinNames(childNames)}. Each child checks off their own, and it counts on their own report.`;
}
