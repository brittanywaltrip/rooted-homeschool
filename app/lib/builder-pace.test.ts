// The builder's one pace control: what it says, and what it does.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  baselineCount,
  countCeiling,
  countForNewlyOnDay,
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

/* ── What the review caught: the shapes the new control can produce ──────── */

test('a day turned ON adopts the week\'s count, so an even week stays even', () => {
  // Off days park at 1 (toggleDay resets them; a saved goal hydrates them at 1).
  // A family doing 2 a day who adds Saturday must not be handed "varies" and an
  // overrides map they never asked for.
  const twoADay = shape([0, 1, 2, 3, 4], {}, 2)
  assert.equal(countForNewlyOnDay(twoADay), 2)

  const withSat = {
    activeDays: twoADay.activeDays.map((on, i) => on || i === 5),
    counts: twoADay.counts.map((c, i) => (i === 5 ? countForNewlyOnDay(twoADay) : c)),
  }
  assert.equal(hasVariedCounts(withSat), false, 'still an even week')
  assert.equal(sharedLessonCount(withSat), 2)
  assert.equal(paceSentence(withSat), '12 lessons a week: Mon, Tue, Wed, Thu, Fri, and Sat.')

  // An already uneven week hands the new day the baseline, not a wrong guess.
  assert.equal(countForNewlyOnDay(shape([0, 1, 2], { 2: 2 })), 1)
  // A week where every on-day is skipped still gives the new day a real lesson.
  assert.equal(countForNewlyOnDay(shape([0], { 0: 0 })), 1)
})

test('a stored count above 3 is not dragged down by the stepper', () => {
  // The old builder allowed 10 and the scheduler still clamps at 10. A goal
  // saved at 5 must step down to 4, not be clamped to 3.
  const five = shape([0, 1, 2, 3, 4], {}, 5)
  assert.equal(countCeiling(five, 0), 5)
  assert.equal(withDayCount(five, 0, 4)[0], 4)
  assert.equal(withDayCount(five, 0, 6)[0], 5, 'and it cannot be pushed past what it already is')
  // A normal row still tops out at 3.
  assert.equal(countCeiling(shape([0, 1, 2]), 0), 3)
  assert.equal(withDayCount(shape([0, 1, 2]), 0, 9)[0], 3)
})

test('the row markup: the shared stepper is inert while the days disagree', () => {
  // A single tap on a stepper reading "varies" would flatten the whole
  // overrides map with no undo, and the next save would re-spread the goal.
  const src = readFileSync(resolve(import.meta.dirname, '..', 'dashboard/plan/schedule/page.tsx'), 'utf8')
  assert.match(src, /if \(varies\) return;/, 'setEveryDayCount refuses while varied')
  assert.match(src, /disabled=\{isReadOnly \|\| onDays\.length === 0 \|\| varies \|\|/, 'and the button says so')
  assert.match(src, /const perDayOpen = showPerDay \|\| varies/, 'the list opens whenever the days disagree')
  assert.match(src, /countForNewlyOnDay\(\{ activeDays: r\.active_days, counts: r\.per_day_counts \}\)/)
})
