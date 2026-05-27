// Tests for mapLessonDateAcrossVacation. Before Step 1.5, the inline shift
// loop called nthSchoolDay(orig, shiftDays) for every row regardless of
// whether orig sat inside the new block. nthSchoolDay skips break days
// from its count, so every Mon/Tue/Wed/Thu/Fri origin inside a Mon-Fri
// break converged on the same first-real-day-after-break plus shiftDays.
// Verified live on staging: Test 052526 lessons 55-59 all landed on Jul 24
// for a Jul 13-17 break.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mapLessonDateAcrossVacation } from './handleVacationSave.shift.ts'

// Jul 13 2026 is a Monday.
// Break Jul 13 (Mon) - Jul 17 (Fri), Mon-Fri profile, contains 5 teaching days.
const BREAK_START = '2026-07-13'
const BREAK_END = '2026-07-17'
const SHIFT_DAYS = 5
const SCHOOL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const BLOCKS_INCLUDING_NEW = [{ start_date: BREAK_START, end_date: BREAK_END }]

// ── Lessons INSIDE the break each get a distinct post-break day ───────

test('lesson on Mon inside Mon-Fri break maps to Mon after break', () => {
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-13', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
    ),
    '2026-07-20',
  )
})

test('lesson on Tue inside Mon-Fri break maps to Tue after break', () => {
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-14', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
    ),
    '2026-07-21',
  )
})

test('lesson on Wed inside Mon-Fri break maps to Wed after break', () => {
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-15', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
    ),
    '2026-07-22',
  )
})

test('lesson on Thu inside Mon-Fri break maps to Thu after break', () => {
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-16', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
    ),
    '2026-07-23',
  )
})

test('lesson on Fri inside Mon-Fri break maps to Fri after break', () => {
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-17', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
    ),
    '2026-07-24',
  )
})

// ── Lesson AFTER the break gets the straight-line shift ───────────────

test('lesson on Mon AFTER a Mon-Fri break shifts forward by 5 teaching days', () => {
  // Jul 20 (Mon, first teaching day after the break). 5 teaching days
  // forward, accounting for blocksIncludingNew (which is entirely behind
  // Jul 20), is Mon Jul 27.
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-20', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
    ),
    '2026-07-27',
  )
})

test('lesson on Fri AFTER a Mon-Fri break shifts to Fri the following week', () => {
  // Jul 24 (Fri) + 5 teaching days = Jul 31 (Fri).
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-24', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
    ),
    '2026-07-31',
  )
})

// ── Defensive fallback: ordinalWithinBreak == 0 ───────────────────────

test('lesson on non-teaching day at break start (ordinalWithinBreak=0) falls back to straight-line shift', () => {
  // Break Sat Jul 11 - Mon Jul 13. Lesson on Sat Jul 11 (the break start).
  // ordinalWithinBreak = count(Jul 11, Jul 11, [Mon-Fri], []) = 0 because
  // Sat isn't in the Mon-Fri profile. Falls back to nthSchoolDay(Jul 11,
  // [Mon-Fri], shiftDays=1, blocks=[Sat Jul 11 - Mon Jul 13]):
  //   Jul 12 (Sun, not Mon-Fri) skip
  //   Jul 13 (Mon, in vacation block) skip
  //   Jul 14 (Tue) → 1st found ⇒ return Jul 14
  const SATSTART = '2026-07-11'
  const MONEND = '2026-07-13'
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-11', SATSTART, MONEND, SCHOOL_DAYS, 1,
      [{ start_date: SATSTART, end_date: MONEND }],
    ),
    '2026-07-14',
  )
})

// ── Step 1 normalization still kicks in here ──────────────────────────

test('lowercase school_days input still produces correct shift mapping', () => {
  // Same Mon inside Mon-Fri break test, but with the lowercase format
  // that profiles.school_days defaults to for 2,210 users. Proves Step 1's
  // normalizeSchoolDays still kicks in via the downstream helpers.
  assert.equal(
    mapLessonDateAcrossVacation(
      '2026-07-13', BREAK_START, BREAK_END,
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      SHIFT_DAYS,
      BLOCKS_INCLUDING_NEW,
    ),
    '2026-07-20',
  )
})

// ── Empty school_days edge case ───────────────────────────────────────

test('empty school_days array: lesson inside break maps via fallback (no teaching days = ordinal 0)', () => {
  // With school_days=[], every day is non-teaching. countSchoolDaysInRange
  // returns 0, fallback nthSchoolDay also finds nothing and returns the
  // 365-iteration-out cursor. We just assert the result is a sane date
  // string (YYYY-MM-DD) rather than a specific value, since the function
  // is in an unreachable real-world state (DEFAULT_SCHOOL_DAYS protects
  // callers, and a malformed profile would still get something).
  const out = mapLessonDateAcrossVacation(
    '2026-07-13', BREAK_START, BREAK_END, [], SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
  )
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/)
})

// ── Multi-curriculum / lessons_per_day > 1 are inherent ──────────────

test('two lessons with the same orig date inside the break both map to the same post-break day', () => {
  // lessons_per_day=2 means two lessons share the same scheduled_date.
  // The mapper is pure: identical inputs produce identical outputs, so
  // both lessons land on the same post-break day. That preserves the
  // original "two-per-day" rhythm without special-casing.
  const a = mapLessonDateAcrossVacation(
    '2026-07-15', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
  )
  const b = mapLessonDateAcrossVacation(
    '2026-07-15', BREAK_START, BREAK_END, SCHOOL_DAYS, SHIFT_DAYS, BLOCKS_INCLUDING_NEW,
  )
  assert.equal(a, b)
  assert.equal(a, '2026-07-22')
})
