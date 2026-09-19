import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commitGoalSave, ScheduleSaveError, saveMessageFor,
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
