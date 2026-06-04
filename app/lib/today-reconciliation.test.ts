// Regression tests for the Today scheduled_date cache reconciler.
//
// Background (2026-06-02 bunching bug): the old Today loader fetched incomplete
// lessons in ONE cross-goal cartesian `.in(goalIds) × .in(slots)` with no
// pagination. For accounts with >~1000 incomplete rows the PostgREST response
// was capped, so `syncProjectedScheduledDates` got an incomplete row set and
// left the dropped rows on stale dates — which a later pass then collided with.
// `syncProjectedScheduledDates` itself is correct given a COMPLETE row set
// (proven by the "complete fetch" control below); the bug was the truncated
// fetch in the caller.
//
// The fix is `reconcileGoalScheduleCache`: it reconciles ONE goal at a time,
// fetching only that goal's incomplete rows. A single goal's tail is far under
// the row cap, so its fetch is always complete. These tests exercise that
// reconciler against an in-memory `lessons` table whose SELECTs honour a
// configurable row cap (simulating PostgREST), and assert no per-goal
// collisions even when the account's TOTAL row count exceeds the cap.
//
// No live Supabase harness exists in this suite, so the cap is simulated.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { SupabaseClient } from '@supabase/supabase-js'

import { reconcileGoalScheduleCache, type CurriculumGoalConfig } from './scheduler.ts'

type Row = {
  id: string
  curriculum_goal_id: string
  queue_position: number | null
  lesson_number: number | null
  scheduled_date: string | null
  completed: boolean
  is_backfill: boolean | null
}

// In-memory `lessons` table + a mock supabase that supports the two chains the
// reconciler uses: `.select(...).eq(...).eq(...)` (awaitable, row-cap honoured)
// and `.update({...}).in("id", ids)`. `cap` simulates PostgREST's db-max-rows.
function makeDb(seed: Row[], opts: { cap?: number } = {}) {
  const table = new Map<string, Row>(seed.map((r) => [r.id, { ...r }]))

  function selectChain() {
    const filters: [string, unknown][] = []
    const chain = {
      eq(col: string, val: unknown) { filters.push([col, val]); return chain },
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        let rows = Array.from(table.values()).filter((r) =>
          filters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v),
        )
        if (opts.cap != null) rows = rows.slice(0, opts.cap) // simulate the row cap
        resolve({ data: rows.map((r) => ({ ...r })), error: null })
      },
    }
    return chain
  }

  const lessons = {
    select: () => selectChain(),
    update: (payload: Record<string, unknown>) => ({
      in: async (_col: string, ids: string[]) => {
        for (const id of ids) {
          const row = table.get(id)
          if (row && typeof payload.scheduled_date === 'string') {
            row.scheduled_date = payload.scheduled_date
          }
        }
        return { error: null }
      },
    }),
  }

  const supabase = {
    from(t: string) {
      if (t !== 'lessons') throw new Error(`unexpected table: ${t}`)
      return lessons
    },
  } as unknown as SupabaseClient
  return { supabase, table }
}

// Count incomplete, non-backfill rows per scheduled_date, keep only collisions.
function collisions(table: Map<string, Row>, goalId?: string): Map<string, string[]> {
  const byDate = new Map<string, string[]>()
  for (const r of table.values()) {
    if (goalId && r.curriculum_goal_id !== goalId) continue
    if (r.completed || r.is_backfill || !r.scheduled_date) continue
    const list = byDate.get(r.scheduled_date) ?? []
    list.push(r.id)
    byDate.set(r.scheduled_date, list)
  }
  return new Map(Array.from(byDate).filter(([, ids]) => ids.length > 1))
}

// All 7 days are school days, so the projector lays lessons on consecutive
// calendar days from `today` — deterministic and weekday-independent.
function goal(id: string, lpd: number, total: number, currentLesson = 0): CurriculumGoalConfig {
  return {
    id,
    total_lessons: total,
    lessons_per_day: lpd,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    current_lesson: currentLesson,
  }
}

