// Tests for lib/yearbook-photo-pages.ts — the chapter photo-paging rule:
// wide/square photos tile into collages of up to 6; tall photos are lifted out
// (paired or hero) so they're never crammed into a small cell. Missing
// dimensions are treated as wide.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPhotoPages, isTallPhoto, type PhotoPageItem } from "./yearbook-photo-pages.ts";

let seq = 0;
function wide(): PhotoPageItem {
  return { id: `w${seq++}`, photo_url: "x", photo_width: 1200, photo_height: 800 }; // 1.5 → wide
}
function tall(): PhotoPageItem {
  return { id: `t${seq++}`, photo_url: "x", photo_width: 800, photo_height: 1200 }; // 0.67 → tall
}
function missing(): PhotoPageItem {
  return { id: `m${seq++}`, photo_url: "x" }; // no dimensions
}
function many(make: () => PhotoPageItem, n: number): PhotoPageItem[] {
  return Array.from({ length: n }, () => make());
}

test("isTallPhoto: only when both dims present and ratio < 0.9", () => {
  assert.equal(isTallPhoto(tall()), true);
  assert.equal(isTallPhoto(wide()), false);
  assert.equal(isTallPhoto(missing()), false); // unknown → wide
  assert.equal(isTallPhoto({ id: "s", photo_url: "x", photo_width: 1000, photo_height: 1000 }), false); // square
});

test("1 photo → hero", () => {
  const pages = buildPhotoPages([wide()]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].kind, "hero");
  assert.equal(pages[0].photos.length, 1);
});

test("2 photos → pair", () => {
  const pages = buildPhotoPages(many(wide, 2));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].kind, "pair");
  assert.equal(pages[0].photos.length, 2);
});

test("3 photos → grid", () => {
  const pages = buildPhotoPages(many(wide, 3));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].kind, "grid");
  assert.equal(pages[0].photos.length, 3);
});

test("4 landscapes → one grid of 4 (2x2)", () => {
  const pages = buildPhotoPages(many(wide, 4));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].kind, "grid");
  assert.equal(pages[0].photos.length, 4);
});

test("6 landscapes → one grid of 6 (2x3)", () => {
  const pages = buildPhotoPages(many(wide, 6));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].kind, "grid");
  assert.equal(pages[0].photos.length, 6);
});

test("7 landscapes → two pages (grid of 6 + a trailing single)", () => {
  const pages = buildPhotoPages(many(wide, 7));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].kind, "grid");
  assert.equal(pages[0].photos.length, 6);
  // trailing single is a hero (never a 1-cell grid)
  assert.equal(pages[1].kind, "hero");
  assert.equal(pages[1].photos.length, 1);
});

test("4 portraits → two side_by_side pairs, no grid", () => {
  const pages = buildPhotoPages(many(tall, 4));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].kind, "pair");
  assert.equal(pages[1].kind, "pair");
  assert.ok(pages.every((p) => p.kind !== "grid"));
});

test("a lone trailing portrait becomes a hero", () => {
  const pages = buildPhotoPages(many(tall, 3));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].kind, "pair");
  assert.equal(pages[1].kind, "hero");
  assert.equal(pages[1].photos.length, 1);
});

test("mixed: 4 landscape + 2 portrait → one grid of 4 + one portrait pair", () => {
  const pages = buildPhotoPages([...many(wide, 4), ...many(tall, 2)]);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].kind, "grid");
  assert.equal(pages[0].photos.length, 4);
  assert.equal(pages[1].kind, "pair");
  assert.equal(pages[1].photos.length, 2);
});

test("missing dimensions are treated as landscape (tiles into a grid)", () => {
  const pages = buildPhotoPages(many(missing, 4));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].kind, "grid");
  assert.equal(pages[0].photos.length, 4);
});
