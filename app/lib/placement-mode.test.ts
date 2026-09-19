// node --test app/lib/placement-mode.test.ts
//
// Stage 0b: placement authority.
//
// PERMANENT INVARIANT under test: opening Rooted must never change a family's
// schedule. Verification detects. It never repairs.
//
// An authoritative curriculum's lessons.scheduled_date IS the schedule. Page
// load may compare it against what the projector would say and report a
// disagreement, but it may not write. A legacy curriculum keeps the existing
// reconcile-on-load behaviour until it crosses deliberately.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { verifyAuthoritativePlacement } from "./scheduler.ts";

function repoFile(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
function fnBody(src: string, signature: RegExp): string {
  const m = src.match(signature);
  if (!m) throw new Error(`not found: ${signature}`);
  const start = src.indexOf("{", m.index! + m[0].length - 1);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces");
}

/**
 * A Supabase stand-in that records every call. Any write path is a hard
 * failure rather than a silent no-op, so a future refactor that adds one is
 * caught here instead of in production.
 */
function spyClient(rows: unknown[]) {
  const calls: string[] = [];
  const fail = (op: string) => () => {
    calls.push(op);
    throw new Error(`verification attempted a write: ${op}`);
  };
  const builder: Record<string, unknown> = {
    select() { calls.push("select"); return builder; },
    eq() { return builder; },
    is() { return builder; },
    in() { return builder; },
    not() { return builder; },
    order() { return builder; },
    update: fail("update"),
    insert: fail("insert"),
    upsert: fail("upsert"),
    delete: fail("delete"),
    then(res: (v: { data: unknown[]; error: null }) => unknown) {
      return Promise.resolve(res({ data: rows, error: null }));
    },
  };
  return {
    calls,
    client: {
      from(table: string) { calls.push(`from:${table}`); return builder; },
      rpc: fail("rpc"),
    } as never,
  };
}

const GOAL = {
  id: "goal-1",
  total_lessons: 40,
  current_lesson: 2,
  lessons_per_day: 1,
  lessons_per_day_overrides: null,
  school_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  start_date: "2026-09-14",
} as never;

const TODAY = new Date(2026, 8, 21); // Mon 2026-09-21

function row(over: Record<string, unknown> = {}) {
  return {
    id: "l1", scheduled_date: "2026-09-21", completed: false, is_backfill: false,
    queue_position: 3, queue_pinned: false, skipped: false, ...over,
  };
}

// ── Verification never writes ───────────────────────────────────────────────

test("verification writes nothing when placement agrees", async () => {
  const { client, calls } = spyClient([row({ scheduled_date: "2026-09-21", queue_position: 3 })]);
  const res = await verifyAuthoritativePlacement(client, GOAL, [], 0, TODAY);
  assert.equal(res.disagreements, 0);
  assert.ok(!calls.some((c) => ["update", "insert", "upsert", "delete", "rpc"].includes(c)));
});

test("verification REPORTS a disagreement instead of repairing it", async () => {
  // A stored date the projector disagrees with. The old behaviour was to
  // overwrite it on page load. The new behaviour is to count it and leave it.
  const stale = row({ scheduled_date: "2026-05-19", queue_position: 3 });
  const { client, calls } = spyClient([stale]);
  const res = await verifyAuthoritativePlacement(client, GOAL, [], 0, TODAY);
  assert.equal(res.checked, 1);
  assert.equal(res.disagreements, 1, "the disagreement was not detected");
  assert.equal(stale.scheduled_date, "2026-05-19", "the stored date was mutated");
  assert.ok(!calls.some((c) => ["update", "insert", "upsert", "delete", "rpc"].includes(c)),
    "verification attempted a write");
});

test("verification leaves pinned and skipped rows out of the comparison", async () => {
  const { client } = spyClient([
    row({ id: "pinned", queue_position: 3, queue_pinned: true, scheduled_date: "2026-12-25" }),
    row({ id: "skipped", queue_position: 4, skipped: true, scheduled_date: "2026-12-25" }),
  ]);
  const res = await verifyAuthoritativePlacement(client, GOAL, [], 0, TODAY);
  assert.equal(res.disagreements, 0, "a parent placement was counted as drift");
});

test("a pinned row with no date is not reported as drift", async () => {
  // A pin with no scheduled_date is not fed to the projector as a hold, so the
  // projector places that slot normally and the stored null would look like a
  // mismatch. It is a parent placement in an odd state, not scheduler drift,
  // and one such row exists in production. The pinned exclusion is what keeps
  // it out of the count.
  const { client } = spyClient([
    row({ id: "pinned-no-date", queue_position: 3, queue_pinned: true, scheduled_date: null }),
  ]);
  const res = await verifyAuthoritativePlacement(client, GOAL, [], 0, TODAY);
  assert.equal(res.disagreements, 0, "a dateless parent placement was counted as drift");
});

test("verification survives a read failure without writing", async () => {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {
    select() { return builder; },
    eq() { return builder; },
    update() { calls.push("update"); throw new Error("write"); },
    then(res: (v: { data: null; error: { message: string } }) => unknown) {
      return Promise.resolve(res({ data: null, error: { message: "boom" } }));
    },
  };
  const client = { from() { return builder; } } as never;
  const res = await verifyAuthoritativePlacement(client, GOAL, [], 0, TODAY);
  assert.deepEqual(res, { checked: 0, disagreements: 0 });
  assert.equal(calls.length, 0);
});

// ── Structural guarantees ───────────────────────────────────────────────────

test("the verifier contains no write call at all", () => {
  const src = stripComments(repoFile("app/lib/scheduler.ts"));
  const body = fnBody(src, /export async function verifyAuthoritativePlacement\s*\(/);
  for (const w of [".update(", ".insert(", ".upsert(", ".delete(", ".rpc("]) {
    assert.ok(!body.includes(w), `verifyAuthoritativePlacement must not call ${w}`);
  }
});

test("an authoritative curriculum never reaches the reconciler on page load", () => {
  // The whole point of the split: authoritative placement is not a cache and
  // must never be reconciled from a projection.
  const src = stripComments(repoFile("app/dashboard/page.tsx"));
  // Match the DECLARATION, not the substring: renaming it to
  // _unusedAuthoritativeGoalIds left the old assertion passing on a file where
  // the routing no longer existed.
  assert.ok(/\bconst authoritativeGoalIds = new Set\(/.test(src), "the routing was removed");
  const at = src.indexOf("authoritativeGoalIds.has(goal.id)");
  assert.ok(at > 0, "the page-load branch is gone");
  const branch = src.slice(at, at + 500);
  const verify = branch.indexOf("verifyAuthoritativePlacement");
  const reconcile = branch.indexOf("reconcileGoalScheduleCache");
  assert.ok(verify > -1 && reconcile > -1, "both arms must exist");
  assert.ok(verify < reconcile, "authoritative must take the verifier arm");
});

test("legacy curricula keep the existing reconcile-on-load behaviour", () => {
  // Assert the FALSE arm of the routing ternary actually calls the reconciler.
  // A bare includes() passed even when the call was short-circuited away.
  const src = stripComments(repoFile("app/dashboard/page.tsx"));
  const at = src.indexOf("authoritativeGoalIds.has(goal.id)");
  assert.ok(at > 0, "the routing is gone");
  const branch = src.slice(at, at + 500);
  assert.ok(/:\s*reconcileGoalScheduleCache\(/.test(branch),
    "legacy reconciliation was removed or short-circuited; that is a later stage, not this one");
});

test("the reconciler itself is unchanged for legacy goals", () => {
  // Stage 0b must not alter legacy behaviour. The reconciler still writes.
  const src = stripComments(repoFile("app/lib/scheduler.ts"));
  const body = fnBody(src, /export async function reconcileGoalScheduleCache\s*\(/);
  assert.ok(body.includes("syncProjectedScheduledDates"),
    "the legacy write path was removed; not this stage");
  assert.ok(!body.includes("placement_mode"),
    "the reconciler should not know about placement_mode; routing happens at the call site");
});

// ── The default is legacy ───────────────────────────────────────────────────

test("the migration defaults every curriculum to legacy_projection", () => {
  const sql = repoFile("supabase/migrations/20260919012248_curriculum_goals_placement_mode.sql");
  assert.ok(/default\s+'legacy_projection'/.test(sql), "the default is not legacy_projection");
  assert.ok(/not null/i.test(sql), "placement_mode must be NOT NULL");
  // No backfill, no UPDATE, nothing marked authoritative.
  assert.ok(!/update\s+public\.curriculum_goals/i.test(sql), "the migration writes rows");
  assert.ok(!/'authoritative'\s*,?\s*$/im.test(sql.replace(/enum[^;]*;/i, "")),
    "the migration marks something authoritative");
  // The marker must stay auditable.
  assert.ok(sql.includes("placement_migrated_at"), "the migration stamp is missing");
  assert.ok(/check\s*\(/i.test(sql), "the mode/stamp consistency constraint is missing");
});

test("a rollback exists and warns before dropping a crossed curriculum", () => {
  const sql = repoFile("supabase/rollbacks/20260919012248_curriculum_goals_placement_mode_ROLLBACK.sql");
  assert.ok(/drop column if exists placement_mode/i.test(sql));
  assert.ok(sql.toLowerCase().includes("authoritative"),
    "the rollback does not warn about already-migrated curricula");
});
