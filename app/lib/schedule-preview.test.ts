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
