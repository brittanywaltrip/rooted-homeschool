import assert from "node:assert/strict";
import test from "node:test";
import { dayOffLength, selectReportDaysOff, type ReportBreak } from "./report-days-off.ts";

const blocks: ReportBreak[] = [
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

test("lists breaks that overlap the range, clipped to it, oldest first", () => {
  const got = selectReportDaysOff(blocks, "2026-09-01", "2026-09-30");
  assert.deepEqual(got, [
    { id: "spans-start", name: "Labor Day weekend", start: "2026-09-01", end: "2026-09-07" },
    { id: "one", name: "Dentist recovery", start: "2026-09-03", end: "2026-09-03" },
    { id: "sick", name: "Sick Day", start: "2026-09-14", end: "2026-09-15" },
    { id: "unnamed", name: "Break", start: "2026-09-21", end: "2026-09-21" },
    { id: "spans-end", name: "Fall break", start: "2026-09-28", end: "2026-09-30" },
  ]);
});

test("range edges are inclusive", () => {
  const got = selectReportDaysOff(blocks, "2026-09-15", "2026-09-28").map((d) => d.id);
  assert.deepEqual(got, ["sick", "unnamed", "spans-end"]);
});

test("an open side of the range is unbounded", () => {
  assert.equal(selectReportDaysOff(blocks, "", "").length, 7);
  assert.deepEqual(selectReportDaysOff(blocks, "2026-11-01", "").map((d) => d.id), ["after"]);
});

test("no breaks in range gives an empty list", () => {
  assert.deepEqual(selectReportDaysOff(blocks, "2026-10-10", "2026-10-31"), []);
  assert.deepEqual(selectReportDaysOff([], "2026-09-01", "2026-09-30"), []);
});

test("length counts calendar days inclusively", () => {
  const [labor, one, sick] = selectReportDaysOff(blocks, "2026-09-01", "2026-09-30");
  assert.equal(dayOffLength(labor), 7);
  assert.equal(dayOffLength(one), 1);
  assert.equal(dayOffLength(sick), 2);
});
