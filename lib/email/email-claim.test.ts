// node --test lib/email/email-claim.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  sendOnceClaimed,
  firstFailureKey,
  finalFailureKey,
  type EmailClaimStore,
  type SendOutcome,
} from "./email-claim.ts";

/**
 * A fake email_log with the REAL unique index semantics on
 * (user_id, email_type): a second insert of the same pair fails with 23505.
 * That is the whole mechanism under test, so the fake must not be laxer than
 * Postgres.
 */
function fakeStore(opts: { failConfirm?: boolean; failClaimWith?: string } = {}) {
  const rows = new Map<string, { sentAt: string | null }>();
  const calls: string[] = [];
  const store: EmailClaimStore = {
    async claim(userId, emailType) {
      calls.push(`claim:${emailType}`);
      if (opts.failClaimWith) return { ok: false, duplicate: false, error: opts.failClaimWith };
      const key = `${userId}|${emailType}`;
      if (rows.has(key)) return { ok: false, duplicate: true, error: "duplicate key value" };
      rows.set(key, { sentAt: null });
      return { ok: true, duplicate: false };
    },
    async confirm(userId, emailType) {
      calls.push(`confirm:${emailType}`);
      if (opts.failConfirm) return false;
      const key = `${userId}|${emailType}`;
      const row = rows.get(key);
      if (!row) return false;
      row.sentAt = new Date().toISOString();
      return true;
    },
    async release(userId, emailType) {
      calls.push(`release:${emailType}`);
      const key = `${userId}|${emailType}`;
      const row = rows.get(key);
      // The production DELETE carries `.is('sent_at', null)`. A confirmed row
      // must survive a late release.
      if (row && row.sentAt === null) rows.delete(key);
      return true;
    },
  };
  return { store, rows, calls };
}

const OK: SendOutcome = { ok: true };

test("the first delivery sends exactly once", async () => {
  const { store, rows } = fakeStore();
  let sends = 0;
  const res = await sendOnceClaimed({
    store,
    userId: "u1",
    emailType: firstFailureKey("in_1"),
    send: async () => {
      sends++;
      return OK;
    },
  });
  assert.deepEqual(res, { status: "sent" });
  assert.equal(sends, 1);
  assert.equal(rows.get("u1|payment_failed:in_1")?.sentAt !== null, true);
});

test("a duplicate webhook delivery for the same invoice sends nothing more", async () => {
  const { store } = fakeStore();
  let sends = 0;
  const send = async () => {
    sends++;
    return OK;
  };
  const first = await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send });
  const second = await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send });
  assert.deepEqual(first, { status: "sent" });
  assert.deepEqual(second, { status: "already_claimed" });
  assert.equal(sends, 1, "the duplicate delivery sent a second email");
});

test("intermediate retries of the SAME invoice never resend", async () => {
  // Stripe fires invoice.payment_failed once per attempt, up to 8 times, all
  // carrying the same invoice id.
  const { store } = fakeStore();
  let sends = 0;
  for (let attempt = 1; attempt <= 8; attempt++) {
    await sendOnceClaimed({
      store,
      userId: "u1",
      emailType: firstFailureKey("in_same"),
      send: async () => {
        sends++;
        return OK;
      },
    });
  }
  assert.equal(sends, 1, "a retry attempt sent another email");
});

test("duplicates cannot resend whatever the retry shape was", async () => {
  // The same invoice failing repeatedly: a future retry early on, a null retry
  // on the final attempt, then a redelivery with the field absent. The retry
  // shape is irrelevant to dedup, which keys on the invoice alone.
  const { store } = fakeStore();
  let sends = 0;
  const send = async () => {
    sends++;
    return OK;
  };
  const shapes = [
    { next_payment_attempt: 1790000000 },
    { next_payment_attempt: 1790100000 },
    { next_payment_attempt: null },
    {},
  ];
  for (const _shape of shapes) {
    for (let delivery = 0; delivery < 3; delivery++) {
      await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_dunning"), send });
    }
  }
  assert.equal(sends, 1, "a retry shape change allowed a second send");
});

test("a later billing cycle is a different invoice and does send again", async () => {
  const { store } = fakeStore();
  let sends = 0;
  const send = async () => {
    sends++;
    return OK;
  };
  await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_march"), send });
  await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_april"), send });
  assert.equal(sends, 2);
});

test("concurrent duplicate deliveries cannot double-send", async () => {
  const { store } = fakeStore();
  let sends = 0;
  const send = async () => {
    sends++;
    // Yield, so both deliveries are genuinely in flight at once.
    await new Promise((r) => setTimeout(r, 5));
    return OK;
  };
  const results = await Promise.all([
    sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send }),
    sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send }),
    sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send }),
  ]);
  assert.equal(sends, 1, "concurrent deliveries double-sent");
  assert.equal(results.filter((r) => r.status === "sent").length, 1);
  assert.equal(results.filter((r) => r.status === "already_claimed").length, 2);
});

