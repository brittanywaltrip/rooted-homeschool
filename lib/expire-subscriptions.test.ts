// The nightly sweep: a cancelled paid term ends when it ends, and so does a
// gifted year, and nobody with a live Stripe subscription is ever touched.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { sweepExpiredAccess, type SweepClient } from "./expire-subscriptions.ts";

type Row = Record<string, unknown>;

function fakeClient(profiles: Row[]) {
  const client = {
    from() {
      const make = (update: Record<string, unknown> | null) => {
        const filters: ((r: Row) => boolean)[] = [];
        const run = () => {
          const matched = profiles.filter((r) => filters.every((f) => f(r)));
          if (update) {
            for (const r of matched) Object.assign(r, update);
            return { data: null, error: null };
          }
          return { data: matched.map((r) => ({ ...r })), error: null };
        };
        const q = {
          eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
          not(c: string, _op: string, v: unknown) { filters.push((r) => (v === null ? r[c] != null : r[c] !== v)); return q; },
          is(c: string, v: unknown) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
          lt(c: string, v: unknown) { filters.push((r) => r[c] != null && String(r[c]) < String(v)); return q; },
          in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
          then<T>(res: (v: { data: unknown; error: null }) => T) { return Promise.resolve(run()).then(res); },
        };
        return q;
      };
      return { select: () => make(null), update: (v: Record<string, unknown>) => make(v) };
    },
  };
  return client as unknown as SweepClient;
}

const NOW = new Date("2026-09-15T12:00:00Z");
// What Stripe says about each subscription id in the fixtures.
const stripeSays = async (id: string): Promise<boolean | null> =>
  id === "sub_123" ? true : id === "sub_finished" ? false : null;
const PAST = "2026-09-01T00:00:00Z";
const FUTURE = "2027-03-01T00:00:00Z";

function rows(): Row[] {
  return [
    // A gifted year that ended.
    { id: "gift-ended", display_name: "Ended Gift", plan_type: "gift", is_pro: true, subscription_status: "active", stripe_subscription_id: null, current_period_end: PAST, subscription_end_date: null },
    // A gifted year still running.
    { id: "gift-running", display_name: "Running Gift", plan_type: "gift", is_pro: true, subscription_status: "active", stripe_subscription_id: null, current_period_end: FUTURE, subscription_end_date: null },
    // Gifted once, then bought their own subscription: plan_type stayed 'gift'
    // on a stale row with an old period end, but a live Stripe subscription.
    { id: "gift-then-paid", display_name: "Now Paying", plan_type: "gift", is_pro: true, subscription_status: "active", stripe_subscription_id: "sub_123", current_period_end: PAST, subscription_end_date: null },
    // A cancelled annual plan whose paid term is over.
    { id: "cancelled-ended", display_name: "Cancelled", plan_type: "standard", is_pro: true, subscription_status: "cancelled", stripe_subscription_id: "sub_old", current_period_end: PAST, subscription_end_date: PAST },
    // A cancelled plan with term left.
    { id: "cancelled-running", display_name: "Term Left", plan_type: "standard", is_pro: true, subscription_status: "cancelled", stripe_subscription_id: "sub_old2", current_period_end: FUTURE, subscription_end_date: FUTURE },
    // Paid, cancelled, and gifted a year later: the finished subscription's id
    // is still on the row, because nothing ever clears it.
    { id: "gift-after-cancel", display_name: "Former Subscriber", plan_type: "gift", is_pro: true, subscription_status: "active", stripe_subscription_id: "sub_finished", current_period_end: PAST, subscription_end_date: PAST },
    // Same shape, but Stripe cannot be reached for it.
    { id: "gift-unknown", display_name: "Unconfirmed", plan_type: "gift", is_pro: true, subscription_status: "active", stripe_subscription_id: "sub_unknown", current_period_end: PAST, subscription_end_date: null },
    // An active paying subscriber.
    { id: "active", display_name: "Active", plan_type: "monthly", is_pro: true, subscription_status: "active", stripe_subscription_id: "sub_live", current_period_end: PAST, subscription_end_date: null },
  ];
}

test("a gift past its end date is expired, to free, and logged", async () => {
  const profiles = rows();
  const logs: string[] = [];
  const out = await sweepExpiredAccess(fakeClient(profiles), NOW, (...p) => logs.push(p.join(" ")), stripeSays);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.giftIds, ["gift-ended", "gift-after-cancel"]);
  const ended = profiles.find((p) => p.id === "gift-ended")!;
  assert.equal(ended.is_pro, false);
  assert.equal(ended.plan_type, null);
  assert.equal(ended.subscription_status, "free");
  assert.ok(logs.some((l) => l.includes("expired gift gift-ended")));
  assert.equal(profiles.find((p) => p.id === "gift-running")!.is_pro, true, "a gift still running is untouched");
});

test("a gift with a live Stripe subscription is never expired", async () => {
  const profiles = rows();
  const out = await sweepExpiredAccess(fakeClient(profiles), NOW, () => {}, stripeSays);
  assert.ok(out.ok && !out.giftIds.includes("gift-then-paid"));
  const paid = profiles.find((p) => p.id === "gift-then-paid")!;
  assert.equal(paid.is_pro, true);
  assert.equal(paid.plan_type, "gift");
  assert.equal(profiles.find((p) => p.id === "active")!.is_pro, true, "an active subscriber is untouched");
});

test("a cancelled paid plan still expires as before, and keeps its cancelled status", async () => {
  const profiles = rows();
  const out = await sweepExpiredAccess(fakeClient(profiles), NOW, () => {}, stripeSays);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(out.ids, ["cancelled-ended"]);
  const c = profiles.find((p) => p.id === "cancelled-ended")!;
  assert.equal(c.is_pro, false);
  assert.equal(c.plan_type, null);
  assert.equal(c.subscription_status, "cancelled");
  assert.equal(profiles.find((p) => p.id === "cancelled-running")!.is_pro, true);
});

test("a gift to a former subscriber ends when Stripe says the old subscription is over, and stays when Stripe cannot confirm", async () => {
  const profiles = rows();
  const logs: string[] = [];
  const out = await sweepExpiredAccess(fakeClient(profiles), NOW, (...p) => logs.push(p.join(" ")), stripeSays);
  assert.ok(out.ok);
  const former = profiles.find((p) => p.id === "gift-after-cancel")!;
  assert.equal(former.is_pro, false, "a stale, finished subscription id does not keep a gift alive");
  assert.equal(former.subscription_status, "free");
  const unknown = profiles.find((p) => p.id === "gift-unknown")!;
  assert.equal(unknown.is_pro, true, "never downgraded on a guess");
  assert.ok(logs.some((l) => l.includes("gift left alone, Stripe could not confirm gift-unknown")));
});
