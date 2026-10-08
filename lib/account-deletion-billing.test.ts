import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareDeletionBilling, type DeletionSubscriptions } from "./account-deletion-billing.ts";

const profile = { stripe_customer_id: "cus_test", stripe_subscription_id: "sub_active" };
type Row = Awaited<ReturnType<DeletionSubscriptions["cancel"]>>;

function fixture(rows: Row[], pageSize = 100) {
  const calls: string[] = [];
  const subscriptions: DeletionSubscriptions = {
    async list(params) {
      calls.push("list");
      assert.equal(params.customer, "cus_test");
      assert.equal(params.status, "all");
      const offset = params.starting_after ? rows.findIndex(row => row.id === params.starting_after) + 1 : 0;
      const data = rows.slice(offset, offset + pageSize).map(row => ({ ...row }));
      return { data, has_more: offset + data.length < rows.length };
    },
    async cancel(id, params) {
      calls.push(`cancel:${id}`);
      assert.deepEqual(params, { invoice_now: false, prorate: false });
      const row = rows.find(row => row.id === id)!;
      row.status = "canceled";
      return { ...row };
    },
  };
  return { calls, subscriptions };
}

test("profile errors or missing profile refuse before accessing Stripe", async () => {
  const get = () => { throw new Error("must not call Stripe"); };
  await assert.rejects(prepareDeletionBilling(profile, { message: "database unavailable" }, get), /profile/);
  await assert.rejects(prepareDeletionBilling(null, null, get), /profile/);
});

test("free account needs no Stripe client; missing customer for a stored subscription refuses", async () => {
  const get = () => { throw new Error("must not call Stripe"); };
  await prepareDeletionBilling({ stripe_customer_id: null, stripe_subscription_id: null }, null, get);
  await assert.rejects(prepareDeletionBilling({ ...profile, stripe_customer_id: null }, null, get), /mapping/);
});

test("all pages and every nonterminal status are canceled and checked again", async () => {
  const statuses: Row["status"][] = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused", "canceled", "incomplete_expired"];
  const rows = statuses.map((status, i) => ({ id: i === 0 ? "sub_active" : `sub_${i}`, status }));
  const { subscriptions, calls } = fixture(rows, 2);
  await prepareDeletionBilling(profile, null, () => subscriptions);
  assert.equal(calls.filter(call => call === "list").length, 8);
  assert.equal(calls.filter(call => call.startsWith("cancel:")).length, 6);
  assert.ok(rows.every(row => row.status === "canceled" || row.status === "incomplete_expired"));
});

test("second-page read failure refuses before any cancellation", async () => {
  const f = fixture([{ id: "sub_active", status: "active" }, { id: "sub_2", status: "trialing" }], 1);
  const list = f.subscriptions.list;
  f.subscriptions.list = async params => {
    if (params.starting_after) throw new Error("page failed");
    return list(params);
  };
  await assert.rejects(prepareDeletionBilling(profile, null, () => f.subscriptions), /page failed/);
  assert.deepEqual(f.calls, ["list"]);
});

test("partial cancellation failure stops and retry handles the already-canceled subscription", async () => {
  const f = fixture([{ id: "sub_active", status: "active" }, { id: "sub_2", status: "past_due" }]);
  const cancel = f.subscriptions.cancel;
  f.subscriptions.cancel = async (id, params) => {
    if (id === "sub_2") throw new Error("Stripe unavailable");
    return cancel(id, params);
  };
  await assert.rejects(prepareDeletionBilling(profile, null, () => f.subscriptions), /Stripe unavailable/);
  f.subscriptions.cancel = cancel;
  await prepareDeletionBilling(profile, null, () => f.subscriptions);
  assert.equal(f.calls.filter(call => call === "cancel:sub_active").length, 1);
});

test("unconfirmed cancellation or an open subscription on the final read refuses", async () => {
  const f = fixture([{ id: "sub_active", status: "active" }]);
  f.subscriptions.cancel = async () => ({ id: "sub_active", status: "active" });
  await assert.rejects(prepareDeletionBilling(profile, null, () => f.subscriptions), /did not confirm/);
  f.subscriptions.cancel = async () => ({ id: "sub_active", status: "canceled" });
  await assert.rejects(prepareDeletionBilling(profile, null, () => f.subscriptions), /remains open/);
});

test("missing stored subscription and broken pagination refuse", async () => {
  const f = fixture([]);
  await assert.rejects(prepareDeletionBilling(profile, null, () => f.subscriptions), /not found/);
  f.subscriptions.list = async () => ({ data: [], has_more: true });
  await assert.rejects(prepareDeletionBilling(profile, null, () => f.subscriptions), /empty page/);
  f.subscriptions.list = async () => ({ data: [{ id: "sub_active", status: "active" }], has_more: true });
  await assert.rejects(prepareDeletionBilling(profile, null, () => f.subscriptions), /repeated an id/);
});
