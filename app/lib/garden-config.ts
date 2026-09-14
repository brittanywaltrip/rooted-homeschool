/**
 * Does the Garden read school years?
 *
 * The "You're Rooted" screen wants to say "Two seeds went into the garden
 * today", which is only true if a new school year plants something new. It
 * does now: the Garden counts each child's leaves inside the current school
 * year (app/lib/garden-leaves.ts), so a new year starts every tree from a
 * seed, and last year's finished tree lives on the Years page.
 *
 * Set to false, the screen says "Their trees are growing in the Garden."
 */
export const GARDEN_PER_YEAR = true;

/**
 * The label on the celebration's Garden button.
 *
 * It read "See their seeds in the Garden" while the sentence three lines above
 * it read "Their tree is growing in the Garden", because the sentence was gated
 * on GARDEN_PER_YEAR and the button was not. Both now answer to the same flag.
 */
export function gardenButtonLabel(
  childCount: number,
  perYear: boolean = GARDEN_PER_YEAR,
): string {
  if (perYear) {
    return childCount === 1 ? "See their seed in the Garden" : "See their seeds in the Garden";
  }
  return childCount === 1 ? "See their tree in the Garden" : "See their trees in the Garden";
}

/**
 * The line the celebration prints, given how many children were set up.
 * Exported so the copy is testable without rendering the screen.
 */
export function gardenLine(childCount: number, perYear: boolean = GARDEN_PER_YEAR): string {
  if (!perYear) {
    return childCount === 1
      ? "Their tree is growing in the Garden."
      : "Their trees are growing in the Garden.";
  }
  return childCount === 1
    ? "One seed went into the garden today."
    : `${childCount === 2 ? "Two" : String(childCount)} seeds went into the garden today.`;
}
/**
 * "Zoe", "Zoe and Emma", "Zoe, Emma, and Liam". Oxford comma, because the
 * three-child version without it reads as two children with a compound name.
 */
export function joinNames(names: readonly string[]): string {
  const list = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

/** The possessive for a joined name list: "Zoe's", "Zoe and Emma's". */
export function possessive(joined: string): string {
  if (joined.length === 0) return "";
  return joined.endsWith("s") ? `${joined}'` : `${joined}'s`;
}
