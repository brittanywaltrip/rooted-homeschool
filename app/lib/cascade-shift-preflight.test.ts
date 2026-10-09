import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCascadeShift, type CascadeSnapshotRow } from './cascade-shift-preflight.ts'
import type { CurriculumGoalConfig } from './scheduler.ts'

const goal: CurriculumGoalConfig = { id: 'g', total_lessons: 3, current_lesson: 0, lessons_per_day: 1, school_days: ['Tue'], start_date: '2026-09-22' }
function rows(dates = ['2026-09-22', '2026-09-29', '2026-10-06']): CascadeSnapshotRow[] {
  return dates.map((date, i) => ({ id: `L${i + 1}`, scheduled_date: date, queue_position: i + 1, queue_pinned: false, completed: false, skipped: false, is_backfill: false }))
}
const choice = { lessonId: 'L1', fromDateStr: '2026-09-22', toDateStr: '2026-09-29', shiftDays: 1 }
const today = new Date('2026-09-22T00:00:00')

test('regular weekly shift can fulfill the promise', () => {
  assert.deepEqual(checkCascadeShift(goal, rows(), [], choice, today), { ok: true })
})
for (const pinned of [false, true]) {
  test(`stored gap with pin=${pinned} is refused before it can compress`, () => {
    const input = rows(['2026-09-22', '2026-10-13', '2026-10-20'])
    input[1].queue_pinned = pinned
    const before = structuredClone(input)
    assert.deepEqual(checkCascadeShift(goal, input, [], choice, today), { ok: false, reason: 'spacing' })
    assert.deepEqual(input, before)
  })
}
test('Sunday weekly shift and gap use the same rule', () => {
  const sunday = { ...goal, school_days: ['Sun'], start_date: '2026-09-20' }
  const c = { ...choice, fromDateStr: '2026-09-20', toDateStr: '2026-09-27' }
  const day = new Date('2026-09-20T00:00:00')
  assert.deepEqual(checkCascadeShift(sunday, rows(['2026-09-20', '2026-09-27', '2026-10-04']), [], c, day), { ok: true })
  assert.deepEqual(checkCascadeShift(sunday, rows(['2026-09-20', '2026-10-11', '2026-10-18']), [], c, day), { ok: false, reason: 'spacing' })
})
test('a regular weekly shift skips a holiday without compression', () => {
  const breaks = [{ start_date: '2026-10-06', end_date: '2026-10-06' }]
  assert.deepEqual(checkCascadeShift(goal, rows(['2026-09-22', '2026-09-29', '2026-10-13']), breaks, choice, today), { ok: true })
})
test('repeated shift is allowed when the first shift landed exactly', () => {
  const prior = rows(['2026-09-29', '2026-10-06', '2026-10-13'])
  prior[0].queue_pinned = true
  assert.deepEqual(checkCascadeShift(goal, prior, [], { ...choice, fromDateStr: '2026-09-29', toDateStr: '2026-10-06' }, today), { ok: true })
})
test('a stale source date refuses before a move', () => {
  assert.deepEqual(checkCascadeShift(goal, rows(['2026-09-29', '2026-10-06', '2026-10-13']), [], choice, today), { ok: false, reason: 'changed' })
})
test('earlier pinned work cannot be swept into the re-spread', () => {
  const prior = rows(['2026-09-29', '2026-10-06', '2026-10-13'])
  prior[0].queue_pinned = true
  assert.deepEqual(checkCascadeShift(goal, prior, [], { ...choice, lessonId: 'L2', fromDateStr: '2026-10-06', toDateStr: '2026-10-13' }, today), { ok: false, reason: 'spacing' })
})
test('a literal offset that violates variable capacity is refused', () => {
  const varied = { ...goal, total_lessons: 5, school_days: ['Mon', 'Thu'], start_date: '2026-09-21', lessons_per_day_overrides: { Mon: 2, Thu: 1 } }
  assert.deepEqual(checkCascadeShift(varied, rows(['2026-09-21', '2026-09-21', '2026-09-24', '2026-09-28', '2026-09-28']), [], { ...choice, fromDateStr: '2026-09-21', toDateStr: '2026-09-24' }, new Date('2026-09-21T00:00:00')), { ok: false, reason: 'spacing' })
})
test('an unslotted later row cannot be promised a shift the projector cannot write', () => {
  const input = rows()
  input[2].queue_position = null
  assert.deepEqual(checkCascadeShift(goal, input, [], choice, today), { ok: false, reason: 'spacing' })
})
