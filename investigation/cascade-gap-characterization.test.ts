// Investigation only: these assert observed defects, not desired behavior.
// All writes are to local memory. No credentials, network or database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reprojectGoalForParent, nthSchoolDay, type CurriculumGoalConfig } from '../app/lib/scheduler.ts'
import { makeMemorySupabase } from '../app/lib/test-helpers/memory-supabase.ts'

async function respread(days: string[], today: string, dates: string[], keep = 'L1', pinTail = true, overrides: Record<string, number> | null = null) {
  const goal: CurriculumGoalConfig = { id: 'synthetic', total_lessons: dates.length, current_lesson: 0, lessons_per_day: 1, school_days: days, start_date: today, lessons_per_day_overrides: overrides }
  const lessons = dates.map((date, i) => ({ id: `L${i + 1}`, curriculum_goal_id: goal.id, completed: false, skipped: false, is_backfill: false, queue_position: i + 1, queue_pinned: `L${i + 1}` === keep || pinTail, scheduled_date: date, date }))
  const { client, tables } = makeMemorySupabase({ lessons })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await reprojectGoalForParent(client as any, goal, [], { from: new Date(`${today}T00:00:00`), source: 'plan_cascade_shift', keepPinnedIds: [keep] })
  assert.equal(result.ok, true)
  return { before: lessons, after: tables.lessons, dates: tables.lessons.map(r => r.scheduled_date) }
}

for (const pinTail of [true, false]) {
  test(`Tuesday gap compresses with later pins=${pinTail}`, async () => {
    // L1 just moved Sep 22 -> Sep 29. Existing later dates must shift +1 session.
    const r = await respread(['Tue'], '2026-09-22', ['2026-09-29', '2026-10-13', '2026-10-20'], 'L1', pinTail)
    assert.deepEqual(r.dates, ['2026-09-29', '2026-10-06', '2026-10-13'])
    assert.notDeepEqual(r.dates, ['2026-09-29', '2026-10-20', '2026-10-27'], 'actual dates contradict the advertised +1 school-day shift')
    assert.ok(String(r.dates[1]) < r.before[1].scheduled_date, 'later work actually moved backward')
  })
}

test('Sunday-only gap has the same mismatch; it is not a weekday conversion bug', async () => {
  const r = await respread(['Sun'], '2026-09-20', ['2026-09-27', '2026-10-11', '2026-10-18'])
  assert.deepEqual(r.dates, ['2026-09-27', '2026-10-04', '2026-10-11'])
})

test('a regular Tuesday queue correctly advances one session', async () => {
  const r = await respread(['Tue'], '2026-09-22', ['2026-09-29', '2026-09-29', '2026-10-06'])
  assert.deepEqual(r.dates, ['2026-09-29', '2026-10-06', '2026-10-13'])
})

test('the write also changes an earlier incomplete pin outside the preview tail', async () => {
  // L2 just moved Oct 4 -> Oct 11. L1 is earlier than both source and destination.
  const r = await respread(['Sun'], '2026-09-20', ['2026-09-27', '2026-10-11', '2026-10-11', '2026-10-18'], 'L2')
  assert.deepEqual(r.dates, ['2026-09-20', '2026-10-11', '2026-10-18', '2026-10-25'])
  assert.equal(r.after[0].queue_pinned, false)
})

test('uneven daily capacity makes a literal date offset unsafe without validation', async () => {
  // Originally L1/L2 on Mon Sep 21; L3 Thu Sep 24; L4/L5 Mon Sep 28.
  // Move L1 to Thu: shifting L2 one school day would put two on a 1/day Thursday.
  const r = await respread(['Mon', 'Thu'], '2026-09-21', ['2026-09-24', '2026-09-21', '2026-09-24', '2026-09-28', '2026-09-28'], 'L1', false, { Mon: 2, Thu: 1 })
  assert.deepEqual(r.dates, ['2026-09-24', '2026-09-28', '2026-09-28', '2026-10-01', '2026-10-05'])
  assert.equal(nthSchoolDay('2026-09-21', ['Mon', 'Thu'], 1), '2026-09-24')
  assert.notEqual(r.dates[1], '2026-09-24', 'the projector respects capacity but cannot fulfill the literal same-delta promise')
})
