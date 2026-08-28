// Tests for lib/photo-caption.ts — a featured photo with a caption/title renders
// caption text; one without renders none (no empty caption / placeholder).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  featureCaptionText,
  photoCaptionLine,
  photoMetaLine,
  photoDateLabel,
  photoTakenAt,
} from "./photo-caption.ts";

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

// ─── The line under every photograph ─────────────────────────────────────────

test("photoDateLabel: month name and day, never the year", () => {
  assert.equal(photoDateLabel("2026-10-12"), "October 12");
  assert.equal(photoDateLabel("2026-01-01"), "January 1");
  // A full timestamp is accepted; only the date part is read.
  assert.equal(photoDateLabel("2026-10-12T23:30:00Z"), "October 12");
  // Parsed at midday, so a date-only string cannot slip a day backwards.
  assert.equal(photoDateLabel("2026-03-01"), "March 1");
});

test("photoDateLabel: nothing usable → null, never a broken string", () => {
  assert.equal(photoDateLabel(null), null);
  assert.equal(photoDateLabel(undefined), null);
  assert.equal(photoDateLabel(""), null);
  assert.equal(photoDateLabel("not-a-date"), null);
});

test("photoTakenAt: takenAt wins, date is the older name for the same value", () => {
  assert.equal(photoTakenAt({ takenAt: "2026-05-04", date: "2026-01-01" }), "2026-05-04");
  assert.equal(photoTakenAt({ date: "2026-01-01" }), "2026-01-01");
  assert.equal(photoTakenAt({}), null);
  assert.equal(photoTakenAt({ takenAt: "  ", date: null }), null);
});

test("photoCaptionLine: caption, then the date", () => {
  assert.equal(
    photoCaptionLine({ caption: "She finally read it herself", childName: "Zoe", takenAt: "2026-10-12" }),
    "She finally read it herself · October 12",
  );
});

test("photoCaptionLine: no caption falls back to the child's name", () => {
  assert.equal(photoCaptionLine({ childName: "Zoe", takenAt: "2026-10-12" }), "Zoe · October 12");
  assert.equal(photoCaptionLine({ caption: "   ", childName: "Zoe", takenAt: "2026-10-12" }), "Zoe · October 12");
});

test("photoCaptionLine: with neither, the date alone is still a record", () => {
  assert.equal(photoCaptionLine({ takenAt: "2026-10-12" }), "October 12");
  assert.equal(photoCaptionLine({ childName: null, caption: null, takenAt: "2026-10-12" }), "October 12");
});

test("photoCaptionLine: a caption never carries the name as well", () => {
  // The rule is caption-then-date, not caption-then-name-then-date: the name
  // is the fallback FOR the caption, not an addition to it.
  const line = photoCaptionLine({ caption: "Muddy boots", childName: "Eli", takenAt: "2026-04-02" });
  assert.equal(line, "Muddy boots · April 2");
  assert.ok(!line?.includes("Eli"));
});

test("photoCaptionLine: a photo with no date still prints what it has", () => {
  assert.equal(photoCaptionLine({ caption: "Muddy boots" }), "Muddy boots");
  assert.equal(photoCaptionLine({ childName: "Eli" }), "Eli");
  assert.equal(photoCaptionLine({}), null);
});

test("photoCaptionLine: nothing is truncated, however long the caption", () => {
  const long = "We drove two hours to the tide pools and she did not stop talking about anemones the whole way home";
  const line = photoCaptionLine({ caption: long, takenAt: "2026-06-18" });
  assert.equal(line, `${long} · June 18`);
  assert.ok(line!.includes(long), "the caption survives in full");
});

test("photoMetaLine: the name and date line under a featured photo's caption", () => {
  assert.equal(photoMetaLine({ childName: "Zoe", takenAt: "2026-10-12" }), "Zoe · October 12");
  assert.equal(photoMetaLine({ takenAt: "2026-10-12" }), "October 12");
  assert.equal(photoMetaLine({ childName: "Zoe" }), "Zoe");
  assert.equal(photoMetaLine({}), null);
  // The caption is deliberately NOT part of this line; it has its own.
  assert.equal(photoMetaLine({ caption: "Muddy boots", takenAt: "2026-10-12" }), "October 12");
});
