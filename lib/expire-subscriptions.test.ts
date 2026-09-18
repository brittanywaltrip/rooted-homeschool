// The nightly sweep: a cancelled paid term ends when it ends, and so does a
// gifted year, and nobody with a live Stripe subscription is ever touched.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyPaidThrough } from "./paid-through.ts";
import { decideCancellation } from "./cancellation-decision.ts";
import {
  sweepExpiredAccess,
  type SweepClient,
  type SubscriptionSnapshot,
  type SubscriptionSnapshotBatch,
} from "./expire-subscriptions.ts";

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
// Full ISO form with milliseconds: rule 3 now normalises through Date, so the
// value it writes is toISOString() output rather than whatever literal Stripe
// or a fixture happened to use. Postgres parses both identically into the
// timestamptz column; matching the emitted form keeps the assertions exact.
const PAST = "2026-09-01T00:00:00.000Z";
const FUTURE = "2027-03-01T00:00:00.000Z";

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
    // ── Rule 3 fixtures ──────────────────────────────────────────────────
    // The shape the stale-event bug left behind: Stripe cancelled the
    // subscription, then a late customer.subscription.updated reset the row to
    // 'active' with a null end date, so rule 1 could never see it again.
    { id: "stale-victim", display_name: "Stale Victim", plan_type: "standard", is_pro: true, subscription_status: "active", stripe_subscription_id: "sub_canceled", current_period_end: FUTURE, subscription_end_date: null },
    // Same shape, but the term it was paid through is already over.
    { id: "stale-victim-expired", display_name: "Stale Expired", plan_type: "standard", is_pro: true, subscription_status: "active", stripe_subscription_id: "sub_canceled_past", current_period_end: PAST, subscription_end_date: null },
    // Stripe cannot be reached for this one.
    { id: "reconcile-unknown", display_name: "Unreachable", plan_type: "standard", is_pro: true, subscription_status: "active", stripe_subscription_id: "sub_unreachable", current_period_end: FUTURE, subscription_end_date: null },
    // Stripe answers, but not with a terminal status.
    { id: "reconcile-past-due", display_name: "Past Due", plan_type: "standard", is_pro: true, subscription_status: "past_due", stripe_subscription_id: "sub_pastdue", current_period_end: FUTURE, subscription_end_date: null },
    // Cancelled in Stripe, but there is no paid-through date anywhere.
    { id: "reconcile-no-date", display_name: "No Date", plan_type: "standard", is_pro: true, subscription_status: "active", stripe_subscription_id: "sub_canceled_nodate", current_period_end: null, subscription_end_date: null },
  ];
}

// What Stripe reports for each subscription id in the fixtures. null is the
// "could not be asked, or could not answer" case.
function paidInvoice(end: string, start = PAST): Omit<SubscriptionSnapshot, "status"> {
  return {
    latestInvoiceId: "in_paid",
    latestInvoiceStatus: "paid",
    linePeriodStart: start,
    linePeriodEnd: end,
    nextPaymentAttempt: null,
    collectionState: "terminated",
  };
}

const snapshots: Record<string, SubscriptionSnapshot | null> = {
  sub_canceled: { status: "canceled", ...paidInvoice(FUTURE) },
  sub_canceled_past: { status: "canceled", ...paidInvoice(PAST) },
  // Stripe says cancelled, but nothing about the invoice can be read.
  sub_canceled_nodate: {
    status: "canceled",
    latestInvoiceId: null,
    latestInvoiceStatus: null,
    linePeriodStart: null,
    linePeriodEnd: null,
    nextPaymentAttempt: null,
    collectionState: "terminated",
  },
  // The failed-renewal shape: the invoice was never paid, so the last paid
  // period ended where this unpaid one starts.
  sub_canceled_unpaid: {
    status: "canceled",
    latestInvoiceId: "in_unpaid",
    latestInvoiceStatus: "open",
    linePeriodStart: PAST,
    linePeriodEnd: FUTURE,
    nextPaymentAttempt: null,
    collectionState: "terminated",
  },
  // Cancelled, but Stripe has another collection attempt scheduled.
  sub_canceled_dunning: {
    status: "canceled",
    latestInvoiceId: "in_dunning",
    latestInvoiceStatus: "open",
    linePeriodStart: PAST,
    linePeriodEnd: FUTURE,
    nextPaymentAttempt: FUTURE,
    collectionState: "terminated",
  },
  // Cancelled, unpaid invoice, but nothing corroborates that collection ended.
  sub_canceled_uncorroborated: {
    status: "canceled",
    latestInvoiceId: "in_uncorroborated",
    latestInvoiceStatus: "open",
    linePeriodStart: PAST,
    linePeriodEnd: FUTURE,
    nextPaymentAttempt: null,
    collectionState: "unknown",
  },
  sub_pastdue: { status: "past_due", ...paidInvoice(FUTURE) },
  sub_live: { status: "active", ...paidInvoice(FUTURE) },
  sub_unreachable: null,
};
const stripeSnapshot = async (id: string): Promise<SubscriptionSnapshot | null> =>
  snapshots[id] ?? null;

