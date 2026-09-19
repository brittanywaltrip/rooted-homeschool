// Behavioural regression tests for the scheduler paths changed on 2026-09-18/19.
//
// These assert OUTGOING PAYLOADS, not source text. Every test drives the real
// exported function through a recording fake and inspects what it tried to
// write. A source-level assertion can only prove a string is present; it
// cannot prove the write was suppressed, or that the suppression left the
// other phases intact.
//
// What is NOT covered here, and why, is documented at the bottom of the file.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  syncProjectedScheduledDates,
  reconcileGoalScheduleCache,
  buildPastDateCompletionPayload,
  type QueueResyncRow,
  type CurriculumGoalConfig,
} from './scheduler.ts'
import { respreadPastYear, RespreadRefused } from './past-year-respread.ts'
import { PAST_YEAR_SOURCE } from './past-year-dates.ts'

// ── A fake that records every write, and nothing else ─────────────────────
type Write = { table: string; payload: Record<string, unknown>; filter: string; ids?: string[] }

function recorder(reads: Record<string, unknown[]> = {}) {
  const writes: Write[] = []
  const make = (table: string) => {
    const chain = (payload?: Record<string, unknown>, mode: 'select' | 'update' = 'select') => {
      let ids: string[] | undefined
      let filter = ''
      const self: Record<string, unknown> = {}
      const record = () => {
        if (mode === 'update' && payload) writes.push({ table, payload, filter, ids })
      }
      const api = {
        eq: (c: string, v: unknown) => { filter += `eq(${c}=${String(v)})`; record(); return self },
        neq: () => self, lt: () => self, lte: () => self, gt: () => self, gte: () => self,
        is: () => self, not: () => self, or: () => self, order: () => self, limit: () => self,
        range: () => self,
        in: (c: string, v: string[]) => { filter += `in(${c})`; ids = v; record(); return self },
        select: () => self,
        single: async () => ({ data: (reads[table] ?? [])[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: (reads[table] ?? [])[0] ?? null, error: null }),
        then: (res: (v: { data: unknown[]; error: null }) => unknown) =>
          res({ data: (reads[table] ?? []) as unknown[], error: null }),
      }
      Object.assign(self, api)
      return self
    }
    return {
      select: () => chain(),
      update: (p: Record<string, unknown>) => chain(p, 'update'),
      insert: () => chain(),
      delete: () => chain(),
    }
  }
  return {
    writes,
    lessonWrites: () => writes.filter((w) => w.table === 'lessons'),
    client: { from: (t: string) => make(t) } as never,
  }
}

const withSyncFlag = async (value: string | undefined, fn: () => Promise<void>) => {
  const prev = process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED
  if (value === undefined) delete process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED
  else process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED = value
  try { await fn() } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED
    else process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED = prev
  }
}

/** Two incomplete rows whose cached dates disagree with the projector. */
function driftedRows(): QueueResyncRow[] {
  return [
    { id: 'row-1', scheduled_date: '2026-01-05', completed: false, is_backfill: false, queue_pinned: false, skipped: false },
    { id: 'row-2', scheduled_date: '2026-01-06', completed: false, is_backfill: false, queue_pinned: false, skipped: false },
  ]
}
const PROJECTION = new Map([['g1|1', '2026-02-02'], ['g1|2', '2026-02-03']])

// ═══ PRIORITY 1: sync disabled means ZERO date writes ═════════════════════

test('P1 control: with sync ENABLED, drift produces exactly the queue_resync payload', async () => {
  await withSyncFlag('true', async () => {
    const rec = recorder()
    const rows = driftedRows()
    await syncProjectedScheduledDates(rec.client, rows, PROJECTION,
      (r) => `g1|${rows.indexOf(r) + 1}`)
    const w = rec.lessonWrites()
    assert.equal(w.length, 2, 'one UPDATE per distinct target date')
    for (const write of w) {
      assert.deepEqual(Object.keys(write.payload).sort(), ['date', 'scheduled_date', 'scheduled_source'],
        'the resync writes exactly three columns and no others')
      assert.equal(write.payload.scheduled_source, 'queue_resync')
      assert.equal(write.payload.date, write.payload.scheduled_date, 'both date columns move together')
    }
  })
})

