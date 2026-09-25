import assert from "node:assert/strict";
import test from "node:test";
import { oneOffLessonRows } from "./oneOffLessonRows.ts";
import type { AddLessonSubmit } from "./AddLessonModal.tsx";

const shared: AddLessonSubmit = {
  child_ids: ["ava", "ben"],
  curriculum_goal_id: null,
  title: "Science · Look at the stars",
  lesson_number: null,
  minutes_spent: 20,
  scheduled_date: "2026-09-24",
  notes: null,
};

test("a shared Plan entry gives each child an independent unfinished lesson", () => {
  const rows = oneOffLessonRows("family", shared.child_ids, shared, false);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.child_id), ["ava", "ben"]);
  assert.ok(rows.every((row) => row.curriculum_goal_id === null && !row.completed));
  assert.ok(rows.every((row) => row.scheduled_source === "plan_move"));
});

test("logging a shared completed lesson records separate report time for each child", () => {
  const rows = oneOffLessonRows("family", shared.child_ids, shared, true);
  assert.ok(rows.every((row) => row.completed && row.hours === 1 / 3));
  assert.ok(rows.every((row) => row.completed_at === "2026-09-24T12:00:00Z"));
  assert.throws(() => oneOffLessonRows("family", shared.child_ids, {
    ...shared, curriculum_goal_id: "someone-elses-curriculum",
  }, false));
});
