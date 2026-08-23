import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mergeMemoryRecords,
  mergeBookRecords,
  countByChild,
  bookBelongsToChild,
  bookCover,
  bookHowLabel,
  ratingLeaves,
  LEGACY_MEMORY_EVENT_TYPES,
  LEGACY_BOOK_EVENT_TYPES,
} from "./memory-leaves.ts";

const KID_A = "11111111-1111-1111-1111-111111111111";
const KID_B = "22222222-2222-2222-2222-222222222222";
const KID_C = "33333333-3333-3333-3333-333333333333";

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

test("id and caption pass through without joining the dedupe key", () => {
  const records = mergeMemoryRecords(
    [{ id: "mem-1", child_id: KID_A, type: "photo", title: null, caption: "at the creek", date: "2026-06-01" }],
    [{ id: "evt-1", type: "memory_field_trip", payload: { caption: "the aquarium", child_id: KID_A, date: "2026-06-02" } }],
  );
  assert.deepEqual(records.map((r) => r.id), ["mem-1", "evt-1"]);
  assert.deepEqual(records.map((r) => r.caption), ["at the creek", "the aquarium"]);

  // Same book, different ids and captions in each table — still one book.
  const books = mergeBookRecords(
    [{ id: "mem-2", child_id: KID_A, type: "book", title: "Charlotte's Web", caption: "Author: E.B. White", date: "2026-03-20" }],
    [{ id: "evt-2", type: "book_read", payload: { title: "Charlotte's Web", caption: "different note", child_id: KID_A, date: "2026-03-20" } }],
  );
  assert.equal(books.length, 1);
  assert.equal(books[0].id, "mem-2");
});

test("records with no id selected are still well formed", () => {
  const records = mergeMemoryRecords(
    [{ child_id: KID_A, type: "photo", title: null, date: "2026-06-01" }],
    [{ type: "memory_photo", payload: { child_id: KID_A, date: "2026-06-02" } }],
  );
  assert.deepEqual(records.map((r) => r.id), [null, null]);
  assert.deepEqual(records.map((r) => r.caption), [null, null]);
  assert.deepEqual(records.map((r) => r.photo_url), [null, null]);
});

test("photo_url passes through from both sources and never joins the dedupe key", () => {
  const records = mergeMemoryRecords(
    [{ id: "mem-1", child_id: KID_A, type: "book", title: "A", photo_url: "covers/a.jpg", date: "2026-06-01" }],
    [{ id: "evt-1", type: "book_read", payload: { title: "B", photo_url: "legacy/b.jpg", child_id: KID_A, date: "2026-06-02" } }],
  );
  assert.deepEqual(records.map((r) => r.photo_url), ["covers/a.jpg", "legacy/b.jpg"]);

  // Same book, cover on one side only — still one book, and the memories
  // row's cover is the one that survives.
  const books = mergeBookRecords(
    [{ id: "mem-2", child_id: KID_A, type: "book", title: "Charlotte's Web", photo_url: "covers/cw.jpg", date: "2026-03-20" }],
    [{ id: "evt-2", type: "book_read", payload: { title: "Charlotte's Web", child_id: KID_A, date: "2026-03-20" } }],
  );
  assert.equal(books.length, 1);
  assert.equal(books[0].photo_url, "covers/cw.jpg");
});

test("null / undefined inputs are treated as empty", () => {
  assert.deepEqual(mergeMemoryRecords(null, undefined), []);
  assert.deepEqual(countByChild([]), {});
});

// ─── Multi-child attribution (book_child_ids) ────────────────────────────────

/** Build one merged book record through the real code path. */
function bookRecord(row: Record<string, unknown>) {
  return mergeBookRecords([{ type: "book", child_id: null, ...row } as never], [])[0];
}

test("book_child_ids set: counts for exactly those children and no others", () => {
  const b = bookRecord({ title: "Read aloud", date: "2026-08-01", book_child_ids: [KID_A, KID_B] });
  assert.equal(bookBelongsToChild(b, KID_A), true);
  assert.equal(bookBelongsToChild(b, KID_B), true);
  // The rule that matters: a child NOT named never sees it.
  assert.equal(bookBelongsToChild(b, KID_C), false);
});

test("book_child_ids set does NOT fall back to child_id", () => {
  // A row where the two disagree must honour the array, not the legacy column.
  const b = bookRecord({ title: "X", date: "2026-08-01", child_id: KID_C, book_child_ids: [KID_A] });
  assert.equal(bookBelongsToChild(b, KID_A), true);
  assert.equal(bookBelongsToChild(b, KID_C), false);
});

test("book_child_ids null + child_id set: legacy single-child rules", () => {
  const b = bookRecord({ title: "Solo", date: "2026-08-01", child_id: KID_A });
  assert.equal(bookBelongsToChild(b, KID_A), true);
  assert.equal(bookBelongsToChild(b, KID_B), false);
});

test("both null: whole family, counts for every child", () => {
  const b = bookRecord({ title: "Family read", date: "2026-08-01" });
  assert.equal(bookBelongsToChild(b, KID_A), true);
  assert.equal(bookBelongsToChild(b, KID_B), true);
  assert.equal(bookBelongsToChild(b, KID_C), true);
});

test("an empty book_child_ids array means whole family, not nobody", () => {
  const b = bookRecord({ title: "Empty array", date: "2026-08-01", book_child_ids: [] });
  assert.equal(b.book_child_ids, null);
  assert.equal(bookBelongsToChild(b, KID_A), true);
});

