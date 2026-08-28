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
  CLOSING_NOTE_SPREADS,
  BACK_COVER_SPREADS,
  LETTER_SPREADS,
  CHILD_OPENER_SPREADS,
  FAMILY_OPENER_SPREADS,
  pageCountFor,
  type BookCounts,
  type BookSections,
} from "./yearbook-page-count.ts";
import { buildChapterPhotoUnits, planChapterPhotos, DEFAULT_MOSAIC_OPTS, type PhotoItem } from "./yearbook-photo-pages.ts";
import { paginateRecap, type YearRecap } from "./year-recap.ts";
import {
  paginateLetter,
  paginateByLineBudget,
  estimateLines,
  INTERVIEW_PER_PAGE,
  KEEPSAKE_LINES_PER_PAGE,
  YEAR_END_QUESTIONS,
} from "./yearbook-prompts.ts";

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
    childInterviewAnswers: [],
    filledFavoriteChildren: [],
    filledKeepsakePages: [],
    hasLetter: false,
    hasFavoriteDay: false,
    familyWinCount: 0,
    hasClosingNote: false,
    letterPages: 0,
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
};

// An EMPTY book is now the cover and the back cover, and nothing else. No
// letter (nothing written), no family opener (no wins to list), no village (it
// is gone) and no closing note (nothing to count). That is the whole point of
// this pass: a book with no content prints no pages of prompts.
const EMPTY_SPREADS = COVER_SPREADS + BACK_COVER_SPREADS;

test("an empty book is only its fixed spreads", () => {
  assert.equal(estimateYearbookPages(emptyCounts()), EMPTY_SPREADS * 2);
});

test("with every section off, an empty book is cover + back cover only", () => {
  const fixed = COVER_SPREADS + BACK_COVER_SPREADS;
  assert.equal(estimateYearbookPages(emptyCounts(), SECTIONS_OFF), fixed * 2);
});

