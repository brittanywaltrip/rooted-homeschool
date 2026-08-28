// Tests for lib/yearbook-page-count.ts, the one page count Today and the
// yearbook reader share.
//
// The reader emits whole spreads and flattens them two pages at a time, so
// every assertion here is really about spreads. The interesting cases are the
// ones where a naive count would drift: a chapter that spends a photo on its
// divider, several children whose keepsake pages must NOT be packed together,
// and a recap whose section headers push it onto another page.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  estimateYearbookPages,
  ALL_SECTIONS_ON,
  COVER_SPREADS,
  CLOSING_SPREADS,
  BACK_COVER_SPREADS,
  VILLAGE_SPREADS,
  LETTER_SPREADS,
  CHILD_OPENER_SPREADS,
  FAMILY_OPENER_SPREADS,
  pageCountFor,
  type BookCounts,
  type BookSections,
} from "./yearbook-page-count.ts";
import { buildChapterPhotoUnits, DEFAULT_MOSAIC_OPTS, type PhotoItem } from "./yearbook-photo-pages.ts";
import { paginateRecap, type YearRecap } from "./year-recap.ts";

/** An empty book: no children, nothing written, nothing photographed. */
function emptyCounts(overrides: Partial<BookCounts> = {}): BookCounts {
  return {
    childPhotoCounts: [],
    familyPhotoCount: 0,
    childBookCounts: [],
    familyBookCount: 0,
    childDrawingCounts: [],
    familyDrawingCount: 0,
    filledInterviewChildren: 0,
    filledFavoriteChildren: [],
    filledKeepsakePages: [],
    hasLetter: false,
    monthlyAnswers: 0,
    tinyMomentLines: 0,
    filledAdventureCategories: 0,
    recapItemCount: 0,
    ...overrides,
  };
}

const SECTIONS_OFF: BookSections = {
  showLetter: false,
  showYearInNumbers: false,
  showChildChapters: false,
  showFavoriteThings: false,
  showBooksSection: false,
  showFamilyChapter: false,
  showVillage: false,
};

// The spreads an empty book still has, with every section enabled: cover,
// letter, the family opener, village, "until next year", and the back cover.
const EMPTY_SPREADS =
  COVER_SPREADS + LETTER_SPREADS + FAMILY_OPENER_SPREADS + VILLAGE_SPREADS + CLOSING_SPREADS + BACK_COVER_SPREADS;

test("an empty book is only its fixed spreads", () => {
  assert.equal(estimateYearbookPages(emptyCounts()), EMPTY_SPREADS * 2);
});

test("with every section off, an empty book is cover + closing + back cover only", () => {
  const fixed = COVER_SPREADS + CLOSING_SPREADS + BACK_COVER_SPREADS;
  assert.equal(estimateYearbookPages(emptyCounts(), SECTIONS_OFF), fixed * 2);
});

test("the result is always even, for every shape of book", () => {
  // A spread is two facing pages, so an odd page count means a page was
  // counted without its partner, the one thing this function must never do.
  for (let photos = 0; photos <= 40; photos++) {
    for (const drawings of [0, 1, 3, 4, 5, 9]) {
      for (const keepsake of [0, 1, 2, 3]) {
        const pages = estimateYearbookPages(
          emptyCounts({
            childPhotoCounts: [photos],
            childDrawingCounts: [drawings],
            childBookCounts: [photos % 3],
            filledFavoriteChildren: [photos % 2 === 0],
            filledKeepsakePages: [keepsake],
            familyPhotoCount: photos % 7,
            monthlyAnswers: photos % 13,
            filledAdventureCategories: photos % 11,
            recapItemCount: photos,
          }),
        );
        assert.equal(pages % 2, 0, `photos=${photos} drawings=${drawings} keepsake=${keepsake} → even`);
      }
    }
  }
});

test("one child with 30 photos: the chapter spends one on the divider and one on favorites", () => {
  const counts = emptyCounts({
    childPhotoCounts: [30],
    childBookCounts: [0],
    childDrawingCounts: [0],
    filledFavoriteChildren: [false],
    filledKeepsakePages: [0],
  });

  // 30 photos: 1 to the full-bleed divider, 1 to favorites, 28 to the collage.
  // 28 photos at 6 per page is 5 pages, bumped to an even 6 → 3 spreads.
  const collageSpreads = 3;
  assert.equal(pageCountFor(28, DEFAULT_MOSAIC_OPTS.maxPerPage), 6);

  const expected =
    EMPTY_SPREADS + CHILD_OPENER_SPREADS + collageSpreads + 1; // +1 favorites (the spared photo faces it)
  assert.equal(estimateYearbookPages(counts), expected * 2);
});

