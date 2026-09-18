// Unit tests for the paid-through classifier. Run with:
//   node --test lib/paid-through.test.ts
//
// Organised as the approved truth table, one describe-block comment per row,
// plus the invariant tests: an unpaid future period can never be entitlement,
// refund uncertainty never becomes "not refunded", and an absent retry date
// never proves collection ended.

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyPaidThrough,
  resolvePaidPeriodEnd,
  type PaidThroughInput,
} from "./paid-through.ts";

// Shapes from the one real dunning case in this account.
const LAST_PAID_END = new Date("2026-08-26T00:00:00.000Z"); // = unpaid period start
const BILLED_END = new Date("2026-09-26T00:00:00.000Z"); // end of the billed period
const NOW = new Date("2026-09-18T00:00:00.000Z");
const FUTURE_RETRY = new Date("2026-09-20T00:00:00.000Z");
const PAST_RETRY = new Date("2026-09-10T00:00:00.000Z");
const SUB_STARTED_AT = new Date("2026-05-01T00:00:00.000Z");

function input(over: Partial<PaidThroughInput> = {}): PaidThroughInput {
  return {
    latestInvoiceStatus: "paid",
    latestInvoiceLinePeriodStart: LAST_PAID_END,
    latestInvoiceLinePeriodEnd: BILLED_END,
    latestInvoiceNextPaymentAttempt: null,
    collectionState: "terminated",
    priorPaidThrough: { kind: "proven", through: LAST_PAID_END },
    subscriptionStartedAt: SUB_STARTED_AT,
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

test("row 6: open, terminated, PROVEN prior payment is unpaid through that date", () => {
  const out = classifyPaidThrough(
    input({
      latestInvoiceStatus: "open",
      latestInvoiceNextPaymentAttempt: null,
      collectionState: "terminated",
      priorPaidThrough: { kind: "proven", through: LAST_PAID_END },
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
  // On the paid branch, an unusable billed line end.
  assert.equal(classifyPaidThrough(input({ latestInvoiceLinePeriodEnd: invalid })).kind, "unknown");
  // On the unpaid branch, an unusable PROVEN date. A bad date wearing the right
  // label is still missing evidence.
  assert.equal(
    classifyPaidThrough(
      input({
        latestInvoiceStatus: "open",
        latestInvoiceNextPaymentAttempt: null,
        collectionState: "terminated",
        priorPaidThrough: { kind: "proven", through: invalid },
      }),
    ).kind,
    "unknown",
  );
  // And an unusable subscription start when there is no paid history.
  assert.equal(
    classifyPaidThrough(
      input({
        latestInvoiceStatus: "open",
        latestInvoiceNextPaymentAttempt: null,
        collectionState: "terminated",
        priorPaidThrough: { kind: "none" },
        subscriptionStartedAt: invalid,
      }),
    ).kind,
    "unknown",
  );
});

// ── resolvePaidPeriodEnd: a date counts only when an invoice was PAID ────────
//
// Every case below exists because "the unpaid period starts here, so the paid
// one ended here" is an inference about adjacency, not evidence of payment.

const PAID_TERM_END = new Date("2026-08-26T00:00:00.000Z");
const LATER_TERM_END = new Date("2026-09-26T00:00:00.000Z");

const paid = (d: Date | null) => ({ invoiceStatus: "paid" as const, billedLineEnd: d });

test("resolver: the only paid candidate wins", () => {
  assert.equal(
    resolvePaidPeriodEnd([paid(PAID_TERM_END)])?.toISOString(),
    PAID_TERM_END.toISOString(),
  );
});

test("resolver: MULTIPLE paid candidates choose the furthest proven end", () => {
  // Taking the max can never over-state, because every candidate is itself a
  // period somebody paid for. Taking merely the newest could under-state when a
  // recent proration invoice bills a short fragment.
  const out = resolvePaidPeriodEnd([
    paid(PAID_TERM_END),
    paid(LATER_TERM_END),
    paid(PAID_TERM_END),
  ]);
  assert.equal(out?.toISOString(), LATER_TERM_END.toISOString());
});

test("resolver: no candidates at all is null, never a date", () => {
  assert.equal(resolvePaidPeriodEnd([]), null);
});

test("resolver: a first-ever OPEN invoice contributes nothing", () => {
  // Its line period starts at the subscription creation instant. Counting it
  // would assert "paid through the moment they signed up" when nothing was
  // ever paid.
  const subscriptionCreationInstant = new Date("2026-08-26T00:00:00.000Z");
  const out = resolvePaidPeriodEnd([
    { invoiceStatus: "open", billedLineEnd: subscriptionCreationInstant },
  ]);
  assert.equal(out, null);
});

test("resolver: UNCOLLECTIBLE with no prior paid invoice is null", () => {
  assert.equal(
    resolvePaidPeriodEnd([{ invoiceStatus: "uncollectible", billedLineEnd: LATER_TERM_END }]),
    null,
  );
});

test("resolver: draft and void contribute nothing either", () => {
  for (const status of ["draft", "void", null] as const) {
    assert.equal(
      resolvePaidPeriodEnd([{ invoiceStatus: status, billedLineEnd: LATER_TERM_END }]),
      null,
      `status ${String(status)} must not count`,
    );
  }
});

test("resolver: an ambiguous or missing paid line contributes nothing", () => {
  // selectSubscriptionInvoiceLine returned ambiguous, so the caller passes null.
  assert.equal(resolvePaidPeriodEnd([paid(null)]), null);
  assert.equal(
    resolvePaidPeriodEnd([paid(null), paid(PAID_TERM_END)])?.toISOString(),
    PAID_TERM_END.toISOString(),
    "one unreadable invoice must not discard a readable one",
  );
});

test("resolver: a Stripe lookup failure is null, never a guess", () => {
  // The caller catches and passes nothing at all.
  assert.equal(resolvePaidPeriodEnd([]), null);
});

test("resolver: Invalid Dates are ignored rather than compared", () => {
  const invalid = new Date("not a date");
  assert.equal(resolvePaidPeriodEnd([paid(invalid)]), null);
  assert.equal(
    resolvePaidPeriodEnd([paid(invalid), paid(PAID_TERM_END)])?.toISOString(),
    PAID_TERM_END.toISOString(),
  );
});

test("resolver: THE GAP CASE — an unpaid boundary after the paid end is ignored", () => {
  // A pause/resume or billing-anchor change can put the unpaid invoice's line
  // boundary AFTER the real last paid end. If it counted, it would hand out
  // time nobody bought. The status filter is what stops it.
  const lastProvenPaidEnd = PAID_TERM_END;
  const unpaidBoundaryAfterTheGap = new Date("2026-11-01T00:00:00.000Z");

  const out = resolvePaidPeriodEnd([
    paid(lastProvenPaidEnd),
    { invoiceStatus: "open", billedLineEnd: unpaidBoundaryAfterTheGap },
  ]);

  assert.equal(out?.toISOString(), lastProvenPaidEnd.toISOString());
  assert.notEqual(
    out?.toISOString(),
    unpaidBoundaryAfterTheGap.toISOString(),
    "a boundary from an UNPAID invoice must never become paid-through",
  );
  assert.ok(
    out!.getTime() < unpaidBoundaryAfterTheGap.getTime(),
    "the proven answer is earlier than the unpaid boundary, never later",
  );
});

test("resolver: DUNNING uses the last actually paid invoice", () => {
  // The live shape: the renewal invoice is open for the advanced period, and
  // the previous cycle was paid.
  const lastPaidEnd = PAID_TERM_END;
  const advancedUnpaidEnd = LATER_TERM_END;
  const out = resolvePaidPeriodEnd([
    { invoiceStatus: "open", billedLineEnd: advancedUnpaidEnd },
    paid(lastPaidEnd),
  ]);
  assert.equal(out?.toISOString(), lastPaidEnd.toISOString());
  assert.notEqual(out?.toISOString(), advancedUnpaidEnd.toISOString());
});

test("resolver: MONTHLY can never become +365", () => {
  const monthlyEnd = new Date("2026-09-26T00:00:00.000Z");
  const out = resolvePaidPeriodEnd([paid(monthlyEnd)]);
  assert.equal(out?.toISOString(), monthlyEnd.toISOString());
  const aYearOut = Date.now() + 365 * 24 * 60 * 60 * 1000;
  assert.ok(
    Math.abs(out!.getTime() - aYearOut) > 30 * 24 * 60 * 60 * 1000,
    "a monthly term must never land a year out",
  );
});

test("resolver: ANNUAL with no provable date is null, not a manufactured year", () => {
  assert.equal(resolvePaidPeriodEnd([]), null);
});

test("GIFT +365 is a different thing and must remain untouched", () => {
  // The gift path adds a year because somebody BOUGHT a year. The fallback that
  // was deleted invented a year for a period nobody could read. Same number,
  // opposite epistemics, and the risk is that a future cleanup removes the
  // wrong one.
  const src = readFileSync(
    new URL("../app/api/stripe/webhook/route.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    src.includes("Math.max(currentEnd.getTime(), Date.now()) + 365 * 24 * 60 * 60 * 1000"),
    "the gift extension arithmetic must stay exactly as it is",
  );
  assert.ok(
    src.includes("plan_type: 'gift'"),
    "the gift branch must still set plan_type gift",
  );
});

// ── A: paid-through comes from PRIOR PAID evidence, never an unpaid boundary ──

const PROVEN_PRIOR = new Date("2026-08-26T00:00:00.000Z");
const UNPAID_BOUNDARY_AFTER_A_GAP = new Date("2026-11-01T00:00:00.000Z");

function unpaidInput(over: Partial<PaidThroughInput> = {}): PaidThroughInput {
  return input({
    latestInvoiceStatus: "open",
    latestInvoiceNextPaymentAttempt: null,
    collectionState: "terminated",
    ...over,
  });
}

test("A5: ordinary failed renewal uses the PROVEN prior paid end", () => {
  const out = classifyPaidThrough(
    unpaidInput({ priorPaidThrough: { kind: "proven", through: PROVEN_PRIOR } }),
  );
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  assert.equal(out.through.toISOString(), PROVEN_PRIOR.toISOString());
});

test("A4: no paid history at all is unpaid through the SUBSCRIPTION START", () => {
  // "none" means the lookup succeeded and found zero paid invoices, which is
  // positive evidence that no time was ever paid for.
  const out = classifyPaidThrough(
    unpaidInput({ priorPaidThrough: { kind: "none" } }),
  );
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  assert.equal(out.through.toISOString(), SUB_STARTED_AT.toISOString());
});

test("A4b: no paid history AND no usable start date is unknown", () => {
  const out = classifyPaidThrough(
    unpaidInput({ priorPaidThrough: { kind: "none" }, subscriptionStartedAt: null }),
  );
  assert.equal(out.kind, "unknown");
});

test("A7: a FAILED prior-payment lookup is unknown, and never revokes", () => {
  const out = classifyPaidThrough(
    unpaidInput({ priorPaidThrough: { kind: "unknown" } }),
  );
  assert.equal(out.kind, "unknown");
  if (out.kind !== "unknown") return;
  assert.match(out.reason, /prior payment history could not be read/);
  assert.notEqual(out.kind, "unpaid", "absence of evidence must not revoke");
});

test("A6: THE GAP CASE — the proven prior end wins over the unpaid boundary", () => {
  // The unpaid invoice's own line start sits AFTER the real last paid end.
  // Reading it would hand out time nobody bought.
  const out = classifyPaidThrough(
    unpaidInput({
      latestInvoiceLinePeriodStart: UNPAID_BOUNDARY_AFTER_A_GAP,
      priorPaidThrough: { kind: "proven", through: PROVEN_PRIOR },
    }),
  );
  assert.equal(out.kind, "unpaid");
  if (out.kind !== "unpaid") return;
  assert.equal(out.through.toISOString(), PROVEN_PRIOR.toISOString());
  assert.notEqual(
    out.through.toISOString(),
    UNPAID_BOUNDARY_AFTER_A_GAP.toISOString(),
    "an unpaid invoice boundary must never be paid-through",
  );
  assert.ok(out.through.getTime() < UNPAID_BOUNDARY_AFTER_A_GAP.getTime());
});

test("A: the unpaid invoice's lineStart is never consulted, whatever it says", () => {
  // Same prior evidence, wildly different lineStart values: the answer must not
  // move at all.
  const answers = [
    new Date("2020-01-01T00:00:00.000Z"),
    new Date("2030-01-01T00:00:00.000Z"),
    null,
  ].map((lineStart) =>
    classifyPaidThrough(
      unpaidInput({
        latestInvoiceLinePeriodStart: lineStart,
        priorPaidThrough: { kind: "proven", through: PROVEN_PRIOR },
      }),
    ),
  );
  for (const out of answers) {
    assert.equal(out.kind, "unpaid");
    if (out.kind !== "unpaid") return;
    assert.equal(out.through.toISOString(), PROVEN_PRIOR.toISOString());
  }
});

test("A: uncollectible follows the same prior-payment rules as open", () => {
  for (const prior of [
    { kind: "proven" as const, through: PROVEN_PRIOR },
    { kind: "none" as const },
    { kind: "unknown" as const },
  ]) {
    const out = classifyPaidThrough(
      unpaidInput({ latestInvoiceStatus: "uncollectible", priorPaidThrough: prior }),
    );
    assert.equal(
      out.kind,
      prior.kind === "unknown" ? "unknown" : "unpaid",
      `prior ${prior.kind}`,
    );
  }
});

test("A: pending still short-circuits before prior payment is consulted", () => {
  const out = classifyPaidThrough(
    input({
      latestInvoiceStatus: "open",
      latestInvoiceNextPaymentAttempt: FUTURE_RETRY,
      priorPaidThrough: { kind: "unknown" },
    }),
  );
  assert.equal(out.kind, "pending");
});

test("A: the PAID branch is untouched by any prior-payment value", () => {
  for (const prior of [
    { kind: "proven" as const, through: PROVEN_PRIOR },
    { kind: "none" as const },
    { kind: "unknown" as const },
  ]) {
    const out = classifyPaidThrough(input({ priorPaidThrough: prior }));
    assert.equal(out.kind, "paid", `prior ${prior.kind} must not disturb a paid invoice`);
    if (out.kind !== "paid") return;
    assert.equal(out.through.toISOString(), BILLED_END.toISOString());
  }
});
