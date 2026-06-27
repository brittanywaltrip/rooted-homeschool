// Tests for lib/yearbook-photo-pages.ts — smart mosaic collage. Templates are
// chosen by photo count and photos are assigned to cells to minimize cropping:
// portraits land in tall cells, landscapes in wide cells, with top/bottom
// (head/feet) crops penalized over side crops.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectTemplate,
  buildMosaicPages,
  pageCountFor,
  splitBalanced,
  photoAspect,
  cellAspect,
  cropCost,
  isPortrait,
  planChapterPhotos,
  PHOTO_DIVIDER_MIN,
  buildChapterPhotoUnits,
  keepInBook,
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

test("pageCountFor / splitBalanced", () => {
  assert.equal(pageCountFor(0, 6), 0);
  assert.equal(pageCountFor(1, 6), 1); // lone photo → single feature page
  assert.equal(pageCountFor(2, 6), 2);
  assert.equal(pageCountFor(3, 6), 2);
  assert.equal(pageCountFor(6, 6), 2); // split across both pages, not one crammed page
  assert.equal(pageCountFor(12, 6), 2);
  assert.equal(pageCountFor(13, 6), 4); // ceil(13/6)=3 → bumped to even 4
  assert.deepEqual(splitBalanced(3, 2), [2, 1]); // 3 → 2 left, 1 right
  assert.deepEqual(splitBalanced(6, 2), [3, 3]);
  assert.deepEqual(splitBalanced(13, 4), [4, 3, 3, 3]);
});

test("3 photos fill BOTH pages of the spread (2 left, 1 right) — no blank facing page", () => {
  const pages = buildMosaicPages(many(landscape, 3), DEFAULT_MOSAIC_OPTS);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((p) => p.cells.length), [2, 1]);
});

test("1 photo → a single full-page feature (one page, not paired into a 2-page split)", () => {
  const pages = buildMosaicPages([landscape()], DEFAULT_MOSAIC_OPTS);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].cells.length, 1);
});

test("6 photos split across both pages of one spread, not one crammed page", () => {
  const pages = buildMosaicPages(many(landscape, 6), DEFAULT_MOSAIC_OPTS);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((p) => p.cells.length), [3, 3]);
});

test("every chapter of ≥2 photos has an EVEN page count (so a spread never leaves a blank)", () => {
  for (let t = 2; t <= 30; t++) {
    const pages = buildMosaicPages(many(landscape, t), DEFAULT_MOSAIC_OPTS);
    assert.equal(pages.length % 2, 0, `T=${t} → even pages`);
    assert.equal(pages.reduce((s, p) => s + p.cells.length, 0), t, "all photos kept");
    for (const p of pages) assert.ok(p.cells.length >= 1 && p.cells.length <= DEFAULT_MOSAIC_OPTS.maxPerPage);
  }
});

test("buildMosaicPages: empty → [], all photos kept, pages are sequential slices", () => {
  assert.deepEqual(buildMosaicPages([], DEFAULT_MOSAIC_OPTS), []);
  const input = [...many(landscape, 5), ...many(portrait, 8)]; // 13
  const pages = buildMosaicPages(input, DEFAULT_MOSAIC_OPTS);
  const flat = pages.flatMap((pg) => pg.cells.map((c) => c.photo.id));
  assert.equal(flat.length, input.length);
  assert.deepEqual([...flat].sort(), input.map((p) => p.id).sort());
  // Within a page assignment may reorder for crop, but pages are chronological slices.
  let idx = 0;
  for (const pg of pages) {
    const ids = pg.cells.map((c) => c.photo.id).sort();
    const expected = input.slice(idx, idx + pg.cells.length).map((p) => p.id).sort();
    assert.deepEqual(ids, expected);
    idx += pg.cells.length;
  }
});

// ─── planChapterPhotos — reservations must not starve the collage ────────────

test("planChapterPhotos: no photos → title panel, no fav, empty collage", () => {
  for (const showFav of [true, false]) {
    assert.deepEqual(planChapterPhotos(0, showFav), {
      useFeaturePhoto: false,
      useFavPhoto: false,
      collageCount: 0,
    });
  }
});

