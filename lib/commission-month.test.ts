// Pins the YYYY-MM contract for commission_payments.month against the
// helpers used by the affiliate Settings page. The bug they fix:
// previously the page compared p.month (stored as "2026-05") against
// new Date().toLocaleDateString("en-US", { month: "long", year:
// "numeric" }) ("May 2026"), so the filter never matched and every
// affiliate saw "$0.00 paid this month" regardless of actual payments.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMonthKey,
  currentMonthKey,
  monthKeyFromISO,
  monthKeyRange,
  buildMonthlyEarnings,
} from "./commission-month.ts";

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

// ── monthKeyFromISO ──────────────────────────────────────────────────────────

test("monthKeyFromISO reduces an ISO timestamp to YYYY-MM", () => {
  // Midday UTC is unambiguous across US timezones.
  assert.equal(monthKeyFromISO("2026-04-15T12:00:00Z"), "2026-04");
  assert.equal(monthKeyFromISO("2026-07-10T12:00:00Z"), "2026-07");
});

test("monthKeyFromISO returns '' for empty or unparseable input", () => {
  assert.equal(monthKeyFromISO(""), "");
  assert.equal(monthKeyFromISO(null), "");
  assert.equal(monthKeyFromISO(undefined), "");
  assert.equal(monthKeyFromISO("not a date"), "");
});

// ── monthKeyRange ────────────────────────────────────────────────────────────

test("monthKeyRange lists every month inclusive, crossing a year boundary", () => {
  assert.deepEqual(monthKeyRange("2026-04", "2026-07"), ["2026-04", "2026-05", "2026-06", "2026-07"]);
  assert.deepEqual(monthKeyRange("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(monthKeyRange("2026-07", "2026-07"), ["2026-07"]);
});

test("monthKeyRange returns [] for malformed keys or reversed range", () => {
  assert.deepEqual(monthKeyRange("2026-13", "2026-14"), []);
  assert.deepEqual(monthKeyRange("2026-08", "2026-04"), []);
  assert.deepEqual(monthKeyRange("", "2026-04"), []);
});

// ── buildMonthlyEarnings ─────────────────────────────────────────────────────

test("buildMonthlyEarnings produces the unbroken record from the prompt", () => {
  const rows = buildMonthlyEarnings({
    referrals: [
      { createdAt: "2026-04-11T18:48:12Z", converted: true, commissionAmount: 6.63 },
      { createdAt: "2026-04-23T20:48:43Z", converted: true, commissionAmount: 7.80 },
      { createdAt: "2026-07-08T13:00:00Z", converted: true, commissionAmount: 2.0 },
      // A non-converted signup must not add earnings.
      { createdAt: "2026-05-02T10:00:00Z", converted: false, commissionAmount: 0 },
    ],
    payments: [
      { month: "2026-04", amount: 14.43, paid_at: "2026-05-01T17:00:00Z" },
    ],
    startMonthKey: "2026-04",
    endMonthKey: "2026-07",
  });

  assert.equal(rows.length, 4);

  assert.equal(rows[0].monthKey, "2026-04");
  assert.equal(rows[0].label, "April 2026");
  assert.equal(rows[0].earned, 14.43);
  assert.equal(rows[0].conversions, 2);
  assert.equal(rows[0].paid, 14.43);
  assert.equal(rows[0].status, "paid");
  assert.equal(rows[0].paidAt, "2026-05-01T17:00:00Z");

  // May + June are zero months, shown (not hidden).
  assert.equal(rows[1].monthKey, "2026-05");
  assert.equal(rows[1].earned, 0);
  assert.equal(rows[1].status, "none");
  assert.equal(rows[2].monthKey, "2026-06");
  assert.equal(rows[2].status, "none");

  // July earned $2.00 (monthly), not yet paid → pending.
  assert.equal(rows[3].monthKey, "2026-07");
  assert.equal(rows[3].earned, 2.0);
  assert.equal(rows[3].paid, 0);
  assert.equal(rows[3].status, "pending");
});

test("buildMonthlyEarnings falls back to data months when the window is unusable", () => {
  const rows = buildMonthlyEarnings({
    referrals: [{ createdAt: "2026-06-01T12:00:00Z", converted: true, commissionAmount: 2.0 }],
    payments: [{ month: "2026-04", amount: 5, paid_at: null }],
    startMonthKey: "",
    endMonthKey: "",
  });
  assert.deepEqual(rows.map((r) => r.monthKey), ["2026-04", "2026-06"]);
});
