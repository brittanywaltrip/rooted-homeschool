// Unit tests for the curriculum-scheduling helpers. Run with:
//   npm test
//
// Covers the production hotfix: forward-scheduled lessons must never land on
// today, even when the user clicks through with a default startDate that
// happens to equal today. See app/components/CurriculumWizard.tsx and
// "fix(scheduler): curriculum creation no longer crams forward lessons onto
// today" for context.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  forwardScheduleStart,
  collectSchoolDaySlots,
  schoolDaysToBool,
  toDateStr,
  planAddToNextSchoolDays,
  planCompressAfterExtra,
  hasScheduleFieldsChanged,
  buildLessonDateSnapshot,
  applyUndoSnapshot,
  createInFlightGate,
  computeNextLessonsForGoal,
  computeFinishDate,
  computeTodayLessons,
  computeGapLessonsForGoal,
  isBreakDay,
  isSchoolDay,
  normalizeSchoolDays,
  planQueueMove,
  recomputeCurrentLesson,
  syncProjectedScheduledDates,
  type ReschedulableLesson,
  type CurriculumGoalConfig,
  type VacationBlock,
  type QueueMoveInputLesson,
  type QueueResyncRow,
} from './scheduler.ts'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { todayInTz, isoDowFromYmd, addDays, ymdInTz } from './timezone.ts'
import {
  pickNextAvailableDate,
  planRescheduleLessons,
  monotonicCompletedAt,
  schoolDayLabelsToIso,
  isQueueEnabled,
  isVacationDay,
  isDueDate,
  effectiveDueDate,
  isLessonMissed,
  buildPastDateCompletionPayload,
  nthSchoolDay,
  planPushBackNDays,
  schoolDayDelta,
} from './scheduler.ts'

test('forwardScheduleStart bumps today to tomorrow', () => {
  const today = new Date(2026, 3, 28)              // Tue Apr 28 2026
  const userPicked = new Date(2026, 3, 28)         // user kept default = today
  const out = forwardScheduleStart(userPicked, today)
  assert.equal(toDateStr(out), '2026-04-29')
})

test('forwardScheduleStart bumps a past pick to tomorrow', () => {
  const today = new Date(2026, 3, 28)
  const userPicked = new Date(2026, 0, 15)         // mid-January, in the past
  const out = forwardScheduleStart(userPicked, today)
  assert.equal(toDateStr(out), '2026-04-29')
})

test('forwardScheduleStart honors a user pick later than tomorrow', () => {
  const today = new Date(2026, 3, 28)
  const userPicked = new Date(2026, 4, 15)         // May 15
  const out = forwardScheduleStart(userPicked, today)
  assert.equal(toDateStr(out), '2026-05-15')
})

// Wizard hardening (2026-05-01): pin May 1 behavior used by the
// calcFinishDate preview now that it shares forwardScheduleStart with
// the lesson generator. Without this anchor, the preview counted the
// picked start date as a school day while the generator skipped it,
// producing a one-school-day off-by-one in the displayed finish date.

test('forwardScheduleStart returns the day strictly after today when picked is today', () => {
  const today = new Date('2026-05-01T00:00:00')    // Friday
  const picked = new Date('2026-05-01T00:00:00')
  const result = forwardScheduleStart(picked, today)
  assert.equal(toDateStr(result), '2026-05-02')    // Saturday
})

test('forwardScheduleStart honors user pick if later than tomorrow', () => {
  const today = new Date('2026-05-01T00:00:00')
  const picked = new Date('2026-05-15T00:00:00')
  const result = forwardScheduleStart(picked, today)
  assert.equal(toDateStr(result), '2026-05-15')
})

test('Kendra repro: 62 lessons, 3/day Mon-Fri, 15 backfilled, no doubling on today', () => {
  // Reproduces the production bug from 2026-04-28: backfill lessons 1-15
  // occupy past school days, forward lessons 16-62 must spread cleanly
  // across school days starting Wed Apr 29 — never landing on today and
  // never stacking more than perDay on any one date.
  const today = new Date(2026, 3, 28)              // Tue Apr 28 2026
  const userPickedStart = new Date(2026, 3, 28)    // wizard default
  const schoolDays = schoolDaysToBool(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  const perDay = 3
  const totalForward = 47                          // lessons 16..62

  const start = forwardScheduleStart(userPickedStart, today)
  const slots = collectSchoolDaySlots(start, schoolDays, [], perDay, totalForward)

  assert.equal(slots.length, totalForward, 'placed every forward lesson')

  const todayStr = toDateStr(today)
  const onToday = slots.filter((s) => s.date === todayStr)
  assert.equal(onToday.length, 0, 'no lessons land on today')

  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const yStr = toDateStr(yesterday)
  const onYesterday = slots.filter((s) => s.date === yStr)
  assert.equal(onYesterday.length, 0, 'no lessons land on yesterday')

  const firstDate = slots[0].date
  assert.equal(firstDate, '2026-04-29', 'first forward lesson on Wed Apr 29')

  const byDate = new Map<string, number>()
  for (const s of slots) byDate.set(s.date, (byDate.get(s.date) ?? 0) + 1)
  for (const [date, count] of byDate) {
    assert.ok(count <= perDay, `date ${date} has ${count} > ${perDay} lessons`)
  }

  for (const [date] of byDate) {
    const d = new Date(date + 'T12:00:00')
    const dow = (d.getDay() + 6) % 7              // Mon=0..Sun=6
    assert.ok(dow <= 4, `date ${date} (dow ${dow}) is not Mon-Fri`)
  }
})

test('no-backfill curriculum: 30 lessons starting today still skips today', () => {
  const today = new Date(2026, 3, 28)              // Tue
  const start = forwardScheduleStart(new Date(2026, 3, 28), today)
  const slots = collectSchoolDaySlots(start, schoolDaysToBool(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']), [], 3, 30)
  assert.equal(slots[0].date, '2026-04-29')
  assert.equal(slots.filter((s) => s.date === '2026-04-28').length, 0)
})

// SKIPPED under queue-based scheduling (Path A, 2026-05). The "log
// extra → recompress remaining future dates" choreography is unnecessary
// in the new model — completing an extra advances current_lesson and the
// next render projects forward from the new position. Re-enable on rollback.
test.skip('planCompressAfterExtra compresses by exactly one school day', () => {
  // Mom logged 1 extra today (Wed 2026-04-29). She had 31 incomplete future
  // lessons before; now there are 30 left. With perDay=3 + Mon-Fri, the
  // remaining 30 should fit in 10 school days starting tomorrow (Thu 4-30).
  // Baseline (31 lessons / 3 perDay) = 11 school days (would have ended on
  // Thu 5-14). Compressed (30 / 3) = 10 school days, ending Wed 5-13 — one
  // school day earlier, exactly.
  const today = '2026-04-29' // Wed
  const schoolDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const perDay = 3

  const incomplete: ReschedulableLesson[] = Array.from({ length: 30 }, (_, i) => ({
    id: `L${i + 1}`,
    scheduled_date: '2026-05-15', // pre-existing date — overwritten by planner
    date: null,
    curriculum_goal_id: 'goal-1',
  }))

  const { updates, undoData } = planCompressAfterExtra(incomplete, schoolDays, perDay, today)

  assert.equal(updates.length, 30, 'every incomplete lesson is placed')
  assert.equal(undoData.length, 30, 'undo data captured for every lesson')

  // First slot lands on Thu 4-30 (next school day strictly after Wed 4-29).
  assert.equal(updates[0].newDate, '2026-04-30')
  assert.equal(updates[1].newDate, '2026-04-30')
  assert.equal(updates[2].newDate, '2026-04-30')
  // 4th lesson rolls to Fri 5-1, then weekend skipped → Mon 5-4 for the 7th.
  assert.equal(updates[3].newDate, '2026-05-01')
  assert.equal(updates[6].newDate, '2026-05-04')
  // Last (30th) lands on the 10th school day from Thu 4-30 = Wed 5-13.
  assert.equal(updates[29].newDate, '2026-05-13')

  // Distinct school days used = ceil(30 / 3) = 10.
  const distinctDays = new Set(updates.map(u => u.newDate))
  assert.equal(distinctDays.size, 10, 'compresses into 10 school days')

  // No update lands on or before today.
  for (const u of updates) {
    assert.ok(u.newDate > today, `update ${u.id} on ${u.newDate} is not strictly after today`)
  }
})

// SKIPPED under queue-based scheduling (Path A, 2026-05). Re-enable on rollback.
test.skip('planCompressAfterExtra preserves lesson_number ordering across days', () => {
  // Caller is contracted to pass lessons sorted by lesson_number ASC. The
  // planner just walks the input, so the sequence on the calendar mirrors
  // the input order — lesson 1 on the earliest school day, lesson N on
  // the latest. This test pins that.
  const today = '2026-04-29'
  const schoolDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const incomplete: ReschedulableLesson[] = [
    { id: 'A', scheduled_date: null, date: null },
    { id: 'B', scheduled_date: null, date: null },
    { id: 'C', scheduled_date: null, date: null },
    { id: 'D', scheduled_date: null, date: null },
  ]
  const { updates } = planCompressAfterExtra(incomplete, schoolDays, 2, today)
  assert.deepEqual(updates.map(u => u.id), ['A', 'B', 'C', 'D'])
  // perDay=2: A,B → Thu 4-30; C,D → Fri 5-1
  assert.equal(updates[0].newDate, '2026-04-30')
  assert.equal(updates[1].newDate, '2026-04-30')
  assert.equal(updates[2].newDate, '2026-05-01')
  assert.equal(updates[3].newDate, '2026-05-01')
})

// ── hasScheduleFieldsChanged ────────────────────────────────────────────────

test('hasScheduleFieldsChanged returns false for a name-only edit on a hydrated form', () => {
  // The bug we just fixed: form's startDate defaulted to today and never got
  // hydrated from DB, so the gate falsely returned true on every cosmetic
  // edit and trip-shifted today's incomplete lessons. With hydration, the
  // form value matches the persisted goal and this returns false.
  const original = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2025-09-01',
    target_date: '2026-06-15',
    total_lessons: 170,
  }
  const next = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2025-09-01',
    target_date: '2026-06-15',
    total_lessons: 170,
  }
  assert.equal(hasScheduleFieldsChanged(original, next), false)
})

test('hasScheduleFieldsChanged ignores start_date when DB value is null', () => {
  // Legacy goals predate the start_date column being persisted. We never
  // want to "discover" a schedule change just because the form now has
  // today's date in it.
  const original = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: null,
    target_date: null,
    total_lessons: 170,
  }
  const next = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2026-04-29',
    target_date: null,
    total_lessons: 170,
  }
  assert.equal(hasScheduleFieldsChanged(original, next), false)
})

test('hasScheduleFieldsChanged detects each schedule field individually', () => {
  const baseOrig = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2025-09-01',
    target_date: '2026-06-15',
    total_lessons: 170,
  }
  const baseNext = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2025-09-01',
    target_date: '2026-06-15',
    total_lessons: 170,
  }
  assert.equal(hasScheduleFieldsChanged(baseOrig, { ...baseNext, lessons_per_day: 2 }), true,
    'lessons_per_day change is detected')
  assert.equal(hasScheduleFieldsChanged(baseOrig, { ...baseNext, school_days: ['Mon', 'Tue', 'Wed'] }), true,
    'school_days change is detected')
  assert.equal(hasScheduleFieldsChanged(baseOrig, { ...baseNext, start_date: '2025-09-15' }), true,
    'start_date change is detected')
  assert.equal(hasScheduleFieldsChanged(baseOrig, { ...baseNext, target_date: '2026-07-01' }), true,
    'target_date change is detected')
  assert.equal(hasScheduleFieldsChanged(baseOrig, { ...baseNext, target_date: null }), true,
    'target_date set to null is detected')
  assert.equal(hasScheduleFieldsChanged(baseOrig, { ...baseNext, total_lessons: 200 }), true,
    'total_lessons change is detected')
})

test('hasScheduleFieldsChanged treats school_days as a set (order does not matter)', () => {
  const original = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2025-09-01',
    target_date: null,
    total_lessons: 170,
  }
  const next = {
    lessons_per_day: 1,
    school_days: ['Fri', 'Thu', 'Wed', 'Tue', 'Mon'],
    start_date: '2025-09-01',
    target_date: null,
    total_lessons: 170,
  }
  assert.equal(hasScheduleFieldsChanged(original, next), false)
})

test('hasScheduleFieldsChanged ignores total_lessons when DB value is null', () => {
  // Same legacy guard as start_date — older goals didn't persist this.
  const original = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2025-09-01',
    target_date: null,
    total_lessons: null,
  }
  const next = {
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2025-09-01',
    target_date: null,
    total_lessons: 170,
  }
  assert.equal(hasScheduleFieldsChanged(original, next), false)
})

// ── buildLessonDateSnapshot + applyUndoSnapshot ─────────────────────────────
//
// These tests pin the contract that backs Today's reschedule undo: once a
// snapshot is captured before a write, applying it back must restore the
// exact prior state — no recomputation, no column dropouts. Reproduces the
// production failure where reschedulePushAll's undo did nothing on 114
// lessons (single-column snapshot couldn't restore both `date` and
// `scheduled_date`).

test('buildLessonDateSnapshot captures both date columns', () => {
  const snapshot = buildLessonDateSnapshot([
    { id: 'L1', date: '2026-04-29', scheduled_date: '2026-04-29' },
    { id: 'L2', date: null, scheduled_date: '2026-05-01' },
    { id: 'L3' }, // no date columns supplied
  ])
  assert.deepEqual(snapshot, [
    { id: 'L1', date: '2026-04-29', scheduled_date: '2026-04-29' },
    { id: 'L2', date: null, scheduled_date: '2026-05-01' },
    { id: 'L3', date: null, scheduled_date: null },
  ])
})

