// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  spreadLessonDates, pastYearProblem, defaultYearName, buildPastYearLessons, buildPastYearGoal,
  summarizePastYear, pastYearReviewSentence, describeSchoolDays, rowProblem, batches, usableRows,
} from "./past-year-dates.ts";
import { schoolDaysBetween } from "./scheduler.ts";

const MON_FRI = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const dow = (ymd: string) => new Date(ymd + "T12:00:00").getDay();

test("180 lessons over Aug 19 2025 to May 22 2026, Mon to Fri: weekdays only, in order, 180 rows, last on or before the end", () => {
  const days = schoolDaysBetween("2025-08-19", "2026-05-22", MON_FRI);
  assert.ok(days.length > 180, `expected more than 180 school days, got ${days.length}`);
  const dates = spreadLessonDates(180, days);
  assert.equal(dates.length, 180);
  for (const d of dates) assert.ok(dow(d) >= 1 && dow(d) <= 5, `${d} is not a weekday`);
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i] > dates[i - 1], "one per day, ascending");
  assert.equal(dates[0], "2025-08-19");
  assert.ok(dates[dates.length - 1] <= "2026-05-22");
});

test("30 lessons over the same span spread out with gaps", () => {
  const days = schoolDaysBetween("2025-08-19", "2026-05-22", MON_FRI);
  const dates = spreadLessonDates(30, days);
  assert.equal(dates.length, 30);
  assert.equal(new Set(dates).size, 30);
  const gaps = dates.slice(1).map((d, i) => days.indexOf(d) - days.indexOf(dates[i]));
  assert.ok(gaps.every((g) => g >= 6), `lessons should be about a week apart, gaps ${gaps.slice(0, 5)}`);
  assert.ok(dates[dates.length - 1] >= "2026-05-01", "the spread reaches the end of the year");
});

test("900 lessons over 180 school days stack at most 5 per day, dates never decrease", () => {
  const days = Array.from({ length: 180 }, (_, i) => `D${String(i).padStart(3, "0")}`);
  const dates = spreadLessonDates(900, days);
  assert.equal(dates.length, 900);
  const perDay = new Map<string, number>();
  for (const d of dates) perDay.set(d, (perDay.get(d) ?? 0) + 1);
  assert.equal(Math.max(...perDay.values()), 5);
  assert.equal(perDay.size, 180, "every school day is used");
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i] >= dates[i - 1]);
});

test("901 lessons over 180 days: at most ceil(901/180) = 6 per day", () => {
  const days = Array.from({ length: 180 }, (_, i) => `D${String(i).padStart(3, "0")}`);
  const dates = spreadLessonDates(901, days);
  const perDay = new Map<string, number>();
  for (const d of dates) perDay.set(d, (perDay.get(d) ?? 0) + 1);
  assert.ok(Math.max(...perDay.values()) <= 6);
});

test("zero lessons yields zero rows", () => {
  assert.deepEqual(spreadLessonDates(0, ["2025-08-19"]), []);
  assert.deepEqual(buildPastYearLessons({ userId: "u", schoolYearId: "y", yearName: "2025-2026", goalId: "g", childId: "c", curriculumName: "Math", completedLessons: 0, minutesPerLesson: null, schoolDaysInYear: ["2025-08-19"] }), []);
});

test("a start after the end throws", () => {
  assert.throws(() => schoolDaysBetween("2026-05-22", "2025-08-19", MON_FRI), /after end/);
});

test("a positive count with no school days throws rather than placing nothing", () => {
  assert.throws(() => spreadLessonDates(3, []), /no school days/);
  assert.deepEqual(schoolDaysBetween("2025-08-16", "2025-08-17", MON_FRI), [], "a weekend holds no Mon-Fri school days");
});

test("school days honor the chosen weekdays and the fallback", () => {
  const mwf = schoolDaysBetween("2025-09-01", "2025-09-14", ["Mon", "Wed", "Fri"]);
  assert.deepEqual(mwf, ["2025-09-01", "2025-09-03", "2025-09-05", "2025-09-08", "2025-09-10", "2025-09-12"]);
  assert.equal(schoolDaysBetween("2025-09-01", "2025-09-07", []).length, 5, "empty falls back to Mon-Fri (Invariant 5)");
});

// ── the overlap rule ─────────────────────────────────────────────────────────

