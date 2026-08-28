// ─── Yearbook guided prompts ─────────────────────────────────────────────────
// Shared between the reader and the editor so the questions/fields and their
// content keys never drift. Content is stored in yearbook_content under these
// keys (child_interview / child_favorite by child_id + question_key).

export interface Prompt {
  key: string;
  label: string;
}

// Year-End Conversation (was "interview"). Replaces the old questions. The
// "What surprised you?" key is intentionally REUSED (q_surprised_you) so a
// family's existing answer carries over to the matching new question. The other
// old keys are simply not shown (no orphaned answers), their rows retained.
export const YEAR_END_QUESTIONS: Prompt[] = [
  { key: "q_happiest", label: "What made you happiest this year?" },
  { key: "q_brave", label: "What made you brave?" },
  { key: "q_hard", label: "What was really hard?" },
  { key: "q_surprised_you", label: "What surprised you?" },
  { key: "q_laugh", label: "What made you laugh until your stomach hurt?" },
  { key: "q_relive", label: "If you could relive one day, which would it be?" },
  { key: "q_proud", label: "What are you most proud of?" },
  { key: "q_helped", label: "Who helped you this year?" },
  { key: "q_felt_loved", label: "What's something Mom or Dad did that made you feel loved?" },
  { key: "q_future_you", label: "If you could tell Future You one thing, what would it be?" },
  { key: "q_next_year_feel", label: "What do you hope next year feels like?" },
];

// Favorite Things — the expanded ~20. These now have their OWN keys
// (child_favorite) so they no longer borrow the interview answers. Bible verse
// is optional (no special handling needed — empty favorites simply don't show).
export const FAVORITES: Prompt[] = [
  { key: "book", label: "Favorite book" },
  { key: "movie", label: "Favorite movie" },
  { key: "song", label: "Favorite song" },
  { key: "game", label: "Favorite game" },
  { key: "food", label: "Favorite food" },
  { key: "animal", label: "Favorite animal" },
  { key: "place", label: "Favorite place" },
  { key: "toy", label: "Favorite toy" },
  { key: "outfit", label: "Favorite outfit" },
  { key: "family_tradition", label: "Favorite family tradition" },
  { key: "holiday", label: "Favorite holiday" },
  { key: "bible_verse", label: "Favorite Bible verse" },
  { key: "joke", label: "Favorite joke" },
  { key: "dessert", label: "Favorite dessert" },
  { key: "thing_learned", label: "Favorite thing we learned" },
  { key: "field_trip", label: "Favorite field trip" },
  { key: "subject", label: "Favorite subject" },
  { key: "thing_homeschool", label: "Favorite thing about homeschool" },
  { key: "dream_vacation", label: "Dream vacation" },
];

// Migration: a new favorite key ← the old interview key whose answer fed the old
// favorites page. Used for a read-time fallback (and the one-time backfill) so no
// family loses what they wrote when favorites move to their own keys.
export const FAVORITES_FROM_INTERVIEW: Record<string, string> = {
  book: "q_favorite_book", // old "My favorite book was…"
  thing_learned: "q_loved_learning", // old "This year I loved…"
};

// ─── Wave 2 keepsake pages (per-child) ───────────────────────────────────────

// "This Was {Child}" — a per-child snapshot for year-over-year comparison.
// Stored under content_type 'child_snapshot'.
export const SNAPSHOT_FIELDS: Prompt[] = [
  { key: "age", label: "Age" },
  { key: "grade", label: "Grade" },
  { key: "height", label: "Height" },
  { key: "favorite_color", label: "Favorite color" },
  { key: "dream_job", label: "Dream job" },
  { key: "current_obsession", label: "Current obsession" },
  { key: "favorite_snack", label: "Favorite snack" },
  { key: "best_friend", label: "Best friend" },
  { key: "signature_phrase", label: "Signature phrase" },
  { key: "what_makes_me_laugh", label: "What makes me laugh" },
];

// "Things I Never Want to Forget About You Right Now" — parent-written. The
// label is the lead-in; the parent completes the line. Stored under
// content_type 'child_never_forget'.
export const NEVER_FORGET_LINES: Prompt[] = [
  { key: "laugh", label: "Your laugh…" },
  { key: "pronounce", label: "The way you pronounce…" },
  { key: "bedtime", label: "Your bedtime questions…" },
  { key: "stuffed_animal", label: "Your favorite stuffed animal…" },
  { key: "songs", label: "The songs you sing…" },
  { key: "voice", label: "Your little voice…" },
  { key: "hugs", label: "The hugs…" },
  { key: "freckles", label: "The freckles…" },
  { key: "missing_tooth", label: "The missing tooth…" },
];

// "Open When You're Grown" — a letter to the future child. Stored under
// content_type 'child_open_when'.
export const OPEN_WHEN_PROMPTS: Prompt[] = [
  { key: "right_now", label: "Right now you are…" },
  { key: "never_changes", label: "One thing I hope never changes…" },
  { key: "always_remember", label: "One thing I hope you always remember…" },
  { key: "chase", label: "One thing I hope you chase…" },
];

// ─── Family-level content pages ──────────────────────────────────────────────

