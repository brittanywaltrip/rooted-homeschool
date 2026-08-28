// ─── Featured-photo caption ──────────────────────────────────────────────────
// A featured photo's own full-bleed page may carry a small caption at the
// bottom. The caption text is the memory's caption, else its title, else none
// (the date is shown separately and always). Whitespace-only counts as empty,
// and an empty caption is never rendered — so a photo with no caption and no
// title shows no caption line at all.
//
// Pure + framework-free so the reader and the PDF print path decide captions
// identically, and so it's unit-testable.

export interface CaptionSource {
  caption?: string | null;
  title?: string | null;
}

export function featureCaptionText(m: CaptionSource): string | null {
  const caption = m.caption?.trim();
  if (caption) return caption;
  const title = m.title?.trim();
  if (title) return title;
  return null;
}

// ─── The line under every photograph ─────────────────────────────────────────
// Roughly 95% of the photographs in the book used to print with no caption, no
// date and no name, because a mosaic cell rendered the image and nothing else.
// Rooted already stores a date and a child for every memory and often a caption,
// so that was a choice, not a limitation, and it made the collage pages a
// screensaver instead of a record. Every photograph now prints with at least a
// date. The cover and the chapter dividers are the only exceptions: they are
// design surfaces, not records.
//
// Pure + framework-free so the reader, the print path and the page-count helper
// all compose the same line, and so it is unit-testable.

/** Anything that knows when it happened. `takenAt` wins; `date` is the older name for the same value. */
export interface PhotoDateSource {
  takenAt?: string | null;
  date?: string | null;
}

export interface PhotoLineSource extends PhotoDateSource, CaptionSource {
  childName?: string | null;
}

/** One ISO date, whichever field carries it. */
export function photoTakenAt(p: PhotoDateSource): string | null {
  const iso = (p.takenAt ?? p.date ?? "").trim();
  return iso ? iso : null;
}

/**
 * "October 12". Month name and day, never the year: the year is on the cover
 * and repeating it under two hundred photographs is noise.
 *
 * Parsed at midday so a date-only string cannot slip to the previous day in a
 * timezone behind UTC, the same way the reader parses dates elsewhere.
 */
export function photoDateLabel(iso: string | null | undefined): string | null {
  const raw = (iso ?? "").slice(0, 10);
  if (!raw) return null;
  const dt = new Date(`${raw}T12:00:00`);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

/** Join the parts that exist with a middle dot. */
function joinParts(parts: (string | null | undefined)[]): string | null {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return kept.length > 0 ? kept.join(" · ") : null;
}

/**
 * The single line printed under a photograph in a collage cell.
 *
 * With a caption: the caption, then the date. Without one: the child's name,
 * then the date. With neither: just the date. A family memory with no caption
 * has no name to show, so it prints the date alone, which is still a record.
 */
export function photoCaptionLine(p: PhotoLineSource): string | null {
  const date = photoDateLabel(photoTakenAt(p));
  const caption = p.caption?.trim();
  if (caption) return joinParts([caption, date]);
  return joinParts([p.childName, date]);
}

/**
 * The name-and-date line that sits under a featured photograph's own caption,
 * where the caption already has a line of its own.
 */
export function photoMetaLine(p: PhotoLineSource): string | null {
  return joinParts([p.childName, photoDateLabel(photoTakenAt(p))]);
}

// ─── Print safe area ─────────────────────────────────────────────────────────
// Nothing that matters may sit within half an inch of the trim. The reader page
// is fluid rather than a fixed pixel size, so the margin is a fraction of the
// page: DEFAULT_MOSAIC_OPTS.pageAspect is 0.66, so a page 8.5in tall is about
// 5.6in wide, which puts half an inch at 9% of the width and 6% of the height.

export const SAFE_AREA_X = "9%";
export const SAFE_AREA_Y = "6%";
