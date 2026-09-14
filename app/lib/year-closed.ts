import { possessive } from "./garden-config.ts";

/**
 * The handoff between closing a year and the "You finished a year." moment.
 *
 * Same shape as app/lib/setup-celebration.ts, for the same reason: the screen
 * is full-bleed, so it lives outside app/dashboard at /year-closed and has to
 * be navigated to. The year names come from the close route's response (the
 * names the family typed on the close page), never re-derived here. The
 * children's names ride in sessionStorage rather than the URL, which carries
 * only the archived year's id so "Maybe later" knows which report to open.
 */
const KEY = "rooted:year-closed";

export type YearClosedData = {
  archivedYearId: string;
  closingYearName: string;
  newYearName: string;
  childNames: string[];
};

let cached: YearClosedData | null | undefined;

/** False when storage refused it, so the caller can go straight to the report. */
export function writeYearClosed(data: YearClosedData): boolean {
  cached = undefined;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and clear. Cached for the life of the navigation, because React may
 * render twice (StrictMode, a discarded transition) and the second read would
 * otherwise find nothing and bounce the family past the moment.
 */
export function takeYearClosed(): YearClosedData | null {
  if (cached !== undefined) return cached;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) {
      cached = null;
      return null;
    }
    sessionStorage.removeItem(KEY);
    const p = JSON.parse(raw) as Partial<YearClosedData>;
    if (
      typeof p.archivedYearId !== "string" ||
      typeof p.closingYearName !== "string" ||
      typeof p.newYearName !== "string" ||
      !Array.isArray(p.childNames)
    ) {
      cached = null;
      return null;
    }
    cached = {
      archivedYearId: p.archivedYearId,
      closingYearName: p.closingYearName,
      newYearName: p.newYearName,
      childNames: p.childNames.filter((n): n is string => typeof n === "string" && n.trim().length > 0),
    };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Whose keepsakes are saved, with the verb:
 * "Zoe's tree, badges, and book are",
 * "Zoe's and Emma's trees, badges, and book are",
 * "Zoe's, Emma's, and Liam's trees, badges, and book are".
 * Each name takes its own possessive; joinNames would give "Zoe and Emma's",
 * which reads as one shared tree.
 */
export function keepsakeOwners(childNames: readonly string[]): string {
  const names = childNames.map((n) => n.trim()).filter((n) => n.length > 0).map(possessive);
  if (names.length === 0) return "Your family's trees, badges, and book are";
  if (names.length === 1) return `${names[0]} tree, badges, and book are`;
  const who = names.length === 2
    ? `${names[0]} and ${names[1]}`
    : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `${who} trees, badges, and book are`;
}

/** The paragraph under "You finished a year." */
export function yearClosedMessage(data: Pick<YearClosedData, "closingYearName" | "childNames">): string {
  return (
    "Whether you logged every lesson, made it to the last page, or just barely got here: you're here. " +
    `${data.closingYearName} is saved. ${keepsakeOwners(data.childNames)} on your Years page whenever you want them.`
  );
}
