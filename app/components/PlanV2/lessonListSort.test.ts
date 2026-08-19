// Tests for the expanded lesson list's ordering + month grouping.
//
// A family with two kids on the same curriculum reported month headers that
// repeated and jumped around in the expanded list (commit 08b978a). The list
// was sorted by lesson_number while groupLessonsByMonth is a run-length scan
// that opens a header whenever the month differs from the PREVIOUS row, so any
// goal whose dates were not monotonic in lesson order produced
// "August | October | August | September | August".
//
// The first test below pins the OLD behavior as the bug, so if anyone sorts by
// lesson_number again it fails loudly instead of silently regressing the UI.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  cmpLessonNumber,
  cmpLessonForList,
  sortLessonsForList,
  monthKey,
  groupLessonsByMonth,
  type SortableLesson,
} from './lessonListSort.ts'

type Row = SortableLesson & { id: string }

// Dates deliberately NOT monotonic in lesson_number order: lesson 33 sits in
// October, between 32 and 34 which are both in August.
const SCRAMBLED: Row[] = [
  { id: 'a', lesson_number: 31, scheduled_date: '2026-08-03', date: null },
  { id: 'b', lesson_number: 32, scheduled_date: '2026-08-05', date: null },
  { id: 'c', lesson_number: 33, scheduled_date: '2026-10-12', date: null },
  { id: 'd', lesson_number: 34, scheduled_date: '2026-08-07', date: null },
  { id: 'e', lesson_number: 35, scheduled_date: '2026-09-02', date: null },
  { id: 'f', lesson_number: 36, scheduled_date: '2026-08-10', date: null },
  { id: 'g', lesson_number: null, scheduled_date: null, date: null },
]

// ── The regression the module exists to prevent ────────────────────────

test('lesson_number order + run-length grouper repeats month headers (the bug)', () => {
  const byNumber = [...SCRAMBLED].sort(cmpLessonNumber)
  const keys = groupLessonsByMonth(byNumber).map((g) => g.key)
  assert.deepEqual(keys, [
    'August 2026', 'October 2026', 'August 2026', 'September 2026',
    'August 2026', 'Unscheduled',
  ])
  const months = keys.filter((k) => k !== 'Unscheduled')
  assert.ok(months.length > new Set(months).size, 'the bug repeats a month header')
})

test('date order emits each month header exactly once', () => {
  const keys = groupLessonsByMonth(sortLessonsForList(SCRAMBLED)).map((g) => g.key)
  assert.deepEqual(keys, ['August 2026', 'September 2026', 'October 2026', 'Unscheduled'])
  assert.equal(keys.length, new Set(keys).size)
})

// ── Ordering ───────────────────────────────────────────────────────────

test('rows are ordered by date ascending, undated last', () => {
  const sorted = sortLessonsForList(SCRAMBLED)
  assert.deepEqual(sorted.map((l) => l.id), ['a', 'b', 'd', 'f', 'e', 'c', 'g'])
  const dated = sorted.filter((l) => l.scheduled_date ?? l.date)
  for (let i = 1; i < dated.length; i++) {
    const prev = dated[i - 1].scheduled_date ?? dated[i - 1].date
    const cur = dated[i].scheduled_date ?? dated[i].date
    assert.ok(cur! >= prev!, `${cur} must not precede ${prev}`)
  }
})

test('an out-of-order date is shown, not hidden', () => {
  // Lesson 33 really is dated after lesson 34; the list must say so.
  const sorted = sortLessonsForList(SCRAMBLED)
  const i33 = sorted.findIndex((l) => l.lesson_number === 33)
  const i34 = sorted.findIndex((l) => l.lesson_number === 34)
  assert.ok(i33 > i34)
})

test('same-date rows tie-break by lesson_number', () => {
  const tie: Row[] = [
    { id: 'x', lesson_number: 9, scheduled_date: '2026-08-05', date: null },
    { id: 'y', lesson_number: 7, scheduled_date: '2026-08-05', date: null },
    { id: 'z', lesson_number: 8, scheduled_date: '2026-08-05', date: null },
  ]
  assert.deepEqual(sortLessonsForList(tie).map((l) => l.lesson_number), [7, 8, 9])
})

test('falls back to the legacy date column when scheduled_date is null', () => {
  const rows: Row[] = [
    { id: 'p', lesson_number: 2, scheduled_date: null, date: '2026-08-01' },
    { id: 'q', lesson_number: 1, scheduled_date: null, date: '2026-09-01' },
  ]
  assert.deepEqual(sortLessonsForList(rows).map((l) => l.id), ['p', 'q'])
})

test('scheduled_date wins over the legacy date column', () => {
  const rows: Row[] = [
    { id: 'p', lesson_number: 1, scheduled_date: '2026-09-01', date: '2026-08-01' },
    { id: 'q', lesson_number: 2, scheduled_date: '2026-08-15', date: '2026-12-01' },
  ]
  assert.deepEqual(sortLessonsForList(rows).map((l) => l.id), ['q', 'p'])
})

test('two undated rows fall back to lesson_number order', () => {
  const rows: Row[] = [
    { id: 'p', lesson_number: 5, scheduled_date: null, date: null },
    { id: 'q', lesson_number: 2, scheduled_date: null, date: null },
  ]
  assert.deepEqual(sortLessonsForList(rows).map((l) => l.id), ['q', 'p'])
})

test('sortLessonsForList does not mutate its input', () => {
  const before = SCRAMBLED.map((r) => r.id)
  sortLessonsForList(SCRAMBLED)
  assert.deepEqual(SCRAMBLED.map((r) => r.id), before)
})

test('sortLessonsForList returns a new array', () => {
  assert.notEqual(sortLessonsForList(SCRAMBLED), SCRAMBLED)
})

