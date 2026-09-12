// Unit tests for the Plan page's within-a-day ordering. Run with:
//   npm test
//
// The order this pins is the one a family reads: one child at a time, timed
// work first, then subject A to Z. What it replaced sorted by lesson_number
// and curriculum_goal_id, which interleaved the children: a two-child day read
// Language Arts Emma, Language Arts Zoe, Math Zoe, Math Emma, so a mother
// working with one child at a time read every other row.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  orderDayLessons,
  groupDayLessonsByChild,
  lessonStartTime,
  lessonSubject,
  goalsById,
  normalizeStartTime,
  formatStartTime,
  type OrderableLesson,
  type OrderableGoal,
} from './dayOrder.ts'

// Zoe is first in the family's list, Emma second.
const CHILDREN = [{ id: 'zoe' }, { id: 'emma' }]

const GOALS: OrderableGoal[] = [
  { id: 'zoe-math', subject_label: 'Math', scheduled_start_time: '09:00:00' },
  { id: 'zoe-la', subject_label: 'Language Arts', scheduled_start_time: null },
  { id: 'zoe-science', subject_label: 'Science', scheduled_start_time: '13:00:00' },
  { id: 'emma-math', subject_label: 'Math', scheduled_start_time: null },
  { id: 'emma-la', subject_label: 'Language Arts', scheduled_start_time: null },
]

function lesson(over: Partial<OrderableLesson> & { id: string }): OrderableLesson {
  return {
    child_id: null,
    curriculum_goal_id: null,
    lesson_number: null,
    ...over,
  }
}

test('a day runs one child at a time, timed work first, then subject A to Z', () => {
  // Deliberately shuffled on the way in, including the exact interleaving the
  // old sort produced.
  const day: OrderableLesson[] = [
    lesson({ id: 'emma-la-1', child_id: 'emma', curriculum_goal_id: 'emma-la', lesson_number: 4 }),
    lesson({ id: 'zoe-la-1', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 4 }),
    lesson({ id: 'zoe-sci-1', child_id: 'zoe', curriculum_goal_id: 'zoe-science', lesson_number: 2 }),
    lesson({ id: 'emma-math-1', child_id: 'emma', curriculum_goal_id: 'emma-math', lesson_number: 9 }),
    lesson({ id: 'zoe-math-1', child_id: 'zoe', curriculum_goal_id: 'zoe-math', lesson_number: 8 }),
    // A one-off for Zoe, logged with no curriculum behind it.
    lesson({ id: 'zoe-oneoff', child_id: 'zoe', title: 'Nature walk' }),
    // A row belonging to no child at all.
    lesson({ id: 'orphan', title: 'Stray row' }),
  ]

  assert.deepEqual(
    orderDayLessons(day, CHILDREN, GOALS).map((l) => l.id),
    [
      // Zoe first, because she is first in the family's list.
      'zoe-math-1',   // 09:00
      'zoe-sci-1',    // 13:00
      'zoe-la-1',     // untimed
      'zoe-oneoff',   // one-off, after her curriculum work
      // Then Emma, both untimed, so subject A to Z.
      'emma-la-1',
      'emma-math-1',
      // Then the row with no child.
      'orphan',
    ],
  )
})

test('a 13:00 lesson sorts after a 9:00 one and before the untimed ones', () => {
  const day: OrderableLesson[] = [
    lesson({ id: 'la', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 1 }),
    lesson({ id: 'sci', child_id: 'zoe', curriculum_goal_id: 'zoe-science', lesson_number: 1 }),
    lesson({ id: 'math', child_id: 'zoe', curriculum_goal_id: 'zoe-math', lesson_number: 1 }),
  ]
  assert.deepEqual(
    orderDayLessons(day, CHILDREN, GOALS).map((l) => l.id),
    ['math', 'sci', 'la'],
  )
})

test('two lessons of the same subject stay in lesson order', () => {
  const day: OrderableLesson[] = [
    lesson({ id: 'b', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 12 }),
    lesson({ id: 'a', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 11 }),
  ]
  assert.deepEqual(orderDayLessons(day, CHILDREN, GOALS).map((l) => l.id), ['a', 'b'])
})

test('the child order is the family order, not alphabetical', () => {
  const day: OrderableLesson[] = [
    lesson({ id: 'emma', child_id: 'emma', curriculum_goal_id: 'emma-math', lesson_number: 1 }),
    lesson({ id: 'zoe', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 1 }),
  ]
  assert.deepEqual(orderDayLessons(day, CHILDREN, GOALS).map((l) => l.id), ['zoe', 'emma'])
  // Reverse the family's list and the day follows it.
  assert.deepEqual(
    orderDayLessons(day, [{ id: 'emma' }, { id: 'zoe' }], GOALS).map((l) => l.id),
    ['emma', 'zoe'],
  )
})

test('a child the family list does not know sorts after the known ones, before no-child rows', () => {
  const day: OrderableLesson[] = [
    lesson({ id: 'orphan', title: 'Stray' }),
    lesson({ id: 'ghost', child_id: 'not-in-list', title: 'Ghost child' }),
    lesson({ id: 'zoe', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 1 }),
  ]
  assert.deepEqual(orderDayLessons(day, CHILDREN, GOALS).map((l) => l.id), ['zoe', 'ghost', 'orphan'])
})

