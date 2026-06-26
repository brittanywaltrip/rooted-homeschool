// Tests for lib/yearbook-photo-pages.ts — smart mosaic collage. Templates are
// chosen by photo count and photos are assigned to cells to minimize cropping:
// portraits land in tall cells, landscapes in wide cells, with top/bottom
// (head/feet) crops penalized over side crops.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectTemplate,
  buildMosaicPages,
  balancedChunks,
  photoAspect,
  cellAspect,
  cropCost,
  isPortrait,
  TEMPLATES,
  DEFAULT_MOSAIC_OPTS,
  DEFAULT_ASPECT,
  type PhotoItem,
} from "./yearbook-photo-pages.ts";

const PA = DEFAULT_MOSAIC_OPTS.pageAspect;

let seq = 0;
function photo(w: number, h: number): PhotoItem {
  return { id: `p${seq++}`, photo_url: "x", photo_width: w, photo_height: h };
}
const landscape = () => photo(1500, 1000); // 1.5
const portrait = () => photo(1000, 1500); // 0.667
const square = () => photo(1000, 1000); // 1.0
const noDims = (): PhotoItem => ({ id: `m${seq++}`, photo_url: "x" });
const many = (make: () => PhotoItem, n: number) => Array.from({ length: n }, () => make());

// Aspect of the cell a given photo was placed in.
function placedCellAspect(page: { cols: number; rows: number; cells: { c: number; r: number; cs: number; rs: number }[] }, i: number): number {
  return cellAspect(page.cells[i], page.cols, page.rows, PA);
}

test("photoAspect: real, square, missing (→ 1.5 landscape)", () => {
  assert.equal(photoAspect(landscape()), 1.5);
  assert.equal(photoAspect(square()), 1);
  assert.ok(Math.abs(photoAspect(portrait()) - 2 / 3) < 1e-9);
  assert.equal(photoAspect(noDims()), DEFAULT_ASPECT);
  assert.equal(DEFAULT_ASPECT, 1.5);
});

test("cropCost: vertical (top/bottom) crop costs more than the same side crop", () => {
  // portrait (0.667) into a wide cell (1.5) → vertical crop (head/feet)
  const vertical = cropCost(2 / 3, 1.5);
  // landscape (1.5) into a tall cell (0.667) → horizontal crop (sides)
  const horizontal = cropCost(1.5, 2 / 3);
  assert.ok(vertical > horizontal);
});

test("every template tiles its grid exactly (no gaps, no overlap)", () => {
  for (const [count, variants] of Object.entries(TEMPLATES)) {
    for (const v of variants) {
      const filled = Array.from({ length: v.rows }, () => Array(v.cols).fill(0));
      for (const cell of v.cells) {
        for (let r = cell.r; r < cell.r + cell.rs; r++) {
          for (let c = cell.c; c < cell.c + cell.cs; c++) {
            filled[r][c] += 1;
          }
        }
      }
      const flat = filled.flat();
      assert.ok(flat.every((x) => x === 1), `template ${count} tiles exactly`);
      assert.equal(v.cells.length, Number(count), `template ${count} has ${count} cells`);
    }
  }
});

test("2 portraits → two tall halves, each portrait in a tall (aspect<1) cell", () => {
  const page = selectTemplate(many(portrait, 2), PA);
  assert.equal(page.cols, 2);
  assert.equal(page.rows, 1);
  page.cells.forEach((_, i) => assert.ok(placedCellAspect(page, i) < 1, "tall cell"));
});

test("2 landscapes → two wide stacked halves (each cell aspect>1)", () => {
  const page = selectTemplate(many(landscape, 2), PA);
  assert.equal(page.cols, 1);
  assert.equal(page.rows, 2);
  page.cells.forEach((_, i) => assert.ok(placedCellAspect(page, i) > 1, "wide cell"));
});

test("portraits are placed in cells no wider than themselves (no head/feet crop)", () => {
  // mix of portraits + landscapes; each portrait should land in a cell whose
  // aspect is <= the photo's aspect, so any crop is on the sides, not top/bottom.
  const photos = [portrait(), landscape(), portrait(), landscape(), square()];
  const page = selectTemplate(photos, PA);
  page.cells.forEach((cell, i) => {
    const a = photoAspect(cell.photo);
    if (isPortrait(a)) {
      assert.ok(placedCellAspect(page, i) <= a + 1e-9, "portrait not in a wider cell");
    }
  });
});

test("balancedChunks: ≤ max, evenly split, no lonely trailing page", () => {
  assert.deepEqual(balancedChunks(1, 6), [1]);
  assert.deepEqual(balancedChunks(6, 6), [6]);
  assert.deepEqual(balancedChunks(7, 6), [4, 3]);
  assert.deepEqual(balancedChunks(13, 6), [5, 4, 4]);
  assert.deepEqual(balancedChunks(0, 6), []);
  for (const n of [1, 2, 5, 6, 7, 8, 11, 19, 24]) {
    const sizes = balancedChunks(n, 6);
    assert.equal(sizes.reduce((s, x) => s + x, 0), n);
    assert.ok(Math.max(...sizes) <= 6);
    assert.ok(Math.min(...sizes) >= 1);
  }
});

test("buildMosaicPages: empty → [], keeps ALL photos, splits across pages", () => {
  assert.deepEqual(buildMosaicPages([], DEFAULT_MOSAIC_OPTS), []);
  const input = [...many(landscape, 7), ...many(portrait, 6)]; // 13
  const pages = buildMosaicPages(input, DEFAULT_MOSAIC_OPTS);
  assert.ok(pages.length >= 2, "spills onto multiple pages");
  const flat = pages.flatMap((pg) => pg.cells.map((c) => c.photo.id));
  assert.equal(flat.length, input.length);
  assert.deepEqual([...flat].sort(), input.map((p) => p.id).sort());
  for (const pg of pages) assert.ok(pg.cells.length <= DEFAULT_MOSAIC_OPTS.maxPerPage);
});

test("missing-dimension photos behave as landscape (wide template for a pair)", () => {
  const page = selectTemplate(many(noDims, 2), PA);
  // two landscapes → two wide stacked
  assert.equal(page.cols, 1);
  assert.equal(page.rows, 2);
});
