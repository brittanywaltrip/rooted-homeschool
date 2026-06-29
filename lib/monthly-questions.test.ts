// Tests for lib/monthly-questions.ts — deterministic rotation, labels, ranges.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MONTHLY_QUESTIONS,
  monthNumber,
  monthKey,
  questionForMonth,
  monthLabel,
  yearbookMonths,
  monthEntriesFor,
} from "./monthly-questions.ts";

test("12 distinct questions (one per calendar month)", () => {
  assert.equal(MONTHLY_QUESTIONS.length, 12);
  assert.equal(new Set(MONTHLY_QUESTIONS).size, 12);
  assert.ok(MONTHLY_QUESTIONS.every((q) => q.endsWith("?")));
});

test("monthNumber parses YYYY-MM, rejects junk", () => {
  assert.equal(monthNumber("2025-09"), 9);
  assert.equal(monthNumber("2025-01"), 1);
  assert.equal(monthNumber("2025-12"), 12);
  assert.ok(Number.isNaN(monthNumber("2025-13")));
  assert.ok(Number.isNaN(monthNumber("2025-00")));
  assert.ok(Number.isNaN(monthNumber("nope")));
});

test("monthKey formats a date as YYYY-MM", () => {
  assert.equal(monthKey(new Date(2025, 8, 15)), "2025-09"); // month is 0-based
  assert.equal(monthKey(new Date(2026, 0, 1)), "2026-01");
});

test("questionForMonth is deterministic per calendar month", () => {
  assert.equal(questionForMonth("2025-01"), MONTHLY_QUESTIONS[0]);
  assert.equal(questionForMonth("2025-09"), MONTHLY_QUESTIONS[8]);
  assert.equal(questionForMonth("2025-12"), MONTHLY_QUESTIONS[11]);
  // same calendar month, different year → same question (consistent rotation)
  assert.equal(questionForMonth("2026-09"), questionForMonth("2025-09"));
  // malformed → falls back to the first question, never throws
  assert.equal(questionForMonth("garbage"), MONTHLY_QUESTIONS[0]);
});

test("monthLabel renders a friendly label", () => {
  assert.equal(monthLabel("2025-09"), "September 2025");
  assert.equal(monthLabel("2026-01"), "January 2026");
  assert.equal(monthLabel("bad"), "bad");
});

test("monthEntriesFor skips empty months, keeps order, uses stored else default question", () => {
  const answers = {
    "2025-09": { question: "What surprised you?", answer: "the first frost" },
    "2025-11": { question: "", answer: "  pie  " }, // blank stored question → default
    "2025-12": { question: "ignored", answer: "   " }, // empty answer → skipped
    "2026-03": { answer: "longer days" },
  };
  const entries = monthEntriesFor("2025-26", answers);
  assert.deepEqual(entries.map((e) => e.month), ["2025-09", "2025-11", "2026-03"]);
  assert.equal(entries[0].answer, "the first frost");
  assert.equal(entries[1].answer, "pie"); // trimmed
  assert.equal(entries[1].question, questionForMonth("2025-11")); // fell back to default
  assert.equal(entries[2].question, questionForMonth("2026-03"));
});

test("monthEntriesFor → [] when nothing answered", () => {
  assert.deepEqual(monthEntriesFor("2025-26", {}), []);
  assert.deepEqual(monthEntriesFor("2025-26", { "2025-09": { answer: "" } }), []);
});

test("yearbookMonths spans Aug→Jul of the school year, in order", () => {
  const months = yearbookMonths("2025-26");
  assert.equal(months.length, 12);
  assert.equal(months[0], "2025-08");
  assert.equal(months[4], "2025-12");
  assert.equal(months[5], "2026-01");
  assert.equal(months[11], "2026-07");
  assert.deepEqual(yearbookMonths("bad"), []);
});
