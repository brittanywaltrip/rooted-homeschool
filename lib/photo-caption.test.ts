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
  typedTitle,
  memoryDisplayLabel,
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

// ─── Falling back to the title ───────────────────────────────────────────────
// 409 photos carry a mother's own words in `title` rather than `caption`,
// because the capture path of the day put them there. They printed
// anonymously. The caption line reads both now, in that order.

test("typedTitle: a real title survives, a machine default does not", () => {
  assert.equal(typedTitle({ title: "Muddy boots" }), "Muddy boots");
  assert.equal(typedTitle({ title: "  Muddy boots  " }), "Muddy boots");
  // "Photo" is what LogTodayModal and LogActivityModal write when the family
  // leaves the field blank, so it is not words anyone chose.
  assert.equal(typedTitle({ title: "Photo" }), null);
  assert.equal(typedTitle({ title: "photo" }), null);
  assert.equal(typedTitle({ title: "  PHOTO " }), null);
  // A title that merely contains the word is still a real title.
  assert.equal(typedTitle({ title: "Photo of the barn" }), "Photo of the barn");
  assert.equal(typedTitle({ title: "   " }), null);
  assert.equal(typedTitle({ title: null }), null);
  assert.equal(typedTitle({}), null);
});

test("photoCaptionLine: the caption still wins over the title", () => {
  assert.equal(
    photoCaptionLine({ type: "photo", caption: "She read it herself", title: "First chapter book", takenAt: "2026-10-12" }),
    "She read it herself · October 12",
  );
});

test("photoCaptionLine: the title is used when the caption is empty", () => {
  const line = photoCaptionLine({ type: "photo", title: "First day at the creek", takenAt: "2026-10-12" });
  assert.equal(line, "First day at the creek · October 12");
  // Whitespace in caption is empty, so the title still comes through.
  assert.equal(
    photoCaptionLine({ type: "photo", caption: "   ", title: "First day at the creek", takenAt: "2026-10-12" }),
    "First day at the creek · October 12",
  );
});

test("photoCaptionLine: a whitespace title is ignored, and so is the default \"Photo\"", () => {
  assert.equal(photoCaptionLine({ type: "photo", title: "   ", childName: "Zoe", takenAt: "2026-10-12" }), "Zoe · October 12");
  assert.equal(photoCaptionLine({ type: "photo", title: "Photo", childName: "Zoe", takenAt: "2026-10-12" }), "Zoe · October 12");
  // With no name either, the date alone. Never the word "Photo".
  const bare = photoCaptionLine({ type: "photo", title: "Photo", takenAt: "2026-10-12" });
  assert.equal(bare, "October 12");
  assert.ok(!bare!.includes("Photo"));
});

test("photoCaptionLine: only a plain photo falls back to its title", () => {
  const shared = { title: "Lesson 42: Fractions", childName: "Eli", takenAt: "2026-10-12" };
  // A lesson photo's title is an auto-generated curriculum label.
  assert.equal(photoCaptionLine({ ...shared, type: "project" }), "Eli · October 12");
  // A book's title is the book's name, already printed in the reading list.
  assert.equal(photoCaptionLine({ ...shared, type: "book", title: "Charlotte's Web" }), "Eli · October 12");
  for (const type of ["drawing", "win", "quote", "field_trip", "milestone", "activity", null, undefined]) {
    const line = photoCaptionLine({ ...shared, type });
    assert.equal(line, "Eli · October 12", `type ${String(type)} must not fall back to its title`);
  }
  // And the photo does.
  assert.equal(photoCaptionLine({ ...shared, type: "photo" }), "Lesson 42: Fractions · October 12");
});

test("photoCaptionLine: a caption on a non-photo type still prints, as it always did", () => {
  assert.equal(
    photoCaptionLine({ type: "project", caption: "Her volcano finally erupted", takenAt: "2026-10-12" }),
    "Her volcano finally erupted · October 12",
  );
});

// ─── The grid label, the same idea mirrored ──────────────────────────────────

test("memoryDisplayLabel: title first, then caption", () => {
  assert.equal(memoryDisplayLabel({ title: "Beach day", caption: "the tide pools" }), "Beach day");
  // A Quick photo after ccec694: its words are in caption, not title.
  assert.equal(memoryDisplayLabel({ title: null, caption: "the tide pools" }), "the tide pools");
  assert.equal(memoryDisplayLabel({ caption: "the tide pools" }), "the tide pools");
});

test("memoryDisplayLabel: the machine default never wins over real words", () => {
  assert.equal(memoryDisplayLabel({ title: "Photo", caption: "the tide pools" }), "the tide pools");
  assert.equal(memoryDisplayLabel({ title: "   ", caption: "the tide pools" }), "the tide pools");
  // Nothing anywhere, so the caller falls back to its own type label.
  assert.equal(memoryDisplayLabel({ title: "Photo" }), null);
  assert.equal(memoryDisplayLabel({ title: "  ", caption: "  " }), null);
  assert.equal(memoryDisplayLabel({}), null);
});

test("the two directions disagree on purpose, and neither loses the words", () => {
  // Words in title only: the book falls back to it, the grid prefers it.
  const inTitle = { type: "photo", title: "Muddy boots", takenAt: "2026-04-02" };
  assert.equal(photoCaptionLine(inTitle), "Muddy boots · April 2");
  assert.equal(memoryDisplayLabel(inTitle), "Muddy boots");

  // Words in caption only: the book prefers it, the grid falls back to it.
  const inCaption = { type: "photo", caption: "Muddy boots", takenAt: "2026-04-02" };
  assert.equal(photoCaptionLine(inCaption), "Muddy boots · April 2");
  assert.equal(memoryDisplayLabel(inCaption), "Muddy boots");
});
