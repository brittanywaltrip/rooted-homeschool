import assert from "node:assert/strict";
import test from "node:test";
import { dayOffInputError, dayOffLength, selectReportDaysOff, type ReportAbsence, type ReportBreak } from "./report-days-off.ts";

const breaks: ReportBreak[] = [
  { id: "before", name: "Summer", start_date: "2026-07-01", end_date: "2026-08-31" },      // ends the day before
  { id: "sick", name: "  Sick Day ", start_date: "2026-09-14", end_date: "2026-09-15" },
  { id: "one", name: "Dentist recovery", start_date: "2026-09-03", end_date: "2026-09-03" },
  { id: "spans-start", name: "Labor Day weekend", start_date: "2026-08-29", end_date: "2026-09-07" },
  { id: "spans-end", name: "Fall break", start_date: "2026-09-28", end_date: "2026-10-04" },
  { id: "after", name: "Thanksgiving", start_date: "2026-11-25", end_date: "2026-11-27" },
  { id: "unnamed", name: "", start_date: "2026-09-21", end_date: "2026-09-21" },
  { id: "reversed", name: "Bad", start_date: "2026-09-10", end_date: "2026-09-09" },
  { id: "missing", name: "No end", start_date: "2026-09-10", end_date: null },
  { id: "sick", name: "Sick Day", start_date: "2026-09-14", end_date: "2026-09-15" },     // same row twice
];

const SEPT = { absences: [] as ReportAbsence[], childId: null, from: "2026-09-01", to: "2026-09-30" };

test("lists breaks that overlap the range, clipped to it, oldest first", () => {
  const got = selectReportDaysOff({ ...SEPT, breaks }).map(({ id, name, start, end, childId }) => ({ id, name, start, end, childId }));
  assert.deepEqual(got, [
    { id: "spans-start", name: "Labor Day weekend", start: "2026-09-01", end: "2026-09-07", childId: null },
    { id: "one", name: "Dentist recovery", start: "2026-09-03", end: "2026-09-03", childId: null },
    { id: "sick", name: "Sick Day", start: "2026-09-14", end: "2026-09-15", childId: null },
    { id: "unnamed", name: "Break", start: "2026-09-21", end: "2026-09-21", childId: null },
    { id: "spans-end", name: "Fall break", start: "2026-09-28", end: "2026-09-30", childId: null },
  ]);
});

test("range edges are inclusive", () => {
  const got = selectReportDaysOff({ ...SEPT, breaks, from: "2026-09-15", to: "2026-09-28" }).map((d) => d.id);
  assert.deepEqual(got, ["sick", "unnamed", "spans-end"]);
});

test("an open side of the range is unbounded", () => {
  assert.equal(selectReportDaysOff({ ...SEPT, breaks, from: "", to: "" }).length, 7);
  assert.deepEqual(selectReportDaysOff({ ...SEPT, breaks, from: "2026-11-01", to: "" }).map((d) => d.id), ["after"]);
});

test("no days off in range gives an empty list", () => {
  assert.deepEqual(selectReportDaysOff({ ...SEPT, breaks, from: "2026-10-10", to: "2026-10-31" }), []);
  assert.deepEqual(selectReportDaysOff({ ...SEPT, breaks: [] }), []);
});

test("length counts calendar days inclusively", () => {
  const [labor, one, sick] = selectReportDaysOff({ ...SEPT, breaks });
  assert.equal(dayOffLength(labor), 7);
  assert.equal(dayOffLength(one), 1);
  assert.equal(dayOffLength(sick), 2);
});

// ── a child's day off belongs to that child ─────────────────────────────────

const AVA = "ava", SAM = "sam";
const absences: ReportAbsence[] = [
  { id: "a1", child_id: AVA, reason: "Sick day", start_date: "2026-09-14", end_date: "2026-09-15" },
  { id: "s1", child_id: SAM, reason: "Dentist", start_date: "2026-09-22", end_date: "2026-09-22" },
  { id: "a0", child_id: AVA, reason: "Sick day", start_date: "2026-08-10", end_date: "2026-08-10" }, // out of range
];
const familyBreak: ReportBreak[] = [{ id: "fall", name: "Fall break", start_date: "2026-09-28", end_date: "2026-09-30" }];

test("Ava's sick day is on Ava's report and never on Sam's", () => {
  const ava = selectReportDaysOff({ breaks: [], absences, childId: AVA, from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(ava.map((d) => [d.id, d.childId]), [["a1", AVA]]);
  const sam = selectReportDaysOff({ breaks: [], absences, childId: SAM, from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(sam.map((d) => [d.id, d.childId]), [["s1", SAM]]);
  assert.ok(!sam.some((d) => d.childId === AVA), "a sibling's absence must never print on this child's report");
});

test("the family report lists every child's day off with its owner, plus family breaks", () => {
  const all = selectReportDaysOff({ breaks: familyBreak, absences, childId: null, from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(all.map((d) => [d.id, d.kind, d.childId]), [
    ["a1", "absence", AVA],
    ["s1", "absence", SAM],
    ["fall", "break", null],
  ]);
});

test("a whole-family break still prints on every child's report", () => {
  for (const childId of [AVA, SAM]) {
    const got = selectReportDaysOff({ breaks: familyBreak, absences: [], childId, from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(got.map((d) => [d.id, d.childId]), [["fall", null]]);
  }
});

test("a break and an absence may share an id without colliding", () => {
  const got = selectReportDaysOff({
    breaks: [{ id: "x", name: "Break", start_date: "2026-09-02", end_date: "2026-09-02" }],
    absences: [{ id: "x", child_id: AVA, reason: "Sick day", start_date: "2026-09-02", end_date: "2026-09-02" }],
    childId: AVA, from: "2026-09-01", to: "2026-09-30",
  });
  assert.equal(got.length, 2);
});

test("a new day off needs a child, a valid range and a short reason", () => {
  assert.equal(dayOffInputError(AVA, "2026-09-14", "2026-09-15", "Sick day"), null);
  assert.match(dayOffInputError("", "2026-09-14", "2026-09-15", "Sick day") ?? "", /which child/);
  assert.match(dayOffInputError(AVA, "", "2026-09-15", "Sick day") ?? "", /first and last day/);
  assert.match(dayOffInputError(AVA, "2026-09-16", "2026-09-15", "Sick day") ?? "", /before the first/);
  assert.match(dayOffInputError(AVA, "2026-09-14", "2026-09-15", "   ") ?? "", /reason/);
  assert.match(dayOffInputError(AVA, "2026-09-14", "2026-09-15", "x".repeat(81)) ?? "", /80/);
});