// Refund evidence for the fixtures. The default is a SUCCESSFUL lookup that
// found nothing refunded, which is evidence. "in_unknown" models a lookup that
// failed, which is not, and must leave the family alone.
const refundStates = async (invoiceId: string | null) =>
  invoiceId === "in_unknown" ? ("unknown" as const) : ("none" as const);

/** The sweep with rule 3 switched on. */
const sweepWithReconcile = (
  profiles: Row[],
  logs: string[] = [],
  dryRun = false,
  snapshot = stripeSnapshot,
) =>
  sweepExpiredAccess(
    fakeClient(profiles),
    NOW,
    (...p) => logs.push(p.join(" ")),
    stripeSays,
    { dryRun, getSubscriptionSnapshot: snapshot, getInvoiceRefundState: refundStates },
  );

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

// ── Rule 3: reconcile paid rows against Stripe ──────────────────────────────

test("rule 3 does not run at all unless a Stripe snapshot source is supplied", async () => {
  const profiles = rows();
  const out = await sweepExpiredAccess(fakeClient(profiles), NOW, () => {}, stripeSays);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.reconciled, 0);
  const victim = profiles.find((p) => p.id === "stale-victim")!;
  assert.equal(victim.subscription_status, "active", "untouched when rule 3 is off");
  assert.equal(victim.subscription_end_date, null);
});

test("an active Stripe subscription is never touched by reconciliation", async () => {
  const profiles = rows();
  const out = await sweepWithReconcile(profiles);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.ok(!out.reconciledIds.includes("active"), "an active subscriber is not reconciled");
  const a = profiles.find((p) => p.id === "active")!;
  assert.equal(a.is_pro, true);
  assert.equal(a.subscription_status, "active");
  assert.equal(a.subscription_end_date, null);
});

test("a cancelled Stripe subscription is synchronised: status and end date only, never entitlement", async () => {
  const profiles = rows();
  const logs: string[] = [];
  const out = await sweepWithReconcile(profiles, logs);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(out.reconciledIds, ["stale-victim", "stale-victim-expired"]);

  const v = profiles.find((p) => p.id === "stale-victim")!;
  assert.equal(v.subscription_status, "cancelled");
  assert.equal(v.subscription_end_date, FUTURE, "stamped with the term Stripe says they paid through");
  assert.equal(v.is_pro, true, "reconciliation never removes access");
  assert.equal(v.plan_type, "standard", "reconciliation never clears the plan");
  assert.ok(logs.some((l) => l.includes("reconciled stale-victim")));
});

test("reconciliation hands rule 1 a date, and rule 1 ends access on the next run", async () => {
  const profiles = rows();
  const first = await sweepWithReconcile(profiles);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.ok(first.reconciledIds.includes("stale-victim-expired"));
  const row = profiles.find((p) => p.id === "stale-victim-expired")!;
  assert.equal(row.is_pro, true, "still entitled immediately after being stamped");
  assert.equal(row.subscription_end_date, PAST);

  const second = await sweepWithReconcile(profiles);
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.ok(second.ids.includes("stale-victim-expired"), "rule 1 picks it up once it carries a past end date");
  assert.equal(row.is_pro, false);
  assert.equal(row.plan_type, null);
  assert.equal(row.subscription_status, "cancelled");
});

