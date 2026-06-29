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
