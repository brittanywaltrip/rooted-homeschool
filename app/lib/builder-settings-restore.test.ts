import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isDecidedNotApplied, markNotApplied, restorePatch, scheduleSnapshot, stillAsWrittenFilters, wasNotApplied,
} from "./builder-settings-restore.ts";

const before = { total_lessons: 120, lessons_per_day: 2, lessons_per_day_overrides: null, school_days: ["Fri", "Sat"], start_date: null, start_at_lesson: 8 };

test("only the scheduling columns phase 1 wrote and changed are restored", () => {
  const written = scheduleSnapshot({ curriculum_name: "Math", total_lessons: 120, lessons_per_day: 3, lessons_per_day_overrides: null, school_days: ["Thu", "Fri", "Sat"], start_date: null, default_minutes: 45 });
  assert.deepEqual(restorePatch(before, written), { lessons_per_day: 2, school_days: ["Fri", "Sat"] });
});

test("a save that changed no scheduling setting restores nothing", () => {
  const written = scheduleSnapshot({ ...before, curriculum_name: "Renamed" });
  assert.deepEqual(restorePatch(before, written), {});
});

test("start_at_lesson is left alone when phase 1 did not write it", () => {
  const written = scheduleSnapshot({ total_lessons: 90, lessons_per_day: 2, school_days: ["Fri", "Sat"], start_date: null, lessons_per_day_overrides: null });
  const patch = restorePatch(before, written);
  assert.deepEqual(patch, { total_lessons: 120 });
  assert.ok(!("start_at_lesson" in patch));
});

test("the restore only matches a row still holding what phase 1 wrote", () => {
  const written = { lessons_per_day: 3, school_days: ["Thu", "Fri"], start_date: null, lessons_per_day_overrides: { Mon: 2 } };
  const patch = { lessons_per_day: 2, school_days: ["Fri"], start_date: "2026-10-02", lessons_per_day_overrides: null };
  assert.deepEqual(stillAsWrittenFilters(written, patch), [
    ["lessons_per_day", "eq", "3"],
    ["lessons_per_day_overrides", "eq", '{"Mon":2}'],
    ["school_days", "eq", '{"Thu","Fri"}'],
    ["start_date", "is", "null"],
  ]);
});

test("only database-decided outcomes count as nothing written", () => {
  for (const status of ["refused", "invalid", "stale", "failed", "unavailable"]) assert.equal(isDecidedNotApplied({ status }), true, status);
  assert.equal(isDecidedNotApplied({ status: "failed", transport: true }), false);
  assert.equal(isDecidedNotApplied({ status: "applied" }), false);
});

test("the not-applied mark travels with the error and nothing else", () => {
  const e = markNotApplied(new Error("refused"));
  assert.equal(wasNotApplied(e), true);
  assert.equal(wasNotApplied(new Error("other")), false);
  assert.equal(wasNotApplied(null), false);
});

test("the Schedule Builder restores only after write-free failures and keeps the draft", () => {
  const src = readFileSync(new URL("../dashboard/plan/schedule/page.tsx", import.meta.url), "utf8");
  // Every refusal or database verdict before a lesson write is marked.
  assert.match(src, /throw markNotApplied\(new ScheduleAssertionError\(\n\s+days\.length > 0/);
  assert.match(src, /throw markNotApplied\(new ScheduleAssertionError\(\n\s+`Lesson scheduling was refused before anything was written \(\$\{committed\.reason\}\)/);
  assert.match(src, /throw isDecidedNotApplied\(committed\) \? markNotApplied\(notApplied\) : notApplied;/);
  // The restore reads the row as phase 1 found it and matches it as written.
  assert.match(src, /\.select\(SCHEDULE_FIELDS\.join\(", "\)\)/);
  assert.match(src, /if \(!snap \|\| !wasNotApplied\(f\.err\)\) continue;/);
  assert.match(src, /stillAsWrittenFilters\(snap\.written, patch\)/);
  // A restored curriculum keeps the family's draft.
  assert.match(src, /!\(err instanceof ScheduleRefusedError\) && !restoredName\)/);
  // Nothing after the commit is marked: those failures follow written lessons.
  const after = src.slice(src.indexOf("// ── Count what the DATABASE wrote"));
  assert.ok(!after.slice(0, after.indexOf("const runPhase2ForGoal")).includes("markNotApplied("));
});

test("a transport failure from apply_builder_rebuild is flagged as uncertain", () => {
  const src = readFileSync(new URL("./phase2-commit.ts", import.meta.url), "utf8");
  assert.match(src, /status: "failed", reason: \(error as \{ message\?: string \}\)\.message \?\? "rpc error", transport: true/);
});
