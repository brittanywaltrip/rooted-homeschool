// Unit tests for the paid-through classifier. Run with:
//   node --test lib/paid-through.test.ts
//
// Organised as the approved truth table, one describe-block comment per row,
// plus the invariant tests: an unpaid future period can never be entitlement,
// refund uncertainty never becomes "not refunded", and an absent retry date
// never proves collection ended.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyPaidThrough, type PaidThroughInput } from "./paid-through.ts";

// Shapes from the one real dunning case in this account.
const LAST_PAID_END = new Date("2026-08-26T00:00:00.000Z"); // = unpaid period start
const BILLED_END = new Date("2026-09-26T00:00:00.000Z"); // end of the billed period
const NOW = new Date("2026-09-18T00:00:00.000Z");
const FUTURE_RETRY = new Date("2026-09-20T00:00:00.000Z");
const PAST_RETRY = new Date("2026-09-10T00:00:00.000Z");

function input(over: Partial<PaidThroughInput> = {}): PaidThroughInput {
  return {
    latestInvoiceStatus: "paid",
    latestInvoiceLinePeriodStart: LAST_PAID_END,
    latestInvoiceLinePeriodEnd: BILLED_END,
    latestInvoiceNextPaymentAttempt: null,
    collectionState: "terminated",
    refundState: "none",
    now: NOW,
    ...over,
  };
}

// ── Row 1: paid + no refund ─────────────────────────────────────────────────

test("row 1: paid invoice, no refund, is paid through the billed line end", () => {
  const out = classifyPaidThrough(input());
  assert.equal(out.kind, "paid");
  if (out.kind !== "paid") return;
  assert.equal(out.through.toISOString(), BILLED_END.toISOString());
});

// ── Row 2: paid + partial refund ────────────────────────────────────────────

test("row 2: a PARTIAL refund never makes a paid term unpaid", () => {
  const out = classifyPaidThrough(input({ refundState: "partial" }));
  assert.equal(out.kind, "paid");
  if (out.kind !== "paid") return;
  assert.equal(out.through.toISOString(), BILLED_END.toISOString());
});

// ── Row 3: paid + full refund ───────────────────────────────────────────────

test("row 3: a FULL refund makes the term unpaid, back to the period start", () => {
  const out = classifyPaidThrough(input({ refundState: "full" }));
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  assert.equal(out.through.toISOString(), LAST_PAID_END.toISOString());
});

test("row 3b: a full refund with no readable period start is unknown, not invented", () => {
  const out = classifyPaidThrough(
    input({ refundState: "full", latestInvoiceLinePeriodStart: null }),
  );
  assert.equal(out.kind, "unknown");
});

// ── Row 4: paid + unknown refund ────────────────────────────────────────────

test("row 4: UNKNOWN refund state is unknown overall, never 'not refunded'", () => {
  const out = classifyPaidThrough(input({ refundState: "unknown" }));
  assert.equal(out.kind, "unknown");
  if (out.kind !== "unknown") return;
  assert.match(out.reason, /refund state/);
});

// ── Row 5: open + future retry ──────────────────────────────────────────────

test("row 5: open with a FUTURE retry is pending, never unpaid", () => {
  const out = classifyPaidThrough(
    input({ latestInvoiceStatus: "open", latestInvoiceNextPaymentAttempt: FUTURE_RETRY }),
  );
  assert.equal(out.kind, "pending");
  if (out.kind !== "pending") return;
  assert.equal(out.retryAt.toISOString(), FUTURE_RETRY.toISOString());
});

test("row 5b: pending short-circuits before refund state is consulted", () => {
  for (const refundState of ["none", "partial", "full", "unknown"] as const) {
    const out = classifyPaidThrough(
      input({
        latestInvoiceStatus: "open",
        latestInvoiceNextPaymentAttempt: FUTURE_RETRY,
        refundState,
      }),
    );
    assert.equal(out.kind, "pending", `refundState ${refundState} must not change pending`);
  }
});

// ── Row 6: open + null retry + terminated ───────────────────────────────────

test("row 6: open, no retry scheduled, collection terminated, is unpaid", () => {
  const out = classifyPaidThrough(
    input({
      latestInvoiceStatus: "open",
      latestInvoiceNextPaymentAttempt: null,
      collectionState: "terminated",
    }),
  );
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  assert.equal(out.through.toISOString(), LAST_PAID_END.toISOString());
  assert.notEqual(
    out.through.toISOString(),
    BILLED_END.toISOString(),
    "must never hand back the period Stripe advanced without payment",
  );
});