test("a book with nothing in it is the cover and the back cover, nothing else", () => {
  // Four pages: no letter spread, no family opener, no closing note, and the
  // village spread does not exist any more. Before this pass the same family
  // got twelve pages, ten of them placeholders and blank ruled lines.
  assert.equal(estimateYearbookPages(emptyCounts()), 4);
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

test("one child with 30 photos and nothing written keeps every photo in the collage", () => {
  const counts = emptyCounts({
    childPhotoCounts: [30],
    childBookCounts: [0],
    childDrawingCounts: [0],
    filledFavoriteChildren: [false],
    filledKeepsakePages: [0],
    childInterviewAnswers: [0],
  });

  // No favorites written, so no favorites spread AND no photo reserved for it:
  // 1 goes to the full-bleed divider and the other 29 stay in the collage.
  // 29 at 6 per page is 5 pages, bumped to an even 6, so 3 spreads.
  assert.equal(pageCountFor(29, DEFAULT_MOSAIC_OPTS.maxPerPage), 6);
  const expected = EMPTY_SPREADS + CHILD_OPENER_SPREADS + 3;
  assert.equal(estimateYearbookPages(counts), expected * 2);
});

test("writing favorites is what buys the favorites spread, and the photo to face it", () => {
  const base = { childPhotoCounts: [30], filledKeepsakePages: [0], childInterviewAnswers: [0] };
  const without = estimateYearbookPages(emptyCounts({ ...base, filledFavoriteChildren: [false] }));
  const withFavs = estimateYearbookPages(emptyCounts({ ...base, filledFavoriteChildren: [true] }));
  // 28 in the collage instead of 29 is still 6 pages, so the only difference is
  // the favorites spread itself.
  assert.equal(pageCountFor(28, DEFAULT_MOSAIC_OPTS.maxPerPage), 6);
  assert.equal(withFavs - without, 2, "one spread, and only when there is something on it");
});

test("three children with unequal photo counts each get their own chapter", () => {
  const counts = emptyCounts({
    childPhotoCounts: [12, 3, 0],
    childBookCounts: [2, 0, 0],
    childDrawingCounts: [0, 5, 0],
    filledFavoriteChildren: [false, false, true],
    filledKeepsakePages: [1, 0, 2],
    childInterviewAnswers: [0, 0, 0],
  });

  // Child 1, 12 photos, no favorites written: divider + 11 in the collage
  // (2 pages → 1 spread), a books spread, and 1 keepsake page facing a blank.
  // Child 2, 3 photos, no favorites written: a title-panel divider and all 3
  // in the collage (1 spread). 5 drawings → 2 gallery pages → 1 spread.
  // Child 3, no photos, but favorites written, plus 2 keepsake pages.
  assert.equal(pageCountFor(11, DEFAULT_MOSAIC_OPTS.maxPerPage), 2);
  assert.equal(pageCountFor(3, DEFAULT_MOSAIC_OPTS.maxPerPage), 2);
  const child1 = CHILD_OPENER_SPREADS + 1 + 1 + 1; // collage + books + keepsake
  const child2 = CHILD_OPENER_SPREADS + 1 + 1; // collage + art
  const child3 = CHILD_OPENER_SPREADS + 1 + 1; // favorites + keepsake
  const expected = EMPTY_SPREADS + child1 + child2 + child3;

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
    childInterviewAnswers: [0, 0],
    // 23 books read is plenty to close a year on.
    hasClosingNote: true,
  });

  const pages = estimateYearbookPages(counts);
  assert.equal(pages % 2, 0);
  assert.ok(pages > EMPTY_SPREADS * 2, "the record adds pages of its own");
  assert.ok(pages >= 26, `a book this full should be substantial, got ${pages}`);

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

// ─── Print correctness: nothing is clamped, so long text costs pages ─────────

test("an unwritten letter prints no letter spread at all", () => {
  const base = estimateYearbookPages(emptyCounts());
  assert.equal(estimateYearbookPages(emptyCounts({ letterPages: 0 })), base);
  // Writing one buys exactly one spread; it used to print either way, with an
  // envelope emoji asking the family to write it.
  assert.equal(estimateYearbookPages(emptyCounts({ letterPages: 1 })), base + 2);
});

test("a chosen favourite day prints the letter spread even with no letter", () => {
  const base = estimateYearbookPages(emptyCounts());
  assert.equal(estimateYearbookPages(emptyCounts({ hasFavoriteDay: true })), base + 2);
  // And the two together are still one spread, not two.
  assert.equal(estimateYearbookPages(emptyCounts({ hasFavoriteDay: true, letterPages: 1 })), base + 2);
});

test("a long letter adds continuation spreads instead of losing its ending", () => {
  const spreadsFor = (letterPages: number) =>
    (estimateYearbookPages(emptyCounts({ letterPages })) - estimateYearbookPages(emptyCounts())) / 2;
  // One page is the letter spread itself; pages 2..n pair off after it, with a
  // blank leaf facing a lone trailing page.
  assert.equal(spreadsFor(1), 1);
  assert.equal(spreadsFor(2), 2);
  assert.equal(spreadsFor(3), 2);
  assert.equal(spreadsFor(4), 3);
  assert.equal(spreadsFor(7), 4);
  // And the count never goes backwards as the letter grows.
  let prev = 0;
  for (let n = 0; n <= 20; n++) {
    const pages = estimateYearbookPages(emptyCounts({ letterPages: n }));
    assert.ok(pages >= prev, `letterPages=${n}`);
    prev = pages;
  }
});

test("the letter costs nothing when the section is switched off", () => {
  const off = { ...ALL_SECTIONS_ON, showLetter: false };
  assert.equal(
    estimateYearbookPages(emptyCounts({ letterPages: 9 }), off),
    estimateYearbookPages(emptyCounts({ letterPages: 0 }), off),
  );
});

test("paginateLetter never loses a word and always terminates", () => {
  const cases = [
    "",
    "   ",
    "One short line.",
    Array.from({ length: 12 }, (_, i) => `Paragraph number ${i}. `.repeat(6)).join("\n\n"),
    "x".repeat(4000), // one unbroken run, longer than any page
    "word ".repeat(1500).trim(),
  ];
  for (const text of cases) {
    const pages = paginateLetter(text);
    const rejoined = pages.join(" ").replace(/\s+/g, "");
    assert.equal(rejoined, text.replace(/\s+/g, ""), `nothing dropped for a ${text.length}-char letter`);
    if (text.trim()) assert.ok(pages.length >= 1);
    else assert.equal(pages.length, 0);
  }
});

test("every answered year-end question is printed, not the first six", () => {
  const spreadsFor = (answers: number) =>
    (estimateYearbookPages(emptyCounts({ childInterviewAnswers: [answers], filledFavoriteChildren: [false], filledKeepsakePages: [0], childPhotoCounts: [0] })) -
      estimateYearbookPages(emptyCounts({ childInterviewAnswers: [0], filledFavoriteChildren: [false], filledKeepsakePages: [0], childPhotoCounts: [0] }))) / 2;
  // The opener's right page holds the first INTERVIEW_PER_PAGE for free.
  assert.equal(spreadsFor(INTERVIEW_PER_PAGE), 0);
  // Answering more used to cost nothing because the extras were dropped.
  assert.equal(spreadsFor(INTERVIEW_PER_PAGE + 1), 1);
  assert.equal(spreadsFor(YEAR_END_QUESTIONS.length), 1);
  // Two full continuation pages still pair into one spread.
  assert.equal(spreadsFor(INTERVIEW_PER_PAGE * 3), 1);
  assert.equal(spreadsFor(INTERVIEW_PER_PAGE * 4), 2);
});

test("keepsake pages are page counts now, so a long answer lengthens the book", () => {
  const short = { prompt: "Your laugh…", value: "is the best sound in the house." };
  const long = { prompt: "Your laugh…", value: "is the best sound in the house. ".repeat(20) };
  const cost = (l: { prompt: string; value: string }) => estimateLines(`${l.prompt} ${l.value}`);

  const shortPages = paginateByLineBudget(Array.from({ length: 6 }, () => short), cost, KEEPSAKE_LINES_PER_PAGE).length;
  const longPages = paginateByLineBudget(Array.from({ length: 6 }, () => long), cost, KEEPSAKE_LINES_PER_PAGE).length;
  assert.ok(longPages > shortPages, "long answers need more pages than short ones");

  const withShort = estimateYearbookPages(emptyCounts({ childPhotoCounts: [0], filledFavoriteChildren: [false], filledKeepsakePages: [shortPages] }));
  const withLong = estimateYearbookPages(emptyCounts({ childPhotoCounts: [0], filledFavoriteChildren: [false], filledKeepsakePages: [longPages] }));
  assert.ok(withLong > withShort, "and the book gets longer, rather than the text getting cut");
});

test("paginateByLineBudget keeps every item and never drops an oversized one", () => {
  const items = [1, 20, 2, 3, 40, 1];
  const pages = paginateByLineBudget(items, (n) => n, 10);
  assert.deepEqual(pages.flat(), items, "every item survives, in order");
  for (const page of pages) assert.ok(page.length >= 1);
  assert.deepEqual(paginateByLineBudget([], () => 1, 10), []);
});

test("the result is still always even once letters and conversations paginate", () => {
  for (const letterPages of [0, 1, 2, 3, 8]) {
    for (const answers of [0, 3, 6, 7, 11]) {
      for (const keepsake of [0, 1, 3, 5]) {
        const pages = estimateYearbookPages(
          emptyCounts({
            letterPages,
            childInterviewAnswers: [answers, answers],
            childPhotoCounts: [4, 0],
            filledFavoriteChildren: [true, false],
            filledKeepsakePages: [keepsake, 0],
          }),
        );
        assert.equal(pages % 2, 0, `letter=${letterPages} answers=${answers} keepsake=${keepsake}`);
      }
    }
  }
});

// ─── The drift detector's own question, asked here ──────────────────────────
//
// The reader compares its rendered pages.length against estimateYearbookPages
// and reports any gap to Sentry. That check only helps if the estimator really
// does mirror the reader's assembly, so this walks the reader's spread pushes
// in the order they appear in app/dashboard/memories/yearbook/read/page.tsx and
// requires the same answer. It is transcribed from the reader, not from the
// estimator, so an arithmetic slip in either one shows up here rather than in
// production as a family being told the wrong length.

interface ReaderShape {
  children: {
    photos: number;
    books: number;
    drawings: number;
    hasFavorites: boolean;
    keepsakePages: number;
    interviewAnswers: number;
  }[];
  familyPhotos: number;
  familyBooks: number;
  familyDrawings: number;
  familyWins: number;
  letterPages: number;
  hasFavoriteDay: boolean;
  hasClosingNote: boolean;
  monthlyAnswers: number;
  tinyMomentLines: number;
  adventures: number;
  recap: [number, number, number];
}

/** Spreads the reader pushes, in the reader's own order. */
function readerSpreadCount(shape: ReaderShape, sections: BookSections): number {
  let n = 0;
  const chunkedSpreads = (items: number, perPage: number) =>
    items <= 0 ? 0 : Math.ceil(Math.ceil(items / perPage) / 2);

  // 2. the letter spread, only when one of its two sides has content
  if (sections.showLetter && (shape.letterPages > 0 || shape.hasFavoriteDay)) {
    n += 1;
    if (shape.letterPages > 1) n += Math.ceil((shape.letterPages - 1) / 2); // 2a
  }

  if (sections.showChildChapters) {
    for (const c of shape.children) {
      n += 1; // 3. chapter opener
      // 3a0. conversation continuation
      n += chunkedSpreads(Math.max(0, c.interviewAnswers - INTERVIEW_PER_PAGE), INTERVIEW_PER_PAGE);
      // 3a. photo collage. The favorites spread gates the reservation too, so
      // a chapter with nothing written keeps that photograph in its collage.
      const showFavorites = sections.showFavoriteThings && c.hasFavorites;
      const plan = planChapterPhotos(c.photos, showFavorites);
      const units = buildChapterPhotoUnits(
        Array.from({ length: plan.collageCount }, (_, i) => ({ id: `x${i}`, photo_url: "y" })),
        DEFAULT_MOSAIC_OPTS,
      ).length;
      n += Math.ceil(units / 2);
      // 3b. favorites
      if (showFavorites) n += 1;
      // 3d. books
      if (sections.showBooksSection && c.books > 0) n += 1;
      // 3e. tiny masterpieces
      n += chunkedSpreads(c.drawings, 4);
      // 3f. keepsake pages, two to a spread
      n += Math.ceil(c.keepsakePages / 2);
    }
  }

  if (sections.showFamilyChapter) {
    if (shape.familyWins > 0) n += 1; // 4. family opener, only with wins to list
    const famUnits = buildChapterPhotoUnits(
      Array.from({ length: shape.familyPhotos }, (_, i) => ({ id: `f${i}`, photo_url: "y" })),
      DEFAULT_MOSAIC_OPTS,
    ).length;
    n += Math.ceil(famUnits / 2); // 4a
    if (sections.showBooksSection && shape.familyBooks > 0) n += 1; // 4b
    n += chunkedSpreads(shape.familyDrawings, 4); // 4c
  }

  // 5. the village spread is gone entirely.
  if (sections.showYearInNumbers) {
    const recap: YearRecap = {
      books: Array.from({ length: shape.recap[0] }, (_, i) => `b${i}`),
      places: Array.from({ length: shape.recap[1] }, (_, i) => `p${i}`),
      moments: Array.from({ length: shape.recap[2] }, (_, i) => `m${i}`),
    };
    n += Math.ceil(paginateRecap(recap).length / 2); // 5.5
  }
  n += chunkedSpreads(shape.monthlyAnswers, 6); // 5.55
  if (shape.tinyMomentLines > 0) n += 1; // 5.56
  n += chunkedSpreads(shape.adventures, 5); // 5.57
  if (shape.hasClosingNote) n += 1; // 5.6 the closing note, one page facing a blank leaf
  n += 1; // 6. back cover
  n += 1; // the cover, unshifted last
  return n;
}

function countsFor(shape: ReaderShape): BookCounts {
  return {
    childPhotoCounts: shape.children.map((c) => c.photos),
    familyPhotoCount: shape.familyPhotos,
    childBookCounts: shape.children.map((c) => c.books),
    familyBookCount: shape.familyBooks,
    childDrawingCounts: shape.children.map((c) => c.drawings),
    familyDrawingCount: shape.familyDrawings,
    filledInterviewChildren: shape.children.filter((c) => c.interviewAnswers > 0).length,
    childInterviewAnswers: shape.children.map((c) => c.interviewAnswers),
    filledFavoriteChildren: shape.children.map((c) => c.hasFavorites),
    filledKeepsakePages: shape.children.map((c) => c.keepsakePages),
    hasLetter: shape.letterPages > 0,
    hasFavoriteDay: shape.hasFavoriteDay,
    familyWinCount: shape.familyWins,
    hasClosingNote: shape.hasClosingNote,
    letterPages: shape.letterPages,
    monthlyAnswers: shape.monthlyAnswers,
    tinyMomentLines: shape.tinyMomentLines,
    filledAdventureCategories: shape.adventures,
    recapItemCount: shape.recap[0] + shape.recap[1] + shape.recap[2],
    recapSectionCounts: shape.recap,
  };
}

test("the estimator matches the reader's assembly, so the drift detector stays quiet", () => {
  const shapes: ReaderShape[] = [
    // An empty book: nothing at all.
    { children: [], familyPhotos: 0, familyBooks: 0, familyDrawings: 0, familyWins: 0, letterPages: 0, hasFavoriteDay: false, hasClosingNote: false, monthlyAnswers: 0, tinyMomentLines: 0, adventures: 0, recap: [0, 0, 0] },
    // The casual family: two children, thirty photographs between them, and
    // not one word typed anywhere.
    { children: [
        { photos: 18, books: 0, drawings: 0, hasFavorites: false, keepsakePages: 0, interviewAnswers: 0 },
        { photos: 12, books: 0, drawings: 0, hasFavorites: false, keepsakePages: 0, interviewAnswers: 0 },
      ], familyPhotos: 0, familyBooks: 0, familyDrawings: 0, familyWins: 0, letterPages: 0, hasFavoriteDay: false, hasClosingNote: true, monthlyAnswers: 0, tinyMomentLines: 0, adventures: 0, recap: [0, 0, 0] },
    // One child, a first year: a few photos, a short letter, no writing yet.
    { children: [{ photos: 7, books: 2, drawings: 1, hasFavorites: false, keepsakePages: 0, interviewAnswers: 3 }], familyPhotos: 4, familyBooks: 0, familyDrawings: 0, familyWins: 2, letterPages: 1, hasFavoriteDay: true, hasClosingNote: true, monthlyAnswers: 2, tinyMomentLines: 0, adventures: 0, recap: [2, 1, 1] },
    // A family who fills everything in: three children, all eleven questions,
    // long keepsake pages, a letter that runs to five pages.
    { children: [
        { photos: 34, books: 12, drawings: 9, hasFavorites: true, keepsakePages: 5, interviewAnswers: 11 },
        { photos: 3, books: 0, drawings: 4, hasFavorites: true, keepsakePages: 3, interviewAnswers: 11 },
        { photos: 0, books: 6, drawings: 0, hasFavorites: false, keepsakePages: 1, interviewAnswers: 7 },
      ], familyPhotos: 21, familyBooks: 4, familyDrawings: 6, familyWins: 9, letterPages: 5, hasFavoriteDay: true, hasClosingNote: true, monthlyAnswers: 12, tinyMomentLines: 14, adventures: 8, recap: [24, 3, 6] },
    // A favourite day chosen but no letter written: the spread still prints,
    // with the day on the left and a blank leaf facing it.
    { children: [], familyPhotos: 0, familyBooks: 0, familyDrawings: 0, familyWins: 0, letterPages: 0, hasFavoriteDay: true, hasClosingNote: false, monthlyAnswers: 0, tinyMomentLines: 0, adventures: 0, recap: [0, 0, 0] },
    // The awkward middles: lone photos, one spilled answer, an odd letter page.
    { children: [
        { photos: 1, books: 1, drawings: 1, hasFavorites: false, keepsakePages: 1, interviewAnswers: 7 },
        { photos: 2, books: 0, drawings: 5, hasFavorites: false, keepsakePages: 2, interviewAnswers: 6 },
      ], familyPhotos: 1, familyBooks: 1, familyDrawings: 3, familyWins: 1, letterPages: 2, hasFavoriteDay: false, hasClosingNote: true, monthlyAnswers: 7, tinyMomentLines: 1, adventures: 6, recap: [11, 1, 1] },
  ];

  const sectionSets: BookSections[] = [
    ALL_SECTIONS_ON,
    SECTIONS_OFF,
    { ...ALL_SECTIONS_ON, showFavoriteThings: false },
    { ...ALL_SECTIONS_ON, showBooksSection: false },
    { ...ALL_SECTIONS_ON, showChildChapters: false },
    { ...ALL_SECTIONS_ON, showLetter: false, showYearInNumbers: false },
  ];

  for (const shape of shapes) {
    for (const sections of sectionSets) {
      const expected = readerSpreadCount(shape, sections) * 2;
      assert.equal(
        estimateYearbookPages(countsFor(shape), sections),
        expected,
        `drift for ${JSON.stringify(shape.children.length)} children / letter ${shape.letterPages}`,
      );
    }
  }
});

// ─── Captions cost no pages, and that has to stay deliberate ────────────────

test("captioning every photograph does not change the page count", () => {
  // The caption line sits inside the cell and the image shrinks to make room,
  // so a chapter of N photographs occupies the same pages either way. This
  // test is the tripwire: if captions ever start costing pages (a smaller
  // maxPerPage, geometry that reacts to caption length), it fails here rather
  // than as a family being quoted a length their book does not have.
  for (let photos = 0; photos <= 40; photos++) {
    const bare = Array.from({ length: photos }, (_, i) => ({ id: `p${i}`, photo_url: "x" }));
    const captioned = bare.map((p) => ({
      ...p,
      caption: "A caption long enough to wrap onto a second line",
      takenAt: "2026-10-12",
      childName: "Zoe",
    }));
    assert.equal(
      buildChapterPhotoUnits(captioned, DEFAULT_MOSAIC_OPTS).length,
      buildChapterPhotoUnits(bare, DEFAULT_MOSAIC_OPTS).length,
      `photos=${photos}`,
    );
  }

  // And the estimate a chapter produces is unchanged, because it is built from
  // that same unit count.
  const counts = emptyCounts({
    childPhotoCounts: [17],
    filledFavoriteChildren: [false],
    filledKeepsakePages: [0],
    childInterviewAnswers: [0],
    familyPhotoCount: 9,
  });
  assert.equal(estimateYearbookPages(counts) % 2, 0);
  assert.equal(
    estimateYearbookPages(counts),
    estimateYearbookPages({ ...counts }),
    "the estimate reads counts only, never caption text",
  );
});

// ─── Nothing empty ever prints ───────────────────────────────────────────────

test("the casual family: two children, thirty photographs, nothing typed", () => {
  // This is the shape the whole pass is for. Before it, this family's book
  // carried a letter spread asking them to write one, two conversation pages
  // asking each child what their year was like, two favorites pages showing a
  // photo over the words "A few favorite things.", a family opener saying "The
  // moments we shared, all together.", twelve blank ruled lines to be signed by
  // hand, and two pages of copy identical in every book ever printed.
  const casual = emptyCounts({
    childPhotoCounts: [18, 12],
    childBookCounts: [0, 0],
    childDrawingCounts: [0, 0],
    filledFavoriteChildren: [false, false],
    filledKeepsakePages: [0, 0],
    childInterviewAnswers: [0, 0],
    familyPhotoCount: 0,
    familyWinCount: 0,
    hasLetter: false,
    hasFavoriteDay: false,
    letterPages: 0,
    // They did show up and log their days, so the book still has an ending.
    hasClosingNote: true,
  });

  const pages = estimateYearbookPages(casual);
  assert.equal(pages % 2, 0, "always whole spreads");

  // Every spread the old book gave this family that had nothing on it. The
  // conversation page is not counted here: it was the right side of the chapter
  // opener, which still exists, so it costs no spread either way.
  const spreadsRemoved =
    LETTER_SPREADS + //            an envelope asking them to write a letter
    FAMILY_OPENER_SPREADS + //     "The moments we shared, all together."
    2 + //                         a favorites spread per child, on a reserved photo alone
    1 + //                         From the village: twelve blank ruled lines
    1; //                          "Until next year", two pages of identical copy
  const spreadsAdded = CLOSING_NOTE_SPREADS; // the closing note, from their own year
  const before = pages + (spreadsRemoved - spreadsAdded) * 2;
  assert.ok(pages < before, `expected fewer pages than the old ${before}, got ${pages}`);
  assert.equal(before - pages, 10, "five placeholder spreads out, one real page in");

  // And nothing that could be a placeholder is in there. Each of these would
  // add a spread if the estimator still printed it unconditionally.
  const noLetter = estimateYearbookPages({ ...casual, letterPages: 0, hasFavoriteDay: false });
  assert.equal(noLetter, pages, "no letter spread");
  const noFamilyOpener = estimateYearbookPages({ ...casual, familyWinCount: 0 });
  assert.equal(noFamilyOpener, pages, "no family opener");
  const noFavorites = estimateYearbookPages({ ...casual, filledFavoriteChildren: [false, false] });
  assert.equal(noFavorites, pages, "no favorites spreads");

  // Only the two chapters and their photographs, plus the covers and the note.
  const chapters = 2 * CHILD_OPENER_SPREADS;
  const collage =
    Math.ceil(buildChapterPhotoUnits(Array.from({ length: 17 }, (_, i) => ({ id: `a${i}`, photo_url: "x" })), DEFAULT_MOSAIC_OPTS).length / 2) +
    Math.ceil(buildChapterPhotoUnits(Array.from({ length: 11 }, (_, i) => ({ id: `b${i}`, photo_url: "x" })), DEFAULT_MOSAIC_OPTS).length / 2);
  assert.equal(pages, (COVER_SPREADS + chapters + collage + CLOSING_NOTE_SPREADS + BACK_COVER_SPREADS) * 2);
});

test("a family with no year at all gets no closing note", () => {
  const pages = estimateYearbookPages(emptyCounts({ hasClosingNote: false }));
  const withNote = estimateYearbookPages(emptyCounts({ hasClosingNote: true }));
  assert.equal(withNote - pages, 2, "one page facing a blank leaf");
  assert.equal(pages, 4, "cover and back cover, and nothing in between");
});

test("the estimate is honest below Lulu's 24 page floor, and never pads to reach it", () => {
  // A very light book really can come out under 24 pages now. That is a print
  // flow problem, not a reason for the book to inflate itself with pages a
  // family did not fill. See CLAUDE.md: the floor is checked before offering to
  // print, never met by padding.
  assert.equal(estimateYearbookPages(emptyCounts()), 4);
  const light = estimateYearbookPages(
    emptyCounts({ childPhotoCounts: [3], filledFavoriteChildren: [false], filledKeepsakePages: [0], childInterviewAnswers: [0], hasClosingNote: true }),
  );
  assert.ok(light < 24, `a light book reports ${light}, not a padded 24`);
});