test('P1: syncProjectedScheduledDates writes NOTHING when the switch is off', async () => {
  await withSyncFlag('false', async () => {
    const rec = recorder()
    const rows = driftedRows()
    await syncProjectedScheduledDates(rec.client, rows, PROJECTION,
      (r) => `g1|${rows.indexOf(r) + 1}`)
    assert.deepEqual(rec.writes, [], 'the same drift that wrote twice above must write nothing')
  })
})

test('P1: the gate is inside the helper, so a DIRECT caller cannot bypass it', async () => {
  // recalibrate.ts imports syncProjectedScheduledDates directly and used to be
  // the one caller that never checked the switch. Calling the helper with no
  // reconcileGoalScheduleCache wrapper is exactly that shape.
  await withSyncFlag('false', async () => {
    const rec = recorder()
    const rows = driftedRows()
    await syncProjectedScheduledDates(rec.client, rows, PROJECTION,
      (r) => `g1|${rows.indexOf(r) + 1}`)
    assert.equal(rec.lessonWrites().length, 0)
  })
})

test('P1: reconcileGoalScheduleCache writes nothing when the switch is off', async () => {
  await withSyncFlag('false', async () => {
    const rec = recorder({ lessons: driftedRows() })
    const goal: CurriculumGoalConfig = {
      id: 'g1', total_lessons: 10, lessons_per_day: 1,
      school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      current_lesson: 0, start_date: '2026-01-01', lessons_per_day_overrides: null,
    }
    await reconcileGoalScheduleCache(rec.client, goal, [], 0, new Date('2026-02-02T12:00:00Z'))
    assert.deepEqual(rec.writes, [])
  })
})

// ═══ PRIORITY 2: what survives a reconcile, and what does not ═════════════

test('P2: a PINNED row is never re-dated, so a manual move survives reconciliation', async () => {
  await withSyncFlag('true', async () => {
    const rec = recorder()
    const rows: QueueResyncRow[] = [
      { id: 'pinned', scheduled_date: '2026-01-05', completed: false, is_backfill: false, queue_pinned: true, skipped: false },
      { id: 'loose', scheduled_date: '2026-01-06', completed: false, is_backfill: false, queue_pinned: false, skipped: false },
    ]
    await syncProjectedScheduledDates(rec.client, rows, PROJECTION,
      (r) => `g1|${rows.indexOf(r) + 1}`)
    const touched = rec.lessonWrites().flatMap((w) => w.ids ?? [])
    assert.ok(!touched.includes('pinned'), 'a pinned row must never be re-dated')
    assert.ok(touched.includes('loose'), 'an unpinned drifted row must be')
  })
})

test('P2: a SKIPPED row is never re-dated, so a skip is not silently undone', async () => {
  await withSyncFlag('true', async () => {
    const rec = recorder()
    const rows: QueueResyncRow[] = [
      { id: 'skipped', scheduled_date: null, completed: false, is_backfill: false, queue_pinned: false, skipped: true },
      { id: 'loose', scheduled_date: '2026-01-06', completed: false, is_backfill: false, queue_pinned: false, skipped: false },
    ]
    await syncProjectedScheduledDates(rec.client, rows, PROJECTION,
      (r) => `g1|${rows.indexOf(r) + 1}`)
    const touched = rec.lessonWrites().flatMap((w) => w.ids ?? [])
    assert.ok(!touched.includes('skipped'))
    assert.ok(touched.includes('loose'))
  })
})

