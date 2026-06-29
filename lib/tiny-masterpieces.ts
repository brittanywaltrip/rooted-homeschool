// ─── Tiny Masterpieces ───────────────────────────────────────────────────────
// Drawings (memory type 'drawing') get their own gallery page instead of being
// mixed into the photo collage, each with the family's answer to the prompt
// "This piece reminds me of…". Only real captions are shown — never an empty
// prompt. Pure + framework-free so the reader and the PDF build them identically
// and so it's unit-testable.

export function isDrawing(m: { type: string }): boolean {
  return m.type === "drawing";
}

/** The line under a tiny masterpiece: the family's "reminds me of…" answer, or null. */
export function tinyMasterpieceCaption(caption: string | null | undefined): string | null {
  const c = caption?.trim();
  return c ? c : null;
}

/**
 * Split a chapter's photo memories into drawings (→ Tiny Masterpieces) and the
 * rest (→ collage), preserving order and dropping anything without a photo.
 */
export function partitionDrawings<T extends { type: string; photo_url?: string | null }>(
  memories: T[],
): { drawings: T[]; photos: T[] } {
  const drawings: T[] = [];
  const photos: T[] = [];
  for (const m of memories) {
    if (!m.photo_url) continue;
    (isDrawing(m) ? drawings : photos).push(m);
  }
  return { drawings, photos };
}

/** Group items into fixed-size pages (e.g. a 2×2 gallery), preserving order. */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size < 1) return arr.length ? [arr.slice()] : [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
