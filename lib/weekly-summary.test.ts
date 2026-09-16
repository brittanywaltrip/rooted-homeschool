// The Monday email's sentences.
//
// Run with: node --test lib/weekly-summary.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { GROWTH_STAGES } from "../app/lib/garden-stages.ts";
import {
  dateInZone,
  gardenLine,
  hadAQuietWeek,
  isoWeekStart,
  lessonsLine,
  memoriesLine,
  memoriesVariable,
  safeTimeZone,
  weeklySubject,
  weekWindow,
} from "./weekly-summary.ts";

test("lessons: one child, two children, three children", () => {
  assert.equal(lessonsLine([{ name: "Zoe", count: 9 }]), "Last week Zoe finished 9 lessons.");
  assert.equal(
    lessonsLine([{ name: "Zoe", count: 9 }, { name: "Emma", count: 8 }]),
    "Last week Zoe finished 9 lessons and Emma finished 8 lessons.",
  );
  assert.equal(
    lessonsLine([{ name: "Zoe", count: 9 }, { name: "Emma", count: 8 }, { name: "Sam", count: 3 }]),
    "Last week Zoe finished 9 lessons, Emma finished 8 lessons, and Sam finished 3 lessons.",
  );
});

test("lessons: one lesson is singular, and a child with none is left out", () => {
  assert.equal(lessonsLine([{ name: "Zoe", count: 1 }]), "Last week Zoe finished 1 lesson.");
  assert.equal(
    lessonsLine([{ name: "Zoe", count: 4 }, { name: "Emma", count: 0 }]),
    "Last week Zoe finished 4 lessons.",
  );
  assert.equal(lessonsLine([{ name: "  ", count: 4 }]), "Last week your family finished 4 lessons.");
});

test("lessons: unassigned lessons are 'your family' only when no child has any", () => {
  assert.equal(lessonsLine([], 6), "Last week your family finished 6 lessons.");
  assert.equal(lessonsLine([], 1), "Last week your family finished 1 lesson.");
  assert.equal(
    lessonsLine([{ name: "Zoe", count: 2 }], 6),
    "Last week Zoe finished 2 lessons.",
    "the child is the story; the unattributed rows are not a second clause",
  );
  assert.equal(lessonsLine([], 0), "");
  assert.equal(lessonsLine([{ name: "Zoe", count: 0 }], 0), "");
});

test("memories: order is photos, wins, books, drawings, then everything else", () => {
  assert.equal(memoriesLine({ photo: 2, win: 1 }), "You captured 2 photos and 1 win.");
  assert.equal(memoriesLine({ drawing: 1, book: 2, photo: 3 }), "You captured 3 photos, 2 books, and 1 drawing.");
  assert.equal(memoriesLine({ moment: 2 }), "You captured 2 wins.", "'moment' is a win by another name");
  assert.equal(
    memoriesLine({ photo: 1, project: 1, field_trip: 2 }),
    "You captured 1 photo and 3 memories.",
    "types with no word of their own are counted together",
  );
  assert.equal(memoriesLine({ project: 1 }), "You captured 1 memory.");
});

test("memories: no memories is an empty string, and no stray space either way", () => {
  assert.equal(memoriesLine({}), "");
  assert.equal(memoriesLine({ photo: 0, win: 0 }), "");
  const lessons = "Last week Zoe finished 9 lessons.";
  assert.equal(memoriesVariable("", lessons), "");
  assert.equal(memoriesVariable("You captured 2 photos.", lessons), " You captured 2 photos.");
  assert.equal(
    memoriesVariable("You captured 2 photos.", ""),
    "You captured 2 photos.",
    "with no lessons sentence it opens the paragraph and takes no leading space",
  );
});

test("garden: the article table, stage by stage", () => {
  // Written out, not derived: "a Growing" and "a Flourishing" are both wrong.
  const expected: Record<string, string> = {
    Seed: "a Seed",
    Sprouting: "Sprouting",
    Seedling: "a Seedling",
    Growing: "Growing",
    "Young Tree": "a Young Tree",
    Flourishing: "Flourishing",
    Blossoming: "Blossoming",
    "Bearing Fruit": "Bearing Fruit",
  };
  for (const stage of GROWTH_STAGES) {
    const line = gardenLine([{ name: "Zoe", leaves: stage.min }]);
    assert.ok(
      line.startsWith(`Zoe's tree is ${expected[stage.name]}`),
      `${stage.name}: got ${JSON.stringify(line)}`,
    );
  }
});