test("a row Stripe cannot answer for, or answers non-terminally for, is left alone", async () => {
  const profiles = rows();
  const logs: string[] = [];
  const out = await sweepWithReconcile(profiles, logs);
  assert.ok(out.ok);

  const unknown = profiles.find((p) => p.id === "reconcile-unknown")!;
  assert.equal(unknown.subscription_status, "active", "never synchronised on a guess");
  assert.equal(unknown.subscription_end_date, null);
  assert.equal(unknown.is_pro, true);
  assert.ok(logs.some((l) => l.includes("reconcile left alone, Stripe could not confirm reconcile-unknown")));

  const pastDue = profiles.find((p) => p.id === "reconcile-past-due")!;
  assert.equal(pastDue.subscription_status, "past_due", "past_due is not cancelled");
  assert.equal(pastDue.subscription_end_date, null);
  assert.equal(pastDue.is_pro, true);
});

test("a cancelled subscription with no readable invoice is left alone, never given an invented date", async () => {
  const profiles = rows();
  const logs: string[] = [];
  await sweepWithReconcile(profiles, logs);
  const nd = profiles.find((p) => p.id === "reconcile-no-date")!;
  assert.equal(nd.subscription_status, "active");
  assert.equal(nd.subscription_end_date, null);
  assert.equal(nd.is_pro, true);
  assert.ok(logs.some((l) => l.includes("reconcile left alone,") && l.includes("reconcile-no-date")));
});

test("a second run is a no-op: reconciliation is idempotent", async () => {
  const profiles = rows();
  const first = await sweepWithReconcile(profiles);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.reconciled, 2);

  const before = JSON.stringify(profiles.find((p) => p.id === "stale-victim"));
  const second = await sweepWithReconcile(profiles);
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.reconciled, 0, "nothing left to reconcile");
  assert.deepEqual(second.reconciledIds, []);
  assert.equal(JSON.stringify(profiles.find((p) => p.id === "stale-victim")), before, "row byte-identical after a second run");

  const third = await sweepWithReconcile(profiles);
  assert.ok(third.ok && third.reconciled === 0);
});

test("a family who resubscribed between the read and the write is never stamped", async () => {
  const profiles = rows();
  // Stripe answers "canceled" for the OLD id, but by the time the write lands
  // linkStripeSubscription has given them a new subscription id.
  const racing = async (id: string): Promise<SubscriptionSnapshot | null> => {
    if (id === "sub_canceled") {
      const row = profiles.find((p) => p.id === "stale-victim")!;
      row.stripe_subscription_id = "sub_brand_new";
      row.subscription_status = "active";
    }
    return snapshots[id] ?? null;
  };
  await sweepWithReconcile(profiles, [], false, racing);
  const v = profiles.find((p) => p.id === "stale-victim")!;
  assert.equal(v.subscription_status, "active", "the write guard rejected the stale read");
  assert.equal(v.subscription_end_date, null);
  assert.equal(v.is_pro, true);
});

test("a dry run reports every planned change and writes nothing, for all three rules", async () => {
  const profiles = rows();
  const snapshot = JSON.stringify(profiles);
  const logs: string[] = [];
  const out = await sweepWithReconcile(profiles, logs, true);
  assert.ok(out.ok);
  if (!out.ok) return;

  assert.equal(out.dryRun, true);
  assert.equal(JSON.stringify(profiles), snapshot, "not one row changed");

  const byRule = (r: string) => out.planned.filter((w) => w.rule === r).map((w) => w.id);
  assert.deepEqual(byRule("reconcile-cancelled"), ["stale-victim", "stale-victim-expired"]);
  assert.deepEqual(byRule("cancelled-term-ended"), ["cancelled-ended"], "rule 1 is suppressed too");
  assert.deepEqual(byRule("gift-ended"), ["gift-ended", "gift-after-cancel"], "rule 2 is suppressed too");

  const planned = out.planned.find((w) => w.id === "stale-victim")!;
  assert.deepEqual(planned.patch, { subscription_status: "cancelled", subscription_end_date: FUTURE });
  assert.ok(planned.because.includes("canceled"));
  const actionLogs = logs.filter((l) => /(expired|reconciled) /.test(l));
  assert.ok(actionLogs.length > 0);
  assert.ok(
    actionLogs.every((l) => l.startsWith("[cron/expire-subscriptions][dry-run]")),
    "every line reporting a change is marked as a dry run",
  );
});

