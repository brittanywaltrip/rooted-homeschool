/**
 * Theme config for the First Day Photo frames. All geometry is expressed as
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
  fields: FirstDayFieldPlacement[];
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
  },
};

export const DEFAULT_FIRST_DAY_THEME = "eucalyptus";

/** Exact brand string per wording rules — always "Rooted Homeschool App". */
export const FIRST_DAY_BRANDING = "Created with Rooted Homeschool App";