test("garden: the countdown to the next stage, and none at the top", () => {
  assert.equal(gardenLine([{ name: "Zoe", leaves: 46 }]), "Zoe's tree is Growing, 4 leaves from Young Tree.");
  assert.equal(gardenLine([{ name: "Emma", leaves: 13 }]), "Emma's tree is a Seedling, 12 leaves from Growing.");
  assert.equal(gardenLine([{ name: "Sam", leaves: 49 }]), "Sam's tree is Growing, 1 leaf from Young Tree.");
  assert.equal(gardenLine([{ name: "Zoe", leaves: 500 }]), "Zoe's tree is Bearing Fruit.");
  assert.equal(gardenLine([{ name: "Zoe", leaves: 900 }]), "Zoe's tree is Bearing Fruit.");
});

test("garden: several children, a name ending in s, and no children at all", () => {
  assert.equal(
    gardenLine([{ name: "Zoe", leaves: 46 }, { name: "Emma", leaves: 13 }]),
    "Zoe's tree is Growing, 4 leaves from Young Tree. Emma's tree is a Seedling, 12 leaves from Growing.",
  );
  assert.equal(gardenLine([{ name: "Wells", leaves: 0 }]), "Wells' tree is a Seed, 1 leaf from Sprouting.");
  assert.equal(gardenLine([]), "");
  assert.equal(gardenLine([{ name: "   ", leaves: 5 }]), "");
});

test("subject: counts, singulars, and no memories half at zero", () => {
  assert.equal(weeklySubject(9, 3), "Your week with Rooted: 9 lessons, 3 memories");
  assert.equal(weeklySubject(1, 1), "Your week with Rooted: 1 lesson, 1 memory");
  assert.equal(weeklySubject(4, 0), "Your week with Rooted: 4 lessons");
  assert.equal(weeklySubject(0, 2), "Your week with Rooted: 0 lessons, 2 memories");
});

test("the week is the Monday to Sunday before the send, in her timezone", () => {
  // Monday 2026-09-21, 15:00 UTC: the send. In Chicago it is still Monday.
  const send = new Date("2026-09-21T15:00:00Z");
  assert.deepEqual(weekWindow(send, "America/Chicago"), { start: "2026-09-14", end: "2026-09-20" });
  assert.deepEqual(weekWindow(send, "America/Los_Angeles"), { start: "2026-09-14", end: "2026-09-20" });
  // Auckland is already Tuesday, and the week just ended is still the same one.
  assert.equal(dateInZone(send, "Pacific/Auckland"), "2026-09-22");
  assert.deepEqual(weekWindow(send, "Pacific/Auckland"), { start: "2026-09-14", end: "2026-09-20" });
  // A manual run mid-week still reports the last whole week.
  assert.deepEqual(weekWindow(new Date("2026-09-24T12:00:00Z"), "America/Chicago"), {
    start: "2026-09-14",
    end: "2026-09-20",
  });
});

test("the dedup key is the Monday of the send's own week", () => {
  assert.equal(isoWeekStart(new Date("2026-09-21T15:00:00Z"), "America/Chicago"), "2026-09-21");
  assert.equal(isoWeekStart(new Date("2026-09-24T12:00:00Z"), "America/Chicago"), "2026-09-21");
  assert.equal(isoWeekStart(new Date("2026-09-28T15:00:00Z"), "America/Chicago"), "2026-09-28");
});

test("a broken timezone falls back to US Pacific, and a quiet week is lessons and memories both zero", () => {
  assert.equal(safeTimeZone("Mars/Olympus"), "America/Los_Angeles");
  assert.equal(safeTimeZone(null), "America/Los_Angeles");
  assert.equal(safeTimeZone("Pacific/Auckland"), "Pacific/Auckland");
  assert.equal(hadAQuietWeek(0, 0), true);
  assert.equal(hadAQuietWeek(1, 0), false);
  assert.equal(hadAQuietWeek(0, 1), false);
});