test('a subjectless row sorts last in its bucket rather than under a blank heading', () => {
  const day: OrderableLesson[] = [
    lesson({ id: 'blank', child_id: 'zoe', curriculum_goal_id: 'unknown-goal', lesson_number: 1 }),
    lesson({ id: 'la', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 1 }),
  ]
  assert.deepEqual(orderDayLessons(day, CHILDREN, GOALS).map((l) => l.id), ['la', 'blank'])
})

test('ordering returns a new array and never reshuffles equal rows between renders', () => {
  const day: OrderableLesson[] = [
    lesson({ id: 'a', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 1 }),
    lesson({ id: 'b', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 1 }),
  ]
  const before = day.map((l) => l.id)
  const first = orderDayLessons(day, CHILDREN, GOALS)
  const second = orderDayLessons(day, CHILDREN, GOALS)
  assert.notEqual(first, day, 'a new array, so a memo is not reordered by rendering it')
  assert.deepEqual(day.map((l) => l.id), before, 'the input is untouched')
  assert.deepEqual(first.map((l) => l.id), second.map((l) => l.id), 'stable')
})

test('groupDayLessonsByChild splits the ordered day into one run per child', () => {
  const day: OrderableLesson[] = [
    lesson({ id: 'emma-math', child_id: 'emma', curriculum_goal_id: 'emma-math', lesson_number: 1 }),
    lesson({ id: 'zoe-math', child_id: 'zoe', curriculum_goal_id: 'zoe-math', lesson_number: 1 }),
    lesson({ id: 'zoe-la', child_id: 'zoe', curriculum_goal_id: 'zoe-la', lesson_number: 1 }),
    lesson({ id: 'orphan', title: 'Stray' }),
  ]
  const groups = groupDayLessonsByChild(day, CHILDREN, GOALS)
  assert.deepEqual(
    groups.map((g) => [g.childId, g.rows.map((r) => r.id)]),
    [
      ['zoe', ['zoe-math', 'zoe-la']],
      ['emma', ['emma-math']],
      [null, ['orphan']],
    ],
  )
  // One run per child: a child never appears twice, which is what makes the
  // header safe to render once above the run.
  const ids = groups.map((g) => g.childId)
  assert.equal(new Set(ids).size, ids.length)
})

test('start times normalise and read like a school day', () => {
  assert.equal(normalizeStartTime('09:00:00'), '09:00')
  assert.equal(normalizeStartTime('9:00'), '09:00')
  assert.equal(normalizeStartTime(''), null)
  assert.equal(normalizeStartTime(null), null)
  assert.equal(normalizeStartTime('garbage'), null)
  // Twelve-hour, matching Today and the print sheets. A 1 PM lesson reading
  // "13:00" here and "1 PM" there is the inconsistency this avoids.
  assert.equal(formatStartTime('09:00:00'), '9:00 AM')
  assert.equal(formatStartTime('13:30'), '1:30 PM')
  assert.equal(formatStartTime('00:05'), '12:05 AM')
  assert.equal(formatStartTime('12:00'), '12:00 PM')
  assert.equal(formatStartTime(null), null)
})

test('a lesson reads its time and subject from its goal', () => {
  const byId = goalsById(GOALS)
  const l = lesson({ id: 'x', child_id: 'zoe', curriculum_goal_id: 'zoe-math', lesson_number: 8 })
  assert.equal(lessonStartTime(l, byId), '09:00')
  assert.equal(lessonSubject(l, byId), 'Math')
  // A one-off has neither.
  const oneOff = lesson({ id: 'y', child_id: 'zoe', title: 'Nature walk' })
  assert.equal(lessonStartTime(oneOff, byId), null)
  assert.equal(lessonSubject(oneOff, byId), null)
  // The joined subject_label wins when the goal is not in the loaded set, and
  // the subjects table wins over both.
  assert.equal(
    lessonSubject(lesson({ id: 'z', curriculum_goals: { subject_label: 'History' } }), byId),
    'History',
  )
  assert.equal(
    lessonSubject(
      lesson({ id: 'w', subjects: { name: 'Art', color: null }, curriculum_goals: { subject_label: 'History' } }),
      byId,
    ),
    'Art',
  )
})

test('two children the family list does not know stay in contiguous runs', () => {
  // They share one rank, so without the id tiebreak they sorted by subject and
  // interleaved (A, B, A). Callers render one header per run and key React off
  // the child, so a repeated child dropped rows and duplicated keys.
  const day: OrderableLesson[] = [
    lesson({ id: 'a1', child_id: 'ghost-a', curriculum_goal_id: 'zoe-la', lesson_number: 1 }),
    lesson({ id: 'b1', child_id: 'ghost-b', curriculum_goal_id: 'zoe-math', lesson_number: 1 }),
    lesson({ id: 'a2', child_id: 'ghost-a', curriculum_goal_id: 'zoe-science', lesson_number: 1 }),
  ]
  const groups = groupDayLessonsByChild(day, CHILDREN, GOALS)
  const ids = groups.map((g) => g.childId)
  assert.equal(new Set(ids).size, ids.length, 'each unknown child appears once')
})
