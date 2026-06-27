// Tests for lib/yearbook-prompts.ts — the guided prompts and their content keys.

import { test } from "node:test";
import assert from "node:assert/strict";

import { YEAR_END_QUESTIONS, FAVORITES, FAVORITES_FROM_INTERVIEW } from "./yearbook-prompts.ts";

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

test("favorites migration maps the two old interview-fed favorites to real keys", () => {
  assert.equal(FAVORITES_FROM_INTERVIEW.book, "q_favorite_book");
  assert.equal(FAVORITES_FROM_INTERVIEW.thing_learned, "q_loved_learning");
  // every migration target is a real favorite key
  for (const favKey of Object.keys(FAVORITES_FROM_INTERVIEW)) {
    assert.ok(FAVORITES.some((f) => f.key === favKey), `${favKey} is a favorite`);
  }
});
