// A school year closes only when the family closes it.
//
// useSchoolYears used to archive the active year on any reload once its
// end_date had passed and nothing upcoming existed. That skipped
// /api/school-year/close entirely (no celebration, no "Set up next year", no
// keepsake, subjects left active, grades not advanced) and then hid the Close
// card, because there was no active year left. The hook's row logic now lives
// in planSchoolYearRows, next to the one definition of "this year".
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isYearAwaitingClose,
  overdueYearHeadline,
  planSchoolYearRows,
  type SchoolYearStatusRow,
} from "../app/lib/school-year.ts";

const TODAY = "2026-09-14";

function row(id: string, status: SchoolYearStatusRow["status"], start: string, end: string, created = "2025-08-01T12:00:00Z"): SchoolYearStatusRow {
  return { id, status, start_date: start, end_date: end, created_at: created };
}

test("an active year with a past end date and no upcoming year stays active, not archived", () => {
  const rows = [row("y25", "active", "2025-08-18", "2026-05-31"), row("y24", "archived", "2024-08-19", "2025-05-30")];
  const plan = planSchoolYearRows(rows, TODAY);
  assert.equal(plan.active?.id, "y25");
  assert.equal(plan.promote, null, "nothing is written for a year that has merely run past its end date");
  assert.deepEqual(plan.archived.map((r) => r.id), ["y24"]);
  // And Plan asks instead.
  assert.equal(isYearAwaitingClose({ active: plan.active, upcoming: plan.upcoming, today: TODAY }), true);
});

test("an upcoming year whose start date has arrived is promoted, and the old active year archived", () => {
  const rows = [row("y26", "upcoming", "2026-09-01", "2027-05-31"), row("y25", "active", "2025-08-18", "2026-05-31")];
  const plan = planSchoolYearRows(rows, TODAY);
  assert.deepEqual(plan.promote, { activateId: "y26", archiveId: "y25" });
  // Starting today counts.
  assert.deepEqual(planSchoolYearRows([row("y26", "upcoming", TODAY, "2027-05-31")], TODAY).promote, { activateId: "y26", archiveId: null });
  // Not before its day.
  assert.equal(planSchoolYearRows([row("y26", "upcoming", "2026-09-15", "2027-05-31"), row("y25", "active", "2025-08-18", "2026-05-31")], TODAY).promote, null);
});

test("the active year is the one getCurrentSchoolYear reads: the newest created", () => {
  const rows = [
    row("older", "active", "2026-08-01", "2027-05-31", "2026-07-01T00:00:00Z"),
    row("newer", "active", "2025-08-01", "2026-05-31", "2026-08-01T00:00:00Z"),
  ];
  assert.equal(planSchoolYearRows(rows, TODAY).active?.id, "newer");
});

test("no nudge while a next year is set up, before the end date, or on the end date itself", () => {
  const active = row("y25", "active", "2025-08-18", "2026-05-31");
  assert.equal(isYearAwaitingClose({ active, upcoming: row("y26", "upcoming", "2026-09-20", "2027-05-31"), today: TODAY }), false);
  assert.equal(isYearAwaitingClose({ active: { end_date: "2026-09-14" }, upcoming: null, today: TODAY }), false);
  assert.equal(isYearAwaitingClose({ active: { end_date: "2026-09-13" }, upcoming: null, today: TODAY }), true);
  assert.equal(isYearAwaitingClose({ active: null, upcoming: null, today: TODAY }), false);
  assert.equal(isYearAwaitingClose({ active: { end_date: "" }, upcoming: null, today: TODAY }), false);
});

test("the nudge headline reads the family's own year name without doubling 'year' or using a dash", () => {
  assert.equal(overdueYearHeadline("2025-2026", "2026-05-31"), "Your 2025-2026 year ended May 31. Ready to close it?");
  assert.equal(overdueYearHeadline("Kindergarten Year", "2026-06-05"), "Your Kindergarten Year ended June 5. Ready to close it?");
  assert.equal(overdueYearHeadline("", "2026-05-31"), "Your school year ended May 31. Ready to close it?");
  for (const s of [overdueYearHeadline("2025-2026", "2026-05-31"), overdueYearHeadline(null, "bad")]) {
    assert.ok(!/[–—]/.test(s), `no en or em dash in family-facing copy: ${s}`);
  }
});

test("the hook never archives on an end date, and reads only the user it is given", () => {
  const src = readFileSync(resolve(import.meta.dirname, "useSchoolYears.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /end_date\s*</, "no branch compares end_date to today");
  assert.match(src, /\.eq\("user_id", userId\)/);
  assert.match(src, /planSchoolYearRows\(/, "row logic has one definition, in app/lib/school-year.ts");
  // The only archive it may write is the one a promotion names.
  const archives = src.match(/status: "archived"/g) ?? [];
  assert.equal(archives.length, 1);
  assert.match(src, /if \(plan\.promote\.archiveId\)/);
});
