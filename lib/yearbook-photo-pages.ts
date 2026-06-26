// ─── Yearbook smart mosaic collage ───────────────────────────────────────────
// Pure TypeScript (no React), so it's unit-testable. Tiles each page with a
// curated template chosen by photo count, then assigns photos to cells to
// minimize cropping — portraits into tall cells, landscapes into wide cells —
// using simple orientation heuristics (NO AI / face detection).
//
// Cropping is direction-aware: a cell crop along the photo's SIDES (horizontal)
// is gentle, but a crop along the TOP/BOTTOM (vertical) risks chopping
// heads/feet, so it's penalized heavily. The renderer fills each cell with
// object-cover plus a focal object-position (portraits biased toward the top),
// so the page fills edge to edge with no gaps and faces are kept.
//
// Templates + assignment are computed deterministically from stored aspect
// ratios + a fixed logical page aspect, and rendered in pure CSS grid, so the
// on-screen reader and the PDF print path render identically.

export interface PhotoItem {
  id: string;
  photo_url: string | null;
  photo_width?: number | null;
  photo_height?: number | null;
}

/** A cell's placement in the template's grid (0-based start, span counts). */
export interface CellRect {
  c: number;
  r: number;
  cs: number;
  rs: number;
}

export interface TemplateVariant {
  cols: number;
  rows: number;
  cells: CellRect[];
}

export interface PlacedCell extends CellRect {
  photo: PhotoItem;
}

export interface MosaicPage {
  cols: number;
  rows: number;
  cells: PlacedCell[];
}

export interface MosaicOpts {
  /** Page content aspect (width / height). The reader page is portrait-ish. */
  pageAspect: number;
  maxPerPage: number;
}

export const DEFAULT_MOSAIC_OPTS: MosaicOpts = {
  pageAspect: 0.66,
  maxPerPage: 6,
};

/** Missing dimensions → assume a 3:2 landscape (per project rule). */
export const DEFAULT_ASPECT = 1.5;

export function photoAspect(p: PhotoItem): number {
  if (
    typeof p.photo_width === "number" &&
    typeof p.photo_height === "number" &&
    p.photo_width > 0 &&
    p.photo_height > 0
  ) {
    return p.photo_width / p.photo_height;
  }
  return DEFAULT_ASPECT;
}

export function isPortrait(aspect: number): boolean {
  return aspect < 0.9;
}

/** Rendered aspect (w/h) of a cell, given the template grid + page aspect. */
export function cellAspect(cell: CellRect, cols: number, rows: number, pageAspect: number): number {
  return ((cell.cs * rows) / (cell.rs * cols)) * pageAspect;
}

// Cost of cover-fitting a photo (aspect Ap) into a cell (aspect Ac). When the
// photo is relatively WIDER than the cell it's cropped on the sides (gentle);
// when it's relatively TALLER it's cropped top/bottom — heads/feet — which we
// weight heavily so portraits avoid wide cells.
const VERTICAL_CROP_WEIGHT = 3;
export function cropCost(Ap: number, Ac: number): number {
  if (Ap >= Ac) {
    // photo wider than cell → horizontal (side) crop, gentle
    return 1 - Ac / Ap;
  }
  // photo taller than cell → vertical (top/bottom) crop, penalized
  return (1 - Ap / Ac) * VERTICAL_CROP_WEIGHT;
}

// ─── Curated templates by photo count (each tiles its grid exactly) ──────────

