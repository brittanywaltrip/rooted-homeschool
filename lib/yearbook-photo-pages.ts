// ─── Yearbook justified-rows packing ─────────────────────────────────────────
// Pure TypeScript (no React) so it's unit-testable. Lays a chapter's photos out
// in justified rows — Google-Photos / photo-book style — then paginates the
// rows down each page.
//
// Within a justified row every photo shares one height and its width scales by
// its true aspect ratio, so the row fills the page width edge to edge with a
// small uniform gap and NOTHING is cropped (each photo's box matches its own
// ratio — no letterbox mat). Layout is computed deterministically from a fixed
// LOGICAL page (width = 1 unit, height = `pageH` units) + the stored aspect
// ratios, so the on-screen reader and the PDF print path render identically (no
// runtime container measurement).

export interface PhotoItem {
  id: string;
  photo_url: string | null;
  photo_width?: number | null;
  photo_height?: number | null;
}

export interface CollageRow {
  photos: PhotoItem[];
  /** Aspect ratio (width / height) per photo, defaulted for missing dims. */
  aspects: number[];
  /** true → justify to full page width (flex-grow). false → a too-sparse row
   *  (e.g. a lone portrait) rendered at `maxRowH` with natural widths, centered,
   *  so it doesn't blow up to full width. */
  justified: boolean;
  /** Row height as a fraction of page width (used for pagination + tests). */
  height: number;
}

export interface CollagePageRows {
  rows: CollageRow[];
}

export interface JustifiedOpts {
  /** Close a row once justifying it to full width drops to this height (fraction of page width). */
  targetRowH: number;
  /** A trailing row taller than this when justified is rendered un-justified at this height. */
  maxRowH: number;
  /** Uniform gap as a fraction of page width (affects row breaks; render gap is a small px value). */
  gap: number;
  /** Page content height as a fraction of page width (pagination fills to here). */
  pageH: number;
}

// Tuned for the reader's book-page proportions. Adjust here to make pages denser
// or roomier — both the reader and the PDF read from these same numbers.
export const DEFAULT_JUSTIFIED_OPTS: JustifiedOpts = {
  targetRowH: 0.58,
  maxRowH: 0.92,
  gap: 0.008,
  pageH: 1.5,
};

/** Missing dimensions → assume a 3:2 landscape so the photo tiles normally. */
export const DEFAULT_ASPECT = 3 / 2;

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

// Height (fraction of page width) a row of `count` photos with aspect-sum
// `aspectSum` takes when justified to full width with (count-1) gaps.
function justifiedHeight(count: number, aspectSum: number, gap: number): number {
  return (1 - (count - 1) * gap) / aspectSum;
}

/** Greedily break photos into justified rows (chronological order preserved). */
export function buildRows(photos: PhotoItem[], opts: JustifiedOpts = DEFAULT_JUSTIFIED_OPTS): CollageRow[] {
  const rows: CollageRow[] = [];
  let cur: PhotoItem[] = [];
  let aspects: number[] = [];
  let sum = 0;

  for (const p of photos) {
    const r = photoAspect(p);
    cur.push(p);
    aspects.push(r);
    sum += r;
    const h = justifiedHeight(cur.length, sum, opts.gap);
    if (h <= opts.targetRowH) {
      rows.push({ photos: cur, aspects, justified: true, height: h });
      cur = [];
      aspects = [];
      sum = 0;
    }
  }

  // Trailing leftover row.
  if (cur.length > 0) {
    const h = justifiedHeight(cur.length, sum, opts.gap);
    if (h <= opts.maxRowH) {
      rows.push({ photos: cur, aspects, justified: true, height: h });
    } else {
      // Too sparse to justify (a lone portrait, say) — keep its real shape at
      // maxRowH instead of stretching it across the whole page.
      rows.push({ photos: cur, aspects, justified: false, height: opts.maxRowH });
    }
  }

  return rows;
}

/** Stack rows down each page until the page height is filled, then continue. */
export function paginateRows(rows: CollageRow[], opts: JustifiedOpts = DEFAULT_JUSTIFIED_OPTS): CollagePageRows[] {
  const pages: CollagePageRows[] = [];
  let cur: CollageRow[] = [];
  let curH = 0;

  for (const row of rows) {
    const gapBefore = cur.length > 0 ? opts.gap : 0;
    if (cur.length > 0 && curH + gapBefore + row.height > opts.pageH) {
      pages.push({ rows: cur });
      cur = [row];
      curH = row.height;
    } else {
      cur.push(row);
      curH += gapBefore + row.height;
    }
  }
  if (cur.length > 0) pages.push({ rows: cur });

  return pages;
}

export function buildCollagePages(photos: PhotoItem[], opts: JustifiedOpts = DEFAULT_JUSTIFIED_OPTS): CollagePageRows[] {
  if (photos.length === 0) return [];
  return paginateRows(buildRows(photos, opts), opts);
}
