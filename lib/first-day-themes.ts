/**
 * Theme config for the photo frames (First Day, and the two fall frames). All geometry is expressed as
 * PERCENTAGES of the frame PNG's natural dimensions, so the same numbers drive
 * the live WYSIWYG preview (at any display size) and the full-resolution canvas
 * export. Coordinates are 0–1 fractions.
 *
 * Tuning note: the seed values below are estimates read off
 * first-day-eucalyptus.png. The editor renders a live preview that uses these
 * exact percentages, so nudging any value here moves it identically in the
 * preview and the export — adjust until each value sits on its printed line.
 */

export type FirstDayFieldKey = "name" | "grade" | "year" | "age" | "subject" | "goal";

export interface FirstDayFieldPlacement {
  key: FirstDayFieldKey;
  /** Anchor x as a fraction of frame width (meaning depends on `align`). */
  xPct: number;
  /** Text baseline y as a fraction of frame height. */
  yPct: number;
  align: "left" | "center" | "right";
  /** Max text width as a fraction of frame width; text shrinks to fit. */
  maxWidthPct: number;
  /** Font size in px at the frame's natural width; scaled for preview/export. */
  fontPx: number;
}

export interface FirstDayTheme {
  id: string;
  label: string;
  /** Frame art: a PNG with a transparent arch opening, baked-in headline/labels/footer. */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Serif that matches the baked-in art. Must be loaded before canvas export. */
  fontFamily: string;
  /** Color for the rendered values. */
  textColor: string;
  /** Photo bounding box (behind the arch), as fractions of width/height. */
  arch: { xPct: number; yPct: number; wPct: number; hPct: number };
  /**
   * The rendered values. May be empty: a frame with no fields shows no inputs
   * in the editor and draws no text on the export, only the branding line.
   */
  fields: FirstDayFieldPlacement[];
  /**
   * Branding line baseline as a fraction of frame height. Defaults to
   * DEFAULT_BRANDING_Y_PCT, which is where the eucalyptus art leaves room.
   */
  brandingYPct?: number;
  /** File name stem for the export, e.g. "emma-fall.png" or "fall.png". */
  fileSlug: string;
  /** navigator.share title and text. */
  shareTitle: string;
  shareText: string;
}

export const FIRST_DAY_THEMES: Record<string, FirstDayTheme> = {
  eucalyptus: {
    id: "eucalyptus",
    label: "Eucalyptus",
    src: "/frames/first-day-eucalyptus.png",
    naturalWidth: 1024,
    naturalHeight: 1536,
    fontFamily: "Playfair Display",
    textColor: "#41513f",
    // Photo box is drawn slightly larger than the visible arch opening so the
    // photo fully covers the transparent area; the opaque frame hides overflow.
    arch: { xPct: 0.12, yPct: 0.15, wPct: 0.76, hPct: 0.58 },
    fields: [
      // Row 1 — NAME / GRADE LEVEL / SCHOOL YEAR / AGE (baseline on the line)
      { key: "name",    xPct: 0.161, yPct: 0.780, align: "center", maxWidthPct: 0.15, fontPx: 30 },
      { key: "grade",   xPct: 0.354, yPct: 0.780, align: "center", maxWidthPct: 0.17, fontPx: 27 },
      { key: "year",    xPct: 0.568, yPct: 0.780, align: "center", maxWidthPct: 0.16, fontPx: 27 },
      { key: "age",     xPct: 0.805, yPct: 0.780, align: "center", maxWidthPct: 0.10, fontPx: 28 },
      // Row 2 — FAVORITE SUBJECT / GOAL THIS YEAR
      { key: "subject", xPct: 0.284, yPct: 0.833, align: "center", maxWidthPct: 0.26, fontPx: 27 },
      { key: "goal",    xPct: 0.719, yPct: 0.833, align: "center", maxWidthPct: 0.34, fontPx: 27 },
    ],
    fileSlug: "first-day",
    shareTitle: "First Day Photo",
    shareText: "Our first day, made with Rooted Homeschool App.",
  },
  fall: {
    id: "fall",
    label: "It's Fall Y'all",
    src: "/frames/fall-yall.png",
    naturalWidth: 1374,
    naturalHeight: 1145,
    fontFamily: "Playfair Display",
    textColor: "#41513f",
    // Transparent opening measured from the PNG alpha: x 222 to 1156, y 302 to 980.
    // The box is drawn a little larger than the opening so the photo covers it fully.
    arch: { xPct: 0.150, yPct: 0.250, wPct: 0.700, hPct: 0.615 },
    fields: [],
    // The art is transparent below y 1075 in the middle, so the eucalyptus
    // 0.972 (and 0.975) would print on nothing. The wood under the opening is
    // fully opaque across the text's width from y 985 to 1058; a baseline at
    // 0.913 (y 1045) keeps the whole line on it.
    brandingYPct: 0.913,
    fileSlug: "fall",
    shareTitle: "Fall Photo",
    shareText: "Made with Rooted Homeschool App.",
  },
  fallCamp: {
    id: "fallCamp",
    label: "Fall Camp",
    src: "/frames/fall-camp.png",
    naturalWidth: 1374,
    naturalHeight: 1145,
    fontFamily: "Playfair Display",
    textColor: "#41513f",
    // Opening measured from the PNG alpha: x 249 to 1156, y 305 to 949.
    arch: { xPct: 0.175, yPct: 0.255, wPct: 0.675, hPct: 0.585 },
    fields: [],
    // Opaque wood across the text's width from y 954 to 1077; same baseline
    // as the fall frame so the two read alike.
    brandingYPct: 0.913,
    fileSlug: "fallCamp",
    shareTitle: "Fall Photo",
    shareText: "Made with Rooted Homeschool App.",
  },
};

