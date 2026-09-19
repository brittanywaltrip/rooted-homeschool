// The shared count formatter. These are the exact phrases the audit found
// broken in production, pinned so they cannot regress.

import { test } from "node:test";
import assert from "node:assert/strict";

import { countLabel, pluralize, pluralOf } from "./plural.ts";

test("memory: the phrase the dashboard, memories grid and year-end page render", () => {
  assert.equal(countLabel(0, "memory"), "0 memories");
  assert.equal(countLabel(1, "memory"), "1 memory");
  assert.equal(countLabel(2, "memory"), "2 memories");
  assert.equal(countLabel(24, "memory"), "24 memories");
});

test("leaf: never 'leafs'", () => {
  assert.equal(pluralOf("leaf"), "leaves");
  assert.equal(countLabel(1, "leaf"), "1 leaf");
  assert.equal(countLabel(9, "leaf"), "9 leaves");
  assert.equal(countLabel(0, "leaf"), "0 leaves");
});

test("the garden's 'N more leaf/leaves to go' sentence", () => {
  const toGo = (n: number) => `${countLabel(n, "leaf")} to go`;
  assert.equal(toGo(1), "1 leaf to go");
  assert.equal(toGo(9), "9 leaves to go");
});

test("regular nouns still take a plain -s", () => {
  assert.equal(countLabel(1, "lesson"), "1 lesson");
  assert.equal(countLabel(3, "lesson"), "3 lessons");
  assert.equal(countLabel(2, "photo"), "2 photos");
  assert.equal(countLabel(2, "day"), "2 days");
});

test("consonant + y takes -ies, vowel + y does not", () => {
  assert.equal(pluralOf("memory"), "memories");
  assert.equal(pluralOf("story"), "stories");
  assert.equal(pluralOf("family"), "families");
  assert.equal(pluralOf("day"), "days");
  assert.equal(pluralOf("journey"), "journeys");
});

test("sibilant endings take -es", () => {
  assert.equal(pluralOf("class"), "classes");
  assert.equal(pluralOf("box"), "boxes");
  assert.equal(pluralOf("branch"), "branches");
  assert.equal(pluralOf("brush"), "brushes");
});

test("irregulars Rooted actually shows a family", () => {
  assert.equal(pluralOf("child"), "children");
  assert.equal(countLabel(1, "child"), "1 child");
  assert.equal(countLabel(3, "child"), "3 children");
  assert.equal(pluralOf("person"), "people");
});

test("capitalization is preserved", () => {
  assert.equal(pluralOf("Memory"), "Memories");
  assert.equal(pluralOf("Leaf"), "Leaves");
  assert.equal(pluralOf("Lesson"), "Lessons");
  assert.equal(pluralOf("LEAF"), "LEAVES");
});

test("an explicit plural overrides the derived one", () => {
  assert.equal(countLabel(2, "is", "are"), "2 are");
  assert.equal(countLabel(1, "is", "are"), "1 is");
});

test("pluralize returns the bare noun, countLabel prefixes the number", () => {
  assert.equal(pluralize(1, "memory"), "memory");
  assert.equal(pluralize(5, "memory"), "memories");
  assert.equal(countLabel(5, "memory"), "5 memories");
});

test("the number is rendered exactly as passed, with no locale grouping", () => {
  // Adopting the helper must not silently re-format existing counts.
  assert.equal(countLabel(1200, "memory"), "1200 memories");
});
