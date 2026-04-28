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
