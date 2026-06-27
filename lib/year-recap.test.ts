// Tests for lib/year-recap.ts — named lists (no counts), only real items.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildYearRecap, isRecapEmpty, type RecapMemory } from "./year-recap.ts";

test("groups by type into named lists of titles", () => {
  const mems: RecapMemory[] = [
    { type: "book", title: "Charlotte's Web", date: "2025-09-01" },
    { type: "field_trip", title: "Natural History Museum", date: "2025-10-02" },
    { type: "win", title: "Read a whole chapter alone", date: "2025-11-03" },
    { type: "book", title: "The Hobbit", date: "2025-12-01" },
    { type: "photo", title: "should be ignored", date: "2025-09-15" },
  ];
  const r = buildYearRecap(mems);
  assert.deepEqual(r.books, ["Charlotte's Web", "The Hobbit"]);
  assert.deepEqual(r.places, ["Natural History Museum"]);
  assert.deepEqual(r.moments, ["Read a whole chapter alone"]);
});

test("falls back to caption, drops blank/whitespace items", () => {
  const mems: RecapMemory[] = [
    { type: "book", title: "  ", caption: "Goodnight Moon", date: "2025-01-01" },
    { type: "book", title: null, caption: "   ", date: "2025-02-01" }, // no usable text → dropped
    { type: "win", title: "", caption: null, date: "2025-03-01" }, // dropped
  ];
  const r = buildYearRecap(mems);
  assert.deepEqual(r.books, ["Goodnight Moon"]);
  assert.deepEqual(r.moments, []);
});

test("sorts chronologically and collapses case-insensitive duplicates", () => {
  const mems: RecapMemory[] = [
    { type: "book", title: "Frog and Toad", date: "2025-05-01" },
    { type: "book", title: "Dune", date: "2025-01-01" },
    { type: "book", title: "frog and toad", date: "2025-09-01" }, // dup of first
  ];
  assert.deepEqual(buildYearRecap(mems).books, ["Dune", "Frog and Toad"]);
});

test("empty input → empty lists, isRecapEmpty true", () => {
  const r = buildYearRecap([]);
  assert.deepEqual(r, { books: [], places: [], moments: [] });
  assert.equal(isRecapEmpty(r), true);
});

test("isRecapEmpty is false when any list has items", () => {
  assert.equal(isRecapEmpty(buildYearRecap([{ type: "win", title: "Did it!" }])), false);
});

test("no numbers/counts are produced — recap is purely string lists", () => {
  const r = buildYearRecap([{ type: "book", title: "A" }, { type: "book", title: "B" }]);
  for (const v of Object.values(r)) {
    assert.ok(Array.isArray(v) && v.every((x) => typeof x === "string"));
  }
});