test('reschedulePushAll round-trip: 5 lessons restored to exact prior dates', () => {
  // Reproduce the production bug: push 5 future lessons +1 school day, then
  // undo via snapshot. Every lesson must end on its original date.
  const before = new Map([
    ['L1', { date: '2026-04-29', scheduled_date: '2026-04-29' }],
    ['L2', { date: '2026-04-30', scheduled_date: '2026-04-30' }],
    ['L3', { date: '2026-05-01', scheduled_date: '2026-05-01' }],
    ['L4', { date: '2026-05-04', scheduled_date: '2026-05-04' }],
    ['L5', { date: '2026-05-05', scheduled_date: '2026-05-05' }],
  ])
  const snapshot = buildLessonDateSnapshot(
    Array.from(before.entries()).map(([id, row]) => ({ id, ...row })),
  )
  // Simulate the push: every row +1 day on both columns.
  const pushed = new Map(before)
  for (const [id, row] of pushed) {
    const d = new Date(row.scheduled_date! + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    const next = toDateStr(d)
    pushed.set(id, { date: next, scheduled_date: next })
  }
  // Sanity: pushed differs from before for all rows.
  for (const id of before.keys()) {
    assert.notDeepEqual(pushed.get(id), before.get(id), `pushed should differ for ${id}`)
  }
  // Undo via snapshot — full restore.
  const restored = applyUndoSnapshot(pushed, snapshot)
  for (const id of before.keys()) {
    assert.deepEqual(restored.get(id), before.get(id), `${id} restored to its prior state`)
  }
})

test('rescheduleMoveTo round-trip: a single lesson moved to tomorrow restores cleanly', () => {
  const before = new Map([
    ['L1', { date: '2026-04-29', scheduled_date: '2026-04-29' }],
  ])
  const snapshot = buildLessonDateSnapshot([{ id: 'L1', date: '2026-04-29', scheduled_date: '2026-04-29' }])
  // Simulate the move-to-tomorrow write.
  const moved = new Map(before)
  moved.set('L1', { date: '2026-04-30', scheduled_date: '2026-04-30' })
  // Undo.
  const restored = applyUndoSnapshot(moved, snapshot)
  assert.deepEqual(restored.get('L1'), { date: '2026-04-29', scheduled_date: '2026-04-29' })
})

test('rescheduleDoubleUp round-trip: a missed-on-past row goes to tomorrow then back', () => {
  // Captures the case where the undo target was a past date, not "today" —
  // the prior snapshot-as-today bug would have lost this distinction.
  const before = new Map([
    ['L1', { date: '2026-04-22', scheduled_date: '2026-04-22' }],
  ])
  const snapshot = buildLessonDateSnapshot([{ id: 'L1', date: '2026-04-22', scheduled_date: '2026-04-22' }])
  const moved = new Map(before)
  moved.set('L1', { date: '2026-04-30', scheduled_date: '2026-04-30' })
  const restored = applyUndoSnapshot(moved, snapshot)
  assert.deepEqual(restored.get('L1'), { date: '2026-04-22', scheduled_date: '2026-04-22' })
})

test('missed-lesson sheet "Add to next school days" round-trip', () => {
  // 3 missed lessons get filled into upcoming school days; undo restores
  // each to its original past date (not to "today").
  const before = new Map([
    ['L1', { date: '2026-04-25', scheduled_date: '2026-04-25' }],
    ['L2', { date: '2026-04-27', scheduled_date: '2026-04-27' }],
    ['L3', { date: '2026-04-28', scheduled_date: '2026-04-28' }],
  ])
  const snapshot = buildLessonDateSnapshot(
    Array.from(before.entries()).map(([id, row]) => ({ id, ...row })),
  )
  const filled = new Map(before)
  filled.set('L1', { date: '2026-04-30', scheduled_date: '2026-04-30' })
  filled.set('L2', { date: '2026-05-01', scheduled_date: '2026-05-01' })
  filled.set('L3', { date: '2026-05-04', scheduled_date: '2026-05-04' })
  const restored = applyUndoSnapshot(filled, snapshot)
  assert.deepEqual(restored.get('L1'), before.get('L1'))
  assert.deepEqual(restored.get('L2'), before.get('L2'))
  assert.deepEqual(restored.get('L3'), before.get('L3'))
})

test('missed-lesson sheet "Push schedule back N days" round-trip covers missed + future', () => {
  // 2 missed + 3 future incomplete. Push-back fills missed into upcoming
  // school days AND shifts every future row +N days. Undo must restore
  // BOTH groups, not just one.
  const before = new Map([
    ['M1', { date: '2026-04-25', scheduled_date: '2026-04-25' }], // missed
    ['M2', { date: '2026-04-28', scheduled_date: '2026-04-28' }], // missed
    ['F1', { date: '2026-04-30', scheduled_date: '2026-04-30' }], // future
    ['F2', { date: '2026-05-01', scheduled_date: '2026-05-01' }], // future
    ['F3', { date: '2026-05-04', scheduled_date: '2026-05-04' }], // future
  ])
  const snapshot = buildLessonDateSnapshot(
    Array.from(before.entries()).map(([id, row]) => ({ id, ...row })),
  )
  // Simulate the write: M1/M2 fill 4-30 and 5-1; F1/F2/F3 push by 2 school days.
  const written = new Map(before)
  written.set('M1', { date: '2026-04-30', scheduled_date: '2026-04-30' })
  written.set('M2', { date: '2026-05-01', scheduled_date: '2026-05-01' })
  written.set('F1', { date: '2026-05-04', scheduled_date: '2026-05-04' })
  written.set('F2', { date: '2026-05-05', scheduled_date: '2026-05-05' })
  written.set('F3', { date: '2026-05-06', scheduled_date: '2026-05-06' })
  // Undo via snapshot.
  const restored = applyUndoSnapshot(written, snapshot)
  for (const id of before.keys()) {
    assert.deepEqual(restored.get(id), before.get(id), `${id} fully restored`)
  }
})

// ── createInFlightGate ──────────────────────────────────────────────────────
//
// Locks down the regression where one user click on "Push all remaining
// lessons back one day" caused the handler to fire 2–4 times against
// already-mutated state, shifting the schedule by +2 to +4 school days.

test('createInFlightGate: tryEnter returns true once, then false until exit', () => {
  const gate = createInFlightGate()
  assert.equal(gate.tryEnter(), true,  'first attempt enters')
  assert.equal(gate.tryEnter(), false, 'second attempt is locked out')
  assert.equal(gate.tryEnter(), false, 'third attempt is locked out')
  assert.equal(gate.isBusy(),   true,  'gate reports busy while locked')
  gate.exit()
  assert.equal(gate.isBusy(),   false, 'gate reports free after exit')
  assert.equal(gate.tryEnter(), true,  'next attempt after exit enters')
})

test('createInFlightGate: exit is idempotent', () => {
  const gate = createInFlightGate()
  gate.tryEnter()
  gate.exit()
  gate.exit() // calling exit twice should be safe
  assert.equal(gate.tryEnter(), true)
})

test('createInFlightGate: rapid 4 attempts produce exactly 1 successful entry (pushAll repro)', async () => {
  // Mirrors the production failure shape: one user click that re-fired 2-4
  // times. With the gate in place, only the first invocation runs the
  // wrapped action; the rest no-op silently.
  const gate = createInFlightGate()
  let runs = 0
  async function guarded() {
    if (!gate.tryEnter()) return
    try {
      runs += 1
      // Simulate the async work (fetch + writes).
      await Promise.resolve()
    } finally {
      gate.exit()
    }
  }
  // Fire 4 attempts effectively-synchronously — the first wins, the next 3
  // hit the gate before the prior microtask completes.
  const p1 = guarded()
  const p2 = guarded()
  const p3 = guarded()
  const p4 = guarded()
  await Promise.all([p1, p2, p3, p4])
  assert.equal(runs, 1, 'wrapped action ran exactly once')
})

test('createInFlightGate: independent gates don\'t cross-block', () => {
  // The Today page uses ONE gate for all reschedule actions, but other
  // unrelated gates in the codebase must remain independent.
  const gateA = createInFlightGate()
  const gateB = createInFlightGate()
  assert.equal(gateA.tryEnter(), true)
  assert.equal(gateB.tryEnter(), true, 'gate B unaffected by gate A')
  assert.equal(gateA.tryEnter(), false)
  assert.equal(gateB.tryEnter(), false)
})

// ── planAddToNextSchoolDays density-awareness (HOTFIX 2026-04-30) ────────────
//
// Repro of the production audit: TGTB goal (lessons_per_day=1, Mon-Fri) had
// L8-L14 already forward-scheduled onto Apr 30 - May 8 when mom clicked
// "Add to my next school day(s)" on the missed banner with L2-L6. The old
// planner stacked L2 on Apr 30, L3 on May 1, etc., colliding with L8-L12.
// The fix: walk forward past dates that are already at lessons_per_day
// capacity for that goal.

// SKIPPED under queue-based scheduling (Path A, 2026-05). This test
// pinned the OLD pinned-date density-aware reshuffle behavior that the
// new model removes — there are no "missed lessons" to redistribute under
// queue projection. Re-enable on rollback.
test.skip('planAddToNextSchoolDays: missed lessons skip past forward-scheduled dates (TGTB repro)', () => {
  const today = '2026-04-29' // user-local Apr 29 (the moment of the bug)
  const schoolDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const goalId = 'tgtb'
  // Pretend L8-L14 already sit on Apr 30 - May 8.
  const density = new Map<string, number>([
    [`${goalId}|2026-04-30`, 1],
    [`${goalId}|2026-05-01`, 1],
    [`${goalId}|2026-05-04`, 1],
    [`${goalId}|2026-05-05`, 1],
    [`${goalId}|2026-05-06`, 1],
    [`${goalId}|2026-05-07`, 1],
    [`${goalId}|2026-05-08`, 1],
  ])
  const missed: ReschedulableLesson[] = [
    { id: 'L2', scheduled_date: '2026-04-16', curriculum_goal_id: goalId },
    { id: 'L3', scheduled_date: '2026-04-17', curriculum_goal_id: goalId },
    { id: 'L4', scheduled_date: '2026-04-20', curriculum_goal_id: goalId },
    { id: 'L5', scheduled_date: '2026-04-21', curriculum_goal_id: goalId },
    { id: 'L6', scheduled_date: '2026-04-22', curriculum_goal_id: goalId },
  ]
  const { updates } = planAddToNextSchoolDays(
    missed,
    () => schoolDays,
    today,
    density,
    () => 1,
  )
  // First open slot is May 11 (Mon), then May 12, May 13, May 14, May 15.
  assert.deepEqual(updates, [
    { id: 'L2', newDate: '2026-05-11' },
    { id: 'L3', newDate: '2026-05-12' },
    { id: 'L4', newDate: '2026-05-13' },
    { id: 'L5', newDate: '2026-05-14' },
    { id: 'L6', newDate: '2026-05-15' },
  ])
})

// SKIPPED under queue-based scheduling (Path A, 2026-05). Re-enable on rollback.
test.skip('planAddToNextSchoolDays: empty density map matches old behavior (no regression)', () => {
  const today = '2026-04-29'
  const schoolDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const missed: ReschedulableLesson[] = [
    { id: 'L1', scheduled_date: '2026-04-25', curriculum_goal_id: 'g1' },
    { id: 'L2', scheduled_date: '2026-04-27', curriculum_goal_id: 'g1' },
    { id: 'L3', scheduled_date: '2026-04-28', curriculum_goal_id: 'g1' },
  ]
  const { updates } = planAddToNextSchoolDays(
    missed,
    () => schoolDays,
    today,
    new Map(),
    () => 1,
  )
  assert.deepEqual(updates, [
    { id: 'L1', newDate: '2026-04-30' },
    { id: 'L2', newDate: '2026-05-01' },
    { id: 'L3', newDate: '2026-05-04' },
  ])
})

// SKIPPED under queue-based scheduling (Path A, 2026-05). Re-enable on rollback.
test.skip('planAddToNextSchoolDays: per-goal density isolates collisions', () => {
  // Goal A is full on Apr 30. Goal B has nothing. A missed lesson on goal B
  // should still land on Apr 30; only goal A is forced past.
  const today = '2026-04-29'
  const schoolDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const density = new Map<string, number>([['goalA|2026-04-30', 1]])
  const missed: ReschedulableLesson[] = [
    { id: 'A1', scheduled_date: '2026-04-22', curriculum_goal_id: 'goalA' },
    { id: 'B1', scheduled_date: '2026-04-22', curriculum_goal_id: 'goalB' },
  ]
  const { updates } = planAddToNextSchoolDays(
    missed,
    () => schoolDays,
    today,
    density,
    () => 1,
  )
  // A1 must skip past Apr 30 → May 1. B1 lands on Apr 30 (its goal is empty).
  assert.deepEqual(updates, [
    { id: 'A1', newDate: '2026-05-01' },
    { id: 'B1', newDate: '2026-04-30' },
  ])
})

// SKIPPED under queue-based scheduling (Path A, 2026-05). Re-enable on rollback.
test.skip('planAddToNextSchoolDays: lessons_per_day=2 allows two lessons per date', () => {
  const today = '2026-04-29'
  const schoolDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const density = new Map<string, number>() // empty
  const missed: ReschedulableLesson[] = [
    { id: 'L1', scheduled_date: '2026-04-25', curriculum_goal_id: 'g1' },
    { id: 'L2', scheduled_date: '2026-04-26', curriculum_goal_id: 'g1' },
    { id: 'L3', scheduled_date: '2026-04-27', curriculum_goal_id: 'g1' },
  ]
  const { updates } = planAddToNextSchoolDays(
    missed,
    () => schoolDays,
    today,
    density,
    () => 2, // two lessons per day
  )
  // L1 + L2 share Apr 30; L3 lands on May 1.
  assert.deepEqual(updates, [
    { id: 'L1', newDate: '2026-04-30' },
    { id: 'L2', newDate: '2026-04-30' },
    { id: 'L3', newDate: '2026-05-01' },
  ])
})

// SKIPPED under queue-based scheduling (Path A, 2026-05). Re-enable on rollback.
test.skip('planAddToNextSchoolDays: same-call placements increment the running map (no self-collision)', () => {
  // Two missed lessons on the same goal at lessons_per_day=1. The first
  // placement must occupy Apr 30 so the second has to walk past it.
  const today = '2026-04-29'
  const schoolDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const missed: ReschedulableLesson[] = [
    { id: 'X1', scheduled_date: '2026-04-22', curriculum_goal_id: 'g1' },
    { id: 'X2', scheduled_date: '2026-04-23', curriculum_goal_id: 'g1' },
  ]
  const { updates } = planAddToNextSchoolDays(
    missed,
    () => schoolDays,
    today,
    new Map(),
    () => 1,
  )
  assert.deepEqual(updates, [
    { id: 'X1', newDate: '2026-04-30' },
    { id: 'X2', newDate: '2026-05-01' },
  ])
})

// ── Queue-based scheduling (Path A, 2026-05) ───────────────────────────
//
// The new read model. Today / Plan project forward from
// (current_lesson, lessons_per_day, school_days) instead of querying
// pinned scheduled_date. Block of upcoming lessons shifts forward when
// mom finishes extra and shifts backward when she misses a day, with no
// reschedule write. These tests pin the new behavior.

function goalCfg(overrides: Partial<CurriculumGoalConfig> = {}): CurriculumGoalConfig {
  return {
    id: 'g1',
    total_lessons: 100,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    current_lesson: 0,
    ...overrides,
  }
}

test('queue: today on a school day for a fresh goal returns lesson 1', () => {
  const today = new Date(2026, 3, 28) // Tue Apr 28 2026
  const out = computeTodayLessons([goalCfg()], today)
  assert.deepEqual(out, [{ goal_id: 'g1', lesson_number: 1, date: '2026-04-28' }])
})

test('queue: today on a non-school day returns nothing for that goal', () => {
  const sat = new Date(2026, 4, 2) // Sat May 2 2026
  const out = computeTodayLessons([goalCfg()], sat)
  assert.deepEqual(out, [])
})

test('queue: lessons_per_day=2 places two slots today and the next two tomorrow', () => {
  const tue = new Date(2026, 3, 28)
  const goal = goalCfg({ lessons_per_day: 2 })
  const today = computeTodayLessons([goal], tue)
  assert.deepEqual(today, [
    { goal_id: 'g1', lesson_number: 1, date: '2026-04-28' },
    { goal_id: 'g1', lesson_number: 2, date: '2026-04-28' },
  ])
  // Tomorrow's view: project 2 days starting Tue 4/28 — Tue gets 1+2, Wed gets 3+4.
  const twoDays = computeNextLessonsForGoal(goal, tue, 2)
  assert.deepEqual(twoDays, [
    { goal_id: 'g1', lesson_number: 1, date: '2026-04-28' },
    { goal_id: 'g1', lesson_number: 2, date: '2026-04-28' },
    { goal_id: 'g1', lesson_number: 3, date: '2026-04-29' },
    { goal_id: 'g1', lesson_number: 4, date: '2026-04-29' },
  ])
})

test('queue: block shift forward when mom completes extra (Kendra-style overachiever)', () => {
  // Goal had current_lesson=5 yesterday. Mom completed lessons 6+7 today
  // (mark-complete advanced current_lesson to 7). Tomorrow's projection
  // must start at lesson 8 — and the projected finish moves earlier
  // compared to the not-overachieving baseline.
  const tue = new Date(2026, 3, 28) // Tue Apr 28
  const wed = new Date(2026, 3, 29) // Wed Apr 29
  const baseline = goalCfg({ current_lesson: 5, total_lessons: 20 })
  const overachieved = goalCfg({ current_lesson: 7, total_lessons: 20 })

  const tomorrow = computeNextLessonsForGoal(overachieved, wed, 1)
  assert.deepEqual(tomorrow, [
    { goal_id: 'g1', lesson_number: 8, date: '2026-04-29' },
  ])

  const finishBaseline = computeFinishDate(baseline, tue)
  const finishOverachieved = computeFinishDate(overachieved, tue)
  assert.ok(finishBaseline && finishOverachieved, 'both projections finish')
  assert.ok(
    finishOverachieved!.getTime() < finishBaseline!.getTime(),
    `overachieved finish (${toDateStr(finishOverachieved!)}) should be earlier than baseline (${toDateStr(finishBaseline!)})`,
  )
})

test('queue: block shift backward when mom misses a day (no completion = no advance)', () => {
  // current_lesson=5. Today is a school day, mom completes nothing
  // (current_lesson stays at 5). Tomorrow's projection still leads with
  // lesson 6, so the upcoming block has effectively slipped one school
  // day forward and the finish date moves out by one school day.
  const tue = new Date(2026, 3, 28)
  const wed = new Date(2026, 3, 29)
  const goal = goalCfg({ current_lesson: 5, total_lessons: 20 })

  const today = computeTodayLessons([goal], tue)
  assert.deepEqual(today, [{ goal_id: 'g1', lesson_number: 6, date: '2026-04-28' }])

  const tomorrow = computeTodayLessons([goal], wed)
  assert.deepEqual(tomorrow, [{ goal_id: 'g1', lesson_number: 6, date: '2026-04-29' }],
    'lesson 6 reappears on Wed because current_lesson never advanced')

  // Compare against a "had-completed-by-today" projection: that finishes
  // exactly one school day earlier than the missed-day projection.
  const completed = goalCfg({ current_lesson: 6, total_lessons: 20 })
  const finishMissed = computeFinishDate(goal, wed)
  const finishCompleted = computeFinishDate(completed, wed)
  assert.ok(finishMissed && finishCompleted)
  // Walk one school day from finishCompleted; should equal finishMissed.
  const expected = new Date(finishCompleted!)
  do { expected.setDate(expected.getDate() + 1) } while (!isSchoolDay(expected, goal.school_days))
  assert.equal(toDateStr(finishMissed!), toDateStr(expected),
    'finish date slips by exactly one school day')
})

test('queue: completed goal returns nothing on Today and null finish', () => {
  const today = new Date(2026, 3, 28)
  const goal = goalCfg({ current_lesson: 100, total_lessons: 100 })
  assert.deepEqual(computeTodayLessons([goal], today), [])
  assert.equal(computeFinishDate(goal, today), null)
})

test('queue: empty school_days normalizes to Mon-Fri', () => {
  assert.deepEqual(normalizeSchoolDays([]), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  assert.deepEqual(normalizeSchoolDays(null), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  assert.deepEqual(normalizeSchoolDays(undefined), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  // Non-empty arrays pass through untouched (don't pre-sort or mutate).
  assert.deepEqual(normalizeSchoolDays(['Tue', 'Thu']), ['Tue', 'Thu'])
})

test('queue: catch-up gap lists the lessons that would have been due, in order', () => {
  // 7-calendar-day gap starting Mon 2026-04-20, ending today Mon 2026-04-27.
  // Goal: current_lesson=10 at the start of the gap, lessons_per_day=1, Mon-Fri.
  // School days in the gap: Mon 4/20, Tue 4/21, Wed 4/22, Thu 4/23, Fri 4/24
  // (weekend skipped). That's 5 school days → lessons 11..15 in order.
  const gapStart = new Date(2026, 3, 20) // Mon Apr 20
  const today = new Date(2026, 3, 27)    // Mon Apr 27
  const goal = goalCfg({ current_lesson: 10, total_lessons: 100 })
  const gap = computeGapLessonsForGoal(goal, gapStart, today)
  assert.deepEqual(gap, [
    { goal_id: 'g1', lesson_number: 11, date: '2026-04-20' },
    { goal_id: 'g1', lesson_number: 12, date: '2026-04-21' },
    { goal_id: 'g1', lesson_number: 13, date: '2026-04-22' },
    { goal_id: 'g1', lesson_number: 14, date: '2026-04-23' },
    { goal_id: 'g1', lesson_number: 15, date: '2026-04-24' },
  ])
})

test('queue: computeTodayLessons aggregates across multiple goals', () => {
  // Two goals, both Mon-Fri, both at current_lesson=0. Today (Tue) returns
  // the next lesson from each goal in input order.
  const tue = new Date(2026, 3, 28)
  const out = computeTodayLessons([
    goalCfg({ id: 'math', total_lessons: 50 }),
    goalCfg({ id: 'reading', total_lessons: 30, lessons_per_day: 2 }),
  ], tue)
  assert.deepEqual(out, [
    { goal_id: 'math', lesson_number: 1, date: '2026-04-28' },
    { goal_id: 'reading', lesson_number: 1, date: '2026-04-28' },
    { goal_id: 'reading', lesson_number: 2, date: '2026-04-28' },
  ])
})

test('queue: projection stops at total_lessons even with daysAhead remaining', () => {
  const mon = new Date(2026, 3, 27) // Mon Apr 27
  const goal = goalCfg({ current_lesson: 8, total_lessons: 10, lessons_per_day: 1 })
  // 5 days ahead, but only 2 lessons remain (9, 10). Should return those
  // and stop.
  const out = computeNextLessonsForGoal(goal, mon, 5)
  assert.deepEqual(out, [
    { goal_id: 'g1', lesson_number: 9, date: '2026-04-27' },
    { goal_id: 'g1', lesson_number: 10, date: '2026-04-28' },
  ])
})

// ── lessons_per_day_overrides (Schedule Builder, 2026-05) ──────────────
//
// New per-weekday capacity map keyed by "Mon".."Sun" labels. When set, the
// projector uses that count for matching days and falls back to
// lessons_per_day for unkeyed days. Invariant 2 ("lessons_per_day is a
// hard ceiling") becomes a per-day ceiling under overrides.

test('queue: overrides bump Thursday to 2 while other days stay at 1', () => {
  // Mon Apr 27 .. Fri May 1, lessons_per_day=1 with override Thu=2.
  // Expected weekly slot count: 1+1+1+2+1 = 6.
  const mon = new Date(2026, 3, 27)
  const goal = goalCfg({
    total_lessons: 100,
    lessons_per_day: 1,
    lessons_per_day_overrides: { Thu: 2 },
  })
  const out = computeNextLessonsForGoal(goal, mon, 5)
  assert.deepEqual(out, [
    { goal_id: 'g1', lesson_number: 1, date: '2026-04-27' },
    { goal_id: 'g1', lesson_number: 2, date: '2026-04-28' },
    { goal_id: 'g1', lesson_number: 3, date: '2026-04-29' },
    { goal_id: 'g1', lesson_number: 4, date: '2026-04-30' },
    { goal_id: 'g1', lesson_number: 5, date: '2026-04-30' },
    { goal_id: 'g1', lesson_number: 6, date: '2026-05-01' },
  ])
})

test('queue: full M..F override map wins over lessons_per_day', () => {
  // {"Mon":1,"Tue":1,"Wed":1,"Thu":2,"Fri":1} with lessons_per_day=99.
  // The lessons_per_day fallback should never be consulted because every
  // active weekday is keyed.
  const mon = new Date(2026, 3, 27)
  const goal = goalCfg({
    total_lessons: 100,
    lessons_per_day: 99,
    lessons_per_day_overrides: { Mon: 1, Tue: 1, Wed: 1, Thu: 2, Fri: 1 },
  })
  const out = computeNextLessonsForGoal(goal, mon, 5)
  assert.equal(out.length, 6, 'six slots in the week — Thursday is the only doubled day')
  assert.deepEqual(out.map((l) => l.date), [
    '2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', '2026-04-30', '2026-05-01',
  ])
})

test('queue: override of 0 on a school day produces nothing for that day', () => {
  // Mom uses Tuesday for co-op only — 0 home lessons on Tue, 1 on others.
  // Tuesday remains in school_days (so the day is "in session" for other
  // goals / activities), but THIS goal doesn't generate a slot there.
  const mon = new Date(2026, 3, 27)
  const goal = goalCfg({
    lessons_per_day: 1,
    lessons_per_day_overrides: { Tue: 0 },
  })
  const out = computeNextLessonsForGoal(goal, mon, 5)
  assert.deepEqual(out, [
    { goal_id: 'g1', lesson_number: 1, date: '2026-04-27' }, // Mon
    // Tue skipped
    { goal_id: 'g1', lesson_number: 2, date: '2026-04-29' }, // Wed
    { goal_id: 'g1', lesson_number: 3, date: '2026-04-30' }, // Thu
    { goal_id: 'g1', lesson_number: 4, date: '2026-05-01' }, // Fri
  ])
})

test('queue: null/undefined overrides preserves prior lessons_per_day behavior', () => {
  // Regression guard: callers that don't set the overrides field must see
  // exactly the pre-overrides projection.
  const mon = new Date(2026, 3, 27)
  const goal = goalCfg({ lessons_per_day: 2 })
  const baseline = computeNextLessonsForGoal(goal, mon, 1)
  const withNull = computeNextLessonsForGoal(
    { ...goal, lessons_per_day_overrides: null },
    mon,
    1,
  )
  assert.deepEqual(withNull, baseline, 'null overrides matches absent overrides')
})

test('queue: computeFinishDate honors per-day overrides', () => {
  // 21 lessons at 6/week (Thu=2, M/T/W/F=1) starting Mon Apr 27.
  // Week 1 covers lessons 1-6 (finishes Fri May 1).
  // Week 2 covers 7-12 (finishes Fri May 8).
  // Week 3 covers 13-18 (finishes Fri May 15).
  // Week 4 covers 19-21: Mon=19, Tue=20, Wed=21 → finish Wed May 20.
  const mon = new Date(2026, 3, 27)
  const goal = goalCfg({
    total_lessons: 21,
    lessons_per_day: 1,
    lessons_per_day_overrides: { Thu: 2 },
  })
  const finish = computeFinishDate(goal, mon)
  assert.ok(finish, 'finish date is non-null')
  assert.equal(toDateStr(finish!), '2026-05-20')
})

test('queue: override on a day NOT in school_days has no effect', () => {
  // school_days excludes Saturday. Override sets Sat=5. The cursor never
  // lands on a Saturday because isSchoolDayIdx gates it out, so the
  // override never fires and the projection remains Mon-Fri at 1/day.
  const mon = new Date(2026, 3, 27)
  const goal = goalCfg({
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    lessons_per_day_overrides: { Sat: 5 },
  })
  const out = computeNextLessonsForGoal(goal, mon, 7)
  assert.deepEqual(out.map((l) => l.date), [
    '2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01',
  ])
})

// ── Vacation blocks (Path A queue scheduling, 2026-05) ─────────────────
//
// Brittany's product rule: "i need the vacation thing to work so that
// needs to go into tonights fixes so it knows to skip break days
// entirely. now i know break sometimes means catch up.. so extra
// classes should be able to be logged on those days by the user but not
// scheduled by the system."
//
// Forward projection skips break days. Mark-complete is never blocked
// (that path doesn't go through the projector). Catch-up gap excludes
// break days so mom never gets asked "did you do lessons during your
// beach trip?".

test('isBreakDay: matches inclusive on both ends, no match outside', () => {
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  assert.equal(isBreakDay(new Date(2026, 4, 3),  blocks), false, 'day before break')
  assert.equal(isBreakDay(new Date(2026, 4, 4),  blocks), true,  'first break day')
  assert.equal(isBreakDay(new Date(2026, 4, 6),  blocks), true,  'middle of break')
  assert.equal(isBreakDay(new Date(2026, 4, 8),  blocks), true,  'last break day')
  assert.equal(isBreakDay(new Date(2026, 4, 9),  blocks), false, 'day after break')
  assert.equal(isBreakDay(new Date(2026, 4, 6), null),     false, 'no blocks → no break')
  assert.equal(isBreakDay(new Date(2026, 4, 6), []),       false, 'empty blocks → no break')
})

test('vacation: no break leaves projection unchanged', () => {
  const tue = new Date(2026, 3, 28)
  const goal = goalCfg({ current_lesson: 0, total_lessons: 5 })
  const withoutBlocks = computeNextLessonsForGoal(goal, tue, 14)
  const withEmptyBlocks = computeNextLessonsForGoal(goal, tue, 14, [])
  assert.deepEqual(withEmptyBlocks, withoutBlocks)
})

test('vacation: 5-day break pushes those lessons past the break and the finish moves out 5 calendar days', () => {
  // Goal: 10 lessons, lessons_per_day=1, Mon-Fri. Starts Mon Apr 27 2026.
  // Break: Mon May 4 - Fri May 8 (5 school days).
  // Without break: lessons 1-5 land Mon-Fri Apr 27 - May 1; lessons 6-10
  //   land Mon-Fri May 4 - May 8. Finish = May 8.
  // With break: lessons 1-5 still land Apr 27 - May 1; the May 4-May 8
  //   week gets skipped; lessons 6-10 land Mon-Fri May 11 - May 15.
  //   Finish = May 15. That's 7 calendar days later (5 school days +
  //   the weekend in between).
  const mon = new Date(2026, 3, 27) // Mon Apr 27
  const goal = goalCfg({ current_lesson: 0, total_lessons: 10, lessons_per_day: 1 })
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]

  const noBreak = computeNextLessonsForGoal(goal, mon, 30)
  assert.equal(noBreak.length, 10)
  assert.equal(noBreak[5].date, '2026-05-04', 'baseline lesson 6 lands on Mon May 4')
  assert.equal(noBreak[9].date, '2026-05-08', 'baseline lesson 10 lands on Fri May 8')

  const withBreak = computeNextLessonsForGoal(goal, mon, 30, blocks)
  assert.equal(withBreak.length, 10)
  assert.equal(withBreak[5].date, '2026-05-11', 'lesson 6 pushed to Mon May 11')
  assert.equal(withBreak[9].date, '2026-05-15', 'lesson 10 pushed to Fri May 15')

  const finishNoBreak = computeFinishDate(goal, mon)
  const finishWithBreak = computeFinishDate(goal, mon, blocks)
  assert.equal(toDateStr(finishNoBreak!), '2026-05-08')
  assert.equal(toDateStr(finishWithBreak!), '2026-05-15')
})

test('vacation: today inside a break returns nothing for that goal', () => {
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const wedDuringBreak = new Date(2026, 4, 6) // Wed May 6 — middle of break
  const goal = goalCfg({ current_lesson: 4, total_lessons: 20 })
  const today = computeTodayLessons([goal], wedDuringBreak, blocks)
  assert.deepEqual(today, [])
})

test('vacation: mom logs a lesson during a break — projection picks up day after break and starts one lesson later', () => {
  // Goal at current_lesson=4, total=20, Mon-Fri, perDay=1. Break Mon
  // May 4 - Fri May 8. Mom completes lesson 5 on Wed May 6 (mid-break),
  // which the projector doesn't see — recomputeCurrentLesson advances
  // current_lesson to 5 directly.
  // Tomorrow's projection (Thu May 7, still mid-break): nothing.
  // Day-after-break projection (Mon May 11): lesson 6 leads.
  // Without her break-day log, lesson 5 would lead on May 11 instead.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const monAfterBreak = new Date(2026, 4, 11) // Mon May 11

  const beforeLog = goalCfg({ current_lesson: 4, total_lessons: 20 })
  const afterLog  = goalCfg({ current_lesson: 5, total_lessons: 20 })

  const before = computeNextLessonsForGoal(beforeLog, monAfterBreak, 1, blocks)
  const after  = computeNextLessonsForGoal(afterLog,  monAfterBreak, 1, blocks)
  assert.deepEqual(before, [{ goal_id: 'g1', lesson_number: 5, date: '2026-05-11' }])
  assert.deepEqual(after,  [{ goal_id: 'g1', lesson_number: 6, date: '2026-05-11' }])
})

test('vacation: catch-up gap entirely inside a break returns nothing (modal does not appear)', () => {
  // Mom finished lesson 4 on Sat May 2. Family went on break Sun May 3 -
  // Sat May 9. Today is Sun May 10. The 7-day gap from Sun May 3 to Sat
  // May 9 is entirely inside the break + weekend, so no school days
  // were "missed" — modal must not appear.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-03', end_date: '2026-05-09' }]
  const gapStart = new Date(2026, 4, 3)  // Sun May 3
  const today = new Date(2026, 4, 10)    // Sun May 10
  const goal = goalCfg({ current_lesson: 4, total_lessons: 20 })
  const gap = computeGapLessonsForGoal(goal, gapStart, today, blocks)
  assert.deepEqual(gap, [])
})

// ── Verification round 1 bug fixes (PR #48 follow-up, 2026-05-01) ─────
//
// Each test pins one of the bugs Brittany hit on the Vercel preview and
// asserts the queue projector returns the right shape. The wiring (which
// surface calls which function with which inputs) is covered by hand via
// the preview verification; these tests pin the function-level contracts.

test('bug 3: calendar projection is anchored to today, not the visible month start', () => {
  // Repro from preview verification: the calendar day-detail panel
  // showed today's queue numbers on tomorrow's cell when the visible
  // month started AFTER today. Root cause: caller passed projStart =
  // ms (May 1) and current_lesson = 94, so the projector treated May 1
  // as the first allocation slot — re-placing today's lessons (Apr 30
  // → 95) onto May 1.
  // Fix is at the caller boundary (loaders project from today, then
  // filter to the visible range). This test pins the projector contract
  // we depend on: starting at today=Apr 30, May 1 must be slot 2 of
  // the queue (lesson 96) not slot 1 (lesson 95).
  const today = new Date(2026, 3, 30) // Thu Apr 30 2026
  const goal = goalCfg({ current_lesson: 94, total_lessons: 200, lessons_per_day: 1 })
  const out = computeNextLessonsForGoal(goal, today, 7)
  // Apr 30 (Thu) = 95, May 1 (Fri) = 96, weekend skipped, Mon May 4 = 97,
  //   Tue May 5 = 98, Wed May 6 = 99
  assert.deepEqual(out, [
    { goal_id: 'g1', lesson_number: 95, date: '2026-04-30' },
    { goal_id: 'g1', lesson_number: 96, date: '2026-05-01' },
    { goal_id: 'g1', lesson_number: 97, date: '2026-05-04' },
    { goal_id: 'g1', lesson_number: 98, date: '2026-05-05' },
    { goal_id: 'g1', lesson_number: 99, date: '2026-05-06' },
  ])
})

test('bug 3: starting from a future date with stale current_lesson is the bug we eliminated', () => {
  // Documents the off-by-one. Caller passing projStart = May 1 (the
  // visible month start) with current_lesson still at 94 causes May 1
  // to be filled with lesson 95, which IS today's allocation. This is
  // the broken pattern; loaders must NOT do this.
  const may1 = new Date(2026, 4, 1)
  const goal = goalCfg({ current_lesson: 94, total_lessons: 200, lessons_per_day: 1 })
  const buggy = computeNextLessonsForGoal(goal, may1, 7)
  assert.equal(buggy[0].lesson_number, 95, 'projecting from a future date with un-advanced current_lesson re-places today\'s lessons there — the bug')
  assert.equal(buggy[0].date, '2026-05-01', 'May 1 gets today\'s queue lesson, off-by-one')
})

test('bug 4: finish date computed from current_lesson, not from MAX(scheduled_date)', () => {
  // Repro: Plan curriculum cards showed "On track to finish May 30"
  // for Emma LA with 94 done of 120, but should finish May 26 (94 done,
  // 26 remaining, 1/day Mon-Fri, starting May 1).
  // computeFinishDate uses current_lesson + total_lessons + lessons_per_day
  // + school_days, which is the live queue truth. Cache scheduled_date
  // doesn't enter the calculation.
  const may1 = new Date(2026, 4, 1) // Fri May 1
  const goal = goalCfg({ current_lesson: 94, total_lessons: 120, lessons_per_day: 1 })
  // 26 remaining at 1/day Mon-Fri starting Fri May 1.
  // School days from Fri May 1: Fri 1, Mon 4, Tue 5, Wed 6, Thu 7, Fri 8, Mon 11, Tue 12, Wed 13, Thu 14,
  //   Fri 15, Mon 18, Tue 19, Wed 20, Thu 21, Fri 22, Mon 25, Tue 26, Wed 27, Thu 28, Fri 29,
  //   Mon Jun 1, Tue 2, Wed 3, Thu 4, Fri 5
  // That's 26 school days; the 26th is Fri Jun 5.
  const finish = computeFinishDate(goal, may1)
  assert.equal(toDateStr(finish!), '2026-06-05', 'finish date follows the queue, not the cache')
})

test('bug 1+2: Log Extra modal pool excludes today\'s allocation but includes everything else', () => {
  // Repro: Log Extra was offering today's current allocation (Emma LA
  // 95 on a Tuesday) by reading scheduled_date directly. The new
  // contract: project from today with the real current_lesson, then
  // drop entries dated today. What remains is the future pool the
  // modal can offer — one entry per (goal, lesson_number, projected_date).
  const today = new Date(2026, 4, 1) // Fri May 1
  const todayKey = '2026-05-01'
  const goal = goalCfg({ current_lesson: 94, total_lessons: 100, lessons_per_day: 1 })
  // Project 22 days from today, drop today.
  const all = computeNextLessonsForGoal(goal, today, 22)
  const pool = all.filter((p) => p.date !== todayKey)
  // Today (Fri May 1) is goal\'s lesson 95 — must be excluded from pool.
  assert.equal(pool.find((p) => p.lesson_number === 95), undefined, 'today\'s allocation is excluded')
  // The next entry (May 4 Mon) is lesson 96 — must be the first pool item.
  assert.equal(pool[0].lesson_number, 96)
  assert.equal(pool[0].date, '2026-05-04')
})

test('bug 1+2: on a non-school day or break, today\'s allocation is empty and the pool starts at lesson current+1', () => {
  // Edge case: today is Saturday (or in a break). computeNextLessons
  // returns nothing for today, so the "drop today" filter is a no-op
  // and the first pool item is lesson_number = current_lesson + 1 on
  // the next school day.
  const sat = new Date(2026, 4, 2) // Sat May 2 — non-school day
  const todayKey = '2026-05-02'
  const goal = goalCfg({ current_lesson: 94, total_lessons: 100, lessons_per_day: 1 })
  const pool = computeNextLessonsForGoal(goal, sat, 22).filter((p) => p.date !== todayKey)
  // First school day after Sat May 2 with Mon-Fri schedule = Mon May 4 = lesson 95.
  assert.equal(pool[0].lesson_number, 95, 'pool starts at lesson 95 — today consumed nothing')
  assert.equal(pool[0].date, '2026-05-04')
})

test('bug 5: Past tab grouping by kid → subject → lesson_number desc preserves a clean per-subject sequence', () => {
  // Repro: within a date the rows alternated kid/subject. Brittany
  // wants per-subject grouping with descending lesson_number.
  // This test pins the sort order the renderer applies.
  type Row = { id: string; child_id: string; subject: string; lesson_number: number | null; scheduled_date: string }
  const rows: Row[] = [
    { id: 'a', child_id: 'emma', subject: 'LA',   lesson_number: 88, scheduled_date: '2026-04-28' },
    { id: 'b', child_id: 'emma', subject: 'Math', lesson_number: 84, scheduled_date: '2026-04-28' },
    { id: 'c', child_id: 'zoe',  subject: 'LA',   lesson_number: 75, scheduled_date: '2026-04-28' },
    { id: 'd', child_id: 'zoe',  subject: 'Math', lesson_number: 83, scheduled_date: '2026-04-28' },
    { id: 'e', child_id: 'emma', subject: 'LA',   lesson_number: 89, scheduled_date: '2026-04-29' },
    { id: 'f', child_id: 'emma', subject: 'LA',   lesson_number: 90, scheduled_date: '2026-04-30' },
    { id: 'g', child_id: 'emma', subject: 'Math', lesson_number: 85, scheduled_date: '2026-04-29' },
    { id: 'h', child_id: 'zoe',  subject: 'LA',   lesson_number: 76, scheduled_date: '2026-04-29' },
  ]
  // Apply the renderer's grouping + sort: kid asc, then subject group,
  // then lesson_number desc within subject.
  const byKid = new Map<string, Row[]>()
  for (const r of rows) {
    const k = byKid.get(r.child_id) ?? []
    k.push(r); byKid.set(r.child_id, k)
  }
  const orderedKids = Array.from(byKid.keys()).sort()
  const out: { kid: string; subject: string; lessonNumbers: number[] }[] = []
  for (const kid of orderedKids) {
    const bySubj = new Map<string, Row[]>()
    for (const r of byKid.get(kid)!) {
      const s = bySubj.get(r.subject) ?? []
      s.push(r); bySubj.set(r.subject, s)
    }
    for (const subject of Array.from(bySubj.keys()).sort()) {
      const items = bySubj.get(subject)!.slice().sort((a, b) => (b.lesson_number ?? 0) - (a.lesson_number ?? 0))
      out.push({ kid, subject, lessonNumbers: items.map((r) => r.lesson_number!) })
    }
  }
  assert.deepEqual(out, [
    { kid: 'emma', subject: 'LA',   lessonNumbers: [90, 89, 88] },
    { kid: 'emma', subject: 'Math', lessonNumbers: [85, 84] },
    { kid: 'zoe',  subject: 'LA',   lessonNumbers: [76, 75] },
    { kid: 'zoe',  subject: 'Math', lessonNumbers: [83] },
  ])
})

// ── Verification round 2 bug fixes (PR #48 follow-up #2, 2026-05-01) ──

test('bug A: Upcoming tab projection skips today and starts at lesson current+lessons_per_day+1', () => {
  // Repro: Upcoming tab showed Sat May 2 lesson_number = 95 when today
  // was Fri May 1 with current_lesson = 94. Lesson 95 is today's
  // allocation; Saturday should be lesson 96.
  // Fix pattern (matches Log Extra modal): project from today, drop
  // entries dated today. Today's allocation thereby leaves the pool
  // and the next entry starts at lesson_number = current_lesson + 1
  // shifted forward by today's slots.
  const friday = new Date(2026, 4, 1) // Fri May 1 2026
  const todayKey = '2026-05-01'
  const goal = goalCfg({
    current_lesson: 94,
    total_lessons: 200,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], // 7-day school
  })
  const pool = computeNextLessonsForGoal(goal, friday, 15)
    .filter((p) => p.date !== todayKey)
  // First pool item lands on Sat May 2 with lesson 96 (NOT 95).
  assert.equal(pool[0].date, '2026-05-02')
  assert.equal(pool[0].lesson_number, 96)
  // Sun May 3 is also a school day → lesson 97.
  assert.equal(pool[1].date, '2026-05-03')
  assert.equal(pool[1].lesson_number, 97)
})

test('bug A: Upcoming on a non-school day → today consumed nothing → pool starts at current+1', () => {
  // Sat May 2 with Mon-Fri schedule. Today is non-school, today
  // consumed zero allocation, so the drop-today filter is a no-op
  // and the first pool item is lesson_number = current_lesson + 1
  // on the next school day.
  const sat = new Date(2026, 4, 2) // Sat May 2 — not a school day
  const todayKey = '2026-05-02'
  const goal = goalCfg({
    current_lesson: 94,
    total_lessons: 200,
    lessons_per_day: 1,
  })
  const pool = computeNextLessonsForGoal(goal, sat, 15)
    .filter((p) => p.date !== todayKey)
  assert.equal(pool[0].date, '2026-05-04', 'next school day')
  assert.equal(pool[0].lesson_number, 95, 'lesson 95 because today consumed nothing')
})

test('bug B: Past tab date label uses completed_at, never a stale future scheduled_date', () => {
  // Repro: completed Emma LA lesson 91 displayed "Tomorrow" in the
  // Past tab because the row's pre-pinned scheduled_date was in the
  // future. Fix: use completed_at (sliced to YYYY-MM-DD) as the date
  // label source. Fall back to updated_at, then scheduled_date.
  type Row = { id: string; completed_at: string | null; updated_at: string | null; scheduled_date: string }
  function dateLabelDate(l: Row): string {
    const ts = l.completed_at ?? l.updated_at ?? null
    return ts ? ts.slice(0, 10) : l.scheduled_date
  }

  const completed = { id: 'L91', completed_at: '2026-04-28T15:30:00Z', updated_at: '2026-04-28T15:30:01Z', scheduled_date: '2026-05-02' }
  assert.equal(dateLabelDate(completed), '2026-04-28', 'completed_at wins over future scheduled_date')

  const completedAtNull = { id: 'L91', completed_at: null, updated_at: '2026-04-27T10:00:00Z', scheduled_date: '2026-05-02' }
  assert.equal(dateLabelDate(completedAtNull), '2026-04-27', 'updated_at fallback when completed_at is missing')

  const bothNull = { id: 'L91', completed_at: null, updated_at: null, scheduled_date: '2026-05-02' }
  assert.equal(dateLabelDate(bothNull), '2026-05-02', 'scheduled_date fallback when both timestamps are missing')
})

test('bug C: Plan lesson cards derive their tint from the kid color, not a global sage-green', () => {
  // The render code passes the lesson's child_id → child.color into
  // tintFromHex/darkenHex. Two different kids must produce two
  // different card backgrounds for the same goal_id / subject. This
  // test pins the call-site contract — that the renderer keys tint by
  // child color, not by subject.
  function tint(hex: string, opacity: number): string {
    // mirror of lib/color-tint.tintFromHex semantics so this test
    // doesn't depend on importing browser-only helpers
    const h = hex.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const tr = Math.round(r * opacity + 255 * (1 - opacity))
    const tg = Math.round(g * opacity + 255 * (1 - opacity))
    const tb = Math.round(b * opacity + 255 * (1 - opacity))
    return `#${tr.toString(16).padStart(2, '0')}${tg.toString(16).padStart(2, '0')}${tb.toString(16).padStart(2, '0')}`
  }
  const emmaColor = '#9b6bff'
  const zoeColor = '#ff8a3c'
  const emmaBg = tint(emmaColor, 0.25)
  const zoeBg = tint(zoeColor, 0.25)
  assert.notEqual(emmaBg, zoeBg, 'two kids → two distinct tinted backgrounds')
  // The fallback color (no kid set) must match what the Plan renderer
  // uses so unassigned lessons render the same neutral tint they
  // always have.
  const fallback = tint('#7a6f65', 0.25)
  assert.ok(/^#[0-9a-f]{6}$/.test(fallback), 'fallback tint produces a valid hex')
})

test('vacation: catch-up gap mixing school days and break days only checkboxes the school days', () => {
  // Mom finished lesson 9 on Fri May 1. Today is Mon May 11. The gap is
  // Sat May 2 through Sun May 10 (9 calendar days). Family was on break
  // Mon May 4 - Fri May 8 (5 school days). The school days that were
  // genuinely missed: only Mon May 11... wait, Mon May 11 IS today.
  // School days inside the gap (Sat May 2 → Sun May 10):
  //   Sat May 2  — weekend, not school
  //   Sun May 3  — weekend, not school
  //   Mon May 4  — break
  //   Tue May 5  — break
  //   Wed May 6  — break
  //   Thu May 7  — break
  //   Fri May 8  — break
  //   Sat May 9  — weekend, not school
  //   Sun May 10 — weekend, not school
  // So the entire "missed" portion is break + weekends → 0 entries.
  // We need a gap that has at least one school day on either side of
  // the break. Adjust: gapStart = Thu Apr 30 (school day pre-break),
  // today = Mon May 11 (school day post-break). School days "missed":
  //   Thu Apr 30, Fri May 1 (pre-break) — 2 school days
  //   Then break May 4 - May 8 — skipped
  //   Mon May 11 is today, excluded.
  // Goal current_lesson at start of gap = 7; expects lessons 8, 9 on
  // those two pre-break school days.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const gapStart = new Date(2026, 3, 30) // Thu Apr 30
  const today = new Date(2026, 4, 11)    // Mon May 11
  const goal = goalCfg({ current_lesson: 7, total_lessons: 20 })
  const gap = computeGapLessonsForGoal(goal, gapStart, today, blocks)
  assert.deepEqual(gap, [
    { goal_id: 'g1', lesson_number: 8, date: '2026-04-30' },
    { goal_id: 'g1', lesson_number: 9, date: '2026-05-01' },
  ])
})

// ── Lessons-per-day quota fix (production hotfix, 2026-05-01) ──────────
//
// Production bug: completing a lesson advanced current_lesson, then the
// 15-second poll re-projected today and current_lesson + 1 was the next
// queue lesson, pulling a fresh card onto Today every time mom marked
// complete. Real-world users walked themselves 7+ lessons forward in an
// hour because each new card felt obligatory.
// Fix: the projector accepts a completedTodayCount and anchors today's
// slots to (current_lesson - completedTodayCount + 1), holding today's
// slot list stable across mark-complete actions.

test('hotfix: completing one lesson today does not pull the next onto today (perDay=1)', () => {
  const friday = new Date(2026, 4, 1) // Fri May 1 2026
  const goal = goalCfg({ current_lesson: 5, total_lessons: 30, lessons_per_day: 1 })
  // Mom just finished lesson 5 → current_lesson=5, completedToday=1
  const result = computeTodayLessons([goal], friday, undefined, new Map([['g1', 1]]))
  assert.deepEqual(result, [
    { goal_id: 'g1', lesson_number: 5, date: '2026-05-01' },
  ], 'today still shows lesson 5 (the completed one), not lesson 6')
})

test('hotfix: lessons_per_day=2 with one done shows checked + unchecked, not two unchecked', () => {
  const friday = new Date(2026, 4, 1)
  const goal = goalCfg({ current_lesson: 5, total_lessons: 30, lessons_per_day: 2 })
  // Lesson 5 done, lesson 6 still pending. completedToday=1.
  const result = computeTodayLessons([goal], friday, undefined, new Map([['g1', 1]]))
  assert.deepEqual(result, [
    { goal_id: 'g1', lesson_number: 5, date: '2026-05-01' },
    { goal_id: 'g1', lesson_number: 6, date: '2026-05-01' },
  ])
})

test('hotfix: first day includes completed-today, future days continue from queue position', () => {
  const friday = new Date(2026, 4, 1) // Fri May 1
  const goal = goalCfg({ current_lesson: 5, total_lessons: 30, lessons_per_day: 1 })
  // 7 days ahead, 1 lesson already done today. Today emits lesson 5
  // (the completed slot); Mon-Thu of next week emit 6, 7, 8, 9.
  const result = computeNextLessonsForGoal(goal, friday, 7, undefined, 1)
  assert.deepEqual(result, [
    { goal_id: 'g1', lesson_number: 5, date: '2026-05-01' },
    { goal_id: 'g1', lesson_number: 6, date: '2026-05-04' },
    { goal_id: 'g1', lesson_number: 7, date: '2026-05-05' },
    { goal_id: 'g1', lesson_number: 8, date: '2026-05-06' },
    { goal_id: 'g1', lesson_number: 9, date: '2026-05-07' },
  ])
})

test('hotfix: computeFinishDate subtracts completed-today from today\'s slot allocation', () => {
  // current_lesson=8 means lesson 8 was just completed; total=10 leaves
  // 2 lessons (9 and 10) remaining. Today is Fri May 1. With
  // completedToday=1, today contributes 0 usable slots. Lesson 9
  // lands Mon May 4, lesson 10 lands Tue May 5. Without the fix,
  // today would have absorbed lesson 9 and finish would drift to Mon.
  const friday = new Date(2026, 4, 1)
  const goal = goalCfg({ current_lesson: 8, total_lessons: 10, lessons_per_day: 1 })
  const finish = computeFinishDate(goal, friday, undefined, 1)
  assert.equal(toDateStr(finish!), '2026-05-05')
})

test('hotfix regression: rapid mark-complete clicks do not advance Today\'s slot', () => {
  // Simulates the production bug. Goal at current_lesson=4. Click
  // through. The projector must return the same lesson_number on
  // every render after the completion, not the next-in-queue.
  const friday = new Date(2026, 4, 1)
  const baseGoal = goalCfg({ current_lesson: 4, total_lessons: 30, lessons_per_day: 1 })

  // Initial render: nothing completed today, today shows lesson 5.
  let result = computeTodayLessons([baseGoal], friday, undefined, new Map())
  assert.deepEqual(result, [{ goal_id: 'g1', lesson_number: 5, date: '2026-05-01' }])

  // After completing lesson 5: current_lesson=5, completedToday=1.
  // Today STILL shows lesson 5 (now checked, but the same slot).
  const advancedGoal = goalCfg({ current_lesson: 5, total_lessons: 30, lessons_per_day: 1 })
  result = computeTodayLessons([advancedGoal], friday, undefined, new Map([['g1', 1]]))
  assert.deepEqual(result, [{ goal_id: 'g1', lesson_number: 5, date: '2026-05-01' }],
    'second render returns the same lesson_number, not lesson 6')

  // 15-second poll re-firing returns the same again, stable.
  result = computeTodayLessons([advancedGoal], friday, undefined, new Map([['g1', 1]]))
  assert.deepEqual(result, [{ goal_id: 'g1', lesson_number: 5, date: '2026-05-01' }])
})

test('hotfix: omitting completedTodayPerGoal preserves prior behavior (callers projecting from past dates)', () => {
  // computeGapLessonsForGoal projects from a past date for the catch-up
  // modal. completedTodayCount is irrelevant there, the default of 0
  // must keep the projector emitting current_lesson + 1 on the first
  // school day of the gap.
  const friday = new Date(2026, 4, 1)
  const goal = goalCfg({ current_lesson: 5, total_lessons: 30, lessons_per_day: 1 })
  // No completedToday map passed → defaults to 0 → today shows lesson 6.
  const result = computeTodayLessons([goal], friday, undefined)
  assert.deepEqual(result, [{ goal_id: 'g1', lesson_number: 6, date: '2026-05-01' }],
    'no map → behaves identically to prior callsites')
})

// ── CurriculumWizard preview math: vacation_blocks honored ─────────────
//
// The wizard's Step 3 finish-date and required-per-day previews walk
// dates forward from forwardScheduleStart. After the May 2026 hardening
// they correctly skip non-school-days; this round adds vacation-block
// skipping so the preview matches the actual lesson generator (which
// already skipped break days). The inline simulators below mirror the
// wizard's calcFinishDate / calcRequiredPerDay loops exactly so the
// test reflects component behavior without booting a JSX environment.

type WizardBlock = { start_date: string; end_date: string }
function isInBlocks(dateStr: string, blocks: WizardBlock[]): boolean {
  return blocks.some((b) => dateStr >= b.start_date && dateStr <= b.end_date)
}

function simulateCalcFinishDate(input: {
  remaining: number
  perDay: number
  schoolDays: boolean[]   // Mon=0..Sun=6
  startDate: Date
  today: Date
  vacationBlocks: WizardBlock[]
}): string | null {
  const { remaining, perDay, schoolDays, startDate, today, vacationBlocks } = input
  if (remaining === 0 || perDay <= 0 || !schoolDays.some(Boolean)) return null
  const daysNeeded = Math.ceil(remaining / perDay)
  let cnt = 0
  const cursor = forwardScheduleStart(startDate, today)
  let safety = 0
  while (cnt < daysNeeded && safety < 3650) {
    const dayIdx = (cursor.getDay() + 6) % 7
    const dateStr = toDateStr(cursor)
    if (schoolDays[dayIdx] && !isInBlocks(dateStr, vacationBlocks)) cnt++
    if (cnt < daysNeeded) cursor.setDate(cursor.getDate() + 1)
    safety++
  }
  return toDateStr(cursor)
}

function simulateCalcRequiredPerDay(input: {
  remaining: number
  schoolDays: boolean[]
  startDate: Date
  targetDate: Date
  vacationBlocks: WizardBlock[]
}): number | null {
  const { remaining, schoolDays, startDate, targetDate, vacationBlocks } = input
  if (!schoolDays.some(Boolean) || remaining === 0) return null
  if (targetDate < startDate) return null
  let schoolDayCount = 0
  const cursor = new Date(startDate)
  let safety = 0
  while (cursor <= targetDate && safety < 3650) {
    const dayIdx = (cursor.getDay() + 6) % 7
    const dateStr = toDateStr(cursor)
    if (schoolDays[dayIdx] && !isInBlocks(dateStr, vacationBlocks)) schoolDayCount++
    cursor.setDate(cursor.getDate() + 1)
    safety++
  }
  return schoolDayCount > 0 ? Math.ceil(remaining / schoolDayCount) : null
}

test('wizard preview: calcFinishDate without vacation blocks finishes on Fri Jun 12', () => {
  // 30 lessons, perDay=1, Mon-Fri, start May 1 2026 (Friday).
  // forwardScheduleStart bumps May 1 → May 2 (Sat). Cursor walks to first
  // school day after that: Mon May 4 = lesson 1. 30 weekdays of Mon-Fri
  // walking from May 4 inclusive lands the 30th on Fri Jun 12 2026.
  const result = simulateCalcFinishDate({
    remaining: 30,
    perDay: 1,
    schoolDays: [true, true, true, true, true, false, false],
    startDate: new Date(2026, 4, 1),
    today: new Date(2026, 4, 1),
    vacationBlocks: [],
  })
  assert.equal(result, '2026-06-12', 'baseline: no vacation, 30 weekdays from May 4')
})

test('wizard preview: calcFinishDate skips vacation blocks (May 3-17 pushes finish to Jun 26)', () => {
  // Same setup as above, plus a vacation block May 3-17 inclusive.
  // The vacation contains 10 weekdays (Mon May 4-Fri May 8 plus Mon
  // May 11-Fri May 15). Cursor skips them; lesson 1 lands on Mon May 18,
  // 30th on Fri Jun 26 2026, exactly the 10-school-day shift we expect.
  const result = simulateCalcFinishDate({
    remaining: 30,
    perDay: 1,
    schoolDays: [true, true, true, true, true, false, false],
    startDate: new Date(2026, 4, 1),
    today: new Date(2026, 4, 1),
    vacationBlocks: [{ start_date: '2026-05-03', end_date: '2026-05-17' }],
  })
  assert.equal(result, '2026-06-26', 'vacation pushes finish out by 10 school days')
})

test('wizard preview: calcFinishDate with vacation outside the projection window unchanged', () => {
  // Sanity: a vacation that ends BEFORE the projection window starts has
  // no effect. Apr 1-15 is fully past Fri May 1 and the forward walk.
  const noVac = simulateCalcFinishDate({
    remaining: 30, perDay: 1,
    schoolDays: [true, true, true, true, true, false, false],
    startDate: new Date(2026, 4, 1), today: new Date(2026, 4, 1),
    vacationBlocks: [],
  })
  const pastVac = simulateCalcFinishDate({
    remaining: 30, perDay: 1,
    schoolDays: [true, true, true, true, true, false, false],
    startDate: new Date(2026, 4, 1), today: new Date(2026, 4, 1),
    vacationBlocks: [{ start_date: '2026-04-01', end_date: '2026-04-15' }],
  })
  assert.equal(pastVac, noVac, 'past vacations are no-ops')
})

test('wizard preview: calcRequiredPerDay raises the rate when vacation blocks consume school days', () => {
  // 30 remaining lessons, target Jun 26 2026, Mon-Fri school days, start
  // May 1. Without vacation: Fri May 1 through Fri Jun 26 contains 41
  // weekdays. 30 / 41 = 0.73 → ceil = 1.
  const without = simulateCalcRequiredPerDay({
    remaining: 30,
    schoolDays: [true, true, true, true, true, false, false],
    startDate: new Date(2026, 4, 1),
    targetDate: new Date(2026, 5, 26),
    vacationBlocks: [],
  })
  assert.equal(without, 1, 'baseline: 41 weekdays, 30 lessons → 1/day suffices')

  // With vacation May 3-17 (10 weekdays consumed): 31 usable school days
  // → 30 / 31 → ceil = 1. Need a tighter target to see the rate change.
  // Target May 22 has only 16 weekdays (May 1, 4-8, 11-15, 18-22), drop
  // the 10 vacation weekdays leaves 6 usable → ceil(30/6) = 5/day.
  const tightWith = simulateCalcRequiredPerDay({
    remaining: 30,
    schoolDays: [true, true, true, true, true, false, false],
    startDate: new Date(2026, 4, 1),
    targetDate: new Date(2026, 4, 22),
    vacationBlocks: [{ start_date: '2026-05-03', end_date: '2026-05-17' }],
  })
  assert.equal(tightWith, 5, 'vacation consumes 10 school days from a 16-day window')
})

// ---------------------------------------------------------------------------
// Timezone helpers (Invariant 9). These exercise app/lib/timezone.ts directly
// and pass without any scheduler-internal changes. They are the early signal
// that the test runner is wired up correctly for the new module.
// ---------------------------------------------------------------------------

test('todayInTz returns YYYY-MM-DD for valid IANA tz', () => {
  assert.match(todayInTz('America/New_York'), /^\d{4}-\d{2}-\d{2}$/)
})

test('todayInTz falls back to America/New_York for null', () => {
  assert.strictEqual(todayInTz(null), todayInTz('America/New_York'))
})

test('isoDowFromYmd returns 1=Mon..7=Sun', () => {
  assert.strictEqual(isoDowFromYmd('2026-05-04'), 1)
  assert.strictEqual(isoDowFromYmd('2026-05-10'), 7)
})

test('addDays handles month rollover', () => {
  assert.strictEqual(addDays('2026-05-31', 1), '2026-06-01')
})

// ===========================================================================
// Invariant tests (CC #2). Each test below corresponds to one of Invariants
// 1-10 in docs/CURRICULUM-SCHEDULING.md. Invariant 8 is structural ("one
// shared pickNextAvailableDate helper") and is verified by the targeted
// grep tests at the very bottom of this file plus reading scheduler.ts.
// ===========================================================================

// Helper: load a source file from the repo root for static-analysis tests.
// `npm test` and `node --test` both run from repo root so process.cwd() is
// the right anchor.
function loadRepoFile(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), 'utf-8')
}

// Helper: extract the body of a function declaration by name. Uses a
// brace-depth scan so nested braces (object literals, etc.) are handled.
function extractFunctionBody(src: string, signaturePattern: RegExp): string {
  const m = src.match(signaturePattern)
  if (!m) throw new Error(`function not found: ${signaturePattern}`)
  const start = src.indexOf('{', m.index! + m[0].length - 1)
  if (start < 0) throw new Error(`opening brace not found for ${signaturePattern}`)
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start + 1, i)
    }
  }
  throw new Error(`closing brace not found for ${signaturePattern}`)
}

