// Tests for lib/yearbook-photo-pages.ts — justified-rows packing (Google-Photos
// / photo-book style). Photos fill rows edge-to-edge by scaling widths to their
// true aspect ratios; tall photos are never cropped and a too-sparse trailing
// row (e.g. a lone portrait) is not stretched to full width.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRows,
  paginateRows,
  buildCollagePages,
  photoAspect,
  DEFAULT_JUSTIFIED_OPTS,
  DEFAULT_ASPECT,
  type PhotoItem,
  type JustifiedOpts,
} from "./yearbook-photo-pages.ts";

const OPTS: JustifiedOpts = DEFAULT_JUSTIFIED_OPTS;

let seq = 0;
function photo(w: number, h: number): PhotoItem {
  return { id: `p${seq++}`, photo_url: "x", photo_width: w, photo_height: h };
}
const landscape = () => photo(1500, 1000); // 3:2 → 1.5
const portrait = () => photo(1000, 1500); // 2:3 → 0.667
const square = () => photo(1000, 1000); // 1.0
const noDims = (): PhotoItem => ({ id: `m${seq++}`, photo_url: "x" });
const many = (make: () => PhotoItem, n: number) => Array.from({ length: n }, () => make());

// A justified row, by construction, fills the page width: the sum of each
// photo's width (aspect × row height) plus the inter-photo gaps equals 1.
function rowFillsWidth(aspects: number[], height: number, gap: number): boolean {
  const widths = aspects.reduce((s, a) => s + a * height, 0);
  const gaps = (aspects.length - 1) * gap;
  return Math.abs(widths + gaps - 1) < 1e-9;
}

test("photoAspect: real dims, square, and missing dims (→ 3:2)", () => {
  assert.equal(photoAspect(landscape()), 1.5);
  assert.equal(photoAspect(square()), 1);
  assert.ok(Math.abs(photoAspect(portrait()) - 2 / 3) < 1e-9);
  assert.equal(photoAspect(noDims()), DEFAULT_ASPECT);
  assert.equal(DEFAULT_ASPECT, 1.5);
});

test("landscapes pack ~2 per justified row, each row fills the width edge to edge", () => {
  const rows = buildRows(many(landscape, 6), OPTS);
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.equal(row.justified, true);
    assert.ok(row.height <= OPTS.targetRowH + 1e-9, "closed rows are no taller than target");
    assert.ok(rowFillsWidth(row.aspects, row.height, OPTS.gap), "row fills full page width");
  }
  // all 6 photos accounted for, in order
  assert.equal(rows.flatMap((r) => r.photos).length, 6);
});

test("a lone portrait is NOT stretched to full width (capped, un-justified)", () => {
  const rows = buildRows([portrait()], OPTS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].justified, false);
  assert.equal(rows[0].height, OPTS.maxRowH);
});

test("a lone landscape becomes a justified full-width banner", () => {
  const rows = buildRows([landscape()], OPTS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].justified, true);
  // single photo justified to width 1 → height = 1 / aspect
  assert.ok(Math.abs(rows[0].height - 1 / 1.5) < 1e-9);
});

test("portraits make taller rows than landscapes (still justified, no crop)", () => {
  const pRows = buildRows(many(portrait, 4), OPTS);
  const lRows = buildRows(many(landscape, 4), OPTS);
  for (const r of [...pRows, ...lRows]) {
    if (r.justified) assert.ok(rowFillsWidth(r.aspects, r.height, OPTS.gap));
  }
  // a justified portrait row is taller than a justified landscape row
  const pH = pRows.find((r) => r.justified)!.height;
  const lH = lRows.find((r) => r.justified)!.height;
  assert.ok(pH > lH);
});

test("paginateRows splits rows across pages when the page height fills", () => {
  // 30 landscapes → many short rows → must span multiple pages
  const rows = buildRows(many(landscape, 30), OPTS);
  const pages = paginateRows(rows, OPTS);
  assert.ok(pages.length >= 2, "spills onto multiple pages");
  for (const pg of pages) {
    const total = pg.rows.reduce((s, r) => s + r.height, 0) + (pg.rows.length - 1) * OPTS.gap;
    assert.ok(total <= OPTS.pageH + 1e-9, "no page exceeds the page height");
    assert.ok(pg.rows.length >= 1);
  }
});

test("buildCollagePages: empty in → empty out, and every photo is kept in order", () => {
  assert.deepEqual(buildCollagePages([], OPTS), []);
  const input = [...many(landscape, 5), ...many(portrait, 3), ...many(square, 2)];
  const pages = buildCollagePages(input, OPTS);
  const flat = pages.flatMap((pg) => pg.rows.flatMap((r) => r.photos));
  assert.equal(flat.length, input.length);
  assert.deepEqual(flat.map((p) => p.id), input.map((p) => p.id));
});

test("missing dimensions are treated as 3:2 landscape (tile, never capped alone-as-portrait)", () => {
  const rows = buildRows(many(noDims, 2), OPTS);
  // two 1.5-aspect photos → one justified row that fills width
  assert.equal(rows.length, 1);
  assert.equal(rows[0].justified, true);
  assert.ok(rowFillsWidth(rows[0].aspects, rows[0].height, OPTS.gap));
});
