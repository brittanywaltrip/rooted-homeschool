// The one-row self-heal that puts back the lesson a family is due next.
//
// "Today projection missing lesson rows" is a real missing row. On 2026-09-13
// the founder found 23 live curricula across 2 families where the row for
// current_lesson + 1 did not exist at all, and put them back by hand. Today
// writes it now instead of filing a warning about it.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { planNextRow, type NextRowGoal } from './healNextRow.ts'

const GOAL: NextRowGoal = {
  id: 'goal-1',
  child_id: 'zoe',
  curriculum_name: 'Easy Peasy Computer 8',
  current_lesson: 9,
  total_lessons: 40,
}

test('plans the missing next row with the projector\'s own slot and date', () => {
  const row = planNextRow({ goal: GOAL, userId: 'u1', slot: 10, date: '2026-09-14', existingRowCount: 38 })
  assert.ok(row)
  assert.equal(row!.lesson_number, 10)
  assert.equal(row!.queue_position, 10, 'never null: a slotless goal row is invisible to Today')
  assert.equal(row!.scheduled_date, '2026-09-14')
  assert.equal(row!.date, '2026-09-14')
  assert.equal(row!.scheduled_source, 'today_self_heal')
  assert.equal(row!.completed, false, 'the family has not done it; the row stopped existing')
  assert.equal(row!.completed_at, null)
  assert.equal(row!.is_backfill, false)
  assert.equal(row!.child_id, 'zoe', 'a row with no child never reaches that child anywhere')
  assert.equal(row!.title, 'Easy Peasy Computer 8 — Lesson 10')
  assert.equal(row!.user_id, 'u1')
})

test('heals only the lesson that is in the way, never a deeper hole', () => {
  // A gap further down the queue is a different shape and keeps its warning.
  assert.equal(
    planNextRow({ goal: GOAL, userId: 'u1', slot: 12, date: '2026-09-16', existingRowCount: 38 }),
    null,
  )
  // And the slot below the pointer is history, not a missing next lesson.
  assert.equal(
    planNextRow({ goal: GOAL, userId: 'u1', slot: 9, date: '2026-09-14', existingRowCount: 38 }),
    null,
  )
})

test('declines an empty goal, which is healEmptyGoal\'s case and not this one', () => {
  assert.equal(
    planNextRow({ goal: { ...GOAL, current_lesson: 0 }, userId: 'u1', slot: 1, date: '2026-09-14', existingRowCount: 0 }),
    null,
  )
  // With rows present the same goal IS healed.
  assert.ok(
    planNextRow({ goal: { ...GOAL, current_lesson: 0 }, userId: 'u1', slot: 1, date: '2026-09-14', existingRowCount: 51 }),
  )
})

test('never writes past the end of the curriculum, or on a bad date', () => {
  assert.equal(
    planNextRow({ goal: { ...GOAL, current_lesson: 40 }, userId: 'u1', slot: 41, date: '2026-09-14', existingRowCount: 40 }),
    null,
  )
  assert.equal(
    planNextRow({ goal: GOAL, userId: 'u1', slot: 10, date: 'not-a-date', existingRowCount: 38 }),
    null,
  )
  assert.equal(
    planNextRow({ goal: GOAL, userId: 'u1', slot: 0, date: '2026-09-14', existingRowCount: 38 }),
    null,
  )
})

test('a goal with no name still gets a readable title', () => {
  const row = planNextRow({
    goal: { ...GOAL, curriculum_name: null },
    userId: 'u1', slot: 10, date: '2026-09-14', existingRowCount: 38,
  })
  assert.equal(row!.title, 'Lesson — Lesson 10'.replace('Lesson — ', 'Lesson — '))
  assert.ok(row!.title.includes('Lesson 10'))
})

test('the Today heal reads BOTH gap halves, or it never fires for the reported shape', () => {
  // splitProjectionGaps sends a goal to `full` whenever missing >= projected.
  // The 23 curricula this exists for are one lesson a day: one slot projected
  // for today, that one slot missing, so projected === missing and they land in
  // `full`. Reading only `partial` meant the heal could never run for any of
  // them. What separates this heal from healEmptyGoal is the goal's ROW COUNT,
  // not the ratio.
  const src = readFileSync(resolve(process.cwd(), 'app/dashboard/page.tsx'), 'utf-8')
  assert.match(src, /const nextRowCandidates = \[\.\.\.partialGaps, \.\.\.fullGaps\]\.filter\(missingFirstSlot\)/)
  assert.match(src, /countLessonRowsByGoal\(/, 'and it decides on a row count')
  assert.match(
    src,
    /if \(!isOldEnoughToHeal\(\(goal as \{ created_at\?: string \| null \}\)\.created_at\)\) continue/,
    'a goal whose phase 2 may still be running in another tab is left alone',
  )
})

test('a 23505 on the heal is a good outcome, not a warning', () => {
  // The row exists again, which is what we wanted. The 860 orphan-damaged rows
  // hold a lesson_number with a drifted or null slot, so this is reachable.
  const src = readFileSync(resolve(process.cwd(), 'app/lib/healNextRow.ts'), 'utf-8')
  assert.match(src, /if \(\(error as \{ code\?: string \}\)\.code === "23505"\) return false/)
  assert.match(src, /phase: "next_row_self_heal"/)
  assert.match(src, /level: "warning"/)
})
