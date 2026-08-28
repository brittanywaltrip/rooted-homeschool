// ─── Yearbook page count ─────────────────────────────────────────────────────
// The reader assembles the book as SPREADS (app/dashboard/memories/yearbook/
// read/page.tsx, the useMemo at ~line 924) and derives its flat page list at
// ~line 1640 as `spreads.flatMap(s => [left, right])`, so printed pages are
// always spreads × 2.
//
// Today cannot run that assembly: it has no React tree, no signed photo URLs
// and no reason to build 40 pages of JSX to show one number. This module is the
// one place that answers "how many pages is the book right now" from plain
// counts, so Today and the reader can never quietly disagree about it. The
// reader checks itself against this function on every render and reports a
// mismatch to Sentry (see the drift detector in the reader), which is the only
// thing keeping the two honest.
//
// Pure + framework-free, so it runs under node --test and inside both callers.
// The photo maths is NOT reimplemented here: planChapterPhotos and
// buildChapterPhotoUnits are the same functions the reader calls.

import {
  planChapterPhotos,
  buildChapterPhotoUnits,
  pageCountFor,
  splitBalanced,
  DEFAULT_MOSAIC_OPTS,
  type PhotoItem,
} from "./yearbook-photo-pages.ts";
import { INTERVIEW_PER_PAGE } from "./yearbook-prompts.ts";

// ─── Fixed spreads ───────────────────────────────────────────────────────────
// Spreads the book always has, whatever a family has written. Each is one
// spread (two pages). Line numbers are where the reader pushes them.

/** The cover + table of contents. Reader: `spreads.unshift(buildCoverSpread(...))`. */
export const COVER_SPREADS = 1;
/** "Until next year…", the warm closing spread. Reader: the `id: "until-next-year"` push. */
export const CLOSING_SPREADS = 1;
/** The back cover. Reader: the `id: "back"` push, always the last spread. */
export const BACK_COVER_SPREADS = 1;
/** "From the village", the signing spread, only when the section is enabled. Reader: `if (ybSettings.show_village)`. */
export const VILLAGE_SPREADS = 1;
/**
 * "A letter from home". Reader pushes this on `show_letter` alone, regardless
 * of whether the letter is written, because an unwritten letter still gets its
 * warm empty page. A letter longer than one page adds continuation spreads on
 * top of this; see BookCounts.letterPages.
 */
export const LETTER_SPREADS = 1;
/** A child's chapter opener (divider + year-end conversation). One per child. */
export const CHILD_OPENER_SPREADS = 1;
/** The "Our family" opener spread. Reader: `if (ybSettings.show_family_chapter)`. */
export const FAMILY_OPENER_SPREADS = 1;

// Page capacities the reader paginates by (each is a `chunk(items, N)` call).
const DRAWINGS_PER_PAGE = 4; // buildTinyMasterpiecesSpreads
const MONTHS_PER_PAGE = 6; // buildMonthByMonthSpreads
const ADVENTURES_PER_PAGE = 5; // buildAdventureSpreads
// paginateRecap's own budget: a page holds 15 lines, a section header costs 2.
const RECAP_LINES_PER_PAGE = 15;
const RECAP_HEADER_LINES = 2;