const ACTIVE = { id: "a", name: "2026-2027", start_date: "2026-08-18", end_date: "2027-05-31", status: "active" };
const OLD = { id: "o", name: "2024-2025", start_date: "2024-08-20", end_date: "2025-05-30", status: "archived" };
const TODAY = "2026-09-10";

test("overlap: a range that touches the active year is refused, in words", () => {
  const msg = pastYearProblem("2025-08-18", "2026-08-18", [ACTIVE], TODAY);
  assert.equal(msg, "That overlaps your 2026-2027 year (starts Aug 18, 2026). Pick an end date before it.");
  assert.match(pastYearProblem("2025-08-18", "2026-09-01", [ACTIVE], TODAY) ?? "", /overlaps your 2026-2027 year/);
});

test("overlap: a range that ends the day before the active year is accepted", () => {
  assert.equal(pastYearProblem("2025-08-18", "2026-08-17", [ACTIVE], TODAY), null);
  assert.equal(pastYearProblem("2025-08-18", "2026-05-22", [ACTIVE, OLD], TODAY), null);
});

test("overlap: an archived year is refused too, and touching counts", () => {
  assert.match(pastYearProblem("2025-05-30", "2026-05-22", [ACTIVE, OLD], TODAY) ?? "", /overlaps your 2024-2025 year/);
  assert.equal(pastYearProblem("2025-05-31", "2026-05-22", [ACTIVE, OLD], TODAY), null);
});

test("overlap: with no active year the range must end before today", () => {
  assert.equal(pastYearProblem("2025-08-18", "2026-09-10", [], TODAY), "A past year has to end before today.");
  assert.equal(pastYearProblem("2025-08-18", "2026-09-09", [], TODAY), null);
});

test("overlap: bad or backwards dates say so", () => {
  assert.equal(pastYearProblem("", "2026-05-22", [ACTIVE], TODAY), "Pick a start date and an end date.");
  assert.equal(pastYearProblem("2026-05-22", "2025-08-18", [ACTIVE], TODAY), "The end date needs to come after the start date.");
});

test("the default name comes from the dates, with a plain hyphen", () => {
  assert.equal(defaultYearName("2025-08-19", "2026-05-22"), "2025-2026");
  assert.equal(defaultYearName("2026-01-05", "2026-06-12"), "2026");
  assert.ok(!defaultYearName("2025-08-19", "2026-05-22").includes("–"), "never an en dash");
});

// ── the rows ─────────────────────────────────────────────────────────────────

const kelly = [
  { childId: "k1", curriculumName: "Math Mammoth 1", subjectLabel: "Math", totalLessons: 180, completedLessons: 180, minutesPerLesson: 30 },
  { childId: "k1", curriculumName: "All About Reading", subjectLabel: "Reading", totalLessons: 160, completedLessons: 152, minutesPerLesson: null },
  { childId: "k1", curriculumName: "", subjectLabel: "Art", totalLessons: 30, completedLessons: 30, minutesPerLesson: null },
  { childId: "k1", curriculumName: "Nature Study", subjectLabel: "Science", totalLessons: 30, completedLessons: 0, minutesPerLesson: null },
  { childId: "k2", curriculumName: "Handwriting", subjectLabel: "Handwriting", totalLessons: 80, completedLessons: 80, minutesPerLesson: 15 },
];

test("rows with an empty name or zero completed are ignored, not errors", () => {
  assert.equal(usableRows(kelly).length, 3);
  assert.equal(rowProblem(kelly[2]), null);
  assert.equal(rowProblem(kelly[3]), null);
});

