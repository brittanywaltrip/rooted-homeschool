// node --test app/lib/schedule-preview.test.ts
//
// Stage 0c: inert foundation for the atomic scheduling writer.
//
// The behavioural proof for these functions is a rolled-back transaction run
// against the live database (15 state_version assertions, 12 preview
// assertions, plus a probe showing Postgres refuses a write inside a STABLE
// function with 0A000). These tests are the repo-side guards: they stop the
// SQL from quietly losing a property nobody would notice in review.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function repoFile(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

const VERSION_SQL = repoFile(
  "supabase/migrations/20260919013822_schedule_state_version_fix_owner_lookup.sql",
);
const FOUNDATION_SQL = repoFile(
  "supabase/migrations/20260919013700_schedule_transactions_and_preview.sql",
);

/**
 * Every input the projector and the phase-2 planners actually consume. If one
 * of these stops being hashed, a confirmation could survive a change that
 * alters its own impact, which is the exact race state_version exists to close.
 */
const MEANINGFUL_INPUTS = [
  // curriculum_goals
  "archived", "total_lessons", "current_lesson", "start_at_lesson",
  "lessons_per_day", "lessons_per_day_overrides", "school_days",
  "start_date", "target_date", "placement_mode",
  // lessons
  "lesson_number", "queue_position", "queue_pinned", "skipped",
  "completed", "completed_at", "scheduled_date", "notes",
  "minutes_spent", "scheduled_source",
];

/**
 * Fields that must NOT be hashed. A rename must never invalidate a
 * confirmation Mom is looking at.
 */
const COSMETIC_FIELDS = [
  "curriculum_name", "icon_emoji", "subject_label", "default_minutes",
  "scheduled_start_time", "course_level", "credits_value",
];

test("state_version hashes every meaningful scheduler input", () => {
  for (const field of MEANINGFUL_INPUTS) {
    assert.ok(
      VERSION_SQL.includes(field),
      `state_version no longer covers ${field}; a change to it could not invalidate a confirmation`,
    );
  }
});

test("state_version hashes the family's vacation blocks", () => {
  // User-level, not per goal, but any block reshapes every projection.
  assert.ok(/from vacation_blocks v where v\.user_id = v_owner/.test(VERSION_SQL),
    "vacation blocks dropped out of state_version");
});

test("state_version ignores cosmetic fields", () => {
  // Scoped to the hash bodies, since the header comment names these on purpose.
  const body = VERSION_SQL.slice(VERSION_SQL.indexOf("select coalesce(md5("));
  for (const field of COSMETIC_FIELDS) {
    assert.ok(!body.includes(field), `${field} is hashed; a rename would invalidate a confirmation`);
  }
  assert.ok(!/\bl\.title\b/.test(body), "lessons.title is hashed; a rename would invalidate a confirmation");
});

test("state_version is deterministic: aggregation is explicitly ordered", () => {
  // string_agg without ORDER BY returns rows in whatever order the plan gives,
  // so the same state could hash two ways and every confirmation would be
  // spuriously invalidated.
  const aggs = VERSION_SQL.match(/string_agg\([^)]*\)/g) ?? [];
  assert.ok(aggs.length >= 3, "expected three aggregated sections");
  for (const a of aggs) {
    assert.ok(a.includes("order by"), `string_agg without ORDER BY is non-deterministic: ${a}`);
  }
});

// ── Read only ───────────────────────────────────────────────────────────────

test("both functions are declared STABLE so Postgres refuses writes inside them", () => {
  // Proven live: a STABLE probe attempting an UPDATE raised
  // "0A000: UPDATE is not allowed in a non-volatile function".
  // Strip SQL comments first: the header quotes the error text
  // "non-volatile function", which is prose, not a volatility declaration.
  const code = (sql: string) => sql.replace(/--[^\n]*/g, " ");
  for (const [name, sql] of [["state_version", VERSION_SQL], ["preview", FOUNDATION_SQL]] as const) {
    assert.ok(/\bstable\b/.test(code(sql)), `${name} is no longer STABLE; read-only is unenforced`);
    assert.ok(!/\bvolatile\b/.test(code(sql)), `${name} was made VOLATILE; it could write`);
  }
});

test("the preview foundation contains no lesson or goal write", () => {
  const sql = FOUNDATION_SQL.toLowerCase();
  for (const w of ["update lessons", "insert into lessons", "delete from lessons",
                   "update curriculum_goals", "delete from curriculum_goals"]) {
    assert.ok(!sql.includes(w), `the inert foundation performs a write: ${w}`);
  }
});

