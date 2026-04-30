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
  type ReschedulableLesson,
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

test('planCompressAfterExtra compresses by exactly one school day', () => {
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

test('planCompressAfterExtra preserves lesson_number ordering across days', () => {
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

test('planAddToNextSchoolDays: missed lessons skip past forward-scheduled dates (TGTB repro)', () => {
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

test('planAddToNextSchoolDays: empty density map matches old behavior (no regression)', () => {
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

test('planAddToNextSchoolDays: per-goal density isolates collisions', () => {
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

test('planAddToNextSchoolDays: lessons_per_day=2 allows two lessons per date', () => {
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

test('planAddToNextSchoolDays: same-call placements increment the running map (no self-collision)', () => {
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
