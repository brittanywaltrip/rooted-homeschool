// node --test app/lib/phase2-insert-rows.test.ts
//
// Regression cover for the 2026-09-20 staging failure: every Phase 2 save that
// inserted lessons was refused with
//   400 {"code":"22023","message":"14 unknown key(s) in the inserted rows"}
// because the builder put `user_id` in each insert row and schedule_commit's
// key allowlist (correctly) does not accept it.
//
// These drive the SAME builders the page calls, not a hand-written shape. The
// SQL harness missed this precisely because it built its rows from the
// allowlist's own key names, so it tested the function against the assumption
// the function was written from.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildForwardInsertRow,
  buildBackfillInsertRow,
  assertNoServerOwnedFields,
  SERVER_OWNED_FIELDS,
} from './phase2-insert-rows.ts'

const FWD = {
  childId: 'ch-1', goalId: 'goal-1', lessonNumber: 7, queuePosition: 7,
  curriculumName: '  Math  ', date: '2026-04-02',
}

/** The allowlist as schedule_commit declares it, read from the applied migration
 *  rather than retyped, so the two cannot drift. */
function allowlistFromMigration(): Set<string> {
  const sql = readFileSync(
    resolve(import.meta.dirname, '../../supabase/migrations/20260919231840_schedule_commit_lesson_updates.sql'),
    'utf8',
  )
  const m = sql.match(/unknown key\(s\) in the inserted rows[\s\S]{0,40}/)
  assert.ok(m, 'the insert-row check must still exist in the migration')
  const block = sql.slice(0, sql.indexOf('unknown key(s) in the inserted rows'))
  const last = block.lastIndexOf('not in (')
  const list = block.slice(last + 'not in ('.length, block.indexOf(');', last))
  const keys = [...list.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
  assert.ok(keys.length > 10, `expected a real allowlist, got ${keys.length} keys`)
  return new Set(keys)
}

test('the client payload contains NO user_id', () => {
  for (const row of [buildForwardInsertRow(FWD), buildBackfillInsertRow({ ...FWD, minutes: 30 })]) {
    assert.ok(!('user_id' in row), 'insert rows must not carry user_id')
    for (const f of SERVER_OWNED_FIELDS) {
      assert.ok(!(f in row), `insert rows must not carry the server-owned field ${f}`)
    }
  }
})

test('every key the builders emit is accepted by the RPC allowlist', () => {
  // This is the assertion that would have caught the bug. It compares the REAL
  // builder output against the REAL migration, so neither can drift alone.
  const allowed = allowlistFromMigration()
  for (const [label, row] of [
    ['forward', buildForwardInsertRow(FWD)],
    ['backfill', buildBackfillInsertRow({ ...FWD, minutes: 30 })],
  ] as const) {
    const rejected = Object.keys(row).filter((k) => !allowed.has(k))
    assert.deepEqual(rejected, [], `${label} row sends key(s) schedule_commit rejects: ${rejected.join(', ')}`)
  }
})

test('a payload containing user_id is still rejected', () => {
  assert.throws(
    () => assertNoServerOwnedFields([{ ...buildForwardInsertRow(FWD), user_id: 'u-1' }], 'unit'),
    (e: unknown) => /server-owned field\(s\) \[user_id\]/.test((e as Error).message),
    'the guard must name the offending field',
  )
  // One bad row among good ones is still a refusal.
  assert.throws(
    () => assertNoServerOwnedFields(
      [buildForwardInsertRow(FWD), { ...buildForwardInsertRow(FWD), user_id: 'u-1' }], 'unit'),
    /server-owned field/,
  )
})

test('clean rows pass the guard', () => {
  assert.doesNotThrow(() => assertNoServerOwnedFields(
    [buildForwardInsertRow(FWD), buildBackfillInsertRow({ ...FWD, minutes: 45 })], 'unit'))
  assert.doesNotThrow(() => assertNoServerOwnedFields([], 'unit'))
})

test('commitGoalSave runs the guard before it calls the RPC', () => {
  // Ordering is the point: a guard that runs after the call is decoration.
  const src = readFileSync(resolve(import.meta.dirname, 'schedule-commit-client.ts'), 'utf8')
  const guardAt = src.indexOf('assertNoServerOwnedFields(')
  const rpcAt = src.indexOf('client.rpc("schedule_commit"')
  assert.ok(guardAt > -1, 'commitGoalSave must call the guard')
  assert.ok(rpcAt > -1)
  assert.ok(guardAt < rpcAt, 'the guard must run BEFORE the RPC call')
})

test('the page uses these builders rather than inlining a row', () => {
  const page = readFileSync(
    resolve(import.meta.dirname, '../dashboard/plan/schedule/page.tsx'), 'utf8')
  assert.ok(/buildForwardInsertRow\(/.test(page), 'the page must use the shared forward builder')
  assert.ok(/buildBackfillInsertRow\(/.test(page), 'the page must use the shared backfill builder')
  // The specific regression, checked precisely rather than with a clever
  // regex. An earlier attempt used a pattern that spanned the whole file and
  // matched anything; another matched the curriculum_goals payload and failed
  // for the wrong reason.
  //
  // Scoped to LESSON rows on purpose: the page also builds direct PostgREST
  // inserts for children, activities and curriculum_goals, and those SHOULD set
  // user_id -- ordinary RLS-protected inserts where the client owns the row it
  // creates. Only rows headed for schedule_commit must not, because that
  // function is SECURITY DEFINER and assigns the owner itself.
  const lines = page.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/\buser_id:/.test(lines[i])) continue
    const window = lines.slice(i, i + 4).join('\n')
    assert.ok(
      !/\blesson_number:/.test(window) && !/\bcurriculum_goal_id:\s*goalId/.test(window),
      `line ${i + 1} builds a lesson insert row carrying user_id; ` +
        'schedule_commit assigns the owner from auth.uid()',
    )
  }
})

test('the builders shape the fields the scheduler depends on', () => {
  const f = buildForwardInsertRow(FWD)
  assert.equal(f.title, 'Math — Lesson 7', 'the curriculum name is trimmed')
  assert.equal(f.completed, false)
  assert.equal(f.hours, 0)
  assert.equal(f.scheduled_date, '2026-04-02')
  assert.equal(f.date, f.scheduled_date, 'both date caches agree')
  assert.equal(f.scheduled_source, 'wizard_create')

  const b = buildBackfillInsertRow({ ...FWD, minutes: 30 })
  assert.equal(b.completed, true)
  assert.equal(b.is_backfill, true)
  assert.equal(b.minutes_spent, 30)
  assert.equal(b.hours, 0.5)
  assert.equal(b.completed_at, '2026-04-02T12:00:00Z')

  // A taken slot yields null, which the projector reads as "no slot".
  assert.equal(buildForwardInsertRow({ ...FWD, queuePosition: null }).queue_position, null)
})
