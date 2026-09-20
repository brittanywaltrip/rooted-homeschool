import assert from "node:assert/strict";
import test from "node:test";
import { selectReportPhotos, type ReportPhoto } from "./report-evidence.ts";

const photo = (id: string, date: string, child_id: string | null, photo_url: string | null = `${id}.jpg`): ReportPhoto => ({
  id, date, child_id, photo_url, type: "photo", title: null, caption: null, lesson_id: null,
});

test("photo evidence uses an inclusive range and chronological order", () => {
  const got = selectReportPhotos([
    photo("last", "2026-09-30", null),
    photo("before", "2026-07-31", null),
    photo("first", "2026-08-01", null),
    photo("after", "2026-10-01", null),
  ], null, "2026-08-01", "2026-09-30");
  assert.deepEqual(got.map((row) => row.id), ["first", "last"]);
});

test("a child's report includes shared photos but not a sibling's photos", () => {
  const got = selectReportPhotos([
    photo("shared", "2026-09-01", null),
    photo("ada", "2026-09-02", "ada"),
    photo("ben", "2026-09-03", "ben"),
  ], "ada", "2026-09-01", "2026-09-30");
  assert.deepEqual(got.map((row) => row.id), ["shared", "ada"]);
});

test("a row without a usable photo never becomes visual evidence", () => {
  assert.deepEqual(selectReportPhotos([
    photo("missing", "2026-09-01", null, null),
  ], null, "2026-09-01", "2026-09-30"), []);
});
