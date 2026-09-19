import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commitGoalSave, reconcileGoalSave, outcomeIsKnown,
  ScheduleSaveError, saveMessageFor,
} from "./schedule-commit-client.ts";

function fake(responses: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return (responses[fn] ?? { error: null, data: {} }) as never;
      },
    },
  };
}

const sealed = { error: null, data: { proposal_id: "prop-1" } };

test("a save seals a proposal first, then commits against it", async () => {
  const f = fake({
    schedule_seal_proposal: sealed,
    schedule_commit: { error: null, data: { status: "committed", deleted: 2, inserted: 3, updated: 1, transaction_id: "t1", after_version: "v2" } },
  });
  const r = await commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" });
  assert.deepEqual(f.calls.map(c => c.fn), ["schedule_seal_proposal", "schedule_commit"]);
  assert.equal(f.calls[1].args.p_proposal_id, "prop-1");
  assert.deepEqual(r, { status: "committed", deleted: 2, inserted: 3, updated: 1, transactionId: "t1", afterVersion: "v2" });
});

test("a rebuild seals with NO placements — its rows do not exist yet", async () => {
  const f = fake({ schedule_seal_proposal: sealed, schedule_commit: { error: null, data: {} } });
  await commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" });
  assert.deepEqual(f.calls[0].args.p_placements, []);
  assert.equal(f.calls[0].args.p_action, "rebuild");
});

test("the goal's own id keys the goal update and the pointer", async () => {
  const f = fake({ schedule_seal_proposal: sealed, schedule_commit: { error: null, data: {} } });
  await commitGoalSave(f.client, {
    goalId: "g7", goalUpdates: { total_lessons: 11 }, pointer: 4, idempotencyKey: "key-12345678",
  });
  assert.deepEqual(f.calls[1].args.p_goal_updates, { g7: { total_lessons: 11 } });
  assert.deepEqual(f.calls[1].args.p_pointers, { g7: 4 });
});

test("no pointer means no pointer write, not a write of zero", async () => {
  const f = fake({ schedule_seal_proposal: sealed, schedule_commit: { error: null, data: {} } });
  await commitGoalSave(f.client, { goalId: "g1", pointer: null, idempotencyKey: "key-12345678" });
  assert.deepEqual(f.calls[1].args.p_pointers, {});
});

test("a stale schedule is reported as retryable, and says the settings are kept", async () => {
  const f = fake({
    schedule_seal_proposal: sealed,
    schedule_commit: { error: { message: "the schedule changed", code: "40001" } },
  });
  await assert.rejects(
    () => commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" }),
    (e: ScheduleSaveError) => {
      assert.equal(e.retryable, true);
      assert.equal(e.staleClient, false);
      assert.match(e.message, /still here/i);
      return true;
    });
});

test("a refused privilege is reported as a stale client", async () => {
  const f = fake({
    schedule_seal_proposal: { error: { message: "permission denied", code: "42501" } },
  });
  await assert.rejects(
    () => commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" }),
    (e: ScheduleSaveError) => {
      assert.equal(e.staleClient, true);
      assert.match(e.message, /reload/i);
      return true;
    });
});

test("every failure message promises nothing was changed", () => {
  for (const code of ["40001", "42501", "XX000"]) {
    assert.match(saveMessageFor({ message: "x", code }), /nothing was saved|nothing was changed|still here/i);
  }
});

test("a seal that returns no proposal id fails loudly instead of committing against undefined", async () => {
  const f = fake({ schedule_seal_proposal: { error: null, data: {} } });
  await assert.rejects(
    () => commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" }),
    /did not return a proposal/);
  assert.equal(f.calls.length, 1, "it must not call schedule_commit");
});

test("an already_committed replay is surfaced, not mistaken for a fresh save", async () => {
  const f = fake({
    schedule_seal_proposal: sealed,
    schedule_commit: { error: null, data: { status: "already_committed", deleted: 1, inserted: 0, updated: 0, transaction_id: "t9", after_version: "v9" } },
  });
  const r = await commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" });
  assert.equal(r.status, "already_committed");
  assert.equal(r.transactionId, "t9");
});