export interface BookCounts {
  /**
   * In-book photos per child, drawings excluded, in chapter order. This is the
   * population the reader PLANS the chapter from, so the caller must already
   * have dropped anything the letter's "favorite moment" reserved away from it
   * (reader: `reservedPhotoIds`) and any photo the family featured (the reader
   * plans from `nonFeatured`). See chapterPhotoUnits on what featuring costs.
   */
  childPhotoCounts: number[];
  /**
   * In-book family photos (no child_id), drawings excluded, minus anything the
   * letter reserved. Unlike childPhotoCounts this DOES include featured
   * photos: the family chapter has no planning step, so the reader sends every
   * one of them straight to the collage.
   */
  familyPhotoCount: number;
  childBookCounts: number[];
  familyBookCount: number;
  childDrawingCounts: number[];
  familyDrawingCount: number;
  /**
   * How many children answered at least one year-end question. Does NOT change
   * the count on its own: the reader renders the interview on the chapter
   * opener's right page whether or not it has answers (it falls back to a warm
   * line), so an unanswered interview costs the same pages as an answered one.
   * What DOES change the count is answering more than fit there, which is
   * childInterviewAnswers below.
   */
  filledInterviewChildren: number;
  /**
   * Per child, how many year-end questions they answered. The chapter opener's
   * right page holds INTERVIEW_PER_PAGE of them and the rest continue on their
   * own spreads, so a child who answered all eleven adds pages. Until the
   * print-correctness pass the reader clamped this at six and silently dropped
   * the rest, which is why answering more used to cost nothing.
   */
  childInterviewAnswers: number[];
  /**
   * Per child, whether they have at least one filled "favorite things" field.
   * Per child rather than a total because the favorites spread also appears
   * when the chapter had a photo to spare for it, and pairing a bare count to
   * the wrong child would put the spread in the wrong chapter.
   */
  filledFavoriteChildren: boolean[];
  /**
   * Per child, how many keepsake PAGES are filled. One for the snapshot, then
   * however many pages the never-forget lines and the open-when letter
   * paginate into, so this is no longer capped at three: those two pages stopped
   * clamping their text and now flow onto more pages instead of cutting it.
   * Per child because the reader packs each child's keepsake pages into that
   * child's own spreads: two children with one page each are two spreads, not
   * one.
   */
  filledKeepsakePages: number[];
  /** Whether the letter has text. Kept for symmetry; see LETTER_SPREADS. */
  hasLetter: boolean;
  /**
   * How many pages the letter from home paginates into (0 when unwritten).
   * The first page faces "A Day We'll Never Forget" on the letter spread, and
   * the rest pair off onto continuation spreads. It used to be one page with
   * line-clamp-[11], so a long letter cost no extra pages and lost its ending.
   */
  letterPages: number;
  /** Monthly reflections with a non-empty answer, inside this yearbook's months. */
  monthlyAnswers: number;
  /** Non-empty lines in the "tiny moments" text. */
  tinyMomentLines: number;
  /** Adventure categories the family wrote something under. */
  filledAdventureCategories: number;
  /** Total named recap items (books + places + moments) after blanks and duplicates are dropped. */
  recapItemCount: number;
  /**
   * The same items split by recap section, in the reader's section order.
   * Optional: paginateRecap charges a header per section, so the split changes
   * where pages break. With it the recap is exact; without it the items are
   * treated as one section, which can be a spread light for a family with one
   * long section and a couple of short ones.
   */
  recapSectionCounts?: number[];
}

/** The yearbook_settings toggles that add or remove whole sections. */
export interface BookSections {
  showLetter: boolean;
  showYearInNumbers: boolean;
  showChildChapters: boolean;
  showFavoriteThings: boolean;
  showBooksSection: boolean;
  showFamilyChapter: boolean;
  showVillage: boolean;
}

/** The reader's DEFAULT_YB_SETTINGS, which is what a family gets until they toggle something. */
export const ALL_SECTIONS_ON: BookSections = {
  showLetter: true,
  showYearInNumbers: true,
  showChildChapters: true,
  showFavoriteThings: true,
  showBooksSection: true,
  showFamilyChapter: true,
  showVillage: true,
};

/** Pages that hold `perPage` items each, paired into spreads (a lone trailing page gets a filler). */
function spreadsForChunkedPages(itemCount: number, perPage: number): number {
  if (itemCount <= 0) return 0;
  return Math.ceil(Math.ceil(itemCount / perPage) / 2);
}

/**
 * How many pages a chapter's photos occupy, using the reader's own functions.
 *
 * Featured photos are the one thing this cannot model. A featured photo gets a
 * solo full-bleed page, and its cost depends on WHERE it sits: dropped into
 * the middle of a run it also splits that run's mosaic in two, which a count
 * cannot express. So a child's featured photos are left out of
 * childPhotoCounts entirely (the reader plans that chapter from its
 * non-featured photos), and the family chapter's are counted but treated as
 * ordinary mosaic photos. Both are exact for a family that has never used the
 * feature toggle, and run a page or two light for one that has. The reader's
 * drift detector reports that gap rather than either side hiding it.
 */
function chapterPhotoUnits(collageCount: number): number {
  if (collageCount <= 0) return 0;
  // Synthetic items: buildChapterPhotoUnits only reads `featured` for grouping
  // and the dimensions for cell assignment, neither of which moves the page
  // count. Running the real function keeps the maths in one place.
  const items: PhotoItem[] = Array.from({ length: collageCount }, (_, i) => ({
    id: `count-${i}`,
    photo_url: "x",
  }));
  return buildChapterPhotoUnits(items, DEFAULT_MOSAIC_OPTS).length;
}

/**
 * Recap pages, mirroring paginateRecap's line budget without needing the
 * actual strings. A section costs a header plus one line per item, a page
 * holds RECAP_LINES_PER_PAGE lines, and a section that overflows continues on
 * the next page with its header repeated.
 */
