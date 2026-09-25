import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LESSON_UNIT_LABELS,
  formatLessonLabel,
  formatLessonOfTotal,
  formatLessonRange,
  lessonNumberFor,
  lessonPosition,
  lessonUnitFromGoal,
  unitCount,
  unitNounPlural,
} from "./lesson-label.ts";

const MWC = lessonUnitFromGoal({ lesson_unit_label: "week", lessons_per_unit: 4 });

test("a curriculum with no setting reads exactly as before", () => {
  assert.equal(lessonUnitFromGoal({}), null);
  assert.equal(lessonUnitFromGoal(null), null);
  assert.equal(lessonUnitFromGoal({ lesson_unit_label: null, lessons_per_unit: 4 }), null);
  assert.equal(formatLessonLabel(47, null), "Lesson 47");
  assert.equal(formatLessonOfTotal(47, 120, null), "Lesson 47 of 120");
  assert.equal(formatLessonRange(11, 18, null), "Lessons 11 to 18");
  assert.equal(formatLessonRange(11, 18, null, { lower: true }), "lessons 11 to 18");
});

test("Math with Confidence: 4 lessons a week, lesson 47 is Week 12.3", () => {
  assert.deepEqual(MWC, { label: "week", perUnit: 4 });
  assert.equal(formatLessonLabel(45, MWC), "Week 12.1");
  assert.equal(formatLessonLabel(47, MWC), "Week 12.3");
  assert.equal(formatLessonLabel(48, MWC), "Week 12.4");
  assert.equal(formatLessonLabel(49, MWC), "Week 13.1");
  assert.equal(formatLessonLabel(1, MWC), "Week 1.1");
  assert.equal(formatLessonLabel(47, MWC, { lower: true }), "week 12.3");
});

test("one lesson a unit reads as the unit alone", () => {
  const chapters = lessonUnitFromGoal({ lesson_unit_label: "chapter", lessons_per_unit: 1 });
  assert.equal(formatLessonLabel(9, chapters), "Chapter 9");
  assert.equal(formatLessonLabel(9, lessonUnitFromGoal({ lesson_unit_label: "day", lessons_per_unit: null })), "Day 9");
});

test("'Lesson' is never split into parts, and junk settings fall back to the default", () => {
  assert.equal(lessonUnitFromGoal({ lesson_unit_label: "lesson", lessons_per_unit: 4 }), null);
  assert.equal(lessonUnitFromGoal({ lesson_unit_label: "fortnight", lessons_per_unit: 4 }), null);
  assert.deepEqual(lessonUnitFromGoal({ lesson_unit_label: "week", lessons_per_unit: 0 }), { label: "week", perUnit: 1 });
  assert.deepEqual(lessonUnitFromGoal({ lesson_unit_label: "week", lessons_per_unit: 2.5 }), { label: "week", perUnit: 1 });
  assert.deepEqual(lessonUnitFromGoal({ lesson_unit_label: "week", lessons_per_unit: 99 }), { label: "week", perUnit: 1 });
});

test("the label is display only: position and its inverse round-trip for every lesson", () => {
  for (const per of [1, 2, 3, 4, 5, 7]) {
    for (let n = 1; n <= 200; n++) {
      const { unit, part } = lessonPosition(n, per);
      assert.ok(part >= 1 && part <= per);
      assert.equal(lessonNumberFor(unit, part, per), n, `n=${n} per=${per}`);
    }
  }
});

test("labels are unique and in book order, so no two lessons ever read the same", () => {
  const seen = new Set<string>();
  for (let n = 1; n <= 150; n++) seen.add(formatLessonLabel(n, MWC));
  assert.equal(seen.size, 150);
});