export const DEFAULT_FIRST_DAY_THEME = "eucalyptus";

/** Picker order. */
export const FIRST_DAY_THEME_ORDER = ["eucalyptus", "fall", "fallCamp"] as const;

export const DEFAULT_BRANDING_Y_PCT = 0.972;

export function brandingYPct(theme: FirstDayTheme): number {
  return theme.brandingYPct ?? DEFAULT_BRANDING_Y_PCT;
}

export function isFirstDayThemeId(id: unknown): id is string {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(FIRST_DAY_THEMES, id);
}

/**
 * The theme the editor opens on. A ?theme= value wins when it names a theme;
 * an unknown one falls back to the default (not to the stored pick, so a bad
 * link always lands somewhere predictable). With no query value, the family's
 * last pick is used.
 */
export function initialFirstDayThemeId(query: string | null | undefined, stored: string | null | undefined): string {
  if (query != null && query !== "") return isFirstDayThemeId(query) ? query : DEFAULT_FIRST_DAY_THEME;
  return isFirstDayThemeId(stored) ? stored : DEFAULT_FIRST_DAY_THEME;
}

/** The text the export draws on the frame's lines. Empty for a theme with no fields. */
export function frameTextRuns(
  theme: FirstDayTheme,
  values: Partial<Record<FirstDayFieldKey, string>>,
): { field: FirstDayFieldPlacement; text: string }[] {
  const out: { field: FirstDayFieldPlacement; text: string }[] = [];
  for (const field of theme.fields) {
    const text = (values[field.key] || "").trim();
    if (text) out.push({ field, text });
  }
  return out;
}

/**
 * "emma-first-day.png", or just the slug when there is no name. A frame with
 * no name field ignores the name: it is hidden there (and may have been
 * autofilled from a child), so it must not turn up in a file name the family
 * cannot see or clear.
 */
export function frameExportFilename(name: string, theme: FirstDayTheme): string {
  const hasName = theme.fields.some((f) => f.key === "name");
  const who = (hasName ? name || "" : "").replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return who ? `${who}-${theme.fileSlug}.png` : `${theme.fileSlug}.png`;
}

/** Exact brand string per wording rules — always "Rooted Homeschool App". */
export const FIRST_DAY_BRANDING = "Created with Rooted Homeschool App";
