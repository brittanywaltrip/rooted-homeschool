import assert from "node:assert/strict";
import test from "node:test";
import { shiftManualPlan, type PlannedLesson } from "./shiftManualPlan.ts";

const row = (id: string, date: string, extra: Partial<PlannedLesson> = {}): PlannedLesson => ({
  id, scheduled_date: date, date, completed: false, curriculum_goal_id: null, ...extra,
});
const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];

test("missed Friday shifts a manually planned week without stacking on Monday", () => {
  const rows = [row("fri-child-a", "2026-09-25"), row("fri-child-b", "2026-09-25"),
    row("mon", "2026-09-28"), row("tue", "2026-09-29"),
    row("auto", "2026-09-25", { curriculum_goal_id: "goal" })];
  assert.deepEqual(shiftManualPlan(rows, "2026-09-25", "2026-09-28", days, []), [
    { id: "fri-child-a", from: "2026-09-25", date: "2026-09-28" },
    { id: "fri-child-b", from: "2026-09-25", date: "2026-09-28" },
    { id: "mon", from: "2026-09-28", date: "2026-09-29" },
    { id: "tue", from: "2026-09-29", date: "2026-09-30" },
  ]);
});

test("same-day and non-teaching destinations do not shift the tail", () => {
  assert.deepEqual(shiftManualPlan([row("fri", "2026-09-25")], "2026-09-25", "2026-09-25", days, []), []);
  assert.deepEqual(shiftManualPlan([row("fri", "2026-09-25")], "2026-09-25", "2026-09-26", days, []), []);
});

test("backwards shift skips completed and auto curriculum, and respects a break", () => {
  const rows = [row("mon", "2026-10-05"), row("tue", "2026-10-06"),
    row("done", "2026-10-06", { completed: true }),
    row("auto", "2026-10-06", { curriculum_goal_id: "goal" }),
    row("earlier", "2026-10-01")];
  assert.deepEqual(shiftManualPlan(rows, "2026-10-05", "2026-10-01", days,
    [{ start_date: "2026-10-02", end_date: "2026-10-02" }]), [
    { id: "mon", from: "2026-10-05", date: "2026-10-01" },
    { id: "tue", from: "2026-10-06", date: "2026-10-05" },
  ]);
});