test("planChapterPhotos: 1 photo never lands a lonely collage page", () => {
  // with favorites on, the single photo goes to favorites; collage stays empty
  assert.deepEqual(planChapterPhotos(1, true), {
    useFeaturePhoto: false,
    useFavPhoto: true,
    collageCount: 0,
  });
  // with favorites off there's nothing to reclaim → the lone photo becomes a
  // single full-bleed feature divider, not a 1-photo collage (blank facing page)
  assert.deepEqual(planChapterPhotos(1, false), {
    useFeaturePhoto: true,
    useFavPhoto: false,
    collageCount: 0,
  });
});

test("planChapterPhotos: 2 photos stay in the collage behind a title panel", () => {
  // taking a favorites photo would leave collage=1 (blank facing) → don't
  assert.deepEqual(planChapterPhotos(2, true), {
    useFeaturePhoto: false,
    useFavPhoto: false,
    collageCount: 2,
  });
  assert.deepEqual(planChapterPhotos(2, false), {
    useFeaturePhoto: false,
    useFavPhoto: false,
    collageCount: 2,
  });
});

test("planChapterPhotos: Zoe's 3-photo chapter never leaves a blank facing page", () => {
  // 3 photos, favorites on: title-panel divider + 1 favorites photo + collage 2
  const withFav = planChapterPhotos(3, true);
  assert.equal(withFav.useFeaturePhoto, false, "photo-poor → title panel divider");
  assert.equal(withFav.collageCount, 2, "collage fills both pages");
  assert.notEqual(withFav.collageCount, 1);
  // favorites off → all three stay in the collage (2 + 1, both pages used)
  assert.deepEqual(planChapterPhotos(3, false), {
    useFeaturePhoto: false,
    useFavPhoto: false,
    collageCount: 3,
  });
});

test("planChapterPhotos: a photo-rich chapter spares one for a full-bleed divider", () => {
  const p = planChapterPhotos(PHOTO_DIVIDER_MIN, true);
  assert.equal(p.useFeaturePhoto, true, "≥ PHOTO_DIVIDER_MIN → photo divider");
  assert.equal(p.useFeaturePhoto && p.useFavPhoto, true);
  assert.equal(p.collageCount, PHOTO_DIVIDER_MIN - 2);
  assert.ok(p.collageCount >= 2, "collage still fills");
  // just below the threshold keeps the title panel + photos in the collage
  assert.equal(planChapterPhotos(PHOTO_DIVIDER_MIN - 1, false).useFeaturePhoto, false);
});

test("planChapterPhotos: invariants hold for every chapter size, and the collage never blanks", () => {
  for (let n = 0; n <= 30; n++) {
    for (const showFav of [true, false]) {
      const p = planChapterPhotos(n, showFav);
      // every photo is accounted for exactly once
      assert.equal(
        (p.useFeaturePhoto ? 1 : 0) + (p.useFavPhoto ? 1 : 0) + p.collageCount,
        n,
        `n=${n} showFav=${showFav}: counts add up`,
      );
      // the collage is never the lonely 1 that leaves a blank facing page
      assert.ok(p.collageCount === 0 || p.collageCount >= 2, `n=${n} showFav=${showFav}: collage 0 or ≥2`);
      // and the actual mosaic it produces has an even (blank-free) page count
      const pages = buildMosaicPages(Array.from({ length: p.collageCount }, landscape), DEFAULT_MOSAIC_OPTS);
      assert.equal(pages.length % 2, 0, `n=${n} showFav=${showFav}: collage pages fill spreads`);
      // a full-bleed photo divider is only spent when there's a photo to spare
      if (p.useFeaturePhoto) {
        assert.ok(n >= PHOTO_DIVIDER_MIN || (n === 1 && !showFav), `n=${n}: photo divider only with a spare (or lone fallback)`);
      }
    }
  }
});

// ─── keepInBook — hidden photos are excluded ─────────────────────────────────