test("nothing migrates a curriculum to authoritative", () => {
  // Agreement makes a curriculum eligible for a future controlled migration.
  // It does not grant permission to migrate it.
  for (const f of readdirSync(resolve(process.cwd(), "supabase/migrations"))) {
    if (!f.startsWith("202609190")) continue;
    const sql = repoFile(`supabase/migrations/${f}`);
    // The CHECK constraint legitimately NAMES 'authoritative'. What must not
    // exist is a statement that assigns it to a row, or a default that would
    // make new curricula authoritative before we intend it.
    assert.ok(!/set\s+placement_mode\s*=\s*'authoritative'/i.test(sql),
      `${f} assigns authoritative to rows`);
    assert.ok(!/default\s+'authoritative'/i.test(sql),
      `${f} makes authoritative the default`);
    assert.ok(!/update\s+public\.curriculum_goals\s+set/i.test(sql),
      `${f} updates curriculum_goals rows`);
  }
});

// ── Authorisation and shape ─────────────────────────────────────────────────

test("both functions check ownership and are closed to anon", () => {
  for (const [name, sql] of [["state_version", VERSION_SQL], ["preview", FOUNDATION_SQL]] as const) {
    assert.ok(sql.includes("auth.uid()"), `${name} does not check the caller`);
    assert.ok(/permission denied/.test(sql), `${name} has no denial path`);
    assert.ok(/revoke all on function[\s\S]*from public, anon/.test(sql),
      `${name} is not revoked from anon`);
    assert.ok(/security definer/.test(sql), `${name} must be SECURITY DEFINER to read under RLS`);
  }
});

test("preview returns every field the concrete confirmation standard needs", () => {
  for (const key of ["'what'", "'how_much'", "'preserved'", "'from_to'",
                     "'state_version'", "'expires_at'"]) {
    assert.ok(FOUNDATION_SQL.includes(key), `preview no longer returns ${key}`);
  }
  // WHAT STAYS UNTOUCHED has to name the things Mom cares about.
  for (const key of ["parent_placed_lessons", "completed_lessons", "lessons_with_your_notes"]) {
    assert.ok(FOUNDATION_SQL.includes(key), `preview no longer reports ${key}`);
  }
});

test("preview is honest that target dates are not available yet", () => {
  // The projector lives in TypeScript and must stay a single implementation.
  // Preview says so rather than inventing dates.
  assert.ok(/'available', false/.test(FOUNDATION_SQL),
    "from_to claims availability it does not have");
});

test("preview preserves parent placements unless the action resets them", () => {
  assert.ok(FOUNDATION_SQL.includes("reset_parent_placements"),
    "the reset flag is gone; parent placements could be silently counted as movable");
  assert.ok(/v_reset or not coalesce\(l\.queue_pinned, false\)/.test(FOUNDATION_SQL),
    "movable rows no longer exclude parent placements by default");
});

test("schedule_transactions can be read by its owner and written by no client", () => {
  assert.ok(/for select using \(auth\.uid\(\) = user_id\)/.test(FOUNDATION_SQL),
    "the owner-read policy is gone");
  assert.ok(!/for (insert|update|delete)/i.test(FOUNDATION_SQL),
    "a client write policy was added; only the future commit RPC may write");
  assert.ok(/enable row level security/.test(FOUNDATION_SQL), "RLS is not enabled");
});

