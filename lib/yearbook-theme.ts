// ─── Yearbook themes ─────────────────────────────────────────────────────────
// One theme choice reskins the whole book (reader + PDF) by driving every styled
// surface through CSS-variable tokens. The reader sets these vars on a wrapper
// that contains the on-screen book AND the print markup, so both render the
// selected theme identically.
//
// IMPORTANT: the "garden" theme is the production default and its token values
// are pinned to the EXACT colors/fonts the yearbook renders today. Replacing a
// hardcoded literal with var(--yb-…) whose garden value equals that literal is
// byte-for-byte identical output. The regression test below guards these values.
//
// Pure + framework-free so it's unit-testable and shared by reader + print.

export type YearbookThemeName = "garden" | "heirloom" | "gallery";

export interface YearbookTheme {
  name: YearbookThemeName;
  /** Page (interior) background. */
  bg: string;
  /** Heading text color. */
  heading: string;
  /** Body text color. */
  body: string;
  /** Muted text (dates, sub-labels). */
  muted: string;
  /** Accent (overline labels, rule motif). */
  accent: string;
  /** Heading font-family (CSS value). */
  headingFont: string;
  /** Deep panel background (cover, back cover, no-photo divider panel). */
  coverBg: string;
  /** Text on the deep panel. */
  coverFg: string;
  /** Light accent on the deep panel (cover labels/badges). */
  coverAccent: string;
  /** Divider / section-break motif: the eucalyptus sprig, or a thin rule. */
  motif: "sprig" | "rule";
}

export const DEFAULT_THEME_NAME: YearbookThemeName = "garden";

export const THEMES: Record<YearbookThemeName, YearbookTheme> = {
  // Pinned to today's production values — DO NOT change without intending a
  // visual change to every existing yearbook.
  garden: {
    name: "garden",
    bg: "#FAFAF7",
    heading: "#2d2926",
    body: "#2d2926",
    muted: "#7a6f65",
    accent: "#5c7f63",
    headingFont: "var(--font-display)",
    coverBg: "#2d5a3d",
    coverFg: "#fefcf9",
    coverAccent: "#c8e6c4",
    motif: "sprig",
  },
  // Classic, warm, gold-on-cream — a treasured-old-book feel.
  heirloom: {
    name: "heirloom",
    bg: "#f4ecd8",
    heading: "#20392c",
    body: "#4a4032",
    muted: "#7d6f54",
    accent: "#b08d57",
    headingFont: "var(--font-display)",
    coverBg: "#20392c",
    coverFg: "#f4ecd8",
    coverAccent: "#d8c79a",
    motif: "rule",
  },
  // Modern minimal, sans headings, lets the photos shine.
  gallery: {
    name: "gallery",
    bg: "#ffffff",
    heading: "#2b2b2b",
    body: "#2b2b2b",
    muted: "#8a847c",
    accent: "#9a948c",
    headingFont: "var(--font-geist-sans)",
    coverBg: "#2b2b2b",
    coverFg: "#ffffff",
    coverAccent: "#cfcac4",
    motif: "rule",
  },
};

/** Normalize a stored value to a known theme name; anything unknown → garden. */
export function resolveThemeName(name: string | null | undefined): YearbookThemeName {
  return name === "heirloom" || name === "gallery" ? name : DEFAULT_THEME_NAME;
}

/** Resolve a stored theme value to its full token set (default garden). */
export function resolveTheme(name: string | null | undefined): YearbookTheme {
  return THEMES[resolveThemeName(name)];
}

/** The CSS custom properties a theme sets on the book wrapper. */
export function themeCssVars(theme: YearbookTheme): Record<string, string> {
  return {
    "--yb-bg": theme.bg,
    "--yb-heading": theme.heading,
    "--yb-body": theme.body,
    "--yb-muted": theme.muted,
    "--yb-accent": theme.accent,
    "--yb-heading-font": theme.headingFont,
    "--yb-cover-bg": theme.coverBg,
    "--yb-cover-fg": theme.coverFg,
    "--yb-cover-accent": theme.coverAccent,
  };
}