test('P2: undoing a MOVE leaves the row unpinned, so the reconciler may reclaim it', async () => {
  // OBSERVATION, recorded as-is. Not a judgement that this is right, and not a
  // licence to change it.
  //
  // plan_move sets queue_pinned true; plan_move_undo sets it back to FALSE.
  // An unpinned row is in scope for the projector, so an undone lesson can be
  // re-dated on the next load: the undo restores the date, not a pin.
  //
  // This test exists to make that CURRENT behaviour visible and to fail loudly
  // if it changes by accident. Whether it should change is a product question
  // for Brittany, and nothing here presumes an answer.
  await withSyncFlag('true', async () => {
    const rec = recorder()
    const afterUndo: QueueResyncRow[] = [
      { id: 'undone', scheduled_date: '2026-01-05', completed: false, is_backfill: false, queue_pinned: false, skipped: false },
    ]
    await syncProjectedScheduledDates(rec.client, afterUndo, new Map([['g1|1', '2026-02-02']]), () => 'g1|1')
    const w = rec.lessonWrites()
    assert.equal(w.length, 1, 'an undone (unpinned) row IS re-dated by the reconciler')
    assert.equal(w[0].payload.scheduled_source, 'queue_resync')
  })
})

test('P2: undoing a SKIP that restores a pin is then protected', async () => {
  // OBSERVATION, same standing as the test above. skip_undo writes
  // queue_pinned: pinnedIds.has(id), restoring whatever the pin was before the
  // skip. Where the row had been pinned, the reconciler leaves it alone. That
  // differs from the move-undo case; both are recorded, neither is endorsed.
  await withSyncFlag('true', async () => {
    const rec = recorder()
    const rows: QueueResyncRow[] = [
      { id: 'unskipped-pinned', scheduled_date: '2026-01-05', completed: false, is_backfill: false, queue_pinned: true, skipped: false },
    ]
    await syncProjectedScheduledDates(rec.client, rows, new Map([['g1|1', '2026-02-02']]), () => 'g1|1')
    assert.deepEqual(rec.writes, [], 'a restored pin protects the restored date')
  })
})

// ═══ PRIORITY 3: historical completion vs past-year respread ══════════════

test('P3: a past-day completion is an UPDATE that pins history, not a resync', async () => {
  const payload = buildPastDateCompletionPayload('2026-03-04T12:00:00Z')
  assert.equal(payload.scheduled_source, 'catchup_resched')
  assert.equal(payload.completed, true)
  assert.equal(payload.is_backfill, true, 'is_backfill is what stops the projector re-spreading it')
  assert.equal(payload.date, '2026-03-04')
  assert.equal(payload.scheduled_date, '2026-03-04')
})

test('P3: an is_backfill row is invisible to the reconciler, so history never moves', async () => {
  await withSyncFlag('true', async () => {
    const rec = recorder()
    const rows: QueueResyncRow[] = [
      { id: 'history', scheduled_date: '2026-03-04', completed: false, is_backfill: true, queue_pinned: false, skipped: false },
    ]
    await syncProjectedScheduledDates(rec.client, rows, new Map([['g1|1', '2026-02-02']]), () => 'g1|1')
    assert.deepEqual(rec.writes, [], 'a backfilled historical row is never re-dated')
  })
})

test('P3: a COMPLETED row is never re-dated (Invariant 3)', async () => {
  await withSyncFlag('true', async () => {
    const rec = recorder()
    const rows: QueueResyncRow[] = [
      { id: 'done', scheduled_date: '2026-03-04', completed: true, is_backfill: false, queue_pinned: false, skipped: false },
    ]
    await syncProjectedScheduledDates(rec.client, rows, new Map([['g1|1', '2026-02-02']]), () => 'g1|1')
    assert.deepEqual(rec.writes, [])
  })
})