test("three children with unequal photo counts each get their own chapter", () => {
  const counts = emptyCounts({
    childPhotoCounts: [12, 3, 0],
    childBookCounts: [2, 0, 0],
    childDrawingCounts: [0, 5, 0],
    filledFavoriteChildren: [false, false, true],
    filledKeepsakePages: [1, 0, 2],
  });

  // Child 1, 12 photos: divider + favorites + 10 in the collage (2 pages → 1
  // spread), a books spread, and 1 keepsake page (1 spread, facing a filler).
  // Child 2, 3 photos: photo-poor, so a title-panel divider, 1 to favorites,
  // 2 in the collage (1 spread). 5 drawings → 2 gallery pages → 1 spread.
  // Child 3, no photos at all, but has favorites written, plus 2 keepsake
  // pages that pack into a single spread.
  const child1 = CHILD_OPENER_SPREADS + 1 + 1 + 1; // collage + favorites + books, then keepsake
  const child2 = CHILD_OPENER_SPREADS + 1 + 1 + 1; // collage + favorites + art
  const child3 = CHILD_OPENER_SPREADS + 1 + 1; // favorites + keepsake
  const expected = EMPTY_SPREADS + (child1 + 1) + child2 + child3;

  assert.equal(estimateYearbookPages(counts), expected * 2);
});

test("keepsake pages are packed per child, never pooled across children", () => {
  // Two children with one keepsake page each is TWO spreads (each page faces a
  // filler in its own chapter). Pooling them would report one and the book
  // would render two pages more than Today promised.
  const split = estimateYearbookPages(
    emptyCounts({ childPhotoCounts: [0, 0], filledFavoriteChildren: [false, false], filledKeepsakePages: [1, 1] }),
  );
  const pooled = estimateYearbookPages(
    emptyCounts({ childPhotoCounts: [0], filledFavoriteChildren: [false], filledKeepsakePages: [2] }),
  );
  // The split book also carries a second chapter opener, so it is 2 spreads up.
  assert.equal(split - pooled, (CHILD_OPENER_SPREADS + 1) * 2);
});

test("a family with lessons and books but no photos still gets a real book", () => {
  // The learning record is the point: a family who reads and logs but never
  // photographs anything must not be told their book is empty.
  const counts = emptyCounts({
    childPhotoCounts: [0, 0],
    childBookCounts: [14, 9],
    filledFavoriteChildren: [true, true],
    filledKeepsakePages: [0, 0],
    familyBookCount: 4,
    monthlyAnswers: 8,
    tinyMomentLines: 6,
    filledAdventureCategories: 3,
    recapItemCount: 27,
    recapSectionCounts: [27],
  });

  const pages = estimateYearbookPages(counts);
  assert.equal(pages % 2, 0);
  assert.ok(pages > EMPTY_SPREADS * 2, "the record adds pages of its own");
  assert.ok(pages >= 30, `a book this full should be substantial, got ${pages}`);

  // And it is strictly more than the same family with nothing logged.
  assert.ok(pages > estimateYearbookPages(emptyCounts({ childPhotoCounts: [0, 0], filledFavoriteChildren: [false, false], filledKeepsakePages: [0, 0] })));
});

test("turning a section off never adds pages, and turning it on never removes them", () => {
  const counts = emptyCounts({
    childPhotoCounts: [9],
    childBookCounts: [3],
    childDrawingCounts: [2],
    filledFavoriteChildren: [true],
    filledKeepsakePages: [2],
    familyPhotoCount: 5,
    familyBookCount: 1,
    recapItemCount: 10,
  });
  const all = estimateYearbookPages(counts, ALL_SECTIONS_ON);
  for (const key of Object.keys(ALL_SECTIONS_ON) as (keyof BookSections)[]) {
    const off = estimateYearbookPages(counts, { ...ALL_SECTIONS_ON, [key]: false });
    assert.ok(off <= all, `${key} off must not add pages (${off} vs ${all})`);
  }
});

// ─── The photo maths is the reader's, not a copy of it ───────────────────────

