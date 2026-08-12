// Tests for activity occurrence math, driven by a live bug report:
// activity beb07ff6-72c9-48d8-829b-4265fc0f979c, frequency "biweekly",
// days [2] (Wednesday), start_date 2026-10-07, end_date 2026-12-02. The stored
// row was correct but the calendar rendered Oct 14 / Oct 28 / Nov 11 / Nov 25,
// one week off, because parity was anchored to created_at instead of
// start_date.
//
// Anchoring is now start_date: the week containing start_date is week 0
// (shown), the next week is week 1 (hidden). Rows with start_date NULL keep
// the legacy created_at cadence.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { activityOccursOn, biweeklyOccursOn } from './activityOccurrences.ts'

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Local dates from `from` through `to` inclusive, both "YYYY-MM-DD". */
function localRange(from: string, to: string): Date[] {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const end = new Date(ty, tm - 1, td)
  const out: Date[] = []
  for (const cur = new Date(fy, fm - 1, fd); cur <= end; cur.setDate(cur.getDate() + 1)) {
    out.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()))
  }
  return out
}

/** Every date in the window the activity renders on. */
function rendersOn(activity: Parameters<typeof activityOccursOn>[0], from: string, to: string): string[] {
  return localRange(from, to)
    .filter((d) => activityOccursOn(activity, d, ymd(d)))
    .map(ymd)
}

// days [2] = Wednesday under the Mon=0..Sun=6 activities convention.
const REPORTED = {
  id: 'beb07ff6-72c9-48d8-829b-4265fc0f979c',
  name: 'Co-op',
  emoji: '🏫',
  frequency: 'biweekly' as const,
  days: [2],
  start_date: '2026-10-07',
  end_date: '2026-12-02',
  duration_minutes: 120,
  scheduled_start_time: null,
  child_ids: null,
  location: null,
  // Created a week before it starts, the exact offset that produced the bug.
  created_at: '2026-09-30T18:22:11.000Z',
}

test('reported biweekly activity renders on its own start_date week, not the alternate weeks', () => {
  assert.deepEqual(
    rendersOn(REPORTED, '2026-10-05', '2026-12-06'),
    ['2026-10-07', '2026-10-21', '2026-11-04', '2026-11-18', '2026-12-02'],
  )
})

test('biweekly parity ignores created_at once start_date is set', () => {
  // Same schedule, created the day before it starts instead of a week before.
  // Anchoring to created_at would flip every rendered week; anchoring to
  // start_date must not move a single date.
  const createdLater = { ...REPORTED, created_at: '2026-10-06T09:00:00.000Z' }
  assert.deepEqual(
    rendersOn(createdLater, '2026-10-05', '2026-12-06'),
    rendersOn(REPORTED, '2026-10-05', '2026-12-06'),
  )
})

test('biweekly renders nothing after end_date', () => {
  // Dec 16 and Dec 30 are on-parity Wednesdays; end_date must still win.
  assert.deepEqual(rendersOn(REPORTED, '2026-12-03', '2027-01-31'), [])
})

test('biweekly renders nothing before start_date', () => {
  // Sep 23 is an on-parity Wednesday two weeks before start_date.
  assert.deepEqual(rendersOn(REPORTED, '2026-08-01', '2026-10-06'), [])
})

test('weekly activity is unaffected by the biweekly anchoring change', () => {
  const weekly = {
    ...REPORTED,
    id: 'weekly-1',
    frequency: 'weekly' as const,
    start_date: '2026-09-02',
    end_date: '2026-09-23',
    created_at: '2026-08-20T12:00:00.000Z',
  }
  assert.deepEqual(
    rendersOn(weekly, '2026-08-30', '2026-09-30'),
    ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23'],
  )
})

test('multi-day biweekly keeps both days in the same week bucket', () => {
  // Mon (0) + Wed (2), starting on a Wednesday. The Monday of the start week
  // is BEFORE start_date so it is clamped out, but the following on-parity
  // week must show both its Monday and its Wednesday. A 7-day-blocks-from-
  // anchor rule would have split the two days into opposite parities.
  const monAndWed = { ...REPORTED, days: [0, 2], end_date: '2026-11-05' }
  assert.deepEqual(
    rendersOn(monAndWed, '2026-10-05', '2026-11-05'),
    ['2026-10-07', '2026-10-19', '2026-10-21', '2026-11-02', '2026-11-04'],
  )
})

test('biweekly with no start_date keeps the legacy created_at cadence', () => {
  const legacy = { ...REPORTED, start_date: null, end_date: null }
  // created_at 2026-09-30 (a Wednesday) → that Wednesday and every other one.
  assert.deepEqual(
    rendersOn(legacy, '2026-09-30', '2026-11-05'),
    ['2026-09-30', '2026-10-14', '2026-10-28'],
  )
})

test('biweeklyOccursOn parses start_date as a local date, not UTC', () => {
  // new Date("2026-10-07") is Oct 6 in every US timezone. If start_date were
  // parsed that way, the Oct 7 anchor would sit in the wrong week whenever the
  // shift crosses a Sunday/Monday boundary. Sunday start_date is the case that
  // exposes it: 2026-10-11 is a Sunday, so UTC parsing yields Sat Oct 10, which
  // belongs to the PREVIOUS Mon-Sun week.
  const sundayStart = { start_date: '2026-10-11', created_at: null }
  const wedInStartWeek = new Date(2026, 9, 7) // Wed Oct 7, same Mon-Sun week
  const wedNextWeek = new Date(2026, 9, 14)
  assert.equal(biweeklyOccursOn(sundayStart, wedInStartWeek), true)
  assert.equal(biweeklyOccursOn(sundayStart, wedNextWeek), false)
})

test('biweeklyOccursOn stays correct for dates before the anchor week', () => {
  const activity = { start_date: '2026-10-07', created_at: null }
  assert.equal(biweeklyOccursOn(activity, new Date(2026, 8, 23)), true)  // 2 weeks before
  assert.equal(biweeklyOccursOn(activity, new Date(2026, 8, 30)), false) // 1 week before
})
