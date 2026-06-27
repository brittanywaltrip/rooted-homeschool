// Tests for lib/tiny-masterpieces.ts — drawings get their own page; captions
// only show when there's real text (no unfillable prompt).

import { test } from "node:test";
import assert from "node:assert/strict";

import { isDrawing, tinyMasterpieceCaption, partitionDrawings, chunk } from "./tiny-masterpieces.ts";

test("isDrawing only matches the drawing type", () => {
  assert.equal(isDrawing({ type: "drawing" }), true);
  assert.equal(isDrawing({ type: "photo" }), false);
  assert.equal(isDrawing({ type: "book" }), false);
});

test("tinyMasterpieceCaption: real caption shows, empty/whitespace → null", () => {
  assert.equal(tinyMasterpieceCaption("a rainbow over our house"), "a rainbow over our house");
  assert.equal(tinyMasterpieceCaption("  trimmed  "), "trimmed");
  assert.equal(tinyMasterpieceCaption(""), null);
  assert.equal(tinyMasterpieceCaption("   "), null);
  assert.equal(tinyMasterpieceCaption(null), null);
  assert.equal(tinyMasterpieceCaption(undefined), null);
});

test("partitionDrawings splits drawings from photos, keeps order, drops photoless", () => {
  const mems = [
    { id: "a", type: "photo", photo_url: "x" },
    { id: "b", type: "drawing", photo_url: "y" },
    { id: "c", type: "photo", photo_url: null }, // dropped (no photo)
    { id: "d", type: "drawing", photo_url: "z" },
    { id: "e", type: "photo", photo_url: "w" },
  ];
  const { drawings, photos } = partitionDrawings(mems);
  assert.deepEqual(drawings.map((m) => m.id), ["b", "d"]);
  assert.deepEqual(photos.map((m) => m.id), ["a", "e"]);
});

test("partitionDrawings: a chapter of only drawings yields an empty photo collage", () => {
  const mems = [
    { id: "1", type: "drawing", photo_url: "x" },
    { id: "2", type: "drawing", photo_url: "y" },
  ];
  const { drawings, photos } = partitionDrawings(mems);
  assert.equal(photos.length, 0);
  assert.equal(drawings.length, 2);
});

test("chunk groups into fixed-size pages, preserving order", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 4), []);
  assert.deepEqual(chunk([1, 2, 3], 4), [[1, 2, 3]]);
});
