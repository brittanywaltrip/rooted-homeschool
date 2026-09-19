// ─── One place that knows how to say "1 memory" and "3 memories" ────────────
//
// Count copy was being pluralized inline at every call site, which is how
// "1 memories" and "9 more leafs to go" both reached production. Two rules
// were getting re-derived by hand: the -y → -ies swap, and the fact that
// "leaf" does not take a plain -s. Both now live here.
//
// Deliberately not locale-aware: `countLabel(1200, "memory")` renders
// "1200 memories", the same digits the call sites rendered before, so
// adopting this helper changes the noun and nothing else.

/**
 * Plurals the -s / -ies rules below would get wrong.
 *
 * Only words Rooted actually shows a family. An English pluralizer that tries
 * to be complete is a liability: "roof" → "rooves" is the same class of bug as
 * "leafs", just in the other direction.
 */
const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  leaf: "leaves",
  child: "children",
  person: "people",
};

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Preserve the caller's capitalization: "Leaf" → "Leaves", "LEAF" → "LEAVES". */
function matchCase(source: string, lowerPlural: string): string {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return lowerPlural.toUpperCase();
  }
  if (source.charAt(0) === source.charAt(0).toUpperCase()) {
    return lowerPlural.charAt(0).toUpperCase() + lowerPlural.slice(1);
  }
  return lowerPlural;
}

/**
 * The plural form of `one`.
 *
 *   pluralOf("memory") === "memories"
 *   pluralOf("leaf")   === "leaves"
 *   pluralOf("lesson") === "lessons"
 *
 * The plural is derived entirely in lower case and only then re-cased, so the
 * rules never have to reason about capitalization.
 */
export function pluralOf(one: string): string {
  const lower = one.toLowerCase();
  return matchCase(one, lowerPluralOf(lower));
}

function lowerPluralOf(lower: string): string {
  const irregular = IRREGULAR_PLURALS[lower];
  if (irregular) return irregular;

  // consonant + y → ies ("memory" → "memories"), but "day" → "days".
  if (lower.endsWith("y") && lower.length > 1 && !VOWELS.has(lower.charAt(lower.length - 2))) {
    return `${lower.slice(0, -1)}ies`;
  }

  // Sibilant endings take -es ("class" → "classes", "box" → "boxes").
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;

  return `${lower}s`;
}

/**
 * The noun alone, agreeing with `count`.
 *
 *   pluralize(1, "memory") === "memory"
 *   pluralize(0, "memory") === "memories"
 *
 * Zero is plural, which is what English does: "0 memories", not "0 memory".
 * `many` overrides the derived plural for the rare phrase that needs it.
 */
export function pluralize(count: number, one: string, many?: string): string {
  return count === 1 ? one : (many ?? pluralOf(one));
}

/**
 * The count and the noun together, which is what nearly every call site wants.
 *
 *   countLabel(1, "memory")  === "1 memory"
 *   countLabel(9, "leaf")    === "9 leaves"
 *   countLabel(0, "lesson")  === "0 lessons"
 */
export function countLabel(count: number, one: string, many?: string): string {
  return `${count} ${pluralize(count, one, many)}`;
}
