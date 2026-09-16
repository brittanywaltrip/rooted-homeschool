// The builder's one pace control: what it says, and what it does.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  baselineCount,
  dayNeedsBadge,
  hasVariedCounts,
  lessonDayIndices,
  lessonsPerWeek,
  onDayIndices,
  paceSentence,
  sharedLessonCount,
  withDayCount,
  withSameCountEveryDay,
  type PerDayShape,
} from './builder-pace.ts'

/** Mon..Sun. `on` is the chips, `counts` is what each day is set to. */
function shape(on: number[], counts: Partial<Record<number, number>> = {}, base = 1): PerDayShape {
  return {
    activeDays: Array.from({ length: 7 }, (_, i) => on.includes(i)),
    counts: Array.from({ length: 7 }, (_, i) => counts[i] ?? base),
  }
}

test('the sentence: the same count every day', () => {
  assert.equal(paceSentence(shape([0, 1, 2, 3, 4])), '5 lessons a week, Mon to Fri.')
  assert.equal(paceSentence(shape([0, 2, 4])), '3 lessons a week: Mon, Wed, and Fri.')
  assert.equal(paceSentence(shape([0, 1])), '2 lessons a week: Mon and Tue.')
  assert.equal(paceSentence(shape([0])), '1 lesson a week: Mon.')
  // Mon to Fri at two a day is ten lessons, and still reads as the block.
  assert.equal(paceSentence(shape([0, 1, 2, 3, 4], {}, 2)), '10 lessons a week, Mon to Fri.')
})

test('the sentence: one heavier day is named, and the rest are not', () => {
  // The family from the walkthrough: Mon 1, Tue 1, Wed 2.
  assert.equal(paceSentence(shape([0, 1, 2], { 2: 2 })), '4 lessons a week: Mon, Tue, and Wed (2).')
  assert.equal(
    paceSentence(shape([0, 1, 2, 3, 4], { 4: 3 })),
    '7 lessons a week: Mon, Tue, Wed, Thu, and Fri (3).',
    'five days no longer read as the Mon to Fri block once one of them differs',
  )
})

test('the sentence: a day set to 0 is named as skipped, not dropped', () => {
  assert.equal(
    paceSentence(shape([0, 1, 2, 3], { 2: 0 })),
    '3 lessons a week: Mon, Tue, and Thu. Wed is skipped.',
  )
  assert.equal(
    paceSentence(shape([0, 1, 2, 3], { 2: 0, 3: 0 })),
    '2 lessons a week: Mon and Tue. Wed and Thu are skipped.',
  )
  assert.equal(paceSentence(shape([0], { 0: 0 })), 'No lessons a week: Mon is skipped.')
})

test('the sentence: no days picked yet', () => {
  assert.equal(paceSentence(shape([])), 'No school days picked yet.')
})

test('the shared number, and when it reads "varies"', () => {
  assert.equal(sharedLessonCount(shape([0, 1, 2, 3, 4])), 1)
  assert.equal(sharedLessonCount(shape([0, 1, 2, 3, 4], {}, 2)), 2)
  assert.equal(sharedLessonCount(shape([0, 1, 2], { 2: 2 })), null, 'varies')
  assert.equal(hasVariedCounts(shape([0, 1, 2], { 2: 2 })), true)
  assert.equal(hasVariedCounts(shape([0, 1, 2])), false)
  assert.equal(hasVariedCounts(shape([])), false, 'no days is not "varies"')
  // An off day's parked count never makes the row look varied.
  assert.equal(hasVariedCounts(shape([0, 1], { 5: 3, 6: 2 })), false)
})

test('the baseline is the most common count, lowest wins a tie', () => {
  assert.equal(baselineCount(shape([0, 1, 2], { 2: 2 })), 1)
  assert.equal(baselineCount(shape([0, 1, 2], { 0: 2, 1: 2 })), 2)
  assert.equal(baselineCount(shape([0, 1], { 1: 2 })), 1, 'a two-way tie takes the lower')
})

test('a chip is badged only when it is on and differs', () => {
  const varied = shape([0, 1, 2], { 2: 2 })
  assert.equal(dayNeedsBadge(varied, 2), true)
  assert.equal(dayNeedsBadge(varied, 0), false)
  assert.equal(dayNeedsBadge(varied, 5), false, 'an off day is never badged')
  assert.equal(dayNeedsBadge(shape([0, 1, 2]), 2), false, 'nothing differs, nothing is badged')
  assert.equal(dayNeedsBadge(shape([0, 1, 2], { 2: 0 }), 2), true, 'a skipped day differs too')
})

test('"Same on every day" resets every on-day and leaves off-days parked', () => {
  const varied = shape([0, 1, 2], { 2: 2, 5: 3 })
  const reset = withSameCountEveryDay(varied, 1)
  assert.deepEqual(reset.slice(0, 3), [1, 1, 1])
  assert.equal(reset[5], 3, "an off day keeps the count it will resume with")
  assert.equal(hasVariedCounts({ ...varied, counts: reset }), false)
})

test('expanding and collapsing round-trips the counts without loss', () => {
  // Expanding is a view, not a write: the arrays are the same object either way.
  const start = shape([0, 1, 2, 3, 4])
  const afterEdit = { ...start, counts: withDayCount(start, 2, 2) }
  assert.deepEqual([...afterEdit.counts], [1, 1, 2, 1, 1, 1, 1])
  assert.equal(hasVariedCounts(afterEdit), true, 'so the section opens on load')

  // Collapse with "Same on every day", then set Wednesday again: back where it was.
  const collapsed = { ...afterEdit, counts: withSameCountEveryDay(afterEdit, 1) }
  assert.deepEqual([...collapsed.counts], [1, 1, 1, 1, 1, 1, 1])
  const reExpanded = { ...collapsed, counts: withDayCount(collapsed, 2, 2) }
  assert.deepEqual([...reExpanded.counts], [...afterEdit.counts])
})

test('per-day counts clamp to 0..3, and 0 keeps the day chosen', () => {
  const p = shape([0, 1, 2])
  assert.equal(withDayCount(p, 1, 9)[1], 3)
  assert.equal(withDayCount(p, 1, -4)[1], 0)
  const zeroed = { ...p, counts: withDayCount(p, 1, 0) }
  assert.deepEqual(onDayIndices(zeroed), [0, 1, 2], 'the chip stays on')
  assert.deepEqual(lessonDayIndices(zeroed), [0, 2], 'but it produces nothing')
  assert.equal(lessonsPerWeek(zeroed), 2)
})