test("chapter photo pages come from buildChapterPhotoUnits, not a reimplementation", () => {
  // If the collage rules ever change, this fails rather than letting Today and
  // the book drift apart in silence.
  for (let n = 0; n <= 40; n++) {
    const items: PhotoItem[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, photo_url: "x" }));
    const units = buildChapterPhotoUnits(items, DEFAULT_MOSAIC_OPTS).length;
    assert.equal(units, pageCountFor(n, DEFAULT_MOSAIC_OPTS.maxPerPage), `n=${n}`);
  }
});

test("adding one photo to a chapter never shrinks the book", () => {
  let prev = 0;
  for (let n = 0; n <= 60; n++) {
    const pages = estimateYearbookPages(
      emptyCounts({ childPhotoCounts: [n], filledFavoriteChildren: [false], filledKeepsakePages: [0] }),
    );
    assert.ok(pages >= prev, `photos=${n}: ${pages} < ${prev}`);
    prev = pages;
  }
});

// ─── Recap pagination matches paginateRecap exactly ──────────────────────────

test("recap pages match paginateRecap for every section split", () => {
  // recapPageCount mirrors paginateRecap's line budget without the strings.
  // Run both over a spread of shapes and require identical page counts. A
  // section header costs two lines, so the split really does move the breaks.
  const shapes: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 1], [13, 0, 0], [11, 1, 1], [24, 1, 1],
    [5, 5, 5], [12, 12, 12], [13, 13, 13], [14, 14, 14], [40, 3, 2], [6, 6, 6],
    [0, 7, 0], [2, 0, 9], [30, 30, 30],
  ];
  for (const [books, places, moments] of shapes) {
    const recap: YearRecap = {
      books: Array.from({ length: books }, (_, i) => `Book ${i}`),
      places: Array.from({ length: places }, (_, i) => `Place ${i}`),
      moments: Array.from({ length: moments }, (_, i) => `Moment ${i}`),
    };
    const realPages = paginateRecap(recap).length;
    const realSpreads = Math.ceil(realPages / 2);

    const counts = emptyCounts({
      recapItemCount: books + places + moments,
      recapSectionCounts: [books, places, moments],
    });
    const withRecap = estimateYearbookPages(counts);
    const withoutRecap = estimateYearbookPages(counts, { ...ALL_SECTIONS_ON, showYearInNumbers: false });

    assert.equal(
      (withRecap - withoutRecap) / 2,
      realSpreads,
      `recap ${books}/${places}/${moments}: expected ${realSpreads} spreads`,
    );
  }
});

test("an unsplit recap count is used when the caller has no section split", () => {
  // The documented fallback: treat the items as one section. It is exact for a
  // single-section recap, which is what a books-only family has.
  const recap: YearRecap = {
    books: Array.from({ length: 20 }, (_, i) => `Book ${i}`),
    places: [],
    moments: [],
  };
  const counts = emptyCounts({ recapItemCount: 20 });
  const withRecap = estimateYearbookPages(counts);
  const withoutRecap = estimateYearbookPages(counts, { ...ALL_SECTIONS_ON, showYearInNumbers: false });
  assert.equal((withRecap - withoutRecap) / 2, Math.ceil(paginateRecap(recap).length / 2));
});

// ─── Chunked sections ────────────────────────────────────────────────────────

test("month-by-month, adventures and tiny moments paginate the way the reader chunks them", () => {
  const base = emptyCounts();
  const spreadsFor = (o: Partial<BookCounts>) =>
    (estimateYearbookPages(emptyCounts(o)) - estimateYearbookPages(base)) / 2;

  // 6 months per page, 2 pages per spread → 12 months is one spread.
  assert.equal(spreadsFor({ monthlyAnswers: 1 }), 1);
  assert.equal(spreadsFor({ monthlyAnswers: 12 }), 1);
  assert.equal(spreadsFor({ monthlyAnswers: 13 }), 2);
  // 5 adventures per page.
  assert.equal(spreadsFor({ filledAdventureCategories: 10 }), 1);
  // Tiny moments are one page facing a filler, however many lines.
  assert.equal(spreadsFor({ tinyMomentLines: 1 }), 1);
  assert.equal(spreadsFor({ tinyMomentLines: 40 }), 1);
  assert.equal(spreadsFor({ tinyMomentLines: 0 }), 0);
});