test("totals are counted in units: 120 lessons at 4 a week is 30 weeks", () => {
  assert.equal(unitCount(120, 4), 30);
  assert.equal(unitCount(121, 4), 31, "a part-week at the end is still a week");
  assert.equal(formatLessonOfTotal(47, 120, MWC), "Week 12.3 of 30");
  assert.equal(unitNounPlural(MWC), "Weeks");
  assert.equal(unitNounPlural(null, { lower: true }), "lessons");
});

test("ranges name both ends", () => {
  assert.equal(formatLessonRange(11, 18, MWC), "Week 3.3 to Week 5.2");
  assert.equal(formatLessonRange(12, 12, MWC), "Week 3.4");
});

test("a number the formatter cannot place is shown as it is, never hidden", () => {
  assert.equal(formatLessonLabel(0, MWC), "Week 0");
  assert.equal(formatLessonLabel(-3, MWC), "Week -3");
});

test("the word list is the fixed set the database accepts", () => {
  assert.deepEqual([...LESSON_UNIT_LABELS], ["lesson", "week", "day", "unit", "chapter"]);
});

test("stored titles are shown in the curriculum's words and never rewritten", async () => {
  const { displayLessonTitle } = await import("./lesson-label.ts");
  assert.equal(displayLessonTitle("Math with Confidence — Lesson 47", 47, MWC), "Math with Confidence — Week 12.3");
  assert.equal(displayLessonTitle("Math: Lesson 47", 47, MWC), "Math: Week 12.3", "the catch-up paths' shape");
  assert.equal(displayLessonTitle("Math with Confidence — Lesson 47", 47, null), "Math with Confidence — Lesson 47", "no unit: untouched");
  assert.equal(displayLessonTitle("Math with Confidence — Lesson 46", 47, MWC), "Math with Confidence — Lesson 46", "a number that no longer matches the row is shown as saved");
  assert.equal(displayLessonTitle("Fractions review", 47, MWC), "Fractions review", "a family's own title is theirs");
  assert.equal(displayLessonTitle("Math — Lesson 47 notes", 47, MWC), "Math — Lesson 47 notes");
  assert.equal(displayLessonTitle(null, 47, MWC), "");
  assert.equal(displayLessonTitle("Math — Lesson 47", null, MWC), "Math — Lesson 47");
});

test("the builder writes nulls for the default and a clean pair otherwise", async () => {
  const { lessonUnitColumns } = await import("./lesson-label.ts");
  assert.deepEqual(lessonUnitColumns("lesson", 4), { lesson_unit_label: null, lessons_per_unit: null });
  assert.deepEqual(lessonUnitColumns(null, null), { lesson_unit_label: null, lessons_per_unit: null });
  assert.deepEqual(lessonUnitColumns("fortnight", 4), { lesson_unit_label: null, lessons_per_unit: null });
  assert.deepEqual(lessonUnitColumns("week", 4), { lesson_unit_label: "week", lessons_per_unit: 4 });
  assert.deepEqual(lessonUnitColumns("week", 0), { lesson_unit_label: "week", lessons_per_unit: 1 });
  assert.deepEqual(lessonUnitColumns("chapter", 25), { lesson_unit_label: "chapter", lessons_per_unit: 1 });
  // What it writes reads back as what was chosen.
  assert.deepEqual(lessonUnitFromGoal(lessonUnitColumns("week", 4)), { label: "week", perUnit: 4 });
  assert.equal(lessonUnitFromGoal(lessonUnitColumns("lesson", 4)), null);
});

test("the lookup holds only curricula with wording", async () => {
  const { lessonUnitMap } = await import("./lesson-label.ts");
  const map = lessonUnitMap([
    { id: "mwc", lesson_unit_label: "week", lessons_per_unit: 4 },
    { id: "plain", lesson_unit_label: null, lessons_per_unit: null },
    { id: "lesson", lesson_unit_label: "lesson", lessons_per_unit: 3 },
  ]);
  assert.deepEqual([...map.keys()], ["mwc"]);
  assert.deepEqual(map.get("mwc"), { label: "week", perUnit: 4 });
});