test("rule 3 leaves gift rows to rule 2 and already-cancelled rows to rule 1", async () => {
  const profiles = rows();
  const out = await sweepWithReconcile(profiles);
  assert.ok(out.ok);
  if (!out.ok) return;
  for (const id of ["gift-ended", "gift-running", "gift-then-paid", "gift-after-cancel", "gift-unknown", "cancelled-ended", "cancelled-running"]) {
    assert.ok(!out.reconciledIds.includes(id), `${id} is not rule 3's to touch`);
  }
  assert.equal(profiles.find((p) => p.id === "cancelled-running")!.subscription_end_date, FUTURE, "an in-term cancellation keeps its own date");
});

// ── Rule 3, bulk form: one Stripe listing instead of one call per subscriber ──

/** The bulk resolver built from the same fixture snapshots. */
function bulkFrom(
  map: Record<string, SubscriptionSnapshot | null> = snapshots,
  calls: string[][] = [],
) {
  return async (ids: string[]) => {
    calls.push(ids);
    const out = new Map<string, SubscriptionSnapshot>();
    for (const id of ids) {
      const snap = map[id];
      // An id Stripe did not return is simply absent from the map.
      if (snap) out.set(id, snap);
    }
    return out;
  };
}

const sweepWithBulk = (
  profiles: Row[],
  logs: string[] = [],
  dryRun = false,
  // Typed as the production callback, not inferred from bulkFrom(): the default
  // always returns a Map, so inference would narrow this to exclude null and
  // reject a fake that reports "Stripe could not be reached at all".
  bulk: SubscriptionSnapshotBatch = bulkFrom(),
) =>
  sweepExpiredAccess(fakeClient(profiles), NOW, (...p) => logs.push(p.join(" ")), stripeSays, {
    dryRun,
    getSubscriptionSnapshots: bulk,
    getInvoiceRefundState: refundStates,
  });

test("the bulk form asks Stripe once for the whole run, with each candidate id exactly once", async () => {
  const profiles = rows();
  const calls: string[][] = [];
  const out = await sweepWithBulk(profiles, [], false, bulkFrom(snapshots, calls));
  assert.ok(out.ok);
  assert.equal(calls.length, 1, "exactly one Stripe round trip, not one per subscriber");
  const ids = calls[0];
  assert.equal(ids.length, new Set(ids).size, "no duplicate ids requested");
  assert.ok(ids.includes("sub_canceled") && ids.includes("sub_live"));
  assert.ok(!ids.includes("sub_123"), "gift rows are not rule 3's to ask about");
  assert.ok(!ids.includes("sub_old"), "already-cancelled rows are not asked about");
});

test("bulk and per-id forms produce identical results", async () => {
  const viaBulk = rows();
  const viaSingle = rows();
  const a = await sweepWithBulk(viaBulk);
  const b = await sweepWithReconcile(viaSingle);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(a.reconciledIds, b.reconciledIds);
  assert.deepEqual(a.ids, b.ids);
  assert.deepEqual(a.giftIds, b.giftIds);
  assert.deepEqual(viaBulk, viaSingle, "every row ends in the same state either way");
});

test("an id missing from the listing is treated as unknown, never as cancelled", async () => {
  const profiles = rows();
  const logs: string[] = [];
  // Stripe returns nothing at all for the stuck row, as a truncated listing would.
  const partial = bulkFrom({ ...snapshots, sub_canceled: null });
  const out = await sweepWithBulk(profiles, logs, false, partial);
  assert.ok(out.ok);
  if (!out.ok) return;

  const v = profiles.find((p) => p.id === "stale-victim")!;
  assert.equal(v.subscription_status, "active", "absence is not evidence of cancellation");
  assert.equal(v.subscription_end_date, null);
  assert.equal(v.is_pro, true);
  assert.ok(!out.reconciledIds.includes("stale-victim"));
  assert.ok(logs.some((l) => l.includes("reconcile left alone, Stripe could not confirm stale-victim")));
});

test("a partial listing still acts on what Stripe did return", async () => {
  const profiles = rows();
  // Stripe answered for one stuck row and not the other.
  const partial = bulkFrom({ ...snapshots, sub_canceled_past: null });
  const out = await sweepWithBulk(profiles, [], false, partial);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(out.reconciledIds, ["stale-victim"]);
  assert.equal(profiles.find((p) => p.id === "stale-victim")!.subscription_status, "cancelled");
  assert.equal(profiles.find((p) => p.id === "stale-victim-expired")!.subscription_status, "active");
});

