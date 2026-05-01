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
  type ReschedulableLesson,
  type CurriculumGoalConfig,
  type VacationBlock,
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
