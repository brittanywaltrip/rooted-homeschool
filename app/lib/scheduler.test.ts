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
  planCompressAfterExtra,
  hasScheduleFieldsChanged,
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
