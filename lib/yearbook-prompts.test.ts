// Tests for lib/yearbook-prompts.ts — the guided prompts and their content keys.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  YEAR_END_QUESTIONS,
  FAVORITES,
  FAVORITES_FROM_INTERVIEW,
  SNAPSHOT_FIELDS,
  NEVER_FORGET_LINES,
  OPEN_WHEN_PROMPTS,
} from "./yearbook-prompts.ts";

test("Year-End Conversation has the 11 questions with unique keys", () => {
  assert.equal(YEAR_END_QUESTIONS.length, 11);
  const keys = YEAR_END_QUESTIONS.map((q) => q.key);
  assert.equal(new Set(keys).size, 11, "keys are unique");
  assert.ok(YEAR_END_QUESTIONS.every((q) => q.label.endsWith("?")), "each is a question");
});

test("the 'What surprised you?' key is reused so the old answer carries over", () => {
  const q = YEAR_END_QUESTIONS.find((x) => x.label === "What surprised you?");
  assert.ok(q);
  assert.equal(q.key, "q_surprised_you");
});

test("Favorites expanded to ~20 with unique keys, includes Bible verse", () => {
  assert.ok(FAVORITES.length >= 19, "expanded favorites list");
  const keys = FAVORITES.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "keys are unique");
  assert.ok(FAVORITES.some((f) => f.key === "bible_verse"), "Bible verse present (optional)");
  for (const need of ["book", "movie", "song", "thing_learned", "field_trip", "dream_vacation"]) {
    assert.ok(FAVORITES.some((f) => f.key === need), `has ${need}`);
  }
});

test("Wave 2 keepsake prompts: complete sets with unique keys", () => {
  const sets: [string, { key: string; label: string }[], number][] = [
    ["snapshot", SNAPSHOT_FIELDS, 10],
    ["never-forget", NEVER_FORGET_LINES, 9],
    ["open-when", OPEN_WHEN_PROMPTS, 4],
  ];
  for (const [name, list, expected] of sets) {
    assert.equal(list.length, expected, `${name} has ${expected} entries`);
    const keys = list.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length, `${name} keys unique`);
    assert.ok(list.every((p) => p.label.trim().length > 0), `${name} labels non-empty`);
  }
  // a few anchors from the doc
  assert.ok(SNAPSHOT_FIELDS.some((f) => f.key === "signature_phrase"));
  assert.ok(NEVER_FORGET_LINES.some((l) => l.label === "The missing tooth…"));
  assert.ok(OPEN_WHEN_PROMPTS.some((p) => p.key === "chase"));
});

test("favorites migration maps the two old interview-fed favorites to real keys", () => {
  assert.equal(FAVORITES_FROM_INTERVIEW.book, "q_favorite_book");
  assert.equal(FAVORITES_FROM_INTERVIEW.thing_learned, "q_loved_learning");
  // every migration target is a real favorite key
  for (const favKey of Object.keys(FAVORITES_FROM_INTERVIEW)) {
    assert.ok(FAVORITES.some((f) => f.key === favKey), `${favKey} is a favorite`);
  }
});