test("the seal's proposal id is read from preview_id, the key the server actually returns", async () => {
  const f = fake({
    schedule_seal_proposal: { error: null, data: { preview_id: "p-real", state_version: "v1" } },
    schedule_commit: { error: null, data: { status: "committed" } },
  });
  await commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" });
  assert.equal(f.calls[1].args.p_proposal_id, "p-real");
});

test("a replay reports its real counts, not zeros (the builder compares them)", async () => {
  // SQL lifts the counts to the top level now; readResult also reads `impact`,
  // so an older function cannot reintroduce the zeros silently.
  const f = fake({
    schedule_seal_proposal: sealed,
    schedule_commit: { error: null, data: {
      status: "already_committed", transaction_id: "t5",
      impact: { deleted: 1, inserted: 7, updated: 2 }, after_version: "v5" } },
  });
  const r = await commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" });
  assert.equal(r.inserted, 7, "a replay that reported 0 made the builder cry 'nothing was saved'");
  assert.equal(r.deleted, 1);
  assert.equal(r.updated, 2);
  // The assertion the builder actually runs.
  const plannedInsertCount = 7;
  assert.equal(r.inserted === plannedInsertCount, true, "the builder must not throw on a replay");
});

test("only codes known to have aborted may promise nothing changed", () => {
  for (const code of ["40001", "42501", "22023"]) {
    assert.equal(outcomeIsKnown(code), true, `${code} aborts`);
    assert.match(saveMessageFor({ message: "x", code }), /nothing was saved|nothing was changed|still here/i);
  }
  // 23505 is a constraint violation: PostgreSQL raised, so it rolled back.
  // An earlier version of this list called that unknown, which would have told
  // a parent "we couldn't confirm" about a save that definitely did not happen.
  assert.equal(outcomeIsKnown("23505"), true);
  assert.match(saveMessageFor({ message: "x", code: "23505" }), /nothing was changed/i);

  // Genuinely unknown: no code, a connection exception, a cancellation. Each
  // can land AFTER the commit.
  for (const code of [undefined, "08006", "08003", "57014"]) {
    assert.equal(outcomeIsKnown(code), false, `${String(code)} is not known to have aborted`);
    const m = saveMessageFor({ message: "x", code });
    assert.doesNotMatch(m, /nothing was (saved|changed)/i,
      "an unknown outcome must not be reported as a rollback");
    assert.match(m, /couldn't confirm/i);
  }
});

test("an unknown outcome is flagged on the error, so the caller can reconcile", async () => {
  const f = fake({
    schedule_seal_proposal: sealed,
    schedule_commit: { error: { message: "network", code: undefined } },
  });
  await assert.rejects(
    () => commitGoalSave(f.client, { goalId: "g1", idempotencyKey: "key-12345678" }),
    (e: ScheduleSaveError) => {
      assert.equal(e.outcomeKnown, false);
      assert.equal(e.retryable, false);
      return true;
    });
});

test("reconciliation finds a save that committed after its response was lost", async () => {
  const f = fake({ schedule_commit_status: { error: null, data: {
    status: "committed", transaction_id: "t8", deleted: 0, inserted: 3, updated: 1, after_version: "v8" } } });
  const r = await reconcileGoalSave(f.client, "key-12345678");
  assert.equal(r?.status, "already_committed");
  assert.equal(r?.inserted, 3);
  assert.deepEqual(f.calls[0].args, { p_idempotency_key: "key-12345678" });
});

test("reconciliation returning null is 'no record', NOT 'nothing was saved'", async () => {
  const f = fake({ schedule_commit_status: { error: null, data: { status: "not_found" } } });
  assert.equal(await reconcileGoalSave(f.client, "key-12345678"), null);
});