// ── Invariant 2 — queue scheduler ceiling (May 3 regression) ──────────────

test('Invariant 2 — queue scheduler honors lessons_per_day with future start_date (160 lessons, lpd=1, school_days=Mon-Thu, start_date=2026-08-05, today=2026-05-01)', () => {
  // Project forward from the future start_date and assert max-per-date == 1.
  // computeNextLessonsForGoal projects from `fromDate`, which the wizard
  // generate path seeds with `forwardScheduleStart(start_date, today)` —
  // when start_date is in the future, that returns start_date.
  const goal: CurriculumGoalConfig = {
    id: 'wild-math',
    total_lessons: 160,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu'],
    current_lesson: 0,
  }
  const startDate = new Date(2026, 7, 5) // Wed Aug 5 2026
  const projected = computeNextLessonsForGoal(goal, startDate, 365)
  assert.ok(projected.length > 0, 'expected projection to produce lessons')
  // First lesson lands ON the start_date (which is a Wed = school day).
  assert.strictEqual(projected[0].date, '2026-08-05')
  assert.strictEqual(projected[0].lesson_number, 1)
  // No date holds more than 1 lesson.
  const counts = new Map<string, number>()
  for (const p of projected) counts.set(p.date, (counts.get(p.date) ?? 0) + 1)
  for (const [d, c] of counts) assert.ok(c <= 1, `${d} has ${c} lessons (lpd=1)`)
  // Every date is Mon-Thu.
  for (const p of projected) {
    const dow = isoDowFromYmd(p.date)
    assert.ok([1, 2, 3, 4].includes(dow), `${p.date} is dow ${dow}, not Mon-Thu`)
  }
})

