// node --test app/lib/badges-tiered.test.ts
//
// The creative-badge award path. Reported 2026-09-20: a flow with no child
// selected produced failing /rest/v1/badges requests and congratulated the
// family for badges that were never saved.
//
// The exact error, confirmed against staging by doing what the client does:
//
//   SELECT .eq(child_id, '') -> 22P02: invalid input syntax for type uuid: ""
//   INSERT child_id: ''      -> 22P02: invalid input syntax for type uuid: ""
//
// badges.child_id is a uuid column and `childId ?? ""` is not a uuid. Worse,
// awardBadge's guard matched neither "duplicate" nor 23505, so it logged the
// failure and checkCreativeBadges returned the badge regardless -- a
// celebration for a row that does not exist, repeated on the next action
// because nothing had been persisted to stop it.

import test from "node:test";
import assert from "node:assert/strict";

import { checkCreativeBadgesWith, type BadgeWriteClient } from "./badge-award.ts";
import type { BadgeCheckData } from "./badge-tiers.ts";

const USER = "11111111-1111-4111-8111-000000000001";
const CHILD = "22222222-2222-4222-8222-000000000001";

/** Data generous enough to earn several badges at once. */
const RICH: BadgeCheckData = {
  totalLeaves: 500, currentStreak: 30, longestStreak: 60,
  daysLoggedThisMonth: 20, schoolDaysThisMonth: 20,
  totalMemories: 200, totalBooks: 50, subjectsThisWeek: 6, curricula: [],
};
const BARE: BadgeCheckData = {
  totalLeaves: 0, currentStreak: 0, longestStreak: 0,
  daysLoggedThisMonth: 0, schoolDaysThisMonth: 0,
  totalMemories: 0, totalBooks: 0, subjectsThisWeek: 0, curricula: [],
};

/** Records every call so a test can assert what was and was not sent. */
function fakeClient(opts: {
  existing?: string[];
  lookupError?: { code?: string; message: string } | null;
  insertResult?: (row: Record<string, unknown>, n: number) => { code?: string; message: string } | null;
} = {}) {
  const calls = { selects: [] as string[], inserts: [] as Record<string, unknown>[] };
  let n = 0;
  const client: BadgeWriteClient = {
    from() {
      return {
        select() {
          return {
            eq(_c1: string, _v1: string) {
              return {
                eq(_c2: string, v2: string) {
                  calls.selects.push(v2);
                  return Promise.resolve({
                    data: (opts.existing ?? []).map((k) => ({ badge_key: k })),
                    error: opts.lookupError ?? null,
                  });
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          calls.inserts.push(row);
          n += 1;
          return Promise.resolve({ error: opts.insertResult ? opts.insertResult(row, n) : null });
        },
      };
    },
  };
  return { client, calls };
}

test("a missing child id causes ZERO badge requests", async () => {
  for (const missing of ["", undefined as unknown as string, null as unknown as string]) {
    const { client, calls } = fakeClient();
    const got = await checkCreativeBadgesWith(client, USER, missing, RICH);
    assert.deepEqual(got, [], "nothing is awarded without a child");
    assert.equal(calls.selects.length, 0, "no lookup is sent");
    assert.equal(calls.inserts.length, 0, "no insert is sent");
  }
});

test("a valid child earns each badge exactly once", async () => {
  const { client, calls } = fakeClient();
  const got = await checkCreativeBadgesWith(client, USER, CHILD, RICH);
  assert.ok(got.length > 0, "the rich fixture must earn something");
  assert.equal(calls.inserts.length, got.length, "one insert per returned badge");
  const keys = calls.inserts.map((r) => r.badge_key);
  assert.equal(new Set(keys).size, keys.length, "no badge is inserted twice");
  for (const row of calls.inserts) {
    assert.equal(row.child_id, CHILD, "every row carries the real child id");
    assert.equal(row.user_id, USER);
    assert.notEqual(row.child_id, "", "never the empty string that 22P02 rejects");
  }
});

test("an already-earned badge is not re-inserted and not re-celebrated", async () => {
  const first = fakeClient();
  const earned = await checkCreativeBadgesWith(first.client, USER, CHILD, RICH);
  const keys = earned.map((b) => b.badgeKey);

  // Second run with those badges already present.
  const second = fakeClient({ existing: keys });
  const again = await checkCreativeBadgesWith(second.client, USER, CHILD, RICH);
  assert.deepEqual(again, [], "nothing new to celebrate");
  assert.equal(second.calls.inserts.length, 0, "and nothing is written again");
});

test("a CONCURRENT duplicate (23505) is idempotent: no error loop, no second celebration", async () => {
  const { client, calls } = fakeClient({
    insertResult: () => ({ code: "23505", message: 'duplicate key value violates unique constraint' }),
  });
  const got = await checkCreativeBadgesWith(client, USER, CHILD, RICH);
  assert.deepEqual(got, [], "the row exists, but it is not ours to celebrate");
  assert.ok(calls.inserts.length > 0, "the insert was still attempted once per badge");
  // One attempt each, not a retry loop.
  const keys = calls.inserts.map((r) => r.badge_key);
  assert.equal(new Set(keys).size, keys.length, "each badge attempted once, never retried");
});

test("a FAILED insert produces no celebration", async () => {
  const { client } = fakeClient({
    insertResult: () => ({ code: "22P02", message: 'invalid input syntax for type uuid: ""' }),
  });
  const got = await checkCreativeBadgesWith(client, USER, CHILD, RICH);
  assert.deepEqual(got, [], "a badge that did not land is never returned");
});

test("a partial failure celebrates only what landed", async () => {
  const { client, calls } = fakeClient({
    insertResult: (_row, n) => (n === 1 ? null : { code: "22P02", message: "nope" }),
  });
  const got = await checkCreativeBadgesWith(client, USER, CHILD, RICH);
  assert.equal(got.length, 1, "only the insert that succeeded is celebrated");
  assert.ok(calls.inserts.length > 1, "the others were attempted");
});

test("a failed LOOKUP awards nothing rather than guessing", async () => {
  const { client, calls } = fakeClient({ lookupError: { code: "22P02", message: "bad uuid" } });
  const got = await checkCreativeBadgesWith(client, USER, CHILD, RICH);
  assert.deepEqual(got, [], "cannot tell new from old, so celebrate nothing");
  assert.equal(calls.inserts.length, 0, "and write nothing");
});

test("many eligible badges do not cause a request loop", async () => {
  const { client, calls } = fakeClient();
  await checkCreativeBadgesWith(client, USER, CHILD, RICH);
  assert.equal(calls.selects.length, 1, "exactly one lookup, not one per badge");
  assert.ok(calls.inserts.length <= 20, `bounded inserts, got ${calls.inserts.length}`);
  // The count must equal the distinct badges earned, not grow with retries.
  const keys = calls.inserts.map((r) => r.badge_key);
  assert.equal(new Set(keys).size, keys.length);
});

test("an empty account earns nothing and writes nothing", async () => {
  const { client, calls } = fakeClient();
  const got = await checkCreativeBadgesWith(client, USER, CHILD, BARE);
  assert.deepEqual(got, []);
  assert.equal(calls.inserts.length, 0);
  assert.equal(calls.selects.length, 1, "it still looks up, which is correct: it has a child");
});
