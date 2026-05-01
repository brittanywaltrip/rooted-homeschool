import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveLessonSubject } from "./lesson-subject.ts";

test("subjects.name set, goal.subject_label set → returns subjects.name (preferred)", () => {
  assert.equal(resolveLessonSubject("Math", "Mathematics"), "Math");
});

test("subjects.name null, goal.subject_label set → returns goal.subject_label (THE BUG CASE)", () => {
  // This is the bug: 1,730 production lessons across 17 users had
  // subject_id = NULL (so subjects.name was null) while their goal had a
  // populated subject_label. Pre-helper, the loader returned null and the
  // UI bucketed the lesson as "Untitled".
  assert.equal(resolveLessonSubject(null, "Math"), "Math");
});

test("subjects.name set, goal.subject_label null → returns subjects.name", () => {
  assert.equal(resolveLessonSubject("Math", null), "Math");
});

test("both null → returns null", () => {
  assert.equal(resolveLessonSubject(null, null), null);
});

test("both undefined → returns null", () => {
  assert.equal(resolveLessonSubject(undefined, undefined), null);
});

test("both empty string → returns null", () => {
  assert.equal(resolveLessonSubject("", ""), null);
});

test("subjects.name whitespace, goal.subject_label set → falls through to goal label", () => {
  assert.equal(resolveLessonSubject("   ", "Math"), "Math");
});

test("subjects.name set, goal.subject_label whitespace → returns subjects.name", () => {
  assert.equal(resolveLessonSubject("Math", "   "), "Math");
});

test("subjects.name whitespace, goal.subject_label whitespace → returns null", () => {
  assert.equal(resolveLessonSubject("   ", "  "), null);
});

test("trimming: leading/trailing whitespace is stripped from the returned value", () => {
  assert.equal(resolveLessonSubject("  Math  ", null), "Math");
  assert.equal(resolveLessonSubject(null, "  Math  "), "Math");
});

test("undefined for both args (e.g., row missing the join entirely) → returns null", () => {
  assert.equal(resolveLessonSubject(undefined, null), null);
  assert.equal(resolveLessonSubject(null, undefined), null);
});
