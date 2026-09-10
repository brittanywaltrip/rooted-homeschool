// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { lostLessonRows, expectedLessonRowCount, countCompletedBelowStart } from "./lost-lesson-rows.ts";

const counts = (totalLessons: number, startAtLesson: number, completedBelowStart: number, rows: number) => ({
  totalLessons,
  startAtLesson,
  completedBelowStart,
  rows,
});

test("expected rows = total - start + 1, plus kept completed history", () => {
  assert.equal(expectedLessonRowCount({ totalLessons: 57, startAtLesson: 3, completedBelowStart: 2 }), 57);
  assert.equal(expectedLessonRowCount({ totalLessons: 57, startAtLesson: 5, completedBelowStart: 2 }), 55);
  assert.equal(expectedLessonRowCount({ totalLessons: 57, startAtLesson: 1, completedBelowStart: 0 }), 57);
  // Finished curriculum: start = total + 1, only the history remains.
  assert.equal(expectedLessonRowCount({ totalLessons: 57, startAtLesson: 58, completedBelowStart: 57 }), 57);
});

test("moving start_at_lesson 3 -> 5 on a 57-lesson goal, 57 -> 55 rows: no report", () => {
  // The September 2026 false positive. Lessons 1-2 were completed and kept;
  // the uncompleted rows in slots 3 and 4 were correctly removed.
  assert.equal(lostLessonRows(counts(57, 3, 2, 57), counts(57, 5, 2, 55)), null);
});

test("start_at_lesson unchanged at 5, 55 -> 53 rows: report, expected 55", () => {
  const report = lostLessonRows(counts(57, 5, 2, 55), counts(57, 5, 2, 53));
  assert.ok(report);
  assert.equal(report.expectedAfter, 55);
  assert.equal(report.allowedDrop, 0);
  assert.equal(report.actualDrop, 2);
});

test("reducing total_lessons excuses exactly that many rows", () => {
  assert.equal(lostLessonRows(counts(57, 1, 0, 57), counts(50, 1, 0, 50)), null);
  assert.ok(lostLessonRows(counts(57, 1, 0, 57), counts(50, 1, 0, 49)));
});

test("an ungenerated tail is not a loss", () => {
  // Projector writes forward only: 30 of 57 rows on both sides, nothing lost.
  assert.equal(lostLessonRows(counts(57, 1, 0, 30), counts(57, 1, 0, 30)), null);
  // Same goal, start moved forward two: the two-row drop is the expected drop.
  assert.equal(lostLessonRows(counts(57, 3, 2, 30), counts(57, 5, 2, 28)), null);
  // But losing three when only two were removable is still a loss.
  assert.ok(lostLessonRows(counts(57, 3, 2, 30), counts(57, 5, 2, 27)));
});

test("a goal that grew is never reported", () => {
  assert.equal(lostLessonRows(counts(57, 1, 0, 30), counts(57, 1, 0, 57)), null);
});

test("countCompletedBelowStart counts only completed rows below the start", () => {
  const rows = [
    { lesson_number: 1, completed: true },
    { lesson_number: 2, completed: true },
    { lesson_number: 3, completed: false },
    { lesson_number: 4, completed: true },
    { lesson_number: null, completed: true },
  ];
  assert.equal(countCompletedBelowStart(rows, 5), 3);
  assert.equal(countCompletedBelowStart(rows, 3), 2);
  assert.equal(countCompletedBelowStart(rows, 1), 0);
});
