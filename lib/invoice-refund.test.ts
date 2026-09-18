// Unit tests for invoice-scoped refund evidence.
//   node --test lib/invoice-refund.test.ts
//
// The whole point is the none/unknown split: a successful lookup that finds
// nothing refunded is evidence, a failed lookup is not.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyRefund } from "./invoice-refund.ts";

test("a failed lookup is unknown, never softened to 'none'", () => {
  assert.equal(classifyRefund({ lookupSucceeded: false, charge: null }), "unknown");
  assert.equal(
    classifyRefund({ lookupSucceeded: false, charge: { amount: 5900, amountRefunded: 0 } }),
    "unknown",
  );
});

test("a successful lookup with no paid payment is 'none', not unknown", () => {
  // The ordinary open-invoice case: nothing was ever collected, so there is
  // nothing to refund. This is evidence, not absence of it.
  assert.equal(classifyRefund({ lookupSucceeded: true, charge: null }), "none");
});

test("nothing refunded is none", () => {
  assert.equal(
    classifyRefund({ lookupSucceeded: true, charge: { amount: 5900, amountRefunded: 0 } }),
    "none",
  );
});

test("a part of the charge refunded is partial", () => {
  // The live case: one current Rooted+ subscriber carries a $5.85 partial
  // refund from an earlier term. It must never void a later paid term.
  assert.equal(
    classifyRefund({ lookupSucceeded: true, charge: { amount: 3900, amountRefunded: 585 } }),
    "partial",
  );
});

test("the whole charge refunded is full", () => {
  assert.equal(
    classifyRefund({ lookupSucceeded: true, charge: { amount: 5900, amountRefunded: 5900 } }),
    "full",
  );
});

test("an over-refund still reads as full", () => {
  assert.equal(
    classifyRefund({ lookupSucceeded: true, charge: { amount: 5900, amountRefunded: 6000 } }),
    "full",
  );
});

test("a zero-amount charge has nothing to refund", () => {
  // A 100% coupon produces this. It must not divide by a zero total or
  // report 'full' on a charge that never took money.
  assert.equal(
    classifyRefund({ lookupSucceeded: true, charge: { amount: 0, amountRefunded: 0 } }),
    "none",
  );
});

test("unusable amounts are unknown rather than guessed", () => {
  for (const charge of [
    { amount: null, amountRefunded: 0 },
    { amount: 5900, amountRefunded: null },
    { amount: Number.NaN, amountRefunded: 0 },
    { amount: 5900, amountRefunded: Number.NaN },
  ]) {
    assert.equal(classifyRefund({ lookupSucceeded: true, charge }), "unknown");
  }
});
