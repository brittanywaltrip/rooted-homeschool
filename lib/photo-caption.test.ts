// Tests for lib/photo-caption.ts — a featured photo with a caption/title renders
// caption text; one without renders none (no empty caption / placeholder).

import { test } from "node:test";
import assert from "node:assert/strict";

import { featureCaptionText } from "./photo-caption.ts";

test("caption present → caption text", () => {
  assert.equal(featureCaptionText({ caption: "First day of spring", title: "Spring" }), "First day of spring");
});

test("no caption but title present → title text", () => {
  assert.equal(featureCaptionText({ caption: null, title: "Field trip to the farm" }), "Field trip to the farm");
  assert.equal(featureCaptionText({ title: "Field trip" }), "Field trip");
});

test("neither caption nor title → null (no caption rendered)", () => {
  assert.equal(featureCaptionText({}), null);
  assert.equal(featureCaptionText({ caption: null, title: null }), null);
  assert.equal(featureCaptionText({ caption: undefined, title: undefined }), null);
});

test("whitespace-only caption/title counts as empty", () => {
  assert.equal(featureCaptionText({ caption: "   ", title: "  " }), null);
  // whitespace caption falls through to a real title
  assert.equal(featureCaptionText({ caption: "  ", title: "Real title" }), "Real title");
});

test("caption is preferred over title and is trimmed", () => {
  assert.equal(featureCaptionText({ caption: "  Beach day  ", title: "Ocean" }), "Beach day");
});