test('P3: respreadPastYear re-stamps past_year on every date write', async () => {
  const lessons = [1, 2, 3, 4].map((n) => ({
    id: `l${n}`, curriculum_goal_id: 'g1', lesson_number: n,
    date: '2026-01-01', scheduled_date: '2026-01-01', completed_at: '2026-01-01T12:00:00Z',
    scheduled_source: PAST_YEAR_SOURCE, child_id: 'c1', minutes_spent: 30,
  }))
  const rec = recorder({
    curriculum_goals: [{ id: 'g1', child_id: 'c1', curriculum_name: 'Math', subject_label: 'Math',
      current_lesson: 4, total_lessons: 4, school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }],
    school_years: [{ days_attended: 10 }],
    lessons,
    school_year_archives: [],
  })
  await respreadPastYear(rec.client, 'u1',
    { id: 'y1', name: '2025-2026', start_date: '2026-01-05', end_date: '2026-03-06' }, 4)

  const dateWrites = rec.lessonWrites()
  assert.ok(dateWrites.length > 0, 'the respread must actually write dates')
  for (const w of dateWrites) {
    assert.equal(w.payload.scheduled_source, PAST_YEAR_SOURCE,
      'a respread-specific tag would break the respread guard, the Years filed-count, and no-badges-for-a-filed-year')
    assert.ok('date' in w.payload && 'scheduled_date' in w.payload && 'completed_at' in w.payload,
      'the respread moves both date columns and the completion stamp together')
    assert.ok(!('completed' in w.payload), 'a respread must never change completion')
    assert.ok(!('queue_position' in w.payload), 'a respread must never touch the queue')
  }
})

test('P3: respreadPastYear REFUSES a year that was actually lived in Rooted', async () => {
  const lessons = [
    { id: 'l1', curriculum_goal_id: 'g1', lesson_number: 1, date: '2026-01-01', scheduled_date: '2026-01-01',
      completed_at: '2026-01-01T12:00:00Z', scheduled_source: PAST_YEAR_SOURCE, child_id: 'c1', minutes_spent: 30 },
    // One real completion is enough to disqualify the whole year.
    { id: 'l2', curriculum_goal_id: 'g1', lesson_number: 2, date: '2026-01-02', scheduled_date: '2026-01-02',
      completed_at: '2026-01-02T12:00:00Z', scheduled_source: 'completion_today', child_id: 'c1', minutes_spent: 30 },
  ]
  const rec = recorder({
    curriculum_goals: [{ id: 'g1', child_id: 'c1', curriculum_name: 'Math', subject_label: 'Math',
      current_lesson: 2, total_lessons: 2, school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }],
    school_years: [{ days_attended: 10 }],
    lessons,
  })
  await assert.rejects(
    () => respreadPastYear(rec.client, 'u1',
      { id: 'y1', name: '2025-2026', start_date: '2026-01-05', end_date: '2026-03-06' }, 2),
    RespreadRefused,
  )
  assert.deepEqual(rec.lessonWrites(), [], 'a refused respread writes nothing at all')
})

// ═══════════════════════════════════════════════════════════════════════════
// NOT COVERED HERE. These are not testable with mocks and must be exercised
// on staging. Listed so the gap is explicit rather than implied by silence.
//
//  1. The move/undo and skip/undo PAYLOADS themselves. They are inline
//     .update() calls inside React components (app/components/PlanV2/index.tsx
//     :3697 and :4071, app/dashboard/page.tsx:3961), reachable only by
//     rendering the component and driving the toast. The tests above cover the
//     CONSEQUENCE of those payloads (what the reconciler then does with the
//     resulting row state), not the payloads themselves.
//  2. The backfill INSERT (completion_backfill, PlanV2:2273). Same reason: it
//     is inside handleBackfillSubmit, a useCallback in the component.
//  3. Recalibrate end to end. recalibrateCurriculumGoal's five phases need a
//     fake that models the orphan-cleanup TRIGGER and the current_lesson
//     recompute trigger; the in-memory fake has neither, so a "zero writes"
//     assertion there would be measuring the fake, not the code.
//  4. move_lesson_to_date. It is a SQL function; no TypeScript test can reach
//     it.
//  5. Anything about which DATABASE is written. That is what the env-identity
//     guard and /api/health gate exist for.