test("a definitive Resend failure releases the claim so a retry can try again", async () => {
  const { store, rows } = fakeStore();
  const res = await sendOnceClaimed({
    store,
    userId: "u1",
    emailType: firstFailureKey("in_1"),
    send: async () => ({ ok: false, retryable: true, status: 502, error: "bad gateway" }),
  });
  assert.equal(res.status, "released");
  assert.equal(rows.has("u1|payment_failed:in_1"), false, "claim was not released");

  // The webhook retry now succeeds.
  let sends = 0;
  const retry = await sendOnceClaimed({
    store,
    userId: "u1",
    emailType: firstFailureKey("in_1"),
    send: async () => {
      sends++;
      return OK;
    },
  });
  assert.deepEqual(retry, { status: "sent" });
  assert.equal(sends, 1);
});

test("a refused payload keeps the claim, so retries cannot loop on it", async () => {
  const { store, rows } = fakeStore();
  const res = await sendOnceClaimed({
    store,
    userId: "u1",
    emailType: firstFailureKey("in_1"),
    send: async () => ({ ok: false, retryable: false, status: 422, error: "invalid address" }),
  });
  assert.equal(res.status, "kept");
  assert.equal(rows.has("u1|payment_failed:in_1"), true, "a 4xx released the claim");
  // And the row stays unconfirmed, which is the record that a send was tried.
  assert.equal(rows.get("u1|payment_failed:in_1")?.sentAt, null);
});

test("a release can never delete a row another delivery already confirmed", async () => {
  const { store, rows } = fakeStore();
  await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send: async () => OK });
  assert.notEqual(rows.get("u1|payment_failed:in_1")?.sentAt, null);
  await store.release("u1", firstFailureKey("in_1"));
  assert.equal(rows.has("u1|payment_failed:in_1"), true, "a confirmed send was released");
});

test("a send that lands but fails to confirm never re-sends", async () => {
  const { store } = fakeStore({ failConfirm: true });
  let sends = 0;
  const send = async () => {
    sends++;
    return OK;
  };
  const first = await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send });
  assert.deepEqual(first, { status: "sent_unconfirmed" });
  const second = await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send });
  assert.deepEqual(second, { status: "already_claimed" });
  assert.equal(sends, 1);
});

test("an unknown claim-write failure sends nothing", async () => {
  // Never treated as a duplicate: that would silently swallow a billing notice.
  const { store } = fakeStore({ failClaimWith: "connection reset" });
  let sends = 0;
  const res = await sendOnceClaimed({
    store,
    userId: "u1",
    emailType: firstFailureKey("in_1"),
    send: async () => {
      sends++;
      return OK;
    },
  });
  assert.equal(res.status, "claim_failed");
  assert.equal(sends, 0);
});

test("the final notice sends exactly once and a duplicate termination does not resend", async () => {
  const { store } = fakeStore();
  let sends = 0;
  const send = async () => {
    sends++;
    return OK;
  };
  const a = await sendOnceClaimed({ store, userId: "u1", emailType: finalFailureKey("in_1"), send });
  const b = await sendOnceClaimed({ store, userId: "u1", emailType: finalFailureKey("in_1"), send });
  assert.deepEqual(a, { status: "sent" });
  assert.deepEqual(b, { status: "already_claimed" });
  assert.equal(sends, 1);
});

test("the first-failure and final keys are distinct for the same invoice", async () => {
  assert.notEqual(firstFailureKey("in_1"), finalFailureKey("in_1"));
  const { store } = fakeStore();
  let sends = 0;
  const send = async () => {
    sends++;
    return OK;
  };
  await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send });
  await sendOnceClaimed({ store, userId: "u1", emailType: finalFailureKey("in_1"), send });
  assert.equal(sends, 2, "the final notice was swallowed by the first-failure claim");
});

test("an admin notice failure cannot consume the customer's claim", async () => {
  // The admin notice uses its own ':admin' key namespace, so a failed admin
  // send releasing its claim can never re-open the customer's key.
  const { store, rows } = fakeStore();
  await sendOnceClaimed({ store, userId: "u1", emailType: firstFailureKey("in_1"), send: async () => OK });
  await sendOnceClaimed({
    store,
    userId: "u1",
    emailType: `${firstFailureKey("in_1")}:admin`,
    send: async () => ({ ok: false, retryable: true, status: 500 }),
  });
  assert.equal(rows.has("u1|payment_failed:in_1"), true, "the customer claim was released by admin failure");
  assert.equal(rows.has("u1|payment_failed:in_1:admin"), false);
});
