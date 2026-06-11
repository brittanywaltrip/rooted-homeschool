// Tests for lib/school-days.ts. profiles.school_days defaults to lowercase
// full names (["monday","tuesday",...]) for the vast majority of users,
// and curriculum_goals.school_days stores canonical ["Mon","Tue",...].
// Every exported helper must accept both formats and return identical
// results, otherwise vacation shift-forward / push-back / catch-up flows
// silently fail for the lowercase-format families.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeSchoolDays,
  isSchoolDayDate,
  isTeachingDay,
  nthSchoolDay,
  nextSchoolDay,
  countSchoolDaysInRange,
} from './school-days.ts'

// ── normalizeSchoolDays ───────────────────────────────────────────────

test('normalizeSchoolDays: lowercase full names map to canonical abbrev', () => {
  assert.deepEqual(
    normalizeSchoolDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  )
})

test('normalizeSchoolDays: canonical abbrev passes through unchanged', () => {
  assert.deepEqual(
    normalizeSchoolDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']),
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  )
})

test('normalizeSchoolDays: mixed-case duplicates collapse to one canonical entry', () => {
  assert.deepEqual(
    normalizeSchoolDays(['Monday', 'MONDAY', 'mon', 'Mon']),
    ['Mon'],
  )
})

test('normalizeSchoolDays: empty input returns empty array', () => {
  assert.deepEqual(normalizeSchoolDays([]), [])
})

test('normalizeSchoolDays: unknown entries are dropped, valid entries kept', () => {
  assert.deepEqual(normalizeSchoolDays(['xyz', 'monday']), ['Mon'])
})

test('normalizeSchoolDays: weekends normalize too', () => {
  assert.deepEqual(
    normalizeSchoolDays(['saturday', 'SUN', 'sun']),
    ['Sat', 'Sun'],
  )
})

// ── isSchoolDayDate ───────────────────────────────────────────────────

test('isSchoolDayDate: lowercase Mon-Fri profile matches a Monday', () => {
  // Jun 22 2026 is a Monday.
  assert.equal(
    isSchoolDayDate('2026-06-22', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    true,
  )
})

test('isSchoolDayDate: lowercase Mon-Fri profile rejects a Saturday', () => {
  // Jun 20 2026 is a Saturday.
  assert.equal(
    isSchoolDayDate('2026-06-20', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    false,
  )
})

test('isSchoolDayDate: canonical profile matches the same Monday', () => {
  assert.equal(
    isSchoolDayDate('2026-06-22', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']),
    true,
  )
})

// Regression: the dashboard Today page built a long-form lookup key
// (toLocaleDateString weekday:"long" → "monday") and tested it against
// school_days, which stores SHORT form ("Mon".."Sun") for every live
// profile. That made isSchoolDay always false. The dashboard now routes
// through isSchoolDayDate, so these pin the short-form behavior it relies
// on. See app/dashboard/page.tsx loadData().
test('isSchoolDayDate: short-form Mon-Fri profile matches a Wednesday', () => {
  // Jun 24 2026 is a Wednesday.
  assert.equal(
    isSchoolDayDate('2026-06-24', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']),
    true,
  )
})

test('isSchoolDayDate: short-form Mon-Fri profile rejects a Sunday', () => {
  // Jun 21 2026 is a Sunday.
  assert.equal(
    isSchoolDayDate('2026-06-21', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']),
    false,
  )
})

test('isSchoolDayDate: short-form partial-week profile rejects its off day', () => {
  // Mon/Wed/Fri profile. Jun 23 2026 is a Tuesday (off); Jun 24 is a
  // Wednesday (on).
  const mwf = ['Mon', 'Wed', 'Fri']
  assert.equal(isSchoolDayDate('2026-06-23', mwf), false)
  assert.equal(isSchoolDayDate('2026-06-24', mwf), true)
})

// ── countSchoolDaysInRange ────────────────────────────────────────────

test('countSchoolDaysInRange: lowercase profile counts 5 weekdays Mon-Fri', () => {
  // Jun 15 (Mon) through Jun 19 (Fri) 2026.
  assert.equal(
    countSchoolDaysInRange(
      '2026-06-15',
      '2026-06-19',
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      [],
    ),
    5,
  )
})

test('countSchoolDaysInRange: canonical profile returns the same count', () => {
  assert.equal(
    countSchoolDaysInRange(
      '2026-06-15',
      '2026-06-19',
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      [],
    ),
    5,
  )
})

test('countSchoolDaysInRange: vacation block excludes its days from the count', () => {
  assert.equal(
    countSchoolDaysInRange(
      '2026-06-15',
      '2026-06-26',
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      [{ start_date: '2026-06-15', end_date: '2026-06-19' }],
    ),
    5, // Jun 22-26 only, since Jun 15-19 is the vacation
  )
})

// ── nthSchoolDay ──────────────────────────────────────────────────────

test('nthSchoolDay: 5th teaching day after Jun 15 skipping Jun 15-19 vacation lands on Jun 26', () => {
  // Mon Jun 15 -> vacation Jun 15-19. Cursor starts Jun 15, advances day-by-day.
  // First five teaching days: Mon Jun 22, Tue 23, Wed 24, Thu 25, Fri 26.
  assert.equal(
    nthSchoolDay(
      '2026-06-15',
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      5,
      [{ start_date: '2026-06-15', end_date: '2026-06-19' }],
    ),
    '2026-06-26',
  )
})

test('nthSchoolDay: lowercase and canonical produce identical results', () => {
  const lowercase = nthSchoolDay(
    '2026-06-15',
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    3,
  )
  const canonical = nthSchoolDay(
    '2026-06-15',
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    3,
  )
  assert.equal(lowercase, canonical)
})

// ── nextSchoolDay (forwarder; no double-normalize) ───────────────────

test('nextSchoolDay: lowercase profile returns next teaching day', () => {
  // Mon Jun 15 2026 -> next teaching day with Mon-Fri schedule is Tue Jun 16.
  assert.equal(
    nextSchoolDay('2026-06-15', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    '2026-06-16',
  )
})

// ── isTeachingDay ────────────────────────────────────────────────────

test('isTeachingDay: school day but inside vacation returns false', () => {
  assert.equal(
    isTeachingDay(
      '2026-06-17',
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      [{ start_date: '2026-06-15', end_date: '2026-06-19' }],
    ),
    false,
  )
})

test('isTeachingDay: school day outside vacation returns true', () => {
  assert.equal(
    isTeachingDay(
      '2026-06-22',
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      [{ start_date: '2026-06-15', end_date: '2026-06-19' }],
    ),
    true,
  )
})