test("a row with more completed than total, or no total, says why", () => {
  assert.match(rowProblem({ ...kelly[0], completedLessons: 200 }) ?? "", /can't have more lessons completed \(200\) than its total \(180\)/);
  assert.match(rowProblem({ ...kelly[0], totalLessons: 0 }) ?? "", /total number of lessons/);
  assert.equal(rowProblem(kelly[1]), null);
});

test("the summary counts lessons, distinct subjects and children from usable rows only", () => {
  assert.deepEqual(summarizePastYear(kelly), { lessons: 180 + 152 + 80, subjects: 3, children: 2 });
});

test("the review sentence reads in plain words and names the untouched active year", () => {
  const s = pastYearReviewSentence({
    yearName: "2025-2026", start: "2025-08-19", end: "2026-05-22", schoolDays: MON_FRI,
    rows: kelly, childNames: { k1: "Kelly", k2: "Sam" }, activeYearName: "2026-2027",
  });
  assert.equal(
    s,
    "This adds 412 completed lessons across 3 subjects for Kelly and Sam, dated between Aug 19, 2025 and May 22, 2026, on Mondays to Fridays. It will show under Years, on Reports for those dates, and on the year-end summary. Your 2026-2027 year is not changed.",
  );
  assert.ok(!s.includes("—") && !s.includes("–"), "no dashes in copy");
  assert.match(pastYearReviewSentence({ yearName: "x", start: "2025-08-19", end: "2026-05-22", schoolDays: MON_FRI, rows: [kelly[0]], childNames: { k1: "Kelly" }, activeYearName: null }), /across 1 subject for Kelly, .*summary\.$/);
});

test("school days read as a range, a list, or every day", () => {
  assert.equal(describeSchoolDays(MON_FRI), "Mondays to Fridays");
  assert.equal(describeSchoolDays(["Mon", "Wed", "Fri"]), "Mondays, Wednesdays and Fridays");
  assert.equal(describeSchoolDays(["Tue", "Thu"]), "Tuesdays and Thursdays");
  assert.equal(describeSchoolDays(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]), "every day");
});

test("the goal row is archived, on the year, current_lesson = completed, builder defaults", () => {
  const g = buildPastYearGoal({ userId: "u", schoolYearId: "y", yearName: "2025-2026", yearStart: "2025-08-19", yearEnd: "2026-05-22", schoolDays: MON_FRI, row: kelly[1] });
  assert.equal(g.archived, true);
  assert.equal(g.school_year_id, "y");
  assert.equal(g.school_year, "2025-2026");
  assert.equal(g.current_lesson, 152);
  assert.equal(g.start_at_lesson, 1);
  assert.equal(g.lessons_per_day, 1);
  assert.equal(g.default_minutes, 30);
  assert.equal(g.completed_at, null, "not finished: 152 of 160");
  assert.deepEqual(g.school_days, MON_FRI);
  const done = buildPastYearGoal({ userId: "u", schoolYearId: "y", yearName: "2025-2026", yearStart: "2025-08-19", yearEnd: "2026-05-22", schoolDays: MON_FRI, row: kelly[0] });
  assert.equal(done.completed_at, "2026-05-22T12:00:00Z");
  assert.equal(done.default_minutes, 30);
  assert.equal(buildPastYearGoal({ userId: "u", schoolYearId: "y", yearName: "2025-2026", yearStart: "2025-08-19", yearEnd: "2026-05-22", schoolDays: [], row: kelly[4] }).school_days.length, 5, "empty days fall back to Mon-Fri");
});

test("every lesson row is completed history in the builder's shape, tagged past_year, pinned to its slot", () => {
  const days = schoolDaysBetween("2025-08-19", "2026-05-22", MON_FRI);
  const rows = buildPastYearLessons({ userId: "u", schoolYearId: "y", yearName: "2025-2026", goalId: "g", childId: "k1", curriculumName: "math mammoth 1", completedLessons: 152, minutesPerLesson: 30, schoolDaysInYear: days });
  assert.equal(rows.length, 152);
  rows.forEach((r, i) => {
    assert.equal(r.completed, true);
    assert.equal(r.is_backfill, true);
    assert.equal(r.queue_pinned, true);
    assert.equal(r.scheduled_source, "past_year");
    assert.equal(r.lesson_number, i + 1);
    assert.equal(r.queue_position, i + 1);
    assert.equal(r.title, `Math mammoth 1 — Lesson ${i + 1}`, "capitalizeName only lifts the first letter, as the builder does");
    assert.equal(r.completed_at, `${r.date}T12:00:00Z`);
    assert.equal(r.scheduled_date, r.date);
    assert.equal(r.school_year_id, "y");
    assert.equal(r.curriculum_goal_id, "g");
    assert.equal(r.minutes_spent, 30);
    assert.equal(r.hours, 0.5);
  });
  const noMinutes = buildPastYearLessons({ userId: "u", schoolYearId: "y", yearName: "2025-2026", goalId: "g", childId: "k1", curriculumName: "Art", completedLessons: 2, minutesPerLesson: null, schoolDaysInYear: days });
  assert.equal(noMinutes[0].minutes_spent, null);
  assert.equal(noMinutes[0].hours, 0);
});

test("batches of 500", () => {
  const b = batches(Array.from({ length: 1201 }, (_, i) => i));
  assert.deepEqual(b.map((x) => x.length), [500, 500, 201]);
  assert.deepEqual(batches([]), []);
});