test('Invariant 2 — vacation block insert re-spreads incomplete forwards without bunching (max per-date stays <= lessons_per_day)', () => {
  // Simulate ann13mchale's repro: 30 incomplete forward lessons, lpd=2,
  // school_days=[Mon,Wed], a 4-week vacation that overlaps half of them.
  // planRescheduleLessons should re-spread the in-vacation subset onto
  // post-vacation Mon/Wed slots with max-per-date == 2.
  const goalId = 'g1'
  const allForward = Array.from({ length: 30 }, (_, i) => ({
    id: `l${i + 1}`,
    curriculum_goal_id: goalId,
    // Every lesson dated 2026-06-01 onward, packed Mon/Wed at lpd=2.
    // 30 lessons / 2 per day = 15 school days = 7.5 weeks.
    date: '', // filled below
  }))
  // Pre-compute Mon/Wed dates and stack two lessons per date.
  const monWed: string[] = []
  for (let i = 0; monWed.length < 15; i++) {
    const d = addDays('2026-05-31', i) // 2026-05-31 is Sun, walk forward
    const dow = isoDowFromYmd(d)
    if (dow === 1 || dow === 3) monWed.push(d)
  }
  for (let i = 0; i < 30; i++) allForward[i].date = monWed[Math.floor(i / 2)]

  // Vacation: 2026-06-15 → 2026-07-12 (4 weeks). Covers Mon/Wed in that range.
  const vacStart = '2026-06-15'
  const vacEnd = '2026-07-12'
  const inVac = allForward.filter(l => l.date >= vacStart && l.date <= vacEnd)
  const staying = allForward.filter(l => !(l.date >= vacStart && l.date <= vacEnd))
  assert.ok(inVac.length > 0, 'expected some lessons inside the vacation')

  const result = planRescheduleLessons({
    toReshuffle: inVac.map(l => ({ id: l.id, curriculum_goal_id: l.curriculum_goal_id })),
    staying: staying.map(s => ({ curriculum_goal_id: s.curriculum_goal_id, date: s.date })),
    goalConfigs: new Map([[goalId, { school_days: ['Mon', 'Wed'], lessons_per_day: 2 }]]),
    startAfterDate: vacEnd,
    vacations: [{ start: vacStart, end: vacEnd }],
  })

  // Combine staying + new placements, count per date.
  const after = new Map<string, number>()
  for (const s of staying) after.set(s.date, (after.get(s.date) ?? 0) + 1)
  for (const u of result.updates) after.set(u.newDate, (after.get(u.newDate) ?? 0) + 1)

  // Max per date <= lpd = 2.
  for (const [d, c] of after) assert.ok(c <= 2, `${d} has ${c} lessons (lpd=2)`)
  // No new placement lands inside the vacation.
  for (const u of result.updates) {
    assert.ok(u.newDate > vacEnd, `${u.id} placed at ${u.newDate}, not strictly after ${vacEnd}`)
    assert.ok(u.newDate < vacStart || u.newDate > vacEnd, `${u.id} placed inside vacation`)
  }
  // Every new placement is Mon or Wed (ISO 1 or 3).
  for (const u of result.updates) {
    const dow = isoDowFromYmd(u.newDate)
    assert.ok([1, 3].includes(dow), `${u.newDate} is dow ${dow}, not Mon/Wed`)
  }
  // Every original in-vacation lesson got moved.
  assert.strictEqual(result.updates.length, inVac.length)
})