test("the migration files are named for their recorded ledger versions", () => {
  // Repo rule: apply, read back the recorded version, name the file to match.
  const files = readdirSync(resolve(process.cwd(), "supabase/migrations"))
    .filter((f) => f.startsWith("202609190"));
  for (const f of files) {
    const version = f.slice(0, 14);
    const sql = repoFile(`supabase/migrations/${f}`);
    assert.ok(sql.includes(`recorded version ${version}`),
      `${f} does not record its own ledger version; the filename may be a guess`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 0d: the sealed proposal.
//
// Behavioural proof is a rolled-back transaction against the live database:
// 12 canonicalization assertions, 15 seal/authorization assertions, and 8 RLS
// assertions measured on ROWS AFFECTED (RLS filters silently; "no exception"
// is not "denied"). These are the repo-side guards.
// ─────────────────────────────────────────────────────────────────────────────

const SEAL_SQL = repoFile(
  "supabase/migrations/20260919015230_schedule_proposals_seal.sql",
);
const SEAL_FN_SQL = repoFile(
  "supabase/migrations/20260919015417_schedule_seal_proposal_explicit_missing_lesson_id.sql",
);

test("canonicalization is order independent and null safe", () => {
  // Sorting by lesson_id is what makes a reordered client array hash the same.
  assert.ok(/order by sort_key/.test(SEAL_SQL), "placements are no longer sorted; array order would change the hash");
  assert.ok(/order by g::text/.test(SEAL_SQL), "goal_ids are no longer sorted");
  // The sentinel guards all THREE placement fields. Asserting it merely
  // "appears somewhere" let a mutation strip one occurrence and survive.
  assert.ok(/coalesce\(nullif\(e->>'scheduled_date',''\), '~'\)/.test(SEAL_SQL),
    "scheduled_date lost its null sentinel");
  assert.ok(/coalesce\(nullif\(e->>'queue_position',''\), '~'\)/.test(SEAL_SQL),
    "queue_position lost its null sentinel");
  assert.ok(/jsonb_typeof\(e->'queue_pinned'\) = 'null' then '~'/.test(SEAL_SQL),
    "queue_pinned lost its null sentinel");
  assert.ok(/'v1' \|\| e'\\n'/.test(SEAL_SQL), "the canonical form lost its version prefix");
});

test("every field capable of changing the schedule is in the canonical form", () => {
  // Scope to the SELECT that builds the canonical string, not the signature:
  // a field can appear as a parameter while contributing nothing to the hash.
  const body = SEAL_SQL.slice(SEAL_SQL.indexOf("select\n    'v1'"),
                              SEAL_SQL.indexOf("revoke all on function public.schedule_canonicalize_proposal"));
  assert.ok(body.length > 100, "could not isolate the canonical-form expression");
  for (const field of ["p_action", "p_goal_ids", "p_reset_parent_placements",
                       "p_become_authoritative", "lesson_id", "scheduled_date",
                       "queue_position", "queue_pinned"]) {
    assert.ok(body.includes(field), `${field} contributes nothing to the hash`);
  }
});

test("the proposal hash is SHA-256, not md5", () => {
  assert.ok(/digest\(v_canonical, 'sha256'\)/.test(SEAL_FN_SQL), "the seal no longer uses sha256");
  assert.ok(/proposal_hash ~ '\^\[0-9a-f\]\{64\}\$'/.test(SEAL_SQL),
    "the stored-hash shape constraint is gone");
});

test("confirmation facts are computed server side, never accepted from the client", () => {
  // There must be no facts parameter to forge.
  const sig = SEAL_FN_SQL.slice(SEAL_FN_SQL.indexOf("create or replace function public.schedule_seal_proposal"),
                                SEAL_FN_SQL.indexOf("returns jsonb"));
  assert.ok(!/facts/i.test(sig), "the seal accepts confirmation facts as input");
  assert.ok(/into v_facts/.test(SEAL_FN_SQL), "facts are no longer computed in the function");
});

test("FROM and TO are derived from the sealed placements", () => {
  // Bound to the exact proposal that was hashed, not to the goal at large.
  assert.ok(/min\(s\.scheduled_date\) as from_date/.test(SEAL_FN_SQL), "FROM is not from the sealed set");
  assert.ok(/max\(s\.scheduled_date\) as to_date/.test(SEAL_FN_SQL), "TO is not from the sealed set");
  assert.ok(/join sealed s on s\.lesson_id = l\.id/.test(SEAL_FN_SQL), "facts are not joined to the sealed set");
});

test("the seal refuses foreign, completed, duplicate and nameless placements", () => {
  // Assert each guard RAISES. A message downgraded to `raise notice` still
  // contains the text but no longer refuses anything.
  for (const guard of ["placement references a lesson outside the sealed scope",
                       "placement references a completed lesson",
                       "duplicate lesson_id in placements",
                       "placement is missing lesson_id",
                       "goals do not belong to the current user"]) {
    const at = SEAL_FN_SQL.indexOf(guard);
    assert.ok(at > 0, `the seal lost its guard: ${guard}`);
    const before = SEAL_FN_SQL.slice(Math.max(0, at - 60), at);
    assert.ok(/raise exception/.test(before), `guard does not raise: ${guard}`);
  }
});

test("schedule_proposals is readable by its owner and writable by no client", () => {
  assert.ok(/enable row level security/.test(SEAL_SQL), "RLS is not enabled");
  assert.ok(/for select using \(auth\.uid\(\) = user_id\)/.test(SEAL_SQL), "the owner-read policy is gone");
  assert.ok(!/for (insert|update|delete)/i.test(SEAL_SQL),
    "a client write policy was added; only the seal function may write");
});

test("nothing in the seal consumes a proposal", () => {
  // Consumption belongs to the future schedule_commit. The columns exist; no
  // function sets them.
  assert.ok(!/set[\s\S]{0,80}consumed_at/i.test(SEAL_FN_SQL), "the seal consumes a proposal");
  assert.ok(!/consumed_by_transaction_id\s*=/.test(SEAL_FN_SQL), "the seal writes a consumption marker");
});

test("the seal writes only schedule_proposals", () => {
  const fn = SEAL_FN_SQL.replace(/--[^\n]*/g, " ");
  const writes = fn.match(/\b(insert into|update|delete from)\s+(public\.)?(\w+)/gi) ?? [];
  for (const w of writes) {
    assert.ok(/schedule_proposals/.test(w), `the seal writes outside schedule_proposals: ${w}`);
  }
});

test("proposals expire in 15 minutes", () => {
  assert.ok(/interval '15 minutes'/.test(SEAL_FN_SQL), "the expiry window changed");
});
