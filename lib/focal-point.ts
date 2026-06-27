// ─── Per-photo focal point ───────────────────────────────────────────────────
// A focal point is a normalized (0..1) coordinate on a photo that a family wants
// kept in view when the photo fills a cover-fit frame (the yearbook cover and
// any collage cell). It maps directly to CSS `object-position`. When no focal
// point is set we fall back to the existing orientation heuristic (portraits
// bias toward the top so heads/faces aren't cropped; everything else centers).
//
// Pure + framework-free so the reader and the PDF print path apply it
// identically, and so it can be unit-tested.

const PORTRAIT_ASPECT_CUTOFF = 0.9;

export function isValidFocal(
  x: number | null | undefined,
  y: number | null | undefined,
): boolean {
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1
  );
}

/** Clamp a raw drag value into the valid 0..1 focal range. */
export function clampFocal(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

/**
 * CSS `object-position` for a cover-fit photo. Uses the stored focal point when
 * present and valid, otherwise the orientation-aware default (portrait bias
 * ~50%/35%, else centered). `aspect` is width/height of the photo.
 */
export function focalObjectPosition(
  focalX: number | null | undefined,
  focalY: number | null | undefined,
  aspect: number,
): string {
  if (isValidFocal(focalX, focalY)) {
    const fx = +((focalX as number) * 100).toFixed(2);
    const fy = +((focalY as number) * 100).toFixed(2);
    return `${fx}% ${fy}%`;
  }
  return aspect < PORTRAIT_ASPECT_CUTOFF ? "center 35%" : "center";
}