test('Invariant 2 — catch-up modal accept handles 5 missed school days without bunching (max per-date = lpd)', () => {
  // computeGapLessonsForGoal must list one lesson per missed school day at
  // lpd=1, never doubling up. This is the data the catch-up modal renders
  // and writes back via handleCatchUpSubmit (one row per checked entry).
  const goal: CurriculumGoalConfig = {
    id: 'g1',
    total_lessons: 100,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    current_lesson: 10, // mom's at lesson 10 going into the gap
  }
  // Gap = Mon Apr 27 .. Mon May 4 = 5 missed school days (Mon-Fri Apr 27-May 1).
  const gapStart = new Date(2026, 3, 27) // Mon Apr 27
  const today = new Date(2026, 4, 4)     // Mon May 4
  const gap = computeGapLessonsForGoal(goal, gapStart, today)
  assert.strictEqual(gap.length, 5, `expected 5 missed lessons, got ${gap.length}`)
  // Each entry on its own date — max per-date = 1.
  const counts = new Map<string, number>()
  for (const g of gap) counts.set(g.date, (counts.get(g.date) ?? 0) + 1)
  for (const [d, c] of counts) assert.strictEqual(c, 1, `${d} has ${c} entries (lpd=1)`)
  // Lesson numbers are 11..15 in order.
  assert.deepStrictEqual(gap.map(g => g.lesson_number), [11, 12, 13, 14, 15])
})

// ── Invariant 3 — historical backfill stays put ────────────────────────────