test("when Stripe cannot be reached at all, rule 3 sits the whole run out", async () => {
  const profiles = rows();
  const logs: string[] = [];
  const before = JSON.stringify(profiles.filter((p) => String(p.id).startsWith("stale")));
  const out = await sweepWithBulk(profiles, logs, false, async () => null);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.reconciled, 0);
  assert.equal(JSON.stringify(profiles.filter((p) => String(p.id).startsWith("stale"))), before);
  assert.ok(logs.some((l) => l.includes("reconcile skipped for the whole run")));
  assert.ok(out.ids.includes("cancelled-ended"), "rules 1 and 2 still run normally");
});

test("the bulk form keeps the stale-read guard, idempotency and dry run", async () => {
  // Resubscribed between the read and the write.
  const racing = rows();
  await sweepWithBulk(racing, [], false, async (ids) => {
    const row = racing.find((p) => p.id === "stale-victim")!;
    row.stripe_subscription_id = "sub_brand_new";
    return bulkFrom()(ids);
  });
  const raced = racing.find((p) => p.id === "stale-victim")!;
  assert.equal(raced.subscription_status, "active", "stale read rejected by the write guard");
  assert.equal(raced.subscription_end_date, null);

  // Idempotent. Scoped to a row whose term is still running: a row rule 3
  // stamps with a PAST end date is meant to be picked up by rule 1 on the next
  // run, so the sweep as a whole is deliberately not stable across two runs.
  const profiles = rows();
  const first = await sweepWithBulk(profiles);
  assert.ok(first.ok && first.reconciled === 2);
  const stamped = JSON.stringify(profiles.find((p) => p.id === "stale-victim"));
  const second = await sweepWithBulk(profiles);
  assert.ok(second.ok && second.reconciled === 0, "rule 3 finds nothing left to do");
  assert.equal(
    JSON.stringify(profiles.find((p) => p.id === "stale-victim")),
    stamped,
    "an in-term row is byte-identical after a second run",
  );

  // Dry run.
  const dry = rows();
  const untouched = JSON.stringify(dry);
  const out = await sweepWithBulk(dry, [], true);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.dryRun, true);
  assert.equal(JSON.stringify(dry), untouched, "not one row changed");
  assert.deepEqual(
    out.planned.filter((w) => w.rule === "reconcile-cancelled").map((w) => w.id),
    ["stale-victim", "stale-victim-expired"],
  );
});

// ── Phase B: paid-through classification ────────────────────────────────────

test("an unpaid renewal is reconciled to the LAST PAID period, never the advanced one", async () => {
  // The failed-payment shape. Stripe advanced the subscription period to
  // FUTURE when it created the renewal invoice, then the card was declined and
  // the subscription was cancelled. Before the paid-through classifier this
  // stamped FUTURE and handed the family a term they never paid for.
  const profiles: Row[] = [
    {
      id: "unpaid-renewal",
      display_name: "Unpaid Renewal",
      plan_type: "standard",
      is_pro: true,
      subscription_status: "active",
      stripe_subscription_id: "sub_canceled_unpaid",
      current_period_end: FUTURE,
      subscription_end_date: null,
    },
  ];

  const out = await sweepWithBulk(profiles, [], false);
  assert.ok(out.ok);
  if (!out.ok) return;

  assert.deepEqual(out.reconciledIds, ["unpaid-renewal"]);
  const row = profiles[0];
  assert.equal(row.subscription_status, "cancelled");
  assert.equal(
    row.subscription_end_date,
    PAST,
    "must be the end of the last PAID period, which is the unpaid period's start",
  );
  assert.notEqual(
    row.subscription_end_date,
    FUTURE,
    "must never stamp the period Stripe advanced without payment",
  );
  // Rule 3 still never touches entitlement.
  assert.equal(row.is_pro, true);
  assert.equal(row.plan_type, "standard");
});

