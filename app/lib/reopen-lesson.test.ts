// Invariant 23 un-tick: one transaction, then the re-date, in that order.
//
//   node --test app/lib/reopen-lesson.test.ts
//
// PR #84 re-dates the rest of a curriculum after every completion change
// (resyncGoalsForParent -> planGoalResync). That re-date reads the goal's
// unfinished rows and treats every pinned one as a hold, so it projects around
// a make-up ONLY if the make-up pin already exists when it runs. These tests
// pin down both halves: untickLessonThen runs the follow-up only after
// reopen_lesson succeeded, and a re-date run in that order keeps the next
// lesson off the make-up's day while one run first does not.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeNextLessonsForGoal, toDateStr, type QueueHold } from './scheduler.ts'
import { planReopenMakeUp, untickLesson, untickLessonThen } from './reopen-lesson.ts'

type Call = { op: string; name?: string }

function fakeClient(answer: { data?: unknown; error?: { code?: string; message?: string } | null }, log: Call[]) {
  return {
    rpc: (name: string) => {
      log.push({ op: 'rpc', name })
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null })
    },
    from: () => {
      log.push({ op: 'from' })
      throw new Error('the un-tick must not write lessons outside reopen_lesson')
    },
  } as never
}

const ARGS = { lessonId: 'lesson-10', localDay: '2026-09-21' }

test('a successful un-tick runs the follow-up once, after the transaction', async () => {
  const log: Call[] = []
  const res = await untickLessonThen(fakeClient({ data: { status: 'made_up', date: '2026-09-21' } }, log), ARGS, async (r) => {
    log.push({ op: `after:${r.status}:${r.date}` })
  })
  assert.deepEqual(res, { ok: true, status: 'made_up', date: '2026-09-21' })
  assert.deepEqual(log.map((c) => c.op + (c.name ? `:${c.name}` : '')), ['rpc:reopen_lesson', 'after:made_up:2026-09-21'])
})

test('a lesson back in the live queue also runs the follow-up', async () => {
  const log: Call[] = []
  const res = await untickLessonThen(fakeClient({ data: { status: 'requeued' } }, log), ARGS, async () => { log.push({ op: 'after' }) })
  assert.equal(res.ok, true)
  assert.deepEqual(log.map((c) => c.op), ['rpc', 'after'])
})

test('the make-up write fails: nothing follows, and the caller is told', async () => {
  const log: Call[] = []
  const res = await untickLessonThen(
    fakeClient({ data: { status: 'failed', reason: 'injected make-up failure' } }, log),
    ARGS,
    async () => { log.push({ op: 'after' }) },
  )
  assert.deepEqual(res, { ok: false, status: 'failed', reason: 'injected make-up failure' })
  assert.deepEqual(log.map((c) => c.op), ['rpc'], 'no re-date for a change that never happened')
})

test('reopen_lesson missing: retryable "unavailable", no fallback write, nothing follows', async () => {
  const log: Call[] = []
  const res = await untickLessonThen(
    fakeClient({ error: { code: 'PGRST202', message: 'Could not find the function' } }, log),
    ARGS,
    async () => { log.push({ op: 'after' }) },
  )
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.status, 'unavailable')
  assert.deepEqual(log.map((c) => c.op), ['rpc'])
})

test('an RPC error is a failure, not a fallback', async () => {
  const log: Call[] = []
  const res = await untickLesson(fakeClient({ error: { code: '57014', message: 'canceling statement' } }, log), ARGS)
  assert.deepEqual(res, { ok: false, status: 'failed', reason: 'canceling statement' })
  assert.deepEqual(log.map((c) => c.op), ['rpc'])
})

test('already unticked in another tab: no follow-up', async () => {
  const log: Call[] = []
  const res = await untickLessonThen(fakeClient({ data: { status: 'not_completed' } }, log), ARGS, async () => { log.push({ op: 'after' }) })
  assert.equal(res.ok === false && res.status, 'not_completed')
  assert.deepEqual(log.map((c) => c.op), ['rpc'])
})

// ── Why the order matters: PR #84's re-date, run before and after the pin ──

const GOAL = {
  id: 'goal', school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], lessons_per_day: 1, lessons_per_day_overrides: null,
  current_lesson: 10, total_lessons: 40, start_date: '2026-09-08',
}
const TODAY = new Date(2026, 8, 21)

type Row = { id: string; queue_position: number; scheduled_date: string; completed: boolean; queue_pinned: boolean; skipped: boolean }

/** Lesson 10 unticked today; 11..40 ahead from tomorrow. */
function rowsAfterUncomplete(): Row[] {
  const rows: Row[] = [{ id: 'l10', queue_position: 10, scheduled_date: '2026-09-21', completed: false, queue_pinned: false, skipped: false }]
  const d = new Date(2026, 8, 22)
  for (let n = 11; n <= 40; n++) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
    rows.push({ id: `l${n}`, queue_position: n, scheduled_date: toDateStr(d), completed: false, queue_pinned: false, skipped: false })
    d.setDate(d.getDate() + 1)
  }
  return rows
}

/** planGoalResync's projection (PR #84): every pinned unfinished row is a hold. */
function redate(rows: Row[]): Map<string, string> {
  const holds: QueueHold[] = rows.filter((r) => !r.completed && r.queue_pinned && !r.skipped).map((r) => ({ slot: r.queue_position, date: r.scheduled_date }))
  const projected = computeNextLessonsForGoal(GOAL, TODAY, 3650, [], 0, holds)
  const bySlot = new Map(projected.map((p) => [p.lesson_number, p.date]))
  const out = new Map<string, string>()
  for (const r of rows) {
    if (r.completed || r.queue_pinned || r.skipped) continue // planProjectedDateWrites never moves these
    out.set(r.id, bySlot.get(r.queue_position) ?? r.scheduled_date)
  }
  return out
}

function pin(rows: Row[]): Row[] {
  const l10 = rows.find((r) => r.id === 'l10')!
  const decision = planReopenMakeUp({ row: l10, currentLesson: GOAL.current_lesson, todayYmd: '2026-09-21' })
  assert.deepEqual(decision, { date: '2026-09-21' })
  return rows.map((r) => (r.id === 'l10' ? { ...r, queue_pinned: true, scheduled_date: decision!.date } : r))
}

test('pin, THEN re-date: the next lesson stays off the make-up\'s day', () => {
  const pinned = pin(rowsAfterUncomplete())
  const dates = redate(pinned)
  assert.equal(dates.get('l11'), '2026-09-22')
  assert.ok(![...dates.values()].includes('2026-09-21'), 'nothing re-dated onto the make-up\'s day')
})

test('re-date BEFORE the pin puts the next lesson on the make-up\'s day', () => {
  // The unpinned reopened row is invisible to the projection, so today looks
  // free and lesson 11 is re-dated onto it. Pinning afterwards leaves two
  // lessons stored on today: the 1Q shape, in Plan's dates.
  const dates = redate(rowsAfterUncomplete())
  assert.equal(dates.get('l11'), '2026-09-21')
})