test('Invariant 3 — backfilled lessons unchanged after vacation block insert', () => {
  // Static analysis: saveVacationBlock must filter out is_backfill rows
  // before passing lessons to planRescheduleLessons. The actual filter is
  // `r.is_backfill !== true` in the client-side reducer.
  const src = loadRepoFile('app/dashboard/plan/page.tsx')
  const body = extractFunctionBody(src, /async function saveVacationBlock\s*\(/)
  assert.ok(
    body.includes('is_backfill !== true'),
    'saveVacationBlock must filter out is_backfill rows from the re-spread',
  )
  // And it must operate on planRescheduleLessons (Invariant 8) so backfill
  // exclusion logic is centralized at the input filter, not the planner.
  assert.ok(
    body.includes('planRescheduleLessons('),
    'saveVacationBlock must route through planRescheduleLessons',
  )
})

test('Invariant 3 — backfilled lessons unchanged after Missed Lesson Recovery YES', () => {
  // Static analysis: handleMissedRecoveryYes only writes to rows it
  // identifies by (curriculum_goal_id, queue_position) for entries projected
  // by computeGapLessonsForGoal. It must NOT bulk-update forward-dated
  // lessons or scan by is_backfill, so backfilled rows are safe by
  // construction.
  const src = loadRepoFile('app/dashboard/page.tsx')
  const body = extractFunctionBody(src, /async function handleMissedRecoveryYes\s*\(/)
  // Sanity: the function does call from("lessons").update, but only inside
  // the per-entry loop, with .eq("id", ...). It does not run a bulk UPDATE.
  assert.ok(body.includes('for (const entry of allEntries)'), 'YES must iterate per entry')
  // And it must scope each write by id (not by goal_id + completed=false).
  assert.ok(
    !/\.update\([\s\S]*?\)\.eq\("curriculum_goal_id"/.test(body),
    'YES must not run a bulk update by curriculum_goal_id',
  )
})

// ── Invariant 6 — completed_at on goals is monotonic ──────────────────────

test('Invariant 6 — goal.completed_at preserved when last lesson is later marked incomplete', () => {
  // monotonicCompletedAt is the canonical helper enforcing this invariant.
  // Once a value is set, it stays set even if the candidate is null.
  const t = '2026-04-30T18:00:00Z'
  assert.strictEqual(monotonicCompletedAt(t, null), t)
  assert.strictEqual(monotonicCompletedAt(t, undefined), t)
  assert.strictEqual(monotonicCompletedAt(t, '2026-05-01T18:00:00Z'), t)
  // Null prev + valid candidate → write the candidate.
  assert.strictEqual(monotonicCompletedAt(null, t), t)
  // Null prev + null candidate → null.
  assert.strictEqual(monotonicCompletedAt(null, null), null)
})

// ── Invariant 7 — completion / dismiss is local ───────────────────────────

test('Invariant 7 — Missed Lesson Recovery NO does not write to lessons table (session-only dismissal)', () => {
  // The NO path is a true no-op against the DB. Under Path A queue
  // scheduling, the projector already absorbs missed lessons into the
  // upcoming schedule going forward from today, so NO does not need to
  // re-date or touch any lesson row. It only flips the per-tab session
  // flag that gates re-show.
  const src = loadRepoFile('app/dashboard/page.tsx')
  const body = extractFunctionBody(src, /async function handleMissedRecoveryNo\s*\(/)
  assert.ok(
    !body.includes('from("lessons")'),
    'handleMissedRecoveryNo must not write to the lessons table',
  )
  assert.ok(
    body.includes('markMissedRecoveryShown'),
    'handleMissedRecoveryNo must call markMissedRecoveryShown to gate re-show',
  )
})

test('Invariant 7 — marking a single lesson complete only touches that lesson, and pins its scheduled_date to today', () => {
  // confirmCheckOff is the Today-page lesson-completion handler. The
  // structural "no other rows touched" guarantee comes from the
  // .eq("id", lesson.id) filter — we assert the .update().eq("id", ...)
  // shape directly. The payload now pins scheduled_date / date to today
  // on completion so a future-scheduled row doesn't ghost back onto its
  // original calendar slot (sync-scheduled_date fix).
  const src = loadRepoFile('app/dashboard/page.tsx')
  const body = extractFunctionBody(src, /async function confirmCheckOff\s*\(/)
  const updateMatch = body.match(/from\("lessons"\)\.update\(\s*\{([\s\S]*?)\}\s*\)\.eq\(\s*"id"/)
  assert.ok(updateMatch, 'confirmCheckOff must call from("lessons").update(...).eq("id", ...)')
  const payload = updateMatch[1]
  assert.ok(/\bcompleted\s*:\s*true\b/.test(payload), 'payload sets completed: true')
  assert.ok(/\bcompleted_at\s*:/.test(payload), 'payload sets completed_at')
  assert.ok(/\bscheduled_date\s*:\s*today\b/.test(payload), 'payload pins scheduled_date to today')
  assert.ok(/\bdate\s*:\s*today\b/.test(payload), 'payload pins date to today')
})

// ── Invariant 9 — every "today" is in the user's timezone ─────────────────

test('Invariant 9 — todayInTz returns user-local date, never server UTC clock', () => {
  // todayInTz delegates to ymdInTz with `new Date()`. Asserting the format
  // and the supported timezones round-trip is sufficient — the explicit
  // pacific-vs-eastern test below covers the cross-timezone divergence.
  const v = todayInTz('America/Los_Angeles')
  assert.match(v, /^\d{4}-\d{2}-\d{2}$/)
  // ymdInTz with a fixed instant must produce the same shape.
  const ny = ymdInTz(new Date('2026-05-15T16:30:00Z'), 'America/New_York')
  assert.strictEqual(ny, '2026-05-15')
})

test('Invariant 9 — Pacific user and Eastern user at same UTC instant (late-evening Pacific) produce different "today" dates', () => {
  // 2026-05-04 06:30 UTC = 2026-05-03 23:30 PT (still Sun for Pacific) and
  // 2026-05-04 02:30 ET (already Mon for Eastern). Same UTC instant, two
  // different "today" dates depending on tz — exactly the bug Invariant 9
  // prevents.
  const utcInstant = new Date('2026-05-04T06:30:00Z')
  const pacific = ymdInTz(utcInstant, 'America/Los_Angeles')
  const eastern = ymdInTz(utcInstant, 'America/New_York')
  assert.strictEqual(pacific, '2026-05-03')
  assert.strictEqual(eastern, '2026-05-04')
  assert.notStrictEqual(pacific, eastern)
})

test('Invariant 9 — null/missing profiles.timezone falls back to America/New_York with no crash', () => {
  // Null and undefined and "" all fall back. The fallback must not crash.
  const ref = todayInTz('America/New_York')
  assert.strictEqual(todayInTz(null), ref)
  assert.strictEqual(todayInTz(undefined), ref)
  assert.strictEqual(todayInTz(''), ref)
  // Same with the pure helper.
  const fixed = new Date('2026-05-15T12:00:00Z')
  assert.strictEqual(ymdInTz(fixed, null), ymdInTz(fixed, 'America/New_York'))
  assert.strictEqual(ymdInTz(fixed, undefined), ymdInTz(fixed, 'America/New_York'))
})

// ── Invariant 10 — scheduled_source is set on every lesson date write ─────

test("Invariant 10 — schedule builder save writes scheduled_source='wizard_create' on every new lesson row", () => {
  // The legacy CurriculumWizard had two creation paths (generate +
  // saveEdit) tagging wizard_create / wizard_edit. The Schedule Builder
  // (May 2026) collapsed both into one idempotent save flow on the new
  // /dashboard/plan/schedule page: pre-checks existing lesson_numbers,
  // INSERTs only the missing rows. There is no separate wizard_edit
  // path under the queue model — UPDATEs in handleSave touch
  // curriculum_goals.archived / activities.is_active only, never
  // lessons.scheduled_date.
  const src = loadRepoFile('app/dashboard/plan/schedule/page.tsx')
  const body = extractFunctionBody(src, /async function handleSave\s*\(/)
  const matches = (body.match(/scheduled_source:\s*"wizard_create"/g) || []).length
  assert.ok(
    matches >= 1,
    `expected scheduled_source='wizard_create' on the schedule builder lesson INSERT; found ${matches}`,
  )
  // No other source label leaks into the create path.
  assert.ok(
    !body.includes('scheduled_source: "wizard_edit"'),
    'handleSave must not write wizard_edit; the schedule builder has one save path',
  )
})

test("Invariant 10 — vacation block insert writes scheduled_source='vacation_resched' on touched rows", () => {
  const src = loadRepoFile('app/dashboard/plan/page.tsx')
  const body = extractFunctionBody(src, /async function saveVacationBlock\s*\(/)
  assert.ok(
    body.includes('scheduled_source: "vacation_resched"'),
    'saveVacationBlock must tag scheduled_source=vacation_resched on the re-spread update',
  )
})

test("Invariant 10 — Missed Lesson Recovery YES writes scheduled_source='catchup_resched' on touched rows", () => {
  const src = loadRepoFile('app/dashboard/page.tsx')
  const body = extractFunctionBody(src, /async function handleMissedRecoveryYes\s*\(/)
  // The YES handler writes both via UPDATE (existing row) and INSERT
  // (fallback when the row is missing). Both must tag catchup_resched.
  const matches = (body.match(/scheduled_source:\s*"catchup_resched"/g) || []).length
  assert.ok(matches >= 2, `expected scheduled_source='catchup_resched' at least twice (update + insert); found ${matches}`)
})

test('Invariant 10 — no code path leaves scheduled_source NULL after writing lessons.date', () => {
  // For each of the four post-CC#2 trigger sites, confirm that every
  // lessons.update / lessons.insert that touches scheduled_date or date
  // also names scheduled_source somewhere in the same payload.
  const sites: { file: string; fn: RegExp }[] = [
    { file: 'app/dashboard/plan/schedule/page.tsx', fn: /async function handleSave\s*\(/ },
    { file: 'app/dashboard/plan/page.tsx',          fn: /async function saveVacationBlock\s*\(/ },
    { file: 'app/dashboard/page.tsx',               fn: /async function handleMissedRecoveryYes\s*\(/ },
    { file: 'app/dashboard/page.tsx',               fn: /async function skipRestOfToday\s*\(/ },
  ]
  for (const site of sites) {
    const src = loadRepoFile(site.file)
    const body = extractFunctionBody(src, site.fn)
    // Find every object literal containing scheduled_date or date as a key
    // and assert it ALSO contains scheduled_source. This is a coarse check
    // (object-literal-aware), good enough to catch a forgotten tag.
    const objLiterals = body.match(/\{[^{}]*\bscheduled_date\s*:[^{}]*\}/g) || []
    for (const lit of objLiterals) {
      // Skip TS type-annotation and type-cast literals. These appear in
      // `let foo: { id: string; scheduled_date: string | null; ... }` (annotation)
      // and `... as { scheduled_date: string }[]` (cast on a query READ).
      if (/:\s*\b(string|number|boolean|Date|null|undefined)\b(\s*\|\s*\w+)*/.test(lit)) continue
      // Skip explicit clears (scheduled_date: null) — those are un-scheduling
      // actions, not date writes that need a source label.
      if (/scheduled_date:\s*null/.test(lit)) continue
      assert.ok(
        /\bscheduled_source\b/.test(lit),
        `${site.file} ${site.fn} payload writes scheduled_date without scheduled_source: ${lit.slice(0, 200)}`,
      )
    }
  }
})

// ── skipRestOfToday — explicit coverage (May 3 second buggy path) ─────────

test("Invariant 10 — skipRestOfToday writes scheduled_source='skip_today' on every UPDATE", () => {
  const src = loadRepoFile('app/dashboard/page.tsx')
  const body = extractFunctionBody(src, /async function skipRestOfToday\s*\(/)
  assert.ok(
    body.includes('scheduled_source: "skip_today"'),
    'skipRestOfToday must tag scheduled_source=skip_today on the re-spread update',
  )
  // And it must NOT contain a per-lesson cursor reset (the May 3 bug shape).
  assert.ok(
    !body.includes('const cur = new Date(today + "T12:00:00")'),
    'skipRestOfToday must not contain the per-lesson cursor reset that caused bunching',
  )
})

test('Invariant 8 — saveVacationBlock and skipRestOfToday route through planRescheduleLessons (no direct day-walk loops)', () => {
  // Both pre-May-3 buggy sites must now go through the shared planner.
  const planSrc = loadRepoFile('app/dashboard/plan/page.tsx')
  const dashSrc = loadRepoFile('app/dashboard/page.tsx')
  const vacBody = extractFunctionBody(planSrc, /async function saveVacationBlock\s*\(/)
  const skipBody = extractFunctionBody(dashSrc, /async function skipRestOfToday\s*\(/)
  assert.ok(vacBody.includes('planRescheduleLessons('), 'saveVacationBlock must call planRescheduleLessons')
  assert.ok(skipBody.includes('planRescheduleLessons('), 'skipRestOfToday must call planRescheduleLessons')
  // And both must honor the kill switch.
  assert.ok(vacBody.includes('isQueueEnabled()'), 'saveVacationBlock must honor isQueueEnabled()')
  assert.ok(skipBody.includes('isQueueEnabled()'), 'skipRestOfToday must honor isQueueEnabled()')
})

// ── pickNextAvailableDate / planRescheduleLessons unit tests ──────────────

test('pickNextAvailableDate respects capacity, vacations, and school days', () => {
  const occupancy = new Map<string, number>()
  // Mon-Thu, lpd=2, vacation 2026-05-04 to 2026-05-08, fromDate exclusive 2026-05-01 (Fri).
  const args = {
    schoolDays: [1, 2, 3, 4],
    lessonsPerDay: 2,
    vacations: [{ start: '2026-05-04', end: '2026-05-08' }],
    occupancy,
  }
  // First pick from 2026-05-01: skip Sat-Sun + the full vac week + Fri,
  // first valid is Mon 2026-05-11.
  assert.strictEqual(pickNextAvailableDate({ ...args, fromDate: '2026-05-01' }), '2026-05-11')
  // Second pick from same fromDate: lpd=2 lets us stack on May 11.
  assert.strictEqual(pickNextAvailableDate({ ...args, fromDate: '2026-05-01' }), '2026-05-11')
  // Third pick: May 11 full, advance to next valid (Tue May 12).
  assert.strictEqual(pickNextAvailableDate({ ...args, fromDate: '2026-05-01' }), '2026-05-12')
})

test('schoolDayLabelsToIso converts labels and falls back to Mon-Fri on empty/null', () => {
  assert.deepStrictEqual(schoolDayLabelsToIso(['Mon', 'Wed', 'Fri']), [1, 3, 5])
  assert.deepStrictEqual(schoolDayLabelsToIso(['Sun', 'Sat']), [7, 6])
  assert.deepStrictEqual(schoolDayLabelsToIso(null), [1, 2, 3, 4, 5])
  assert.deepStrictEqual(schoolDayLabelsToIso([]), [1, 2, 3, 4, 5])
  assert.deepStrictEqual(schoolDayLabelsToIso(undefined), [1, 2, 3, 4, 5])
})

test('isQueueEnabled defaults to true when env var is unset', () => {
  // The env var is intentionally NOT set during local test runs. The kill
  // switch must default to true so production behavior is unaffected.
  delete process.env.NEXT_PUBLIC_SCHEDULER_QUEUE_ENABLED
  assert.strictEqual(isQueueEnabled(), true)
  process.env.NEXT_PUBLIC_SCHEDULER_QUEUE_ENABLED = 'false'
  assert.strictEqual(isQueueEnabled(), false)
  process.env.NEXT_PUBLIC_SCHEDULER_QUEUE_ENABLED = 'true'
  assert.strictEqual(isQueueEnabled(), true)
  delete process.env.NEXT_PUBLIC_SCHEDULER_QUEUE_ENABLED
})

// ── CC #2.5 — May 3 smoke-run regressions ─────────────────────────────────

test('Invariant 1 — vacation re-spread shifts ALL future lessons of affected goals forward, not just the in-vacation lessons', () => {
  // Repro of the SMOKE TEST goal Brittany hit on 2026-05-03:
  //   30 lessons cached June 1 → July 10 (M-F, 1/day). Vacation June 8-14
  //   with "Shift everything forward". Old impl reshuffled only lessons 6-10
  //   (in-vacation) and parked them on July 13-17, AFTER lessons 11-30 that
  //   stayed put. Lesson 6 on July 13 came AFTER lesson 30 on July 10 —
  //   broken Invariant 1.
  // New contract: every incomplete lesson on/after vacStart of an affected
  // goal moves together, lesson_number order preserved.
  const goalId = 'smoke-test'
  // Build the cached-by-wizard date for each lesson 1..30 (Mon-Fri starting
  // Mon 2026-06-01).
  const cachedDates: string[] = []
  for (let i = 0; cachedDates.length < 30; i++) {
    const d = addDays('2026-06-01', i)
    const dow = isoDowFromYmd(d)
    if (dow >= 1 && dow <= 5) cachedDates.push(d)
  }
  const allForward = cachedDates.map((d, i) => ({
    id: `L${i + 1}`,
    curriculum_goal_id: goalId,
    lesson_number: i + 1,
    scheduled_date: d,
  }))
  // Sanity: lesson 6 cached on Mon 2026-06-08, lesson 30 cached on Fri 2026-07-10.
  assert.strictEqual(allForward[5].scheduled_date, '2026-06-08')
  assert.strictEqual(allForward[29].scheduled_date, '2026-07-10')

  const vacStart = '2026-06-08'
  const vacEnd = '2026-06-14'

  // Replicate the saveVacationBlock partition under the new semantic.
  const affectedGoalIds = new Set(
    allForward.filter(r => r.scheduled_date >= vacStart && r.scheduled_date <= vacEnd).map(r => r.curriculum_goal_id),
  )
  const inVac = allForward.filter(
    r => affectedGoalIds.has(r.curriculum_goal_id) && r.scheduled_date >= vacStart,
  )
  const inVacIds = new Set(inVac.map(r => r.id))
  const staying = allForward.filter(r => !inVacIds.has(r.id))

  // Sanity: 25 lessons (6..30) move; 5 lessons (1..5) stay.
  assert.strictEqual(inVac.length, 25)
  assert.strictEqual(staying.length, 5)

  const result = planRescheduleLessons({
    toReshuffle: inVac.map(r => ({
      id: r.id,
      curriculum_goal_id: r.curriculum_goal_id,
      lesson_number: r.lesson_number,
    })),
    staying: staying.map(s => ({ curriculum_goal_id: s.curriculum_goal_id, date: s.scheduled_date })),
    goalConfigs: new Map([[goalId, { school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], lessons_per_day: 1 }]]),
    startAfterDate: addDays(vacStart, -1),
    vacations: [{ start: vacStart, end: vacEnd }],
  })

  // Build a lookup keyed by lesson id → new date.
  const newDateById = new Map(result.updates.map(u => [u.id, u.newDate]))

  // Calendar-date order must match lesson_number order (Invariant 1).
  // Lesson 6 → first school day strictly after vacation = Mon June 15.
  assert.strictEqual(newDateById.get('L6'), '2026-06-15')
  // Lesson 11 → second post-break week starts Mon June 22.
  assert.strictEqual(newDateById.get('L11'), '2026-06-22')
  // Lesson 30 → last lesson lands on Fri July 17 (5-school-day shift from
  // the cached July 10).
  assert.strictEqual(newDateById.get('L30'), '2026-07-17')

  // Lessons 1-5 stay put (they were before vacStart).
  assert.deepStrictEqual(
    staying.map(s => s.scheduled_date),
    ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'],
  )

  // No moved lesson lands inside the break.
  for (const u of result.updates) {
    assert.ok(
      u.newDate < vacStart || u.newDate > vacEnd,
      `${u.id} placed at ${u.newDate}, inside vacation ${vacStart}..${vacEnd}`,
    )
  }
  // Max-per-date <= 1 (lessons_per_day).
  const counts = new Map<string, number>()
  for (const u of result.updates) counts.set(u.newDate, (counts.get(u.newDate) ?? 0) + 1)
  for (const [d, c] of counts) assert.ok(c <= 1, `${d} has ${c} lessons (lpd=1)`)
})

test('planRescheduleLessons sorts by lesson_number even when input order is shuffled', () => {
  // The vacation re-spread sends a goal's lessons through the planner.
  // If the caller forgot to sort by lesson_number, the planner must do it
  // anyway — Invariant 1 cannot depend on caller hygiene.
  const goalId = 'g1'
  const result = planRescheduleLessons({
    toReshuffle: [
      // Deliberately scrambled: 30, 6, 15, 7, 20.
      { id: 'L30', curriculum_goal_id: goalId, lesson_number: 30 },
      { id: 'L6',  curriculum_goal_id: goalId, lesson_number: 6 },
      { id: 'L15', curriculum_goal_id: goalId, lesson_number: 15 },
      { id: 'L7',  curriculum_goal_id: goalId, lesson_number: 7 },
      { id: 'L20', curriculum_goal_id: goalId, lesson_number: 20 },
    ],
    staying: [],
    goalConfigs: new Map([[goalId, { school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], lessons_per_day: 1 }]]),
    startAfterDate: addDays('2026-06-08', -1), // start at 2026-06-08
    vacations: [],
  })
  // Output order should follow lesson_number ASC: L6, L7, L15, L20, L30.
  assert.deepStrictEqual(result.updates.map(u => u.id), ['L6', 'L7', 'L15', 'L20', 'L30'])
  // Dates climb monotonically.
  for (let i = 1; i < result.updates.length; i++) {
    assert.ok(
      result.updates[i].newDate > result.updates[i - 1].newDate,
      `${result.updates[i].id} on ${result.updates[i].newDate} should be after ${result.updates[i - 1].id} on ${result.updates[i - 1].newDate}`,
    )
  }
})

test('Bug B — projector respects goal.start_date for future-dated goals', () => {
  // Repro: SMOKE TEST goal with start_date = 2026-06-01 (future), today =
  // 2026-05-03. lessons_per_day=1, school_days=Mon-Fri, total=30.
  // Old behavior: cursor = today → lesson 1 lands on Mon 2026-05-04, the
  // visible Plan calendar then shows fewer June lessons than expected
  // because lessons 1-19 are placed before start_date.
  // New behavior: cursor jumps to start_date when start_date > fromDate.
  const today = new Date(2026, 4, 3) // Sun May 3 2026
  const goal: CurriculumGoalConfig = {
    id: 'smoke-test',
    total_lessons: 30,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    current_lesson: 0,
    start_date: '2026-06-01',
  }
  // Project 90 days from today — covers May, June, July.
  const projected = computeNextLessonsForGoal(goal, today, 90)

  // First lesson lands on the start_date (Mon June 1), NOT on May 4.
  assert.strictEqual(projected[0].lesson_number, 1)
  assert.strictEqual(projected[0].date, '2026-06-01')
  // Lesson 5 → Fri June 5.
  assert.strictEqual(projected[4].lesson_number, 5)
  assert.strictEqual(projected[4].date, '2026-06-05')
  // No lesson placed before start_date.
  for (const p of projected) {
    assert.ok(p.date >= '2026-06-01', `lesson ${p.lesson_number} on ${p.date} placed before start_date`)
  }
})

test('Bug B — projector ignores start_date when start_date is null/undefined (legacy goals)', () => {
  // Backward compat: goals from before the start_date column lacked it
  // and the projector behavior must be unchanged for them.
  const today = new Date(2026, 4, 3) // Sun May 3 2026
  const goal: CurriculumGoalConfig = {
    id: 'legacy',
    total_lessons: 5,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    current_lesson: 0,
    start_date: null,
  }
  const projected = computeNextLessonsForGoal(goal, today, 14)
  // First school day on/after Sun May 3 is Mon May 4.
  assert.strictEqual(projected[0].date, '2026-05-04')
})

test('Bug B — projector ignores start_date when start_date is in the past (already-started goal)', () => {
  // start_date in the past means "the family began this curriculum on that
  // day". We don't want to rewind the cursor to the past; current_lesson
  // is the live position.
  const today = new Date(2026, 4, 3) // Sun May 3 2026
  const goal: CurriculumGoalConfig = {
    id: 'started',
    total_lessons: 50,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    current_lesson: 10,
    start_date: '2026-04-01', // started a month ago
  }
  const projected = computeNextLessonsForGoal(goal, today, 14)
  // First lesson is current_lesson + 1 = 11, dated on the next school day
  // on/after today (Mon May 4).
  assert.strictEqual(projected[0].lesson_number, 11)
  assert.strictEqual(projected[0].date, '2026-05-04')
})

test('Bug A end-to-end — verification dates from the prompt match', () => {
  // The four spot checks from the CC #2.5 prompt:
  //   lesson 1 → June 1, lesson 5 → June 5,
  //   lesson 6 → June 15 (first school day after vacation),
  //   lesson 11 → June 22, lesson 30 → July 17.
  // This test combines Bug B (projector start_date) and Bug A (vacation
  // re-spread of all future lessons). Build the cache as if the wizard had
  // already laid lessons 1-30 on June 1-July 10 with no vacation, then
  // simulate inserting the vacation block.
  const goalId = 'smoke-test'
  const cachedDates: string[] = []
  for (let i = 0; cachedDates.length < 30; i++) {
    const d = addDays('2026-06-01', i)
    const dow = isoDowFromYmd(d)
    if (dow >= 1 && dow <= 5) cachedDates.push(d)
  }
  const allForward = cachedDates.map((d, i) => ({
    id: `L${i + 1}`,
    curriculum_goal_id: goalId,
    lesson_number: i + 1,
    scheduled_date: d,
  }))
  // Pre-vacation expectations (cache only).
  assert.strictEqual(allForward[0].scheduled_date,  '2026-06-01') // lesson 1
  assert.strictEqual(allForward[4].scheduled_date,  '2026-06-05') // lesson 5

  const vacStart = '2026-06-08'
  const vacEnd = '2026-06-14'
  const inVac = allForward.filter(r => r.scheduled_date >= vacStart) // affected goal: all >= vacStart move
  const staying = allForward.filter(r => r.scheduled_date < vacStart)

  const result = planRescheduleLessons({
    toReshuffle: inVac.map(r => ({ id: r.id, curriculum_goal_id: r.curriculum_goal_id, lesson_number: r.lesson_number })),
    staying: staying.map(s => ({ curriculum_goal_id: s.curriculum_goal_id, date: s.scheduled_date })),
    goalConfigs: new Map([[goalId, { school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], lessons_per_day: 1 }]]),
    startAfterDate: addDays(vacStart, -1),
    vacations: [{ start: vacStart, end: vacEnd }],
  })
  const newDateById = new Map(result.updates.map(u => [u.id, u.newDate]))

  // Post-vacation expectations.
  assert.strictEqual(newDateById.get('L6'),  '2026-06-15')
  assert.strictEqual(newDateById.get('L11'), '2026-06-22')
  assert.strictEqual(newDateById.get('L30'), '2026-07-17')
})

// ─── Vacation-aware "missed lesson" calculations ───────────────────────────
//
// Production bug: lessons sitting on a date that falls inside a
// vacation_block were appearing in the Plan page's "missed lessons"
// banner. Vacation should EXCLUDE those days from the schedule, not
// flag them as missed. The lesson is effectively pushed forward to
// the next school day after the vacation ends.
//
// `isVacationDay`, `isDueDate`, `effectiveDueDate`, and
// `isLessonMissed` exist so the same vacation rule applies everywhere
// — Today page, Plan page, progress reports — without each call site
// rolling its own.

test('isVacationDay: accepts string or Date and is inclusive on both ends', () => {
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  assert.equal(isVacationDay('2026-05-03', blocks), false, 'string: day before')
  assert.equal(isVacationDay('2026-05-04', blocks), true,  'string: first break day')
  assert.equal(isVacationDay('2026-05-08', blocks), true,  'string: last break day')
  assert.equal(isVacationDay('2026-05-09', blocks), false, 'string: day after')
  assert.equal(isVacationDay(new Date(2026, 4, 6), blocks), true, 'Date: middle of break')
  assert.equal(isVacationDay('2026-05-06', null),  false, 'null blocks')
  assert.equal(isVacationDay('2026-05-06', []),    false, 'empty blocks')
})

test('isDueDate: a vacation day is not a due date even if school_days includes that weekday', () => {
  // Wed May 6 2026 is a Wednesday — a school day for Mon-Fri families —
  // but it is inside the vacation block, so no work is "due" that day.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const monFri = { school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }
  assert.equal(isDueDate('2026-05-06', monFri, blocks), false, 'Wed inside vacation')
  assert.equal(isDueDate('2026-05-13', monFri, blocks), true,  'Wed outside vacation')
  assert.equal(isDueDate('2026-05-09', monFri, blocks), false, 'Sat — not a school day')
  assert.equal(isDueDate('2026-05-13', monFri, []),     true,  'Wed with no vacations')
  assert.equal(isDueDate('2026-05-13', monFri, null),   true,  'Wed with null vacations')
})

test('isDueDate: empty/null school_days falls back to Mon-Fri', () => {
  // Empty school_days must NEVER be treated as "no day is a school day"
  // — that would make every past lesson permanently "not due" and
  // mask real missed work. Fall back to Mon-Fri (Invariant 5).
  const monFriFallback = { school_days: [] as string[] }
  const nullFallback = { school_days: null as string[] | null }
  assert.equal(isDueDate('2026-05-04', monFriFallback, []), true,  'Mon under empty fallback')
  assert.equal(isDueDate('2026-05-09', monFriFallback, []), false, 'Sat under empty fallback')
  assert.equal(isDueDate('2026-05-04', nullFallback, []),   true,  'Mon under null fallback')
})

test('effectiveDueDate: a vacation day pushes forward to the next school day after the block', () => {
  // Lesson originally scheduled on Wed May 6 2026 (a school day, but
  // inside a Mon May 4 - Fri May 8 vacation). The next school day
  // after the vacation ends is Mon May 11.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  assert.equal(effectiveDueDate('2026-05-06', monFri, blocks), '2026-05-11', 'mid-vacation pushes past block')
  assert.equal(effectiveDueDate('2026-05-04', monFri, blocks), '2026-05-11', 'first day of vacation pushes past block')
  assert.equal(effectiveDueDate('2026-05-08', monFri, blocks), '2026-05-11', 'last day of vacation pushes past block')
  assert.equal(effectiveDueDate('2026-05-13', monFri, blocks), '2026-05-13', 'date outside vacation unchanged')
})

test('effectiveDueDate: cascades through weekend after vacation', () => {
  // Vacation ends Fri May 8. The next calendar day is Sat May 9 — not
  // a school day for a Mon-Fri family. Push must cascade to Mon May 11.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  assert.equal(effectiveDueDate('2026-05-06', monFri, blocks), '2026-05-11', 'walks through Sat+Sun to Mon')
})

test('effectiveDueDate: cascades through back-to-back vacation blocks', () => {
  // Two adjacent vacation blocks with one weekend between them. Push
  // must walk over both blocks AND the weekend until landing on a real
  // school day.
  const blocks: VacationBlock[] = [
    { start_date: '2026-05-04', end_date: '2026-05-08' },
    { start_date: '2026-05-11', end_date: '2026-05-15' },
  ]
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  assert.equal(effectiveDueDate('2026-05-06', monFri, blocks), '2026-05-18', 'walks over both blocks to next Mon')
})

test('effectiveDueDate: empty/null school_days falls back to Mon-Fri before pushing', () => {
  // Lesson on Sun May 3 with no vacation; null school_days must use
  // Mon-Fri so the push lands on Mon May 4, not the same Sunday.
  assert.equal(effectiveDueDate('2026-05-03', null, []),  '2026-05-04', 'null school_days → Mon-Fri')
  assert.equal(effectiveDueDate('2026-05-03', [],   []),  '2026-05-04', 'empty school_days → Mon-Fri')
})

test('isLessonMissed: lesson scheduled inside a vacation is NOT missed when vacation has not pushed past today', () => {
  // Today = Wed May 6 2026. Lesson originally scheduled for Mon May 4
  // (inside the vacation Mon May 4 - Fri May 8). Effective date is
  // Mon May 11 — in the future — so the lesson is NOT missed even
  // though its stored scheduled_date is in the past. This is the bug
  // the helper fixes: previously the Plan page flagged this as missed.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const lesson = { scheduled_date: '2026-05-04', date: null, completed: false }
  assert.equal(isLessonMissed(lesson, '2026-05-06', monFri, blocks), false)
})

test('isLessonMissed: lesson on a past school day with no vacation IS missed', () => {
  // Mon May 4 with no vacation, today is Wed May 6, lesson incomplete
  // → genuinely missed. The helper must not over-correct and hide
  // real missed lessons.
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const lesson = { scheduled_date: '2026-05-04', date: null, completed: false }
  assert.equal(isLessonMissed(lesson, '2026-05-06', monFri, []), true)
})

test('isLessonMissed: lesson inside a vacation that ALREADY ENDED is missed (effective date is in the past)', () => {
  // Vacation Mon May 4 - Fri May 8. Today = Tue May 19. Lesson on Wed
  // May 6 pushes forward to Mon May 11 — which is now also in the
  // past, so the lesson is correctly missed. Vacation push doesn't
  // grant permanent immunity.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const lesson = { scheduled_date: '2026-05-06', date: null, completed: false }
  assert.equal(isLessonMissed(lesson, '2026-05-19', monFri, blocks), true)
})

test('isLessonMissed: completed lessons are never missed', () => {
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const lesson = { scheduled_date: '2026-05-04', date: null, completed: true }
  assert.equal(isLessonMissed(lesson, '2026-05-06', monFri, []), false)
})

test('isLessonMissed: lessons with no scheduled_date or date are never missed', () => {
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const lesson = { scheduled_date: null, date: null, completed: false }
  assert.equal(isLessonMissed(lesson, '2026-05-06', monFri, []), false)
})

test('isLessonMissed: empty school_days falls back to Mon-Fri (no false negatives on weekday lessons)', () => {
  // The Plan page passes the goal's school_days through unchanged. If
  // a goal row has school_days = [] (legacy data or hand-edit), the
  // missed check must still flag a Monday lesson as missed — never
  // treat "no school days" as "every day is off" (Invariant 5).
  const lesson = { scheduled_date: '2026-05-04', date: null, completed: false }
  assert.equal(isLessonMissed(lesson, '2026-05-06', [], []),   true,  'empty school_days falls back to Mon-Fri')
  assert.equal(isLessonMissed(lesson, '2026-05-06', null, []), true,  'null school_days falls back to Mon-Fri')
})

test('isLessonMissed: lesson on a vacation day where the original date is a non-school day still pushes correctly', () => {
  // Lesson stored on Sun May 3 (already a non-school day for Mon-Fri).
  // The "push" should walk to Mon May 4 — but Mon May 4 is inside a
  // vacation, so it must keep walking to Mon May 11. Today = Wed May 6.
  // Effective date May 11 is in the future → not missed.
  const blocks: VacationBlock[] = [{ start_date: '2026-05-04', end_date: '2026-05-08' }]
  const monFri = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const lesson = { scheduled_date: '2026-05-03', date: null, completed: false }
  assert.equal(isLessonMissed(lesson, '2026-05-06', monFri, blocks), false)
})

// ── Past-date completion (Plan day-detail backfill, May 2026) ────────────
//
// Plan page exposes a "Mark complete" button on past-day lessons in the
// day-detail panel. Tapping it writes a single lessons-table row with
// completed_at pinned to the selected day, is_backfill=true (Invariant 3:
// backfilled rows never re-spread), and scheduled_source='catchup_resched'
// (Invariant 10: every lessons.date write tags its source). These tests
// pin the contract.

test('past-date completion: payload pins date columns and tags scheduled_source (Invariant 10)', () => {
  const payload = buildPastDateCompletionPayload('2026-04-30T12:00:00Z')
  assert.equal(payload.completed, true, 'must mark completed')
  assert.equal(payload.completed_at, '2026-04-30T12:00:00Z', 'preserves the user-selected day timestamp verbatim')
  assert.equal(payload.date, '2026-04-30', 'date column pinned to the selected day')
  assert.equal(payload.scheduled_date, '2026-04-30', 'scheduled_date pinned in lockstep with date')
  assert.equal(payload.is_backfill, true, 'flagged so the projector never re-spreads (Invariant 3)')
  assert.equal(payload.scheduled_source, 'catchup_resched', 'Invariant 10: every lessons.date write tags its source')
})

test('past-date completion: same-day timestamp produces a same-day date pin (no off-by-one across timezones)', () => {
  // The Plan page passes `${selectedDay}T12:00:00Z` for the catch-up
  // convention. UTC noon is "the same calendar day" globally for any
  // timezone offset between -12h and +12h, so the date pin must equal
  // the selected day regardless of the test runner's TZ.
  const payload = buildPastDateCompletionPayload('2026-01-01T12:00:00Z')
  assert.equal(payload.date, '2026-01-01')
  assert.equal(payload.scheduled_date, '2026-01-01')
})

test('past-date completion: queue projection after backfill (simulated by current_lesson=5) returns lesson 6 today', () => {
  // Mom backfilled lesson 5 on a past Mon via Plan day-detail. Her client
  // wrote the completed row, then called recomputeCurrentLesson which
  // bumped current_lesson to 5 (MAX(lesson_number) of completed rows).
  // Today is Wed Apr 29; the queue projection must show lesson 6, not 5
  // (which is in history). This is what Today / Plan render after a
  // past-date completion — the Source-of-Truth contract for current_lesson.
  const wed = new Date(2026, 3, 29) // Wed Apr 29
  const goalAfterBackfill = goalCfg({ current_lesson: 5, total_lessons: 20 })
  const projection = computeTodayLessons([goalAfterBackfill], wed)
  assert.deepEqual(projection, [{ goal_id: 'g1', lesson_number: 6, date: '2026-04-29' }])
})

test('past-date completion: out-of-order backfill (complete lesson 5 with lessons 1-4 still incomplete) advances current_lesson to 5', () => {
  // recomputeCurrentLesson takes MAX(lesson_number) over completed rows.
  // If mom backfills lesson 5 first without first completing 1-4, the
  // queue position should jump to 5, not stay at 0. This is the existing
  // behavior of recomputeCurrentLesson (scheduler.ts line 105-107) and
  // we want it pinned: the projector then shows lesson 6 today, even
  // though lessons 1-4 remain in history as incomplete records.
  const wed = new Date(2026, 3, 29)
  const goalCurrentLessonJumpedToFive = goalCfg({ current_lesson: 5, total_lessons: 20 })
  const projection = computeTodayLessons([goalCurrentLessonJumpedToFive], wed)
  assert.equal(projection[0]?.lesson_number, 6, 'projection follows current_lesson, not the count of completed rows')
})

// ── Reschedule modal: vacation-aware "next school day" (May 2026) ────────
//
// Repro from staging: today=Mon May 4, school_days=Mon-Fri, vacation
// "California Trip" covers May 3 – May 17. Modal subtitle was showing
// "Adds to Friday May 8" (inside the vacation) because nthSchoolDay was
// vacation-blind. The same blindness affected the action handlers
// (planAddToNextSchoolDays / planPushBackNDays) — clicking would land
// the lesson on May 8 too. Both display and action now take an optional
// `vacations` parameter that skips dates inside any vacation block.

test('nthSchoolDay: with no vacations, behaves as before (legacy callers unaffected)', () => {
  // Mon May 4 → next school day is Tue May 5 (Mon-Fri, no vacations).
  const next = nthSchoolDay('2026-05-04', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 1)
  assert.equal(next, '2026-05-05')
})

test('nthSchoolDay: with empty vacations array explicitly, also matches legacy behavior', () => {
  const next = nthSchoolDay('2026-05-04', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 1, [])
  assert.equal(next, '2026-05-05')
})

test('nthSchoolDay: vacation block covering the entire normal "next" week pushes to first school day after the block', () => {
  // California Trip repro. Today = Mon May 4. Vacation covers May 3 – May 17.
  // Mon-Fri school days. Without vacation awareness the answer is May 5 (Tue).
  // With awareness it must be May 18 (Mon, the first school day after May 17).
  const vac = [{ start: '2026-05-03', end: '2026-05-17' }]
  const next = nthSchoolDay('2026-05-04', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 1, vac)
  assert.equal(next, '2026-05-18', 'first school day strictly after the vacation block')
})

test('nthSchoolDay: vacation block partially overlapping next school day still pushes correctly', () => {
  // Today = Wed May 6. Vacation covers May 7 – May 8 (Thu+Fri). Next
  // school day must be Mon May 11, not Thu May 7 or Fri May 8.
  const vac = [{ start: '2026-05-07', end: '2026-05-08' }]
  const next = nthSchoolDay('2026-05-06', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 1, vac)
  assert.equal(next, '2026-05-11')
})

test('nthSchoolDay: N=3 with vacation in the middle of the requested run skips the break', () => {
  // Today = Mon May 4. Vacation May 6 – May 8. Asking for the 3rd school
  // day after today: Tue May 5 = 1, May 11 = 2 (Wed/Thu/Fri all in
  // vacation), Tue May 12 = 3.
  const vac = [{ start: '2026-05-06', end: '2026-05-08' }]
  const third = nthSchoolDay('2026-05-04', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 3, vac)
  assert.equal(third, '2026-05-12')
})

test('schoolDayDelta: Wed → next Mon, Mon-Fri = 3 school days (Thu, Fri, Mon)', () => {
  // Wed May 6 → Mon May 11. Mon-Fri school days, no vacations.
  // School days strictly after May 6 up to and including May 11:
  // Thu May 7 = 1, Fri May 8 = 2, Mon May 11 = 3. Sat/Sun skipped.
  const n = schoolDayDelta('2026-05-06', '2026-05-11', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  assert.equal(n, 3)
})

test('schoolDayDelta: targetDate on or before fromDate returns 0', () => {
  const sd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  assert.equal(schoolDayDelta('2026-05-06', '2026-05-06', sd), 0)
  assert.equal(schoolDayDelta('2026-05-06', '2026-05-05', sd), 0)
})

test('schoolDayDelta: vacation block inside the window does not count', () => {
  // Mon May 4 → Mon May 18. Mon-Fri. Vacation May 6 – May 15 covers
  // Wed-Fri week 1 + Mon-Fri week 2 → 8 school days knocked out.
  // School days in (May 4, May 18]: Tue May 5 = 1, then Mon May 18 = 2.
  const vac = [{ start: '2026-05-06', end: '2026-05-15' }]
  const n = schoolDayDelta('2026-05-04', '2026-05-18', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], vac)
  assert.equal(n, 2)
})

test('schoolDayDelta: inverse of nthSchoolDay round-trips for the Plan cascade move', () => {
  // For any N, nthSchoolDay(d, sd, N) should be the date where
  // schoolDayDelta(d, that, sd) === N. The cascade-shift Plan move
  // relies on this invariant: pick a delta N from the user's date pick,
  // apply it to every later lesson with nthSchoolDay.
  const sd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  for (const n of [1, 2, 5, 10, 21]) {
    const target = nthSchoolDay('2026-05-04', sd, n)
    assert.equal(schoolDayDelta('2026-05-04', target, sd), n, `round-trip failed at N=${n}`)
  }
})

test('planAddToNextSchoolDays: with vacations, missed lesson lands after the vacation block', () => {
  // Repro: missed lesson currently on Apr 27. Today May 4. Vacation
  // May 3 – May 17. Action should place the lesson on May 18, not May 5.
  const missed: ReschedulableLesson[] = [
    { id: 'L1', scheduled_date: '2026-04-27', curriculum_goal_id: 'g1' },
  ]
  const vac = [{ start: '2026-05-03', end: '2026-05-17' }]
  const result = planAddToNextSchoolDays(
    missed,
    () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    '2026-05-04',
    new Map(),
    () => 1,
    vac,
  )
  assert.equal(result.updates.length, 1)
  assert.equal(result.updates[0].newDate, '2026-05-18', 'must skip the vacation block')
})

test('planAddToNextSchoolDays: without vacations arg, retains pre-fix vacation-blind behavior (backward compat)', () => {
  const missed: ReschedulableLesson[] = [
    { id: 'L1', scheduled_date: '2026-04-27', curriculum_goal_id: 'g1' },
  ]
  // No vacations passed — same as legacy callers
  const result = planAddToNextSchoolDays(
    missed,
    () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    '2026-05-04',
    new Map(),
    () => 1,
  )
  assert.equal(result.updates[0].newDate, '2026-05-05', 'legacy callers (no vacations arg) still get the next weekday')
})

test('planPushBackNDays: with vacations, future lessons hop over the vacation block when shifted', () => {
  // 1 missed lesson on Apr 27, today May 4. Future lesson on May 5 (Tue).
  // Vacation May 6 – May 17. Pushing back 1 school day: future lesson
  // on May 5 should move to May 18 (next school day after the break),
  // NOT to May 6 (the naive "+1 weekday" answer).
  const missed: ReschedulableLesson[] = [
    { id: 'M1', scheduled_date: '2026-04-27', curriculum_goal_id: 'g1' },
  ]
  const future: ReschedulableLesson[] = [
    { id: 'F1', scheduled_date: '2026-05-05', curriculum_goal_id: 'g1' },
  ]
  const vac = [{ start: '2026-05-06', end: '2026-05-17' }]
  const result = planPushBackNDays(
    missed,
    future,
    () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    '2026-05-04',
    vac,
  )
  const futureUpdate = result.updates.find((u) => u.id === 'F1')
  assert.equal(futureUpdate?.newDate, '2026-05-18', 'future lesson must skip the vacation when pushed back')
})

// ── planQueueMove (manual move on the Plan page) ─────────────────────────
//
// These tests pin the JS mirror of the move_lesson_to_date RPC. The two
// implementations MUST agree — the RPC is what production uses, but the
// pure helper lets us assert the algorithm without a database. See
// docs/CURRICULUM-SCHEDULING.md, "Queue position".

function queueLesson(
  id: string,
  qp: number,
  scheduled_date: string | null,
  goalId = 'g1',
): QueueMoveInputLesson {
  return { id, queue_position: qp, scheduled_date, curriculum_goal_id: goalId }
}

test('planQueueMove: move lesson later — siblings between old and new shift down by 1', () => {
  // Goal has 5 lessons on Mon..Fri. Move lesson 2 (Tue) to Fri.
  // Existing Fri lesson: lesson 5. End-of-Fri target = lesson 5's slot +1
  // = qp 6 raw; but because we removed lesson 2 (qp 2) first, the dense
  // rank collapses to 5. So lesson 2 ends at qp 5, and lessons 3, 4, 5
  // shift from qp 3, 4, 5 → 2, 3, 4.
  const lessons: QueueMoveInputLesson[] = [
    queueLesson('L1', 1, '2026-05-18'),
    queueLesson('L2', 2, '2026-05-19'),
    queueLesson('L3', 3, '2026-05-20'),
    queueLesson('L4', 4, '2026-05-21'),
    queueLesson('L5', 5, '2026-05-22'),
  ]
  const plan = planQueueMove({
    movingLessonId: 'L2',
    targetDate: '2026-05-22',
    goalLessons: lessons,
  })
  assert.ok(plan)
  assert.equal(plan!.noop, false)
  assert.equal(plan!.movedNewQp, 5)
  // Shifts must be applied in ascending order so each row's new slot is
  // vacated before it lands.
  assert.deepEqual(plan!.shifts, [
    { id: 'L3', queue_position: 2 },
    { id: 'L4', queue_position: 3 },
    { id: 'L5', queue_position: 4 },
  ])
})

test('planQueueMove: move lesson earlier — siblings between new and old shift up by 1', () => {
  // Move lesson 4 (Thu) to Mon (where lesson 1 already sits).
  // End-of-Mon target = max(qp on Mon) + 1 = 2. Lessons 2, 3 shift up by 1.
  const lessons: QueueMoveInputLesson[] = [
    queueLesson('L1', 1, '2026-05-18'),
    queueLesson('L2', 2, '2026-05-19'),
    queueLesson('L3', 3, '2026-05-20'),
    queueLesson('L4', 4, '2026-05-21'),
  ]
  const plan = planQueueMove({
    movingLessonId: 'L4',
    targetDate: '2026-05-18',
    goalLessons: lessons,
  })
  assert.ok(plan)
  assert.equal(plan!.movedNewQp, 2)
  // Descending order so each row's new slot is vacated before it lands.
  assert.deepEqual(plan!.shifts, [
    { id: 'L3', queue_position: 4 },
    { id: 'L2', queue_position: 3 },
  ])
})

test('planQueueMove: move onto an empty date pushes the lesson to a new tail position', () => {
  // Goal currently runs Mon..Wed (qp 1, 2, 3). Move lesson 1 to Fri
  // (a date with no existing lessons). End-of-Fri falls back to "after
  // the last predecessor". Last predecessor = Wed (qp 3). After removing
  // L1, dense rank shifts L2, L3 down. L1 lands at qp 3, L2 → 1, L3 → 2.
  const lessons: QueueMoveInputLesson[] = [
    queueLesson('L1', 1, '2026-05-18'),
    queueLesson('L2', 2, '2026-05-19'),
    queueLesson('L3', 3, '2026-05-20'),
  ]
  const plan = planQueueMove({
    movingLessonId: 'L1',
    targetDate: '2026-05-22',
    goalLessons: lessons,
  })
  assert.ok(plan)
  assert.equal(plan!.movedNewQp, 3)
  assert.deepEqual(plan!.shifts, [
    { id: 'L2', queue_position: 1 },
    { id: 'L3', queue_position: 2 },
  ])
})

test('planQueueMove: no-op when target date is already the lesson\'s scheduled date and it is last on that day', () => {
  // Lesson 3 sits alone on Wed. Moving it back to Wed should be a no-op.
  const lessons: QueueMoveInputLesson[] = [
    queueLesson('L1', 1, '2026-05-18'),
    queueLesson('L2', 2, '2026-05-19'),
    queueLesson('L3', 3, '2026-05-20'),
  ]
  const plan = planQueueMove({
    movingLessonId: 'L3',
    targetDate: '2026-05-20',
    goalLessons: lessons,
  })
  assert.ok(plan)
  assert.equal(plan!.noop, true)
  assert.equal(plan!.shifts.length, 0)
})

test('planQueueMove: one-off lesson (no goal) returns a noop result for the caller to date-pin', () => {
  // A custom Plan-day lesson with no curriculum_goal — not in any queue.
  // The RPC just updates date columns; the helper signals noop.
  const lessons: QueueMoveInputLesson[] = [
    { id: 'X1', queue_position: null, scheduled_date: '2026-05-19', curriculum_goal_id: null },
  ]
  const plan = planQueueMove({
    movingLessonId: 'X1',
    targetDate: '2026-05-22',
    goalLessons: lessons,
  })
  assert.ok(plan)
  assert.equal(plan!.noop, true)
})

test('planQueueMove: moving to a date with a sibling at a higher qp lands AFTER that sibling (preserves "end of day")', () => {
  // Goal layout where qp order disagrees with date order:
  //   L1 (qp 1, Mon), L2 (qp 2, Tue), L3 (qp 3, Wed), L5 (qp 5, Wed), L4 (qp 4, Thu).
  // Move L2 onto Wed. Wed currently has L3 (qp 3) and L5 (qp 5). User
  // wants L2 at the END of Wed → after L5. So L2's final rank should be 5
  // (post-shift) so it sits after the LAST current Wed sibling.
  const lessons: QueueMoveInputLesson[] = [
    queueLesson('L1', 1, '2026-05-18'),
    queueLesson('L2', 2, '2026-05-19'),
    queueLesson('L3', 3, '2026-05-20'),
    queueLesson('L4', 4, '2026-05-21'),
    queueLesson('L5', 5, '2026-05-20'),
  ]
  const plan = planQueueMove({
    movingLessonId: 'L2',
    targetDate: '2026-05-20',
    goalLessons: lessons,
  })
  assert.ok(plan)
  assert.equal(plan!.movedNewQp, 5)
  // L3, L4, L5 each shift down by 1.
  assert.deepEqual(plan!.shifts, [
    { id: 'L3', queue_position: 2 },
    { id: 'L4', queue_position: 3 },
    { id: 'L5', queue_position: 4 },
  ])
})

// ── recomputeCurrentLesson — defensive read-error guard ──────────────────
//
// Pre-fix repro: a transient SELECT failure on the goal row or the
// completed-rows query caused the Supabase client to return
// { data: null, error: <something> }. The function destructured only
// `data`, fell to maxCompleted=0, and then WROTE current_lesson back to
// (start_at_lesson - 1) — clobbering real progress whenever the read
// hiccupped. The guard now bails on either read error before touching
// the goal row.

type FakeQueryResult = { data: unknown; error: unknown }

function makeFakeSupabase(opts: {
  goalResult: FakeQueryResult
  lessonsResult: FakeQueryResult
}) {
  const writes: { table: string; payload: unknown; goalId: string }[] = []

  // The production call chains:
  //   from('curriculum_goals').select(...).eq(...).maybeSingle()      → goalResult
  //   from('lessons').select(...).eq(...).eq(...).not(...).order(...).limit(...) → lessonsResult
  //   from('curriculum_goals').update({...}).eq(...)                  → recorded in writes
  // The helper builds chainable stubs that ignore their arguments and
  // resolve to the configured results.
  const noop = (): unknown => lessonsChain
  const lessonsChain: Record<string, unknown> = {
    select: noop, eq: noop, not: noop, order: noop,
    limit: async () => opts.lessonsResult,
  }

  const goalsReadChain: Record<string, unknown> = {
    eq: () => ({ maybeSingle: async () => opts.goalResult }),
  }

  function goalsTable() {
    return {
      select: () => goalsReadChain,
      update: (payload: unknown) => ({
        eq: async (_col: string, val: string) => {
          writes.push({ table: 'curriculum_goals', payload, goalId: val })
          return { error: null }
        },
      }),
    }
  }

  const supabase = {
    from(table: string) {
      if (table === 'lessons') return lessonsChain
      if (table === 'curriculum_goals') return goalsTable()
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return { supabase, writes }
}

test('recomputeCurrentLesson: bails without writing when the goal read errors', async () => {
  const { supabase, writes } = makeFakeSupabase({
    goalResult: { data: null, error: { message: 'transient network error' } },
    lessonsResult: { data: [{ queue_position: 99 }], error: null },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await recomputeCurrentLesson(supabase as any, 'goal-1')
  assert.equal(result, null, 'returns null on goal read error')
  assert.equal(writes.length, 0, 'must not write current_lesson when the read failed')
})

test('recomputeCurrentLesson: bails without writing when the completed-rows read errors', async () => {
  const { supabase, writes } = makeFakeSupabase({
    goalResult: { data: { total_lessons: 120, start_at_lesson: 1 }, error: null },
    lessonsResult: { data: null, error: { message: 'transient network error' } },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await recomputeCurrentLesson(supabase as any, 'goal-1')
  assert.equal(result, null, 'returns null on completed-rows read error')
  assert.equal(
    writes.length,
    0,
    'must not write current_lesson when the completed-rows read failed (Ivy regression guard)',
  )
})

test('recomputeCurrentLesson: writes max(queue_position) when both reads succeed', async () => {
  const { supabase, writes } = makeFakeSupabase({
    goalResult: { data: { total_lessons: 120, start_at_lesson: 1 }, error: null },
    lessonsResult: { data: [{ queue_position: 42 }], error: null },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await recomputeCurrentLesson(supabase as any, 'goal-1')
  assert.equal(result, 42, 'returns the recomputed value')
  assert.equal(writes.length, 1, 'writes exactly once on the happy path')
  assert.deepEqual(writes[0].payload, { current_lesson: 42 })
})

// ── syncProjectedScheduledDates — write-through cache helper ──────────────
//
// The queue projector decides which date a queue slot occupies; the
// lessons row's scheduled_date is a cache of that decision. This
// helper aligns the cache with the projector's output so Today's
// scheduled_date filter stops dropping today's slot rows whose cache
// still points at the wizard's original future date. Tests pin the
// contract: skip completed + is_backfill, no-op when aligned, group
// writes by target date, set scheduled_source = 'queue_resync'.

type ResyncSentRow = QueueResyncRow & {
  curriculum_goal_id: string
  queue_position: number
}

function makeResyncSupabase() {
  const writes: { ids: string[]; payload: Record<string, unknown> }[] = []

  const lessonsWriter = {
    update: (payload: Record<string, unknown>) => ({
      in: async (_col: string, ids: string[]) => {
        writes.push({ ids: [...ids], payload })
        return { error: null }
      },
    }),
  }

  const supabase = {
    from(table: string) {
      if (table === 'lessons') return lessonsWriter
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return { supabase, writes }
}

function resyncRow(
  id: string,
  qp: number,
  scheduled_date: string | null,
  completed = false,
  is_backfill = false,
): ResyncSentRow {
  return {
    id,
    scheduled_date,
    completed,
    is_backfill,
    curriculum_goal_id: 'g1',
    queue_position: qp,
  }
}

test('syncProjectedScheduledDates: writes nothing when every row already matches the projector', async () => {
  const { supabase, writes } = makeResyncSupabase()
  const rows = [
    resyncRow('A', 1, '2026-05-19'),
    resyncRow('B', 2, '2026-05-20'),
  ]
  const proj = new Map([
    ['g1|1', '2026-05-19'],
    ['g1|2', '2026-05-20'],
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncProjectedScheduledDates(supabase as any, rows, proj, (r) => `g1|${r.queue_position}`)
  assert.equal(writes.length, 0, 'aligned cache must not trigger any writes')
})

test('syncProjectedScheduledDates: drift on a single row issues exactly one UPDATE for the new date', async () => {
  const { supabase, writes } = makeResyncSupabase()
  const rows = [
    resyncRow('A', 1, '2026-06-15'), // stale: projector says today
    resyncRow('B', 2, '2026-05-20'),
  ]
  const proj = new Map([
    ['g1|1', '2026-05-19'],
    ['g1|2', '2026-05-20'],
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncProjectedScheduledDates(supabase as any, rows, proj, (r) => `g1|${r.queue_position}`)
  assert.equal(writes.length, 1, 'one UPDATE per distinct target date')
  assert.deepEqual(writes[0].ids, ['A'])
  assert.deepEqual(writes[0].payload, {
    scheduled_date: '2026-05-19',
    date: '2026-05-19',
    scheduled_source: 'queue_resync',
  })
})

test('syncProjectedScheduledDates: groups rows by target date so two drifted rows on the same date share one UPDATE', async () => {
  const { supabase, writes } = makeResyncSupabase()
  const rows = [
    resyncRow('A', 1, '2026-06-15'), // drifted → 2026-05-19
    resyncRow('B', 2, '2026-06-15'), // drifted → 2026-05-19 (same target)
    resyncRow('C', 3, '2026-06-15'), // drifted → 2026-05-20 (different target)
  ]
  const proj = new Map([
    ['g1|1', '2026-05-19'],
    ['g1|2', '2026-05-19'],
    ['g1|3', '2026-05-20'],
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncProjectedScheduledDates(supabase as any, rows, proj, (r) => `g1|${r.queue_position}`)
  assert.equal(writes.length, 2, 'two distinct target dates → two UPDATEs')
  const may19 = writes.find((w) => w.payload.scheduled_date === '2026-05-19')
  const may20 = writes.find((w) => w.payload.scheduled_date === '2026-05-20')
  assert.ok(may19 && may20)
  assert.deepEqual(may19!.ids.sort(), ['A', 'B'])
  assert.deepEqual(may20!.ids, ['C'])
})

test('syncProjectedScheduledDates: skips completed rows (Invariant 3 — historical dates stay put)', async () => {
  const { supabase, writes } = makeResyncSupabase()
  const rows = [
    resyncRow('A', 1, '2026-03-01', /* completed */ true),
    resyncRow('B', 2, '2026-06-15'),
  ]
  const proj = new Map([
    ['g1|1', '2026-05-19'], // would shift the completed row if we did not skip
    ['g1|2', '2026-05-20'],
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncProjectedScheduledDates(supabase as any, rows, proj, (r) => `g1|${r.queue_position}`)
  assert.equal(writes.length, 1, 'only the incomplete row is written')
  assert.deepEqual(writes[0].ids, ['B'])
})

test('syncProjectedScheduledDates: skips is_backfill rows even when incomplete (Invariant 3)', async () => {
  const { supabase, writes } = makeResyncSupabase()
  const rows = [
    resyncRow('A', 1, '2026-03-01', /* completed */ false, /* is_backfill */ true),
    resyncRow('B', 2, '2026-06-15'),
  ]
  const proj = new Map([
    ['g1|1', '2026-05-19'],
    ['g1|2', '2026-05-20'],
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncProjectedScheduledDates(supabase as any, rows, proj, (r) => `g1|${r.queue_position}`)
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].ids, ['B'])
})

test('syncProjectedScheduledDates: skips rows the rowKey extractor returns null for (one-off lessons)', async () => {
  const { supabase, writes } = makeResyncSupabase()
  const rows: QueueResyncRow[] = [
    { id: 'X1', scheduled_date: '2026-06-15', completed: false, is_backfill: false },
  ]
  const proj = new Map([['g1|1', '2026-05-19']])
  // The extractor returns null for one-off lessons (no curriculum_goal_id).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncProjectedScheduledDates(supabase as any, rows, proj, () => null)
  assert.equal(writes.length, 0)
})

// ── Create-path regression suite (May 2026 t.ferrebee bug) ──────────────────
// Production bug: a goal saved through the Schedule Builder ended up with
// lesson 1 AND lesson 2 BOTH on the first school day (lpd=1, school_days=
// [Sat], total=36). The same shape was seen across ~21 goals. Root cause
// was not identified from code review of the projector — every input combo
// traced produced clean output. These tests are a regression guard so a
// future projector edit can't reintroduce the doubler silently.
function countByDate(rows: { lesson_number: number; date: string }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.date, (m.get(r.date) ?? 0) + 1)
  return m
}

test('create-path: t.ferrebee shape (lpd=1, Sat-only, total=36) emits one lesson per Saturday with no doubling', () => {
  const goal: CurriculumGoalConfig = {
    id: 'g_tferrebee',
    school_days: ['Sat'],
    lessons_per_day: 1,
    current_lesson: 0,
    total_lessons: 36,
    start_date: null,
  }
  const fromDate = new Date('2026-05-22T00:00:00') // Fri before first Sat
  const out = computeNextLessonsForGoal(goal, fromDate, 3650, [])
  assert.equal(out.length, 36, '36 lessons emitted')
  const counts = countByDate(out)
  for (const [date, count] of counts) {
    assert.ok(count <= 1, `date ${date} has ${count} lessons, expected <= 1`)
  }
  // Lesson 1 and lesson 2 must land on DIFFERENT calendar dates.
  const l1 = out.find((l) => l.lesson_number === 1)!
  const l2 = out.find((l) => l.lesson_number === 2)!
  assert.notEqual(l1.date, l2.date, 'lesson 1 and lesson 2 must be on different dates')
  // Lesson_numbers must be contiguous in queue order.
  for (let i = 0; i < out.length; i++) {
    assert.equal(out[i].lesson_number, i + 1, `lesson at index ${i} is ${out[i].lesson_number}, expected ${i + 1}`)
  }
})

test('create-path: t.ferrebee shape with future start_date (jump to Sat 5/30) still emits one per Sat', () => {
  const goal: CurriculumGoalConfig = {
    id: 'g_tferrebee_future',
    school_days: ['Sat'],
    lessons_per_day: 1,
    current_lesson: 0,
    total_lessons: 36,
    start_date: '2026-05-30',
  }
  const fromDate = new Date('2026-05-22T00:00:00')
  const out = computeNextLessonsForGoal(goal, fromDate, 3650, [])
  assert.equal(out.length, 36)
  const counts = countByDate(out)
  for (const [date, count] of counts) {
    assert.ok(count <= 1, `date ${date} has ${count} lessons, expected <= 1`)
  }
  const l1 = out.find((l) => l.lesson_number === 1)!
  assert.equal(l1.date, '2026-05-30', 'lesson 1 lands on start_date 5/30')
  const l2 = out.find((l) => l.lesson_number === 2)!
  assert.equal(l2.date, '2026-06-06', 'lesson 2 lands on next Sat 6/6')
})

test('create-path: elizabeth.roach shape (lpd=7, Wed/Thu/Fri, total=210, current_lesson=32) packs 7 per day, no doubling', () => {
  const goal: CurriculumGoalConfig = {
    id: 'g_eroach',
    school_days: ['Wed', 'Thu', 'Fri'],
    lessons_per_day: 7,
    current_lesson: 32,
    total_lessons: 210,
    start_date: null,
  }
  const fromDate = new Date('2026-05-20T00:00:00') // Wed
  const out = computeNextLessonsForGoal(goal, fromDate, 3650, [])
  assert.equal(out.length, 178, '210 - 32 = 178 remaining lessons')
  const counts = countByDate(out)
  for (const [date, count] of counts) {
    assert.ok(count <= 7, `date ${date} has ${count} lessons, expected <= 7`)
  }
  // First three school days each get exactly 7 contiguous lessons starting at 33.
  const dateToLessons = new Map<string, number[]>()
  for (const r of out) {
    const list = dateToLessons.get(r.date) ?? []
    list.push(r.lesson_number)
    dateToLessons.set(r.date, list)
  }
  assert.deepEqual(dateToLessons.get('2026-05-20'), [33, 34, 35, 36, 37, 38, 39])
  assert.deepEqual(dateToLessons.get('2026-05-21'), [40, 41, 42, 43, 44, 45, 46])
  assert.deepEqual(dateToLessons.get('2026-05-22'), [47, 48, 49, 50, 51, 52, 53])
  // Lessons 54-60 belong on the NEXT Wed (5/27), not back on 5/20.
  assert.deepEqual(dateToLessons.get('2026-05-27'), [54, 55, 56, 57, 58, 59, 60])
})

test('create-path: 50 lessons, lpd=3, MWF, no doubling, contiguous per date', () => {
  const goal: CurriculumGoalConfig = {
    id: 'g_50_3_mwf',
    school_days: ['Mon', 'Wed', 'Fri'],
    lessons_per_day: 3,
    current_lesson: 0,
    total_lessons: 50,
    start_date: null,
  }
  const fromDate = new Date('2026-05-22T00:00:00') // Fri
  const out = computeNextLessonsForGoal(goal, fromDate, 3650, [])
  assert.equal(out.length, 50)
  const dateToLessons = new Map<string, number[]>()
  for (const r of out) {
    const list = dateToLessons.get(r.date) ?? []
    list.push(r.lesson_number)
    dateToLessons.set(r.date, list)
  }
  for (const [date, lessons] of dateToLessons) {
    assert.ok(lessons.length <= 3, `date ${date} has ${lessons.length} lessons, expected <= 3`)
    // Per-date lesson_numbers must be contiguous (e.g. [1,2,3] not [1,3,5]).
    for (let i = 1; i < lessons.length; i++) {
      assert.equal(lessons[i], lessons[i - 1] + 1, `non-contiguous lesson_numbers on ${date}: ${lessons.join(',')}`)
    }
  }
})

// ── Invariant 11: cache-sync writes the full incomplete tail ──────────────
//
// Production bug 2026-05-26 (whitley.t2212 + 12 others, 77 affected goals,
// 674 misplaced lessons): the dashboard caller projected a 7-day window
// for cache warming. The sync wrote in-window lessons onto the projector's
// new dates without re-aligning out-of-window lessons, whose stale cache
// could still occupy those same dates. Result: queue_resync writes
// collided with wizard_create rows on the same calendar day.
//
// Fix: callers of syncProjectedScheduledDates must build projDateByKey
// from a projection that covers every remaining incomplete lesson of the
// goal, not a fixed-day window. These tests pin that contract.

function applyWrites(
  rows: ResyncSentRow[],
  writes: { ids: string[]; payload: Record<string, unknown> }[],
): Map<string, string | null> {
  const out = new Map<string, string | null>(rows.map((r) => [r.id, r.scheduled_date]))
  for (const w of writes) {
    const newDate = w.payload.scheduled_date as string
    for (const id of w.ids) out.set(id, newDate)
  }
  return out
}

test('Invariant 11 (whitley): full-tail projection of lpd=1 MWF goal emits one lesson per school day, no doubling', () => {
  // whitley.t2212 goal 81046ad4: lpd=1, school_days=[Mon,Wed,Fri].
  // current_lesson=82, total_lessons=87 so lessons 83..87 are the
  // remaining incomplete tail.
  const goal: CurriculumGoalConfig = {
    id: 'g_whitley_kindergarten',
    school_days: ['Mon', 'Wed', 'Fri'],
    lessons_per_day: 1,
    current_lesson: 82,
    total_lessons: 87,
    start_date: null,
  }
  const today = new Date('2026-05-26T00:00:00') // Tue
  const out = computeNextLessonsForGoal(goal, today, 3650, [])
  assert.equal(out.length, 5, '5 incomplete lessons emitted (83..87)')
  const counts = countByDate(out)
  for (const [date, count] of counts) {
    assert.ok(count <= 1, `date ${date} has ${count} lessons, expected <= 1`)
  }
  const byLesson = new Map(out.map((p) => [p.lesson_number, p.date]))
  assert.equal(byLesson.get(83), '2026-05-27')
  assert.equal(byLesson.get(84), '2026-05-29')
  assert.equal(byLesson.get(85), '2026-06-01')
  assert.equal(byLesson.get(86), '2026-06-03')
  assert.equal(byLesson.get(87), '2026-06-05')
})

test('Invariant 11 (whitley): full-tail projDateByKey + syncProjectedScheduledDates leaves every incomplete row on a distinct date', async () => {
  // Simulates the dashboard caller. The "stale cache" mimics the actual
  // production state on 2026-05-26: lessons 83..87 placed by an earlier
  // wizard run, with lesson 85 sitting on 2026-06-01 (its wizard date).
  // Today the projector shifts lessons 83..87 forward by one school day
  // each; a full-tail projection covers all five, so the sync rewrites
  // every drifted row and lesson 85 moves off 2026-06-01 before lesson 84
  // can land there.
  const goal: CurriculumGoalConfig = {
    id: 'g_whitley_kindergarten',
    school_days: ['Mon', 'Wed', 'Fri'],
    lessons_per_day: 1,
    current_lesson: 82,
    total_lessons: 87,
    start_date: null,
  }
  // Today is Thu 2026-05-28 in this scenario so the projector shifts
  // dates one school day forward vs. the cached wizard placement.
  const today = new Date('2026-05-28T00:00:00')
  const projected = computeNextLessonsForGoal(goal, today, 3650, [])
  const projDateByKey = new Map(
    projected.map((p) => [`${goal.id}|${p.lesson_number}`, p.date]),
  )
  // Stale cache: wizard placement one school day earlier than today's
  // projection. Lesson 85 sits on 2026-06-01, the same date today's
  // projector emits for lesson 84.
  const rows: ResyncSentRow[] = [
    { id: 'L83', curriculum_goal_id: goal.id, queue_position: 83, scheduled_date: '2026-05-27', completed: false, is_backfill: false },
    { id: 'L84', curriculum_goal_id: goal.id, queue_position: 84, scheduled_date: '2026-05-29', completed: false, is_backfill: false },
    { id: 'L85', curriculum_goal_id: goal.id, queue_position: 85, scheduled_date: '2026-06-01', completed: false, is_backfill: false },
    { id: 'L86', curriculum_goal_id: goal.id, queue_position: 86, scheduled_date: '2026-06-03', completed: false, is_backfill: false },
    { id: 'L87', curriculum_goal_id: goal.id, queue_position: 87, scheduled_date: '2026-06-05', completed: false, is_backfill: false },
  ]
  const { supabase, writes } = makeResyncSupabase()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncProjectedScheduledDates(supabase as any, rows, projDateByKey, (r) => `${(r as ResyncSentRow).curriculum_goal_id}|${(r as ResyncSentRow).queue_position}`)

  const finalDates = applyWrites(rows, writes)
  const dateCounts = new Map<string, number>()
  for (const d of finalDates.values()) {
    if (!d) continue
    dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1)
  }
  for (const [date, count] of dateCounts) {
    assert.ok(count <= 1, `Invariant 2 violation: date ${date} ended with ${count} incomplete lessons for a lpd=1 goal`)
  }
  // Spot-check: the post-sync dates match the projector's full-tail output.
  assert.equal(finalDates.get('L83'), '2026-05-29')
  assert.equal(finalDates.get('L84'), '2026-06-01')
  assert.equal(finalDates.get('L85'), '2026-06-03')
  assert.equal(finalDates.get('L86'), '2026-06-05')
  assert.equal(finalDates.get('L87'), '2026-06-08')
})

test('Invariant 11 (whitley): partial 7-day projDateByKey reproduces the May 26 collision (regression guard against re-introducing the window)', async () => {
  // Documents the bug Option A fixes. With a 7-day window the projector
  // emits dates only for lessons 83 and 84; lessons 85..87 are absent from
  // projDateByKey and keep their stale cache. The sync moves lesson 84
  // onto 2026-06-01, the same date lesson 85's untouched wizard cache
  // already occupies. This test asserts the collision so a future change
  // that re-narrows the projection window fails loudly here instead of
  // silently re-shipping the production bug.
  const goal: CurriculumGoalConfig = {
    id: 'g_whitley_kindergarten',
    school_days: ['Mon', 'Wed', 'Fri'],
    lessons_per_day: 1,
    current_lesson: 82,
    total_lessons: 87,
    start_date: null,
  }
  const today = new Date('2026-05-28T00:00:00')
  const narrowProjection = computeNextLessonsForGoal(goal, today, 7, [])
  // A 7-day window from Thu 5/28 (endDate Thu 6/4) reaches Wed 6/3, so it
  // emits lessons 83, 84, and 85 but leaves 86 and 87 outside the map.
  assert.equal(narrowProjection.length, 3, '7-day window emits 3 lessons (83, 84, 85)')
  const projDateByKey = new Map(
    narrowProjection.map((p) => [`${goal.id}|${p.lesson_number}`, p.date]),
  )
  const rows: ResyncSentRow[] = [
    { id: 'L83', curriculum_goal_id: goal.id, queue_position: 83, scheduled_date: '2026-05-27', completed: false, is_backfill: false },
    { id: 'L84', curriculum_goal_id: goal.id, queue_position: 84, scheduled_date: '2026-05-29', completed: false, is_backfill: false },
    { id: 'L85', curriculum_goal_id: goal.id, queue_position: 85, scheduled_date: '2026-06-01', completed: false, is_backfill: false },
    { id: 'L86', curriculum_goal_id: goal.id, queue_position: 86, scheduled_date: '2026-06-03', completed: false, is_backfill: false },
    { id: 'L87', curriculum_goal_id: goal.id, queue_position: 87, scheduled_date: '2026-06-05', completed: false, is_backfill: false },
  ]
  const { supabase, writes } = makeResyncSupabase()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncProjectedScheduledDates(supabase as any, rows, projDateByKey, (r) => `${(r as ResyncSentRow).curriculum_goal_id}|${(r as ResyncSentRow).queue_position}`)
  const finalDates = applyWrites(rows, writes)
  // Lesson 85 was rewritten to 2026-06-03 (projector's date). Lesson 86
  // was skipped (out of window) and remains on its stale cache value of
  // 2026-06-03. Two incomplete rows of a lpd=1 goal now share a date.
  assert.equal(finalDates.get('L85'), '2026-06-03')
  assert.equal(finalDates.get('L86'), '2026-06-03')
})
