// Unit tests for deterministic invoice-line selection. Run with:
//   node --test lib/stripe-invoice-line.test.ts
//
// The point of every test here is the same: when the right line cannot be
// proven, the answer is "ambiguous", which becomes "unknown" downstream. A
// plausible guess is the failure mode, not a missing answer.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectSubscriptionInvoiceLine,
  type InvoiceLineLike,
} from "./stripe-invoice-line.ts";

const SUB = "sub_1TxRljLP14EaoUlT7IBDHBSS";
const ITEM = "si_UxMUE6OMhxlkbM";

// Shapes copied from the real dunning invoice in this account.
const TERM_START = 1787749620; // 2026-08-26
const TERM_END = 1790428020; // 2026-09-26

function line(over: Partial<InvoiceLineLike> = {}, details: Record<string, unknown> = {}): InvoiceLineLike {
  return {
    period: { start: TERM_START, end: TERM_END },
    parent: {
      subscription_item_details: {
        subscription: SUB,
        subscription_item: ITEM,
        proration: false,
        ...details,
      },
    },
    ...over,
  };
}

const base = { subscriptionId: SUB, subscriptionItemIds: [ITEM] };

// ── the happy path, from real data ──────────────────────────────────────────

test("finds the single subscription line and reads its period", () => {
  const out = selectSubscriptionInvoiceLine({ ...base, lines: [line()] });
  assert.equal(out.kind, "found");
  if (out.kind !== "found") return;
  assert.equal(out.periodStart?.toISOString(), new Date(TERM_START * 1000).toISOString());
  assert.equal(out.periodEnd?.toISOString(), new Date(TERM_END * 1000).toISOString());
});

test("reads the legacy flat line shape too", () => {
  const legacy: InvoiceLineLike = {
    period: { start: TERM_START, end: TERM_END },
    subscription: SUB,
    subscription_item: ITEM,
    proration: false,
  };
  const out = selectSubscriptionInvoiceLine({ ...base, lines: [legacy] });
  assert.equal(out.kind, "found");
});

// ── proration ───────────────────────────────────────────────────────────────

test("ignores proration lines and picks the real term line", () => {
  const proration = line(
    { period: { start: TERM_START, end: TERM_START + 3600 } },
    { proration: true },
  );
  const out = selectSubscriptionInvoiceLine({ ...base, lines: [proration, line()] });
  assert.equal(out.kind, "found");
  if (out.kind !== "found") return;
  // Index 0 was the proration fragment. Taking lines.data[0] would have
  // reported a one-hour "term".
  assert.equal(out.periodEnd?.toISOString(), new Date(TERM_END * 1000).toISOString());
});

test("an invoice of only proration lines is ambiguous, not a one-hour term", () => {
  const out = selectSubscriptionInvoiceLine({
    ...base,
    lines: [line({ period: { start: TERM_START, end: TERM_START + 3600 } }, { proration: true })],
  });
  assert.equal(out.kind, "ambiguous");
});

// ── multi-line and multi-item ───────────────────────────────────────────────

test("two non-proration lines for the same item are ambiguous, never guessed", () => {
  const second = line({ period: { start: TERM_END, end: TERM_END + 2592000 } });
  const out = selectSubscriptionInvoiceLine({ ...base, lines: [line(), second] });
  assert.equal(out.kind, "ambiguous");
  if (out.kind !== "ambiguous") return;
  assert.match(out.reason, /2 candidate lines/);
});

test("a subscription with more than one item is ambiguous", () => {
  const out = selectSubscriptionInvoiceLine({
    subscriptionId: SUB,
    subscriptionItemIds: [ITEM, "si_second"],
    lines: [line()],
  });
  assert.equal(out.kind, "ambiguous");
  if (out.kind !== "ambiguous") return;
  assert.match(out.reason, /2 items/);
});

test("a subscription with no items is ambiguous", () => {
  const out = selectSubscriptionInvoiceLine({
    subscriptionId: SUB,
    subscriptionItemIds: [],
    lines: [line()],
  });
  assert.equal(out.kind, "ambiguous");
});

test("lines belonging to a DIFFERENT subscription are never selected", () => {
  const other = line({}, { subscription: "sub_someone_else", subscription_item: "si_other" });
  const out = selectSubscriptionInvoiceLine({ ...base, lines: [other] });
  assert.equal(out.kind, "ambiguous");
  if (out.kind !== "ambiguous") return;
  assert.match(out.reason, /no non-proration line matches/);
});

test("a line for the right subscription but the wrong item is not selected", () => {
  const out = selectSubscriptionInvoiceLine({
    ...base,
    lines: [line({}, { subscription_item: "si_a_different_item" })],
  });
  assert.equal(out.kind, "ambiguous");
});

// ── missing and malformed input ─────────────────────────────────────────────

test("no lines, null lines and no subscription id are all ambiguous", () => {
  assert.equal(selectSubscriptionInvoiceLine({ ...base, lines: [] }).kind, "ambiguous");
  assert.equal(selectSubscriptionInvoiceLine({ ...base, lines: null }).kind, "ambiguous");
  assert.equal(
    selectSubscriptionInvoiceLine({ subscriptionId: "", subscriptionItemIds: [ITEM], lines: [line()] }).kind,
    "ambiguous",
  );
});

test("a found line with unusable epochs reports null dates rather than epoch 0", () => {
  const out = selectSubscriptionInvoiceLine({
    ...base,
    lines: [line({ period: { start: 0, end: null } })],
  });
  assert.equal(out.kind, "found");
  if (out.kind !== "found") return;
  assert.equal(out.periodStart, null);
  assert.equal(out.periodEnd, null);
});

test("a found line with no period object at all reports null dates", () => {
  const out = selectSubscriptionInvoiceLine({ ...base, lines: [line({ period: null })] });
  assert.equal(out.kind, "found");
  if (out.kind !== "found") return;
  assert.equal(out.periodStart, null);
  assert.equal(out.periodEnd, null);
});

// ── the trap this module refuses to fall into ───────────────────────────────

test("never reads invoice-root period fields, only the billed line", () => {
  // The caller could hand us an invoice whose root period describes the
  // PREVIOUS cycle. We only ever look at line.period, so a root period cannot
  // leak in. This asserts the selected dates come from the line we matched.
  const rootWouldBe = { start: TERM_START - 2592000, end: TERM_START };
  const out = selectSubscriptionInvoiceLine({
    ...base,
    lines: [line({ period: { start: TERM_START, end: TERM_END } })],
  });
  assert.equal(out.kind, "found");
  if (out.kind !== "found") return;
  assert.notEqual(out.periodEnd?.toISOString(), new Date(rootWouldBe.end * 1000).toISOString());
  assert.equal(out.periodEnd?.toISOString(), new Date(TERM_END * 1000).toISOString());
});
