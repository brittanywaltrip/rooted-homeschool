/**
 * Does the Garden read school years yet?
 *
 * The "You're Rooted" screen wants to say "Two seeds went into the garden
 * today", which is only true if a new school year plants something new. Today
 * the Garden grows one tree per child for the life of the account, so that
 * sentence would be a small lie on every year after the first.
 *
 * Until the Garden is per-year, the screen says "Their trees are growing in the
 * Garden." Flipping this to true is the one edit that switches the copy.
 */
export const GARDEN_PER_YEAR = false;

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