test('the "all" sentinel and null match everything', () => {
  const b = bookRecord({ title: "X", date: "2026-08-01", book_child_ids: [KID_A] });
  assert.equal(bookBelongsToChild(b, "all"), true);
  assert.equal(bookBelongsToChild(b, null), true);
});

test("legacy app_events books have no array and keep child_id rules", () => {
  const [b] = mergeBookRecords(
    [],
    [{ type: "book_read", payload: { title: "Old", child_id: KID_A, date: "2026-02-01" } }],
  );
  assert.equal(b.book_child_ids, null);
  assert.equal(bookBelongsToChild(b, KID_A), true);
  assert.equal(bookBelongsToChild(b, KID_B), false);
});

test("countByChild credits every child named in book_child_ids", () => {
  const counts = countByChild(
    mergeBookRecords(
      [
        { type: "book", child_id: null, title: "Aloud", date: "2026-08-01", book_child_ids: [KID_A, KID_B] },
        { type: "book", child_id: KID_A, title: "Solo", date: "2026-08-02" },
        { type: "book", child_id: null, title: "Family", date: "2026-08-03" },
      ] as never,
      [],
    ),
  );
  // Aloud credits A and B; Solo credits A; Family credits nobody.
  assert.deepEqual(counts, { [KID_A]: 2, [KID_B]: 1 });
});

test("structured book fields pass through the merge", () => {
  const b = bookRecord({
    title: "Charlotte's Web", date: "2026-08-01",
    book_author: "E.B. White", book_pages: 192, book_cover_url: "https://covers/x-M.jpg",
  });
  assert.equal(b.book_author, "E.B. White");
  assert.equal(b.book_pages, 192);
  assert.equal(b.book_cover_url, "https://covers/x-M.jpg");
});

test("the dedupe key still needs no book_child_ids component", () => {
  // book_child_ids only exists on rows written after August 2026, and legacy
  // app_events books stopped in March 2026, so a row carrying the array can
  // never have a legacy twin to collide with. Same title + date + null
  // child_id across the two sources is still one book.
  const books = mergeBookRecords(
    [{ type: "book", child_id: null, title: "Shared", date: "2026-03-20", book_child_ids: [KID_A, KID_B] } as never],
    [{ type: "book_read", payload: { title: "Shared", date: "2026-03-20" } }],
  );
  assert.equal(books.length, 1);
  assert.deepEqual(books[0].book_child_ids, [KID_A, KID_B]);
});

// ─── Cover order ─────────────────────────────────────────────────────────────

test("cover order: the family's own photo beats the Open Library cover", () => {
  assert.deepEqual(
    bookCover({ photo_url: "user/abc.jpg", book_cover_url: "https://covers/x-M.jpg" }),
    { kind: "photo", src: "user/abc.jpg" },
  );
  assert.deepEqual(
    bookCover({ photo_url: null, book_cover_url: "https://covers/x-M.jpg" }),
    { kind: "external", src: "https://covers/x-M.jpg" },
  );
  assert.equal(bookCover({ photo_url: null, book_cover_url: null }), null);
  assert.equal(bookCover({}), null);
});

// ─── Display helpers ─────────────────────────────────────────────────────────

test("bookHowLabel maps every stored value and refuses unknown ones", () => {
  assert.equal(bookHowLabel("read_aloud"), "Read aloud");
  assert.equal(bookHowLabel("read_together"), "Read together");
  assert.equal(bookHowLabel("independent"), "Independent");
  assert.equal(bookHowLabel("audiobook"), "Audiobook");
  assert.equal(bookHowLabel("assigned"), "Assigned");
  // Null rather than echoing a raw enum value into the UI.
  assert.equal(bookHowLabel("something_else"), null);
  assert.equal(bookHowLabel(null), null);
  assert.equal(bookHowLabel(undefined), null);
  assert.equal(bookHowLabel(""), null);
});

test("ratingLeaves renders one leaf per point and nothing when unset", () => {
  assert.equal(ratingLeaves(1), "🌿");
  assert.equal(ratingLeaves(4), "🌿🌿🌿🌿");
  assert.equal(ratingLeaves(5), "🌿🌿🌿🌿🌿");
  assert.equal(ratingLeaves(null), "");
  assert.equal(ratingLeaves(undefined), "");
  // Out of range can only arrive from a hand-edited row; render nothing.
  assert.equal(ratingLeaves(0), "");
  assert.equal(ratingLeaves(9), "");
});

test("book_how / rating / notes pass through the merge, rating clamped", () => {
  const good = bookRecord({
    title: "X", date: "2026-08-01",
    book_how: "audiobook", book_rating: 3, book_notes: "loved it",
  });
  assert.equal(good.book_how, "audiobook");
  assert.equal(good.book_rating, 3);
  assert.equal(good.book_notes, "loved it");

  // A rating the check constraint would have rejected is dropped, not shown.
  const bad = bookRecord({ title: "Y", date: "2026-08-01", book_rating: 11 });
  assert.equal(bad.book_rating, null);
  assert.equal(ratingLeaves(bad.book_rating), "");
});

test("legacy books carry no how / rating / notes", () => {
  const [b] = mergeBookRecords(
    [],
    [{ type: "book_read", payload: { title: "Old", date: "2026-02-01" } }],
  );
  assert.equal(b.book_how, null);
  assert.equal(b.book_rating, null);
  assert.equal(b.book_notes, null);
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
