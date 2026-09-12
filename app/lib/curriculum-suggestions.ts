/**
 * Publishers families actually type, so they can pick instead of spelling.
 *
 * Live data from `curriculum_goals` on 2026-09-12: "the good and the beautiful
 * math" was typed by 49 families, "the good and the beautiful" by 33, "the good
 * and the beautiful language arts" by 29. The same book, three spellings,
 * because the field asked for a free-text name and nothing suggested one.
 *
 * The same query showed "math" (22), "science" (14) and "reading" (12) sitting
 * in the CURRICULUM field, which is a family telling us they cannot tell the
 * two boxes apart. Those are subjects; the fix for them is the field order and
 * the labels, not this list, so they are deliberately NOT here.
 *
 * This is a list, not a model. It ranks BELOW the family's own names: what they
 * have typed before is a better suggestion than anything we can guess.
 */
export const CURRICULUM_PUBLISHERS: readonly string[] = [
  "The Good and the Beautiful",
  "Math With Confidence",
  "All About Reading",
  "All About Spelling",
  "Singapore Math",
  "Beast Academy",
  "Logic of English",
  "Saxon Math",
  "Teaching Textbooks",
  "Math-U-See",
  "Apologia",
  "Story of the World",
  "The Well-Trained Mind",
  "Explode the Code",
  "Handwriting Without Tears",
  "IEW",
  "Notgrass History",
  "Masterbooks",
  "BJU Press",
  "Abeka",
  "Sonlight",
  "Blossom and Root",
  "Torchlight",
  "Gather Round",
  "Life of Fred",
] as const;

/**
 * Subjects worth offering, so "Math" is a tap rather than a guess at what the
 * box wants. Short on purpose: a family with an unusual subject types it, and
 * their own past subjects rank above this anyway.
 */
export const COMMON_SUBJECTS: readonly string[] = [
  "Math",
  "Language Arts",
  "Reading",
  "Writing",
  "Spelling",
  "Science",
  "History",
  "Geography",
  "Bible",
  "Art",
  "Music",
  "Handwriting",
  "Foreign Language",
  "Health",
  "PE",
] as const;

/**
 * The family's own values first, in the order given (most recent first), then
 * the shared list with anything already suggested removed. Case-insensitive on
 * the dedupe so "the good and the beautiful" does not appear twice next to
 * "The Good and the Beautiful".
 */
export function mergeSuggestions(
  ownValues: readonly string[],
  shared: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of [ownValues, shared]) {
    for (const raw of list) {
      const value = (raw ?? "").trim();
      if (value.length === 0) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}