test("rule 3 ignores the row's own current_period_end entirely", async () => {
  // The row claims a future paid-through date, but the invoice says the period
  // was never paid. The invoice wins; the row's copy of the advanced field is
  // not consulted as a fallback any more.
  const profiles: Row[] = [
    {
      id: "row-claims-future",
      display_name: "Row Claims Future",
      plan_type: "standard",
      is_pro: true,
      subscription_status: "active",
      stripe_subscription_id: "sub_canceled_nodate",
      current_period_end: FUTURE,
      subscription_end_date: null,
    },
  ];

  const logs: string[] = [];
  const out = await sweepWithBulk(profiles, logs, false);
  assert.ok(out.ok);
  if (!out.ok) return;

  assert.equal(out.reconciled, 0, "an unreadable invoice must not borrow the row's date");
  assert.equal(profiles[0].subscription_end_date, null);
  assert.ok(logs.some((l) => l.includes("reconcile left alone,") && l.includes("proves nothing either way")));
});

// ── Phase C: pending, corroboration and refund evidence ─────────────────────

function oneRow(subId: string): Row[] {
  return [
    {
      id: "subject",
      display_name: "Subject",
      plan_type: "standard",
      is_pro: true,
      subscription_status: "active",
      stripe_subscription_id: subId,
      current_period_end: FUTURE,
      subscription_end_date: null,
    },
  ];
}

test("rule 3 leaves a family alone while Stripe is still collecting", async () => {
  const profiles = oneRow("sub_canceled_dunning");
  const logs: string[] = [];
  const out = await sweepWithBulk(profiles, logs, false);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.reconciled, 0);
  assert.equal(profiles[0].subscription_status, "active", "nothing written at all");
  assert.equal(profiles[0].subscription_end_date, null);
  assert.ok(logs.some((l) => l.includes("still collecting")));
});

test("a null retry date alone never lets rule 3 revoke: corroboration required", async () => {
  const profiles = oneRow("sub_canceled_uncorroborated");
  const logs: string[] = [];
  const out = await sweepWithBulk(profiles, logs, false);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.reconciled, 0);
  assert.equal(profiles[0].subscription_end_date, null);
  assert.ok(logs.some((l) => l.includes("not corroborated as terminated")));
});

test("a FAILED refund lookup leaves the family alone, never 'not refunded'", async () => {
  const profiles = oneRow("sub_canceled_unpaid");
  const logs: string[] = [];
  const out = await sweepExpiredAccess(
    fakeClient(profiles),
    NOW,
    (...p) => logs.push(p.join(" ")),
    stripeSays,
    {
      dryRun: false,
      getSubscriptionSnapshots: bulkFrom(),
      // The lookup itself failed. Absence of evidence is not evidence.
      getInvoiceRefundState: async () => "unknown" as const,
    },
  );
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.reconciled, 0);
  assert.equal(profiles[0].subscription_end_date, null);
  assert.ok(logs.some((l) => l.includes("refund state could not be determined")));
});

test("with NO refund resolver at all, rule 3 writes nothing rather than assuming", async () => {
  const profiles = oneRow("sub_canceled_unpaid");
  const out = await sweepExpiredAccess(
    fakeClient(profiles),
    NOW,
    () => {},
    stripeSays,
    { dryRun: false, getSubscriptionSnapshots: bulkFrom() },
  );
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.reconciled, 0, "an unperformed lookup must not become 'none'");
  assert.equal(profiles[0].subscription_end_date, null);
});

test("PARITY: rule 3 and the webhook decision write the same date from the same evidence", async () => {
  // The invariant that keeps the safety net and the primary path in step.
  const profiles = oneRow("sub_canceled_unpaid");
  const out = await sweepWithBulk(profiles, [], false);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.reconciled, 1);

  const snap = snapshots["sub_canceled_unpaid"]!;
  const classification = classifyPaidThrough({
    latestInvoiceStatus: snap.latestInvoiceStatus,
    latestInvoiceLinePeriodStart: new Date(snap.linePeriodStart!),
    latestInvoiceLinePeriodEnd: new Date(snap.linePeriodEnd!),
    latestInvoiceNextPaymentAttempt: null,
    collectionState: snap.collectionState,
    refundState: "none",
    now: NOW,
  });
  const decision = decideCancellation({ classification, now: NOW });
  assert.equal(decision.action, "write");
  if (decision.action !== "write") return;

  assert.equal(
    profiles[0].subscription_end_date,
    decision.patch.subscription_end_date,
    "the safety net and the webhook must never disagree about the paid-through date",
  );
  assert.equal(decision.patch.is_pro, false, "the webhook revokes");
  assert.equal(profiles[0].is_pro, true, "rule 3 never touches entitlement");
});