function recapPageCount(counts: number[]): number {
  const sections = counts.filter((n) => n > 0);
  if (sections.length === 0) return 0;

  let pages = 0;
  let used = 0;
  const flush = () => {
    if (used > 0) {
      pages += 1;
      used = 0;
    }
  };

  for (const total of sections) {
    let i = 0;
    while (i < total) {
      if (used + RECAP_HEADER_LINES + 1 > RECAP_LINES_PER_PAGE && used > 0) flush();
      const room = Math.max(1, RECAP_LINES_PER_PAGE - used - RECAP_HEADER_LINES);
      const take = Math.min(total - i, room);
      used += RECAP_HEADER_LINES + take;
      i += take;
      if (i < total) flush();
    }
  }
  flush();
  return pages;
}

/**
 * The number of PAGES the yearbook reader would render for these counts.
 *
 * Always even: the reader only ever emits whole spreads, and a spread is two
 * facing pages (a lone trailing page is paired with a filler, never left off).
 */
export function estimateYearbookPages(
  c: BookCounts,
  sections: BookSections = ALL_SECTIONS_ON,
): number {
  let spreads = COVER_SPREADS;

  if (sections.showLetter) {
    spreads += LETTER_SPREADS;
    // Pages 2..n of a long letter, two to a spread, a filler on the odd one.
    if (c.letterPages > 1) spreads += Math.ceil((c.letterPages - 1) / 2);
  }

  if (sections.showChildChapters) {
    const childCount = Math.max(
      c.childPhotoCounts.length,
      c.childBookCounts.length,
      c.childDrawingCounts.length,
      c.filledFavoriteChildren.length,
      c.filledKeepsakePages.length,
      c.childInterviewAnswers.length,
    );
    for (let i = 0; i < childCount; i++) {
      const photos = c.childPhotoCounts[i] ?? 0;
      const books = c.childBookCounts[i] ?? 0;
      const drawings = c.childDrawingCounts[i] ?? 0;
      const hasFavItems = c.filledFavoriteChildren[i] ?? false;
      const keepsakePages = c.filledKeepsakePages[i] ?? 0;

      // The chapter opener: a divider page facing the year-end conversation.
      spreads += CHILD_OPENER_SPREADS;

      // Conversation answers past the ones that fit on the opener continue on
      // their own spreads, INTERVIEW_PER_PAGE to a page.
      const spilledAnswers = Math.max(0, (c.childInterviewAnswers[i] ?? 0) - INTERVIEW_PER_PAGE);
      spreads += spreadsForChunkedPages(spilledAnswers, INTERVIEW_PER_PAGE);

      // The chapter's photos, allocated exactly as the reader allocates them:
      // one may become the full-bleed divider, one may go to favorites, and
      // planChapterPhotos guarantees the collage is never left at a lonely 1.
      const plan = planChapterPhotos(photos, sections.showFavoriteThings);
      spreads += Math.ceil(chapterPhotoUnits(plan.collageCount) / 2);

      // Favorites: shown when there is something written OR a photo to face it.
      if (sections.showFavoriteThings && (hasFavItems || plan.useFavPhoto)) spreads += 1;

      if (sections.showBooksSection && books > 0) spreads += 1;

      spreads += spreadsForChunkedPages(drawings, DRAWINGS_PER_PAGE);

      // Keepsake pages pack two to a spread, per child.
      spreads += Math.ceil(keepsakePages / 2);
    }
  }

  if (sections.showFamilyChapter) {
    spreads += FAMILY_OPENER_SPREADS;
    // Family photos skip planChapterPhotos entirely. The reader sends them
    // straight to the collage, with no divider or favorites reservation.
    spreads += Math.ceil(chapterPhotoUnits(c.familyPhotoCount) / 2);
    if (sections.showBooksSection && c.familyBookCount > 0) spreads += 1;
    spreads += spreadsForChunkedPages(c.familyDrawingCount, DRAWINGS_PER_PAGE);
  }

  if (sections.showVillage) spreads += VILLAGE_SPREADS;

  if (sections.showYearInNumbers) {
    const split = c.recapSectionCounts ?? (c.recapItemCount > 0 ? [c.recapItemCount] : []);
    spreads += Math.ceil(recapPageCount(split) / 2);
  }

  spreads += spreadsForChunkedPages(c.monthlyAnswers, MONTHS_PER_PAGE);
  if (c.tinyMomentLines > 0) spreads += 1;
  spreads += spreadsForChunkedPages(c.filledAdventureCategories, ADVENTURES_PER_PAGE);

  spreads += CLOSING_SPREADS;
  spreads += BACK_COVER_SPREADS;

  return spreads * 2;
}

// pageCountFor and splitBalanced are the primitives buildChapterPhotoUnits is
// built on. They are re-exported so the tests can pin this module's page maths
// directly against them rather than restating the rules.
export { pageCountFor, splitBalanced };