// ── cmpLessonNumber: nulls last ────────────────────────────────────────

test('cmpLessonNumber puts null lesson_number last', () => {
  const a: SortableLesson = { lesson_number: null, scheduled_date: null, date: null }
  const b: SortableLesson = { lesson_number: 1, scheduled_date: null, date: null }
  assert.ok(cmpLessonNumber(a, b) > 0)
  assert.ok(cmpLessonNumber(b, a) < 0)
  assert.equal(cmpLessonNumber(a, a), 0)
})

test('cmpLessonForList is a consistent comparator', () => {
  // Antisymmetry across every pair, so Array.sort cannot behave erratically.
  for (const x of SCRAMBLED) {
    for (const y of SCRAMBLED) {
      // Summed rather than negated: Math.sign can return -0, and strict
      // equality treats -0 and 0 as different.
      assert.equal(
        Math.sign(cmpLessonForList(x, y)) + Math.sign(cmpLessonForList(y, x)),
        0,
      )
    }
  }
})

// ── monthKey ───────────────────────────────────────────────────────────

test('monthKey labels a date and handles missing/!malformed input', () => {
  assert.equal(monthKey('2026-08-03'), 'August 2026')
  assert.equal(monthKey(null), 'Unscheduled')
  assert.equal(monthKey(undefined), 'Unscheduled')
  assert.equal(monthKey(''), 'Unscheduled')
  assert.equal(monthKey('not-a-date'), 'Unscheduled')
})

test('same month across different years does not merge', () => {
  const rows: Row[] = [
    { id: 'p', lesson_number: 1, scheduled_date: '2026-08-30', date: null },
    { id: 'q', lesson_number: 2, scheduled_date: '2027-08-02', date: null },
  ]
  const keys = groupLessonsByMonth(sortLessonsForList(rows)).map((g) => g.key)
  assert.deepEqual(keys, ['August 2026', 'August 2027'])
})

test('grouping an empty list yields no groups', () => {
  assert.deepEqual(groupLessonsByMonth([]), [])
})

test('every input row survives grouping exactly once', () => {
  const groups = groupLessonsByMonth(sortLessonsForList(SCRAMBLED))
  const ids = groups.flatMap((g) => g.rows.map((r) => r.id))
  assert.equal(ids.length, SCRAMBLED.length)
  assert.deepEqual([...ids].sort(), SCRAMBLED.map((r) => r.id).sort())
})

// ── Continuation chains ────────────────────────────────────────────────

import { buildContinuationDayMap, groupChainRows, type ChainableLesson } from './lessonListSort.ts'

type Chain = ChainableLesson

const PARENT: Chain = { id: 'p', lesson_number: 8, scheduled_date: '2026-08-17', date: null, continues_lesson_id: null }
const CONT_A: Chain = { id: 'c1', lesson_number: null, scheduled_date: '2026-08-18', date: null, continues_lesson_id: 'p' }
const CONT_B: Chain = { id: 'c2', lesson_number: null, scheduled_date: '2026-08-19', date: null, continues_lesson_id: 'p' }
const SIBLING: Chain = { id: 's', lesson_number: 9, scheduled_date: '2026-08-18', date: null, continues_lesson_id: null }

test('day map numbers a parent and its continuations in date order', () => {
  const m = buildContinuationDayMap([CONT_B, PARENT, CONT_A])
  assert.deepEqual(m.get('p'), { day: 1, total: 3 })
  assert.deepEqual(m.get('c1'), { day: 2, total: 3 })
  assert.deepEqual(m.get('c2'), { day: 3, total: 3 })
})

test('a lesson with no continuations is absent from the day map', () => {
  const m = buildContinuationDayMap([PARENT, SIBLING])
  assert.equal(m.size, 0, 'no chains means no labels to render')
})

test('a continuation whose parent is not loaded gets no label', () => {
  const m = buildContinuationDayMap([CONT_A]) // parent 'p' absent
  assert.equal(m.size, 0)
})

test('groupChainRows pulls continuations up next to their parent', () => {
  // Date order alone interleaves the sibling between parent and its day 2.
  const dateOrder = sortLessonsForList([PARENT, SIBLING, CONT_A, CONT_B])
  assert.deepEqual(dateOrder.map((r) => r.id), ['p', 's', 'c1', 'c2'])
  assert.deepEqual(groupChainRows(dateOrder).map((r) => r.id), ['p', 'c1', 'c2', 's'])
})

test('groupChainRows leaves a chainless list untouched', () => {
  const rows = sortLessonsForList([PARENT, SIBLING])
  assert.equal(groupChainRows(rows), rows, 'same reference when there is nothing to move')
})

test('groupChainRows leaves a continuation put when its parent is in another month', () => {
  const orphanInMonth: Chain = { id: 'c9', lesson_number: null, scheduled_date: '2026-09-01', date: null, continues_lesson_id: 'p' }
  const septemberRows = [orphanInMonth]
  assert.deepEqual(groupChainRows(septemberRows).map((r) => r.id), ['c9'])
})

test('groupChainRows preserves every row exactly once', () => {
  const rows = sortLessonsForList([PARENT, SIBLING, CONT_A, CONT_B])
  const out = groupChainRows(rows)
  assert.equal(out.length, rows.length)
  assert.deepEqual(out.map((r) => r.id).sort(), rows.map((r) => r.id).sort())
})

test('month headers survive chain grouping applied per month', () => {
  const rows = sortLessonsForList([PARENT, SIBLING, CONT_A, CONT_B])
  const groups = groupLessonsByMonth(rows).map((g) => ({ key: g.key, rows: groupChainRows(g.rows) }))
  assert.deepEqual(groups.map((g) => g.key), ['August 2026'])
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['p', 'c1', 'c2', 's'])
})
