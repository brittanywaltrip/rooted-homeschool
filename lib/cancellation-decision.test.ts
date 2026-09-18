// Unit tests for the cancellation entitlement decision.
//   node --test lib/cancellation-decision.test.ts
//
// This is the only decision in the billing code that can take Rooted+ away, so
// the tests are written as the safety invariant: revoke only on positive
// evidence, and write nothing at all otherwise.

import { test } from "node:test";
import assert from "node:assert/strict";

import { decideCancellation } from "./cancellation-decision.ts";
import type { PaidThrough } from "./paid-through.ts";

const NOW = new Date("2026-09-18T00:00:00.000Z");
const FUTURE = new Date("2027-03-01T00:00:00.000Z");
const PAST = new Date("2026-08-26T00:00:00.000Z");

// ── writes ──────────────────────────────────────────────────────────────────

test("paid with a future term keeps access and records the purchased end date", () => {
  const d = decideCancellation({ classification: { kind: "paid", through: FUTURE }, now: NOW });
  assert.equal(d.action, "write");
  if (d.action !== "write") return;
  assert.equal(d.termRemaining, true);
  assert.deepEqual(d.patch, {
    is_pro: true,
    subscription_status: "cancelled",
    subscription_end_date: FUTURE.toISOString(),
    cancel_at: null,
  });
  assert.equal("plan_type" in d.patch, false, "plan_type stays set while access is live");
});

test("paid but the term is already over revokes and clears the plan", () => {
  const d = decideCancellation({ classification: { kind: "paid", through: PAST }, now: NOW });
  assert.equal(d.action, "write");
  if (d.action !== "write") return;
  assert.equal(d.termRemaining, false);
  assert.equal(d.patch.is_pro, false);
  assert.equal(d.patch.plan_type, null);
  assert.equal(d.patch.subscription_end_date, PAST.toISOString());
});

test("unpaid revokes and stamps the END OF THE LAST PAID PERIOD, not now", () => {
  const d = decideCancellation({ classification: { kind: "unpaid", through: PAST }, now: NOW });
  assert.equal(d.action, "write");
  if (d.action !== "write") return;
  assert.equal(d.patch.is_pro, false);
  assert.equal(d.patch.plan_type, null);
  // Using `now` here would make the webhook and the reconciliation write
  // different values for the same family.
  assert.equal(d.patch.subscription_end_date, PAST.toISOString());
  assert.notEqual(d.patch.subscription_end_date, NOW.toISOString());
});

test("an unpaid FUTURE period can never become entitlement", () => {
  // The bug in one assertion: even when the unpaid date is somehow in the
  // future, `unpaid` must never grant access.
  const d = decideCancellation({ classification: { kind: "unpaid", through: FUTURE }, now: NOW });
  assert.equal(d.action, "write");
  if (d.action !== "write") return;
  assert.equal(d.termRemaining, false, "unpaid is never entitlement, whatever the date");
  assert.equal(d.patch.is_pro, false);
});

// ── skips ───────────────────────────────────────────────────────────────────

test("pending writes NOTHING and says why", () => {
  const retryAt = new Date("2026-09-20T00:00:00.000Z");
  const d = decideCancellation({ classification: { kind: "pending", retryAt }, now: NOW });
  assert.equal(d.action, "skip");
  if (d.action !== "skip") return;
  assert.match(d.reason, /still collecting/);
});

test("unknown writes NOTHING and carries the reason through", () => {
  const d = decideCancellation({
    classification: { kind: "unknown", reason: "refund state could not be determined" },
    now: NOW,
  });
  assert.equal(d.action, "skip");
  if (d.action !== "skip") return;
  assert.equal(d.reason, "refund state could not be determined");
});

test("INVARIANT: a skip yields no patch at all, not a partial one", () => {
  // A cancelled marker with no date would strand the row forever: rule 1 needs
  // a date, and rule 3 excludes rows already marked cancelled.
  const skips: PaidThrough[] = [
    { kind: "pending", retryAt: new Date("2026-09-20T00:00:00.000Z") },
    { kind: "unknown", reason: "any" },
  ];
  for (const classification of skips) {
    const d = decideCancellation({ classification, now: NOW });
    assert.equal(d.action, "skip");
    assert.equal("patch" in d, false, "a skip must not carry any fields to write");
  }
});

test("INVARIANT: is_pro is only ever true for a paid term still running", () => {
  type Decided = Extract<PaidThrough, { through: Date }>;
  const cases: Array<{ c: Decided; expectPro: boolean }> = [
    { c: { kind: "paid", through: FUTURE }, expectPro: true },
    { c: { kind: "paid", through: PAST }, expectPro: false },
    { c: { kind: "unpaid", through: PAST }, expectPro: false },
    { c: { kind: "unpaid", through: FUTURE }, expectPro: false },
  ];
  for (const { c, expectPro } of cases) {
    const d = decideCancellation({ classification: c, now: NOW });
    assert.equal(d.action, "write");
    if (d.action !== "write") return;
    assert.equal(d.patch.is_pro, expectPro, `${c.kind} through ${c.through.toISOString()}`);
  }
});

test("cancel_at is always cleared on a write, never on a skip", () => {
  const w = decideCancellation({ classification: { kind: "paid", through: FUTURE }, now: NOW });
  assert.equal(w.action, "write");
  if (w.action !== "write") return;
  assert.equal(w.patch.cancel_at, null);
});

test("A: an unpaid classification never grants, whatever date it carries", () => {
  // Phase A changes WHERE the unpaid date comes from, not what it means. This
  // pins the meaning so a future change to the source cannot leak entitlement.
  const dates = [PAST, FUTURE, new Date("2030-01-01T00:00:00.000Z")];
  for (const through of dates) {
    const d = decideCancellation({ classification: { kind: "unpaid", through }, now: NOW });
    assert.equal(d.action, "write");
    if (d.action !== "write") return;
    assert.equal(d.patch.is_pro, false, `unpaid through ${through.toISOString()}`);
    assert.equal(d.patch.plan_type, null);
    assert.equal(d.patch.subscription_end_date, through.toISOString());
  }
});