test("keepInBook: drops include_in_book === false, keeps true / null / undefined", () => {
  const rows = [
    { id: "a", include_in_book: true },
    { id: "b", include_in_book: false },
    { id: "c", include_in_book: null },
    { id: "d" },
  ];
  assert.deepEqual(keepInBook(rows).map((r) => r.id), ["a", "c", "d"]);
});

test("keepInBook: a hidden photo never reaches the collage", () => {
  const photos: PhotoItem[] = [
    { id: "p0", photo_url: "x", include_in_book: true },
    { id: "p1", photo_url: "x", include_in_book: false },
    { id: "p2", photo_url: "x", include_in_book: true },
  ];
  const visible = keepInBook(photos);
  const units = buildChapterPhotoUnits(visible);
  const idsInPages = units.flatMap((u) => (u.kind === "mosaic" ? u.page.cells.map((c) => c.photo.id) : [u.photo.id]));
  assert.ok(!idsInPages.includes("p1"), "hidden photo excluded from rendered pages");
  assert.deepEqual([...idsInPages].sort(), ["p0", "p2"]);
});

// ─── buildChapterPhotoUnits — featured photos get their own page ─────────────

const featured = (): PhotoItem => ({ id: `f${seq++}`, photo_url: "x", photo_width: 1500, photo_height: 1000, featured: true });

test("buildChapterPhotoUnits: no featured photos → mosaic units only (unchanged flow)", () => {
  const photos = many(landscape, 4);
  const units = buildChapterPhotoUnits(photos);
  assert.ok(units.every((u) => u.kind === "mosaic"));
  // same pages as buildMosaicPages directly
  const direct = buildMosaicPages(photos);
  assert.equal(units.length, direct.length);
});

test("buildChapterPhotoUnits: a featured photo becomes its own solo feature page at its position", () => {
  const a = landscape(), b = featured(), c = landscape(), d = landscape();
  const units = buildChapterPhotoUnits([a, b, c, d]);
  // a → mosaic run [a]; b → feature; [c,d] → mosaic run
  assert.equal(units[0].kind, "mosaic");
  assert.equal(units[1].kind, "feature");
  assert.equal(units[1].kind === "feature" && units[1].photo.id, b.id);
  assert.equal(units[2].kind, "mosaic");
  // the featured photo is NOT in any mosaic cell
  const inMosaic = units.flatMap((u) => (u.kind === "mosaic" ? u.page.cells.map((c2) => c2.photo.id) : []));
  assert.ok(!inMosaic.includes(b.id));
});

test("buildChapterPhotoUnits: featured photos keep their ordered position", () => {
  const f1 = featured(), f2 = featured();
  const units = buildChapterPhotoUnits([f1, landscape(), landscape(), f2]);
  const featureIds = units.filter((u) => u.kind === "feature").map((u) => (u as { photo: PhotoItem }).photo.id);
  assert.deepEqual(featureIds, [f1.id, f2.id]); // order preserved, f1 before the run, f2 after
  assert.equal(units[0].kind, "feature");
  assert.equal(units[units.length - 1].kind, "feature");
});

test("buildChapterPhotoUnits: featuring everything → all solo pages, in order, every photo kept", () => {
  const fs = [featured(), featured(), featured()];
  const units = buildChapterPhotoUnits(fs);
  assert.equal(units.length, 3);
  assert.ok(units.every((u) => u.kind === "feature"));
  assert.deepEqual(units.map((u) => (u as { photo: PhotoItem }).photo.id), fs.map((f) => f.id));
});

test("buildChapterPhotoUnits: every photo appears exactly once across all units", () => {
  const photos = [featured(), landscape(), landscape(), featured(), landscape(), portrait()];
  const units = buildChapterPhotoUnits(photos);
  const seen = units.flatMap((u) => (u.kind === "feature" ? [u.photo.id] : u.page.cells.map((c) => c.photo.id)));
  assert.equal(seen.length, photos.length);
  assert.deepEqual([...seen].sort(), photos.map((p) => p.id).sort());
});

test("missing-dimension photos behave as landscape (wide template for a pair)", () => {
  const page = selectTemplate(many(noDims, 2), PA);
  // two landscapes → two wide stacked
  assert.equal(page.cols, 1);
  assert.equal(page.rows, 2);
});
