// Unit tests for the paid-through classifier. Run with:
//   node --test lib/paid-through.test.ts
//
// The case that matters most is "the bug": an open invoice whose subscription
// period end has already advanced into the future. Every other test exists to
// keep that one honest, and several exist to prove the locked principles:
// no manufactured dates, no substitute for a missing billed period, and
// "unknown" wherever the data is ambiguous.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyPaidThrough, type PaidThroughInput } from "./paid-through.ts";

// Real shapes taken from the one live dunning case in this account: a monthly
// subscription whose renewal invoice failed while the subscription's own
// period end had already moved a month ahead. For an unpaid renewal the billed
// line period IS that advanced period, so its start is the last paid end.
const LAST_PAID_END = new Date("2026-08-26T00:00:00.000Z"); // = unpaid period start
const ADVANCED_END = new Date("2026-09-26T00:00:00.000Z"); // end of the billed period

function input(overrides: Partial<PaidThroughInput> = {}): PaidThroughInput {
  return {
    latestInvoiceStatus: "paid",
    latestInvoiceLinePeriodStart: LAST_PAID_END,
    latestInvoiceLinePeriodEnd: ADVANCED_END,
    currentChargeFullyRefunded: false,
    ...overrides,
  };
}

// ── the regression this module exists for ───────────────────────────────────

test("THE BUG: an open invoice never reports the advanced period as paid", () => {
  const out = classifyPaidThrough(input({ latestInvoiceStatus: "open" }));
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  assert.equal(out.through.toISOString(), LAST_PAID_END.toISOString());
  assert.notEqual(
    out.through.toISOString(),
    ADVANCED_END.toISOString(),
    "must never hand back the period Stripe advanced without payment",
  );
});

// ── paid ────────────────────────────────────────────────────────────────────

test("a paid invoice is paid through its billed line period end", () => {
  const out = classifyPaidThrough(input());
  assert.equal(out.kind, "paid");
  if (out.kind !== "paid") return;
  assert.equal(out.through.toISOString(), ADVANCED_END.toISOString());
});

test("a paid invoice with no billed line period end is unknown, never substituted", () => {
  // Locked principle: a paid invoice whose billed period we cannot read has no
  // trustworthy answer. There is deliberately no second source to fall back to.
  const out = classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: null }));
  assert.equal(out.kind, "unknown");
});

// ── unpaid ──────────────────────────────────────────────────────────────────

test("an uncollectible invoice is treated exactly like an open one", () => {
  const out = classifyPaidThrough(input({ latestInvoiceStatus: "uncollectible" }));
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  assert.equal(out.through.toISOString(), LAST_PAID_END.toISOString());
});

test("an unpaid invoice with no line period start is unknown", () => {
  const out = classifyPaidThrough(
    input({ latestInvoiceStatus: "open", latestInvoiceLinePeriodStart: null }),
  );
  assert.equal(out.kind, "unknown");
});

// ── refunds take precedence ─────────────────────────────────────────────────

test("a fully refunded current charge is unpaid even when the invoice says paid", () => {
  const out = classifyPaidThrough(input({ currentChargeFullyRefunded: true }));
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  assert.equal(out.through.toISOString(), LAST_PAID_END.toISOString());
});

test("a refund with no line period start is unknown rather than invented", () => {
  const out = classifyPaidThrough(
    input({ currentChargeFullyRefunded: true, latestInvoiceLinePeriodStart: null }),
  );
  assert.equal(out.kind, "unknown");
});

// ── ambiguous statuses stay ambiguous ───────────────────────────────────────

test("draft, void and null are unknown, so this function never revokes on ambiguity", () => {
  for (const status of ["draft", "void", null] as const) {
    const out = classifyPaidThrough(input({ latestInvoiceStatus: status }));
    assert.equal(out.kind, "unknown", `status ${String(status)} should be unknown`);
  }
});

// ── no invented durations, no substitute sources ────────────────────────────

test("never invents a duration: monthly and annual both return the given date", () => {
  const monthlyEnd = new Date("2026-10-26T00:00:00.000Z");
  const annualEnd = new Date("2027-08-26T00:00:00.000Z");

  const monthly = classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: monthlyEnd }));
  const annual = classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: annualEnd }));

  assert.equal(monthly.kind, "paid");
  assert.equal(annual.kind, "paid");
  if (monthly.kind !== "paid" || annual.kind !== "paid") return;
  // The old periodEndFromSubscription fallback would have produced now + 365
  // days for BOTH of these, which is 12x too long for the monthly one.
  assert.equal(monthly.through.toISOString(), monthlyEnd.toISOString());
  assert.equal(annual.through.toISOString(), annualEnd.toISOString());
});

test("there is no input that yields a paid result without a billed line period end", () => {
  // Structural guard for locked principle 2. The subscription's own
  // current_period_end is not a parameter, so no combination of inputs can
  // resurrect it as a substitute.
  for (const refunded of [false, true]) {
    for (const status of ["draft", "open", "paid", "uncollectible", "void", null] as const) {
      const out = classifyPaidThrough({
        latestInvoiceStatus: status,
        latestInvoiceLinePeriodStart: LAST_PAID_END,
        latestInvoiceLinePeriodEnd: null,
        currentChargeFullyRefunded: refunded,
      });
      assert.notEqual(
        out.kind,
        "paid",
        `status ${String(status)} refunded=${refunded} must not be paid without a billed period end`,
      );
    }
  }
});

test("an Invalid Date is treated as missing, not as a date", () => {
  const invalid = new Date("not a date");
  assert.equal(
    classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: invalid })).kind,
    "unknown",
  );
  assert.equal(
    classifyPaidThrough(
      input({ latestInvoiceStatus: "open", latestInvoiceLinePeriodStart: invalid }),
    ).kind,
    "unknown",
  );
});

// ── shape callers depend on ─────────────────────────────────────────────────

test("an unpaid result in the past makes `through > now` false for a caller", () => {
  const out = classifyPaidThrough(input({ latestInvoiceStatus: "open" }));
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  // This is precisely how the deleted handler will decide termRemaining.
  const now = new Date("2026-09-18T00:00:00.000Z");
  assert.equal(out.through > now, false, "an unpaid past term must not grant access");
});

test("a paid result in the future makes `through > now` true for a caller", () => {
  const out = classifyPaidThrough(input());
  assert.equal(out.kind, "paid");
  if (out.kind !== "paid") return;
  const now = new Date("2026-09-18T00:00:00.000Z");
  assert.equal(out.through > now, true, "a paid future term must keep access");
});
