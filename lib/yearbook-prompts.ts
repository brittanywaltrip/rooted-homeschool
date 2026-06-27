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