test("row 6b: terminated but refund state unknown is unknown overall", () => {
  const out = classifyPaidThrough(
    input({
      latestInvoiceStatus: "open",
      latestInvoiceNextPaymentAttempt: null,
      collectionState: "terminated",
      refundState: "unknown",
    }),
  );
  assert.equal(out.kind, "unknown");
});

// ── Row 7: open + null retry + not corroborated ─────────────────────────────

test("row 7: a null retry date alone NEVER proves collection ended", () => {
  for (const collectionState of ["live", "unknown"] as const) {
    const out = classifyPaidThrough(
      input({
        latestInvoiceStatus: "open",
        latestInvoiceNextPaymentAttempt: null,
        collectionState,
      }),
    );
    assert.equal(out.kind, "unknown", `collectionState ${collectionState} must be unknown`);
    if (out.kind !== "unknown") return;
    assert.match(out.reason, /not corroborated as terminated/);
  }
});

test("row 7b: a PAST retry date is also not proof on its own", () => {
  const out = classifyPaidThrough(
    input({
      latestInvoiceStatus: "open",
      latestInvoiceNextPaymentAttempt: PAST_RETRY,
      collectionState: "live",
    }),
  );
  assert.equal(out.kind, "unknown");
});

// ── uncollectible requires the same corroboration ───────────────────────────

test("uncollectible ALONE does not revoke; it needs collectionState terminated", () => {
  const notCorroborated = classifyPaidThrough(
    input({ latestInvoiceStatus: "uncollectible", collectionState: "live" }),
  );
  assert.equal(notCorroborated.kind, "unknown");

  const corroborated = classifyPaidThrough(
    input({ latestInvoiceStatus: "uncollectible", collectionState: "terminated" }),
  );
  assert.equal(corroborated.kind, "unpaid");
});

// ── Row 8: draft / void / missing ───────────────────────────────────────────

test("row 8: draft, void and missing invoice status are unknown", () => {
  for (const status of ["draft", "void", null] as const) {
    const out = classifyPaidThrough(input({ latestInvoiceStatus: status }));
    assert.equal(out.kind, "unknown", `status ${String(status)} should be unknown`);
  }
});

test("row 8b: a paid invoice with no readable billed line end is unknown", () => {
  const out = classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: null }));
  assert.equal(out.kind, "unknown");
});

// ── Invariants ──────────────────────────────────────────────────────────────

test("INVARIANT: no input ever yields `paid` without positive paid evidence", () => {
  for (const status of ["draft", "open", "uncollectible", "void", null] as const) {
    for (const collectionState of ["terminated", "live", "unknown"] as const) {
      for (const refundState of ["none", "partial", "full", "unknown"] as const) {
        const out = classifyPaidThrough(
          input({ latestInvoiceStatus: status, collectionState, refundState }),
        );
        assert.notEqual(
          out.kind,
          "paid",
          `status ${String(status)} / ${collectionState} / ${refundState} must not be paid`,
        );
      }
    }
  }
});

test("INVARIANT: unknown refund state can never produce unpaid either", () => {
  // Refund uncertainty must not revoke any more than it may grant.
  for (const status of ["paid", "open", "uncollectible"] as const) {
    const out = classifyPaidThrough(
      input({ latestInvoiceStatus: status, refundState: "unknown", collectionState: "terminated" }),
    );
    assert.equal(out.kind, "unknown", `status ${status} with unknown refund must be unknown`);
  }
});

test("INVARIANT: never invents a duration, monthly or annual", () => {
  const monthlyEnd = new Date("2026-10-26T00:00:00.000Z");
  const annualEnd = new Date("2027-08-26T00:00:00.000Z");
  const monthly = classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: monthlyEnd }));
  const annual = classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: annualEnd }));
  assert.equal(monthly.kind, "paid");
  assert.equal(annual.kind, "paid");
  if (monthly.kind !== "paid" || annual.kind !== "paid") return;
  assert.equal(monthly.through.toISOString(), monthlyEnd.toISOString());
  assert.equal(annual.through.toISOString(), annualEnd.toISOString());
});

test("INVARIANT: an Invalid Date is treated as missing", () => {
  const invalid = new Date("not a date");
  assert.equal(classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: invalid })).kind, "unknown");
  assert.equal(
    classifyPaidThrough(
      input({ latestInvoiceStatus: "open", latestInvoiceLinePeriodStart: invalid }),
    ).kind,
    "unknown",
  );
});