export const TEMPLATES: Record<number, TemplateVariant[]> = {
  1: [{ cols: 1, rows: 1, cells: [{ c: 0, r: 0, cs: 1, rs: 1 }] }],
  2: [
    // two tall halves (portraits)
    { cols: 2, rows: 1, cells: [{ c: 0, r: 0, cs: 1, rs: 1 }, { c: 1, r: 0, cs: 1, rs: 1 }] },
    // two wide halves stacked (landscapes)
    { cols: 1, rows: 2, cells: [{ c: 0, r: 0, cs: 1, rs: 1 }, { c: 0, r: 1, cs: 1, rs: 1 }] },
  ],
  3: [
    // tall feature left + two stacked right
    { cols: 2, rows: 2, cells: [{ c: 0, r: 0, cs: 1, rs: 2 }, { c: 1, r: 0, cs: 1, rs: 1 }, { c: 1, r: 1, cs: 1, rs: 1 }] },
    // three wide stacked
    { cols: 1, rows: 3, cells: [{ c: 0, r: 0, cs: 1, rs: 1 }, { c: 0, r: 1, cs: 1, rs: 1 }, { c: 0, r: 2, cs: 1, rs: 1 }] },
    // wide top + two tall bottom
    { cols: 2, rows: 2, cells: [{ c: 0, r: 0, cs: 2, rs: 1 }, { c: 0, r: 1, cs: 1, rs: 1 }, { c: 1, r: 1, cs: 1, rs: 1 }] },
  ],
  4: [
    // 2x2
    { cols: 2, rows: 2, cells: [{ c: 0, r: 0, cs: 1, rs: 1 }, { c: 1, r: 0, cs: 1, rs: 1 }, { c: 0, r: 1, cs: 1, rs: 1 }, { c: 1, r: 1, cs: 1, rs: 1 }] },
    // tall feature left + three stacked right
    { cols: 3, rows: 3, cells: [{ c: 0, r: 0, cs: 2, rs: 3 }, { c: 2, r: 0, cs: 1, rs: 1 }, { c: 2, r: 1, cs: 1, rs: 1 }, { c: 2, r: 2, cs: 1, rs: 1 }] },
  ],
  5: [
    // big feature top-left + three down the right + one wide along the bottom
    { cols: 3, rows: 3, cells: [{ c: 0, r: 0, cs: 2, rs: 2 }, { c: 2, r: 0, cs: 1, rs: 1 }, { c: 2, r: 1, cs: 1, rs: 1 }, { c: 2, r: 2, cs: 1, rs: 1 }, { c: 0, r: 2, cs: 2, rs: 1 }] },
  ],
  6: [
    // 3 x 2
    { cols: 3, rows: 2, cells: [{ c: 0, r: 0, cs: 1, rs: 1 }, { c: 1, r: 0, cs: 1, rs: 1 }, { c: 2, r: 0, cs: 1, rs: 1 }, { c: 0, r: 1, cs: 1, rs: 1 }, { c: 1, r: 1, cs: 1, rs: 1 }, { c: 2, r: 1, cs: 1, rs: 1 }] },
    // feature top-left + five around
    { cols: 3, rows: 3, cells: [{ c: 0, r: 0, cs: 2, rs: 2 }, { c: 2, r: 0, cs: 1, rs: 1 }, { c: 2, r: 1, cs: 1, rs: 1 }, { c: 2, r: 2, cs: 1, rs: 1 }, { c: 0, r: 2, cs: 1, rs: 1 }, { c: 1, r: 2, cs: 1, rs: 1 }] },
  ],
};

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  const out: number[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([items[i], ...p]);
  }
  return out;
}

/**
 * Pick the template variant + photo→cell assignment with the least total crop
 * cost. Deterministic (brute force over ≤6 photos; first minimum wins).
 */
export function selectTemplate(photos: PhotoItem[], pageAspect: number): MosaicPage {
  const n = photos.length;
  const variants = TEMPLATES[n] ?? TEMPLATES[Math.min(Math.max(n, 1), 6)];
  const aspects = photos.map(photoAspect);
  const perms = permutations(range(n));

  let best: { cost: number; variant: TemplateVariant; order: number[] } | null = null;
  for (const variant of variants) {
    const cellAspects = variant.cells.map((cell) => cellAspect(cell, variant.cols, variant.rows, pageAspect));
    for (const perm of perms) {
      let cost = 0;
      for (let i = 0; i < n; i++) cost += cropCost(aspects[perm[i]], cellAspects[i]);
      if (!best || cost < best.cost - 1e-12) best = { cost, variant, order: perm };
    }
  }

  const v = best!.variant;
  const cells: PlacedCell[] = v.cells.map((cell, i) => ({ ...cell, photo: photos[best!.order[i]] }));
  return { cols: v.cols, rows: v.rows, cells };
}

/** Split N into balanced page sizes (≤ maxPerPage, no lonely trailing page). */
export function balancedChunks(total: number, maxPerPage: number): number[] {
  if (total <= 0) return [];
  const pages = Math.ceil(total / maxPerPage);
  const base = Math.floor(total / pages);
  const extra = total % pages;
  return range(pages).map((i) => base + (i < extra ? 1 : 0));
}

export function buildMosaicPages(photos: PhotoItem[], opts: MosaicOpts = DEFAULT_MOSAIC_OPTS): MosaicPage[] {
  if (photos.length === 0) return [];
  const sizes = balancedChunks(photos.length, opts.maxPerPage);
  const pages: MosaicPage[] = [];
  let idx = 0;
  for (const size of sizes) {
    pages.push(selectTemplate(photos.slice(idx, idx + size), opts.pageAspect));
    idx += size;
  }
  return pages;
}
