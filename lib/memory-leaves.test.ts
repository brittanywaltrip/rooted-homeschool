import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mergeMemoryRecords,
  mergeBookRecords,
  countByChild,
  LEGACY_MEMORY_EVENT_TYPES,
  LEGACY_BOOK_EVENT_TYPES,
} from "./memory-leaves.ts";

const KID_A = "11111111-1111-1111-1111-111111111111";
const KID_B = "22222222-2222-2222-2222-222222222222";

test("books logged since March (memories table) are counted", () => {
  const books = mergeBookRecords(
    [{ child_id: KID_A, type: "book", title: "Charlotte's Web", date: "2026-06-01" }],
    [],
  );
  assert.equal(books.length, 1);
  assert.equal(books[0].title, "Charlotte's Web");
});

test("pre-March legacy books still count", () => {
  const books = mergeBookRecords(
    [],
    [{ type: "book_read", payload: { title: "Frog and Toad", child_id: KID_A, date: "2026-02-10" } }],
  );
  assert.equal(books.length, 1);
  assert.equal(books[0].type, "book");
  assert.equal(books[0].child_id, KID_A);
  assert.equal(books[0].date, "2026-02-10");
});

test("a book in BOTH sources counts once (title + child + date)", () => {
  const books = mergeBookRecords(
    [{ child_id: KID_A, type: "book", title: "Charlotte's Web", date: "2026-03-20" }],
    [{ type: "book_read", payload: { title: "Charlotte's Web", child_id: KID_A, date: "2026-03-20" } }],
  );
  assert.equal(books.length, 1);
});

test("dedupe ignores casing and surrounding space", () => {
  const books = mergeBookRecords(
    [{ child_id: KID_A, type: "book", title: "Charlotte's Web", date: "2026-03-20" }],
    [{ type: "memory_book", payload: { title: "  charlotte's web ", child_id: KID_A, date: "2026-03-20" } }],
  );
  assert.equal(books.length, 1);
});

test("same title on a different date or a different child is NOT a duplicate", () => {
  const differentDate = mergeBookRecords(
    [{ child_id: KID_A, type: "book", title: "Charlotte's Web", date: "2026-03-20" }],
    [{ type: "book_read", payload: { title: "Charlotte's Web", child_id: KID_A, date: "2026-05-02" } }],
  );
  assert.equal(differentDate.length, 2);

  const differentChild = mergeBookRecords(
    [{ child_id: KID_A, type: "book", title: "Charlotte's Web", date: "2026-03-20" }],
    [{ type: "book_read", payload: { title: "Charlotte's Web", child_id: KID_B, date: "2026-03-20" } }],
  );
  assert.equal(differentChild.length, 2);
});

test("the memories row wins a collision, so its child_id survives", () => {
  const books = mergeBookRecords(
    [{ child_id: KID_A, type: "book", title: "Charlotte's Web", date: "2026-03-20" }],
    [{ type: "book_read", payload: { title: "Charlotte's Web", child_id: KID_A, date: "2026-03-20" } }],
  );
  assert.equal(books.length, 1);
  assert.equal(books[0].child_id, KID_A);
});

test("non-book legacy types are merged, never deduped against memories", () => {
  // Two untitled photos on one day for one child are two real photos.
  const records = mergeMemoryRecords(
    [
      { child_id: KID_A, type: "photo", title: null, date: "2026-06-01" },
      { child_id: KID_A, type: "photo", title: null, date: "2026-06-01" },
    ],
    [{ type: "memory_photo", payload: { child_id: KID_A, date: "2026-06-01" } }],
  );
  assert.equal(records.length, 3);
});

test("legacy types map onto their memories-table replacements", () => {
  const records = mergeMemoryRecords(
    [],
    [
      { type: "memory_photo", payload: { child_id: KID_A, date: "2026-01-05" } },
      { type: "memory_project", payload: { child_id: KID_A, date: "2026-01-05" } },
      { type: "memory_field_trip", payload: { child_id: KID_A, date: "2026-01-05" } },
      { type: "memory_activity", payload: { child_id: KID_A, date: "2026-01-05" } },
    ],
  );
  assert.deepEqual(records.map((r) => r.type), ["photo", "project", "field_trip", "activity"]);
});

test("countByChild sums per child and skips whole-family memories", () => {
  const counts = countByChild(
    mergeMemoryRecords(
      [
        { child_id: KID_A, type: "book", title: "A", date: "2026-06-01" },
        { child_id: KID_A, type: "photo", title: null, date: "2026-06-02" },
        { child_id: KID_B, type: "book", title: "B", date: "2026-06-01" },
        { child_id: null, type: "photo", title: null, date: "2026-06-03" },
      ],
      [],
    ),
  );
  assert.deepEqual(counts, { [KID_A]: 2, [KID_B]: 1 });
});

test("null / undefined inputs are treated as empty", () => {
  assert.deepEqual(mergeMemoryRecords(null, undefined), []);
  assert.deepEqual(countByChild([]), {});
});

test("legacy type lists stay in sync with what the readers query", () => {
  assert.deepEqual([...LEGACY_BOOK_EVENT_TYPES], ["book_read", "memory_book"]);
  for (const t of LEGACY_BOOK_EVENT_TYPES) {
    assert.ok(
      (LEGACY_MEMORY_EVENT_TYPES as readonly string[]).includes(t),
      `${t} must also be in LEGACY_MEMORY_EVENT_TYPES`,
    );
  }
});