function incompleteRows(goalId: string, n: number, staleDate = '2026-05-01'): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${goalId}-L${i + 1}`,
    curriculum_goal_id: goalId,
    queue_position: i + 1,
    lesson_number: i + 1,
    scheduled_date: staleDate, // all bunched on one stale date to start
    completed: false,
    is_backfill: false,
  }))
}

const NO_VACATIONS: never[] = []
const MON = new Date('2026-06-01T00:00:00')
const TUE = new Date('2026-06-02T00:00:00')

test('reconcileGoalScheduleCache: heals a goal whose tail is bunched onto one date', async () => {
  const { supabase, table } = makeDb(incompleteRows('g1', 6), { cap: 1000 })
  await reconcileGoalScheduleCache(supabase, goal('g1', 1, 6), NO_VACATIONS, 0, MON)

  assert.equal(collisions(table).size, 0, 'every lesson must land on its own date after reconcile')
  const dates = new Set(Array.from(table.values()).map((r) => r.scheduled_date))
  assert.equal(dates.size, 6, 'six lessons should occupy six distinct dates')
})

test('reconcileGoalScheduleCache: account exceeding the row cap across goals has no per-goal collisions', async () => {
  // Two goals × 600 incomplete rows = 1200 total, over the simulated 1000 cap.
  // A single cross-goal fetch would truncate and bunch; per-goal fetches
  // (600 each, under the cap) stay complete.
  const seed = [...incompleteRows('g1', 600), ...incompleteRows('g2', 600)]
  const { supabase, table } = makeDb(seed, { cap: 1000 })

  await reconcileGoalScheduleCache(supabase, goal('g1', 1, 600), NO_VACATIONS, 0, MON)
  await reconcileGoalScheduleCache(supabase, goal('g2', 1, 600), NO_VACATIONS, 0, MON)

  assert.equal(collisions(table, 'g1').size, 0, 'g1 must have no bunched dates')
  assert.equal(collisions(table, 'g2').size, 0, 'g2 must have no bunched dates')
})

test('reconcileGoalScheduleCache: two passes with a shifted projection do not accrete collisions', async () => {
  const { supabase, table } = makeDb(incompleteRows('g1', 6), { cap: 1000 })
  await reconcileGoalScheduleCache(supabase, goal('g1', 1, 6), NO_VACATIONS, 0, MON)
  // Day rolls over → projection shifts one day later. Complete per-goal fetch
  // means pass 2 rewrites the whole tail; nothing is left behind to collide.
  await reconcileGoalScheduleCache(supabase, goal('g1', 1, 6), NO_VACATIONS, 0, TUE)

  assert.equal(collisions(table).size, 0, 'shifted second pass must not stack onto first-pass dates')
})

test('reconcileGoalScheduleCache: backfill rows are never re-dated', async () => {
  const seed: Row[] = [
    ...incompleteRows('g1', 4),
    // historical backfill rows — must keep their original dates
    { id: 'bf-done', curriculum_goal_id: 'g1', queue_position: null, lesson_number: -1, scheduled_date: '2026-01-10', completed: true, is_backfill: true },
    { id: 'bf-open', curriculum_goal_id: 'g1', queue_position: 1, lesson_number: 1, scheduled_date: '2026-01-11', completed: false, is_backfill: true },
  ]
  const { supabase, table } = makeDb(seed, { cap: 1000 })
  await reconcileGoalScheduleCache(supabase, goal('g1', 1, 4), NO_VACATIONS, 0, MON)

  assert.equal(table.get('bf-done')!.scheduled_date, '2026-01-10', 'completed backfill row untouched')
  assert.equal(table.get('bf-open')!.scheduled_date, '2026-01-11', 'incomplete backfill row untouched')
})

test('reconcileGoalScheduleCache: completed rows are never re-dated', async () => {
  const seed: Row[] = [
    ...incompleteRows('g1', 4),
    { id: 'done-1', curriculum_goal_id: 'g1', queue_position: 1, lesson_number: 1, scheduled_date: '2026-04-01', completed: true, is_backfill: false },
  ]
  const { supabase, table } = makeDb(seed, { cap: 1000 })
  await reconcileGoalScheduleCache(supabase, goal('g1', 1, 4), NO_VACATIONS, 0, MON)

  assert.equal(table.get('done-1')!.scheduled_date, '2026-04-01', 'completed row keeps its historical date')
})

test('reconcileGoalScheduleCache: lessons_per_day=2 never puts more than 2 incomplete lessons on a date', async () => {
  const { supabase, table } = makeDb(incompleteRows('g1', 8), { cap: 1000 })
  await reconcileGoalScheduleCache(supabase, goal('g1', 2, 8), NO_VACATIONS, 0, MON)

  const perDate = new Map<string, number>()
  for (const r of table.values()) {
    if (r.completed || r.is_backfill || !r.scheduled_date) continue
    perDate.set(r.scheduled_date, (perDate.get(r.scheduled_date) ?? 0) + 1)
  }
  for (const [date, n] of perDate) assert.ok(n <= 2, `${date} holds ${n} lessons, exceeds lessons_per_day=2`)
})

test('reconcileGoalScheduleCache: kill switch (NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED=false) writes nothing', async () => {
  const prev = process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED
  process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED = 'false'
  try {
    const { supabase, table } = makeDb(incompleteRows('g1', 4), { cap: 1000 })
    await reconcileGoalScheduleCache(supabase, goal('g1', 1, 4), NO_VACATIONS, 0, MON)
    for (const r of table.values()) {
      assert.equal(r.scheduled_date, '2026-05-01', 'disabled reconciler must not write')
    }
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED
    else process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED = prev
  }
})
