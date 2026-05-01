// Pins the YYYY-MM contract for commission_payments.month against the
// helpers used by the affiliate Settings page. The bug they fix:
// previously the page compared p.month (stored as "2026-05") against
// new Date().toLocaleDateString("en-US", { month: "long", year:
// "numeric" }) ("May 2026"), so the filter never matched and every
// affiliate saw "$0.00 paid this month" regardless of actual payments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMonthKey, currentMonthKey } from "./commission-month.ts";

test("currentMonthKey returns YYYY-MM for the local month of the given date", () => {
  // Use a fixed local date so this test is timezone-stable on any
  // host that runs npm test.
  const d = new Date(2026, 4, 15); // May 15 2026 local
  assert.equal(currentMonthKey(d), "2026-05");
});

test("currentMonthKey zero-pads single-digit months", () => {
  const d = new Date(2026, 0, 1); // Jan 1 2026
  assert.equal(currentMonthKey(d), "2026-01");
});

test("currentMonthKey defaults to now()", () => {
  const out = currentMonthKey();
  // Cheap shape check: matches YYYY-MM, year 4 digits, month 01-12.
  assert.match(out, /^\d{4}-(0[1-9]|1[0-2])$/);
});

test("formatMonthKey expands YYYY-MM to a human label", () => {
  assert.equal(formatMonthKey("2026-05"), "May 2026");
  assert.equal(formatMonthKey("2026-01"), "January 2026");
  assert.equal(formatMonthKey("2025-12"), "December 2025");
});

test("formatMonthKey passes through unrecognized values unchanged", () => {
  // Legacy rows or accidental writes shouldn't vanish from the table.
  assert.equal(formatMonthKey("May 2026"), "May 2026");
  assert.equal(formatMonthKey(""), "");
  assert.equal(formatMonthKey("garbage"), "garbage");
  assert.equal(formatMonthKey("2026-13"), "2026-13");
});

test("currentMonthKey + formatMonthKey round-trip for any month", () => {
  for (let m = 0; m < 12; m++) {
    const d = new Date(2026, m, 15);
    const key = currentMonthKey(d);
    const label = formatMonthKey(key);
    const expectedMonth = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    assert.equal(label, expectedMonth, `roundtrip month ${m}`);
  }
});
