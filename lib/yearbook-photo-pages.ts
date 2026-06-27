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
  /** Normalized 0..1 focal point for cover-fit cropping (null → default heuristic). */
  focal_x?: number | null;
  focal_y?: number | null;
  /** A featured photo gets its own full-bleed page instead of a mosaic cell. */
  featured?: boolean | null;
  /** false = hidden from the book (excluded everywhere). */
  include_in_book?: boolean | null;
  /** Content for a featured photo's caption (mosaic cells never show these). */
  caption?: string | null;
  title?: string | null;
  date?: string | null;
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

// How many mosaic PAGES a chapter's photos should occupy. A photo spread is two
// facing pages, so the count is kept EVEN (≥ 2) — a small chapter is split
// across both pages of its spread so a facing page is never left blank. A lone
// photo is the one exception: a single full-page feature.
export function pageCountFor(total: number, maxPerPage: number): number {
  if (total <= 1) return total;
  const min = Math.ceil(total / maxPerPage);
  return Math.max(2, min % 2 === 0 ? min : min + 1);
}

// Split `total` into `parts` balanced page sizes (bigger pages first). Each size
// is ≤ ceil(total/parts) ≤ maxPerPage, and ≥ 1.
export function splitBalanced(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return range(parts).map((i) => base + (i < extra ? 1 : 0));
}

// ─── Chapter photo allocation ────────────────────────────────────────────────
// A chapter wants to spend its photos on three things: a full-bleed feature
// divider (section opener), a "favorite things" photo, and the collage. But
// reservations must never starve the collage: after reserving, the collage has
// to be able to FILL its spread with no blank facing page. buildMosaicPages
// gives an even (blank-free) page count for any collage of ≥2 photos and a lone
// full page for exactly 1 — so the one count we must avoid for the collage is
// exactly 1 (a lonely page leaves its facing page blank).
//
// Rules (see planChapterPhotos):
//  - Photo-poor chapters keep their photos in the collage and use the designed
//    title-panel divider; a full-bleed PHOTO divider is used only when the
//    chapter has a photo to spare (≥ PHOTO_DIVIDER_MIN) so the collage still
//    fills.
//  - The favorite-things photo is reserved only if what's left still fills.
//  - If an allocation would leave the collage at exactly 1, a reserved photo is
//    handed back (or the lone photo is promoted to a single feature divider).

/** A chapter needs at least this many photos to spare one for a full-bleed feature divider. */
export const PHOTO_DIVIDER_MIN = 5;

export interface ChapterPhotoPlan {
  /** Use the most-recent spare photo as a full-bleed feature divider (else a title panel). */
  useFeaturePhoto: boolean;
  /** Reserve a photo for the "favorite things" slot (else a designed panel). */
  useFavPhoto: boolean;
  /** Photos left for the collage — always 0 or ≥2, never exactly 1. */
  collageCount: number;
}

export function planChapterPhotos(available: number, showFav: boolean): ChapterPhotoPlan {
  if (available <= 0) return { useFeaturePhoto: false, useFavPhoto: false, collageCount: 0 };

  // Spare a photo for a full-bleed feature divider only when the chapter is
  // photo-rich enough that the remaining photos still fill the collage.
  let useFeaturePhoto = available >= PHOTO_DIVIDER_MIN;
  let remaining = available - (useFeaturePhoto ? 1 : 0);

  // Take a favorites photo only if what's left still fills (0 or ≥2, never 1).
  let useFavPhoto = false;
  if (showFav && remaining >= 1) {
    const after = remaining - 1;
    if (after === 0 || after >= 2) {
      useFavPhoto = true;
      remaining = after;
    }
  }

  // A collage of exactly 1 can't fill its spread. Yield to page-fill: hand a
  // reserved photo back, or — if there's nothing to reclaim — make the lone
  // photo a single full-bleed feature divider so the collage empties cleanly.
  if (remaining === 1) {
    if (useFavPhoto) {
      useFavPhoto = false;
      remaining = 2;
    } else if (!useFeaturePhoto) {
      useFeaturePhoto = true;
      remaining = 0;
    } else {
      useFeaturePhoto = false;
      remaining = 2;
    }
  }

  return { useFeaturePhoto, useFavPhoto, collageCount: remaining };
}

export function buildMosaicPages(photos: PhotoItem[], opts: MosaicOpts = DEFAULT_MOSAIC_OPTS): MosaicPage[] {
  if (photos.length === 0) return [];
  const sizes = splitBalanced(photos.length, pageCountFor(photos.length, opts.maxPerPage));
  const pages: MosaicPage[] = [];
  let idx = 0;
  for (const size of sizes) {
    pages.push(selectTemplate(photos.slice(idx, idx + size), opts.pageAspect));
    idx += size;
  }
  return pages;
}

// ─── Hide + feature ──────────────────────────────────────────────────────────

/** Photos that belong in the book — hidden (include_in_book === false) are dropped. */
export function keepInBook<T extends { include_in_book?: boolean | null }>(photos: T[]): T[] {
  return photos.filter((p) => p.include_in_book !== false);
}

// A chapter's photo flow as an ordered list of page UNITS: a featured photo
// becomes its own solo full-bleed page at its ordered position, while each
// maximal run of non-featured photos is mosaicked into one or more pages. With
// nothing featured this is exactly buildMosaicPages wrapped as mosaic units, so
// chapters without features render unchanged. Featuring many photos just yields
// many solo pages in order (no silliness, no cell resizing).
export type ChapterPhotoUnit =
  | { kind: "mosaic"; page: MosaicPage }
  | { kind: "feature"; photo: PhotoItem };

export function buildChapterPhotoUnits(
  photos: PhotoItem[],
  opts: MosaicOpts = DEFAULT_MOSAIC_OPTS,
): ChapterPhotoUnit[] {
  const units: ChapterPhotoUnit[] = [];
  let run: PhotoItem[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    for (const page of buildMosaicPages(run, opts)) units.push({ kind: "mosaic", page });
    run = [];
  };
  for (const p of photos) {
    if (p.featured) {
      flushRun();
      units.push({ kind: "feature", photo: p });
    } else {
      run.push(p);
    }
  }
  flushRun();
  return units;
}