// "Adventure Pages" — adventures grouped into named categories (parent writes a
// short line or two under each one that applies). Family-level: stored one row
// per filled category under content_type 'adventure_categories', child_id null,
// question_key = the category key.
export const ADVENTURE_CATEGORIES: Prompt[] = [
  { key: "favorite_field_trip", label: "Our favorite field trip" },
  { key: "nature", label: "Nature adventures" },
  { key: "kitchen", label: "Kitchen creations" },
  { key: "science", label: "Science experiments" },
  { key: "books_places", label: "Books that took us somewhere" },
  { key: "community", label: "Community days" },
  { key: "helping", label: "Helping others" },
  { key: "christmas", label: "Christmas memories" },
  { key: "summer", label: "Summer adventures" },
  { key: "rainy_day", label: "Rainy day fun" },
];

// "Tiny Moments" — a single page of little one-liners, one moment per line.
// Family-level: stored in ONE row under content_type 'tiny_moments', child_id
// null, question_key null, content = the moments as plain text (one per line).
// Splits the stored text into trimmed, non-empty lines for display.
export function tinyMomentLines(content: string | null | undefined): string[] {
  if (!content) return [];
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ─── Pagination for written content ──────────────────────────────────────────
// A yearbook page is a fixed-height box with overflow-hidden. Long text used to
// be handled with line-clamp, which silently cuts a mother's sentence in half
// and gives her no way to know it happened. Nothing in the book may be clamped:
// text that does not fit flows onto another page, and the book gets longer.
//
// These estimate how many lines a string will occupy rather than measuring the
// DOM, because the count has to be identical in three places that never see the
// same layout: the reader, the print path, and the page-count helper Today
// reads (lib/yearbook-page-count.ts). Estimating is deterministic; measuring is
// not. The trade is that a wildly unusual string can be off by a line, so the
// budgets below leave a line of slack rather than filling the page exactly.

/** Characters that fit on one line of body text in a yearbook page column. */
export const CHARS_PER_LINE = 52;

/** Year-end conversation answers that fit on the chapter opener's right page. */
export const INTERVIEW_PER_PAGE = 6;
/** Body lines a full keepsake page holds under its heading. */
export const KEEPSAKE_LINES_PER_PAGE = 14;
/** Same, for a page that also carries a signature line at the bottom. */
export const KEEPSAKE_LINES_WITH_SIGNOFF = 12;
/** Body lines the letter's first page holds, sharing the page with its heading and signature. */
export const LETTER_LINES_FIRST_PAGE = 11;
/** Body lines a letter continuation page holds, having no heading of its own. */
export const LETTER_LINES_PER_PAGE = 16;

/** How many lines a string occupies, minimum one, counting its own newlines. */
export function estimateLines(text: string, charsPerLine: number = CHARS_PER_LINE): number {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return 1;
  return trimmed
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0);
}

/**
 * Pack items onto pages by their estimated line cost. An item always lands on
 * a page even when it is longer than the whole budget on its own, so nothing
 * is ever dropped; it simply gets a page to itself and may run a little long.
 */
export function paginateByLineBudget<T>(
  items: T[],
  cost: (item: T) => number,
  linesPerPage: number,
): T[][] {
  if (items.length === 0) return [];
  const pages: T[][] = [];
  let page: T[] = [];
  let used = 0;
  for (const item of items) {
    const n = Math.max(1, cost(item));
    if (page.length > 0 && used + n > linesPerPage) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(item);
    used += n;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/**
 * Split the letter from home across pages, breaking between paragraphs where
 * it can. A paragraph longer than a whole page is split on a word boundary
 * rather than mid-word, and the remainder carries on the next page.
 *
 * The first page is shorter than the rest because it shares its page with the
 * "A letter from home" heading and the "Love, …" signature.
 */
export function paginateLetter(
  text: string,
  firstPageLines: number = LETTER_LINES_FIRST_PAGE,
  laterPageLines: number = LETTER_LINES_PER_PAGE,
  charsPerLine: number = CHARS_PER_LINE,
): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  // Paragraphs, keeping single newlines inside one paragraph so a list the
  // family typed on separate lines stays together.
  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const pages: string[] = [];
  let page: string[] = [];
  let used = 0;
  const budget = () => (pages.length === 0 ? firstPageLines : laterPageLines);
  const flush = () => {
    if (page.length > 0) {
      pages.push(page.join("\n\n"));
      page = [];
      used = 0;
    }
  };

  for (const paragraph of paragraphs) {
    let rest = paragraph;
    while (rest) {
      const room = budget() - used;
      if (room <= 0) {
        flush();
        continue;
      }
      const cost = estimateLines(rest, charsPerLine);
      if (cost <= room) {
        page.push(rest);
        used += cost;
        rest = "";
        break;
      }
      // Does not fit. Start a fresh page unless this page is already fresh, in
      // which case the paragraph is longer than a page and has to be split.
      if (page.length > 0) {
        flush();
        continue;
      }
      const take = room * charsPerLine;
      let cut = rest.lastIndexOf(" ", take);
      if (cut <= 0) cut = Math.min(take, rest.length);
      page.push(rest.slice(0, cut).trim());
      flush();
      rest = rest.slice(cut).trim();
    }
  }
  flush();
  return pages;
}
