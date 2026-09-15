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

import { planNextRow, planNextRowDecision, readNextRowFacts, type NextRowGoal } from './healNextRow.ts'

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

test('the Today heal reads every gap goal and splits the two heals on a row count', () => {
  // splitProjectionGaps sends a one-lesson-a-day goal missing its one slot to
  // `full`. Reading only `partial` meant the heal could never run for the 23
  // curricula it was written for. What separates this heal from healEmptyGoal
  // is the goal's ROW COUNT, not the ratio.
  const src = readFileSync(resolve(process.cwd(), 'app/dashboard/page.tsx'), 'utf-8')
  assert.match(src, /const gapById = new Map\(\[\.\.\.partialGaps, \.\.\.fullGaps\]/)
  assert.match(src, /countLessonRowsByGoal\(supabase, gapGoalIds\)/, 'and it decides on a row count')
  assert.match(src, /if \(!countByGoal\) return;/, 'a count that could not be read acts on nothing')
  assert.match(
    src,
    /if \(!isOldEnoughToHeal\(goal\.created_at\)\) continue;/,
    'a goal whose phase 2 may still be running in another tab is left alone',
  )
})

test('a 23505 on the heal is a good outcome, not a warning', () => {
  // The row exists again, which is what we wanted. The 860 orphan-damaged rows
  // hold a lesson_number with a drifted or null slot, so this is reachable.
  const src = readFileSync(resolve(process.cwd(), 'app/lib/healNextRow.ts'), 'utf-8')
  assert.match(src, /if \(\(error as \{ code\?: string \}\)\.code === "23505"\) return "conflict"/)
  assert.match(src, /phase: "next_row_self_heal"/)
  assert.match(src, /level: "warning"/)
  const page = readFileSync(resolve(process.cwd(), 'app/dashboard/page.tsx'), 'utf-8')
  // But only once a row really holds the slot: the index is on lesson_number,
  // and an orphan-damaged row with that number and no slot conflicts forever
  // while the family's next lesson stays invisible.
  assert.match(page, /if \(outcome === "conflict"\) \{\s*[\s\S]*?const recheck = await readNextRowFacts\(supabase, \[goalId\], \[slot\]\);\s*if \(recheck\.get\(goalId\)\?\.slotsHeld\.has\(slot\)\) continue;\s*skippedBecause = "lesson_number_held_off_slot";/)
})

/* ── Why the heal never wrote in production ────────────────────────────────
 * No row anywhere carried scheduled_source 'today_self_heal' from Sept 13 to
 * Sept 15. The 58 reports that should have triggered it were goals whose row
 * existed (the insert 409'd, correctly). The one goal truly missing its next
 * row, 87790907 (Apologia, lesson 4 absent), was never loaded on Today while
 * lesson 4 was next; the family worked on Plan and completed lesson 5. From
 * then on lesson 4 sits below a completed lesson, and that is history.
 * ─────────────────────────────────────────────────────────────────────── */

const APOLOGIA: NextRowGoal = {
  id: '87790907',
  child_id: 'kid',
  curriculum_name: 'Apologia',
  current_lesson: 3,
  total_lessons: 150,
}

test('87790907 before lesson 5 was done: lesson 4 is next, and the heal writes it', () => {
  const d = planNextRowDecision({
    goal: APOLOGIA, userId: 'u1', slot: 4, date: '2026-09-15', existingRowCount: 8,
    maxCompletedQueuePosition: 3,
  })
  assert.ok('row' in d, 'no guard refuses the true next-row shape')
  if (!('row' in d)) return
  assert.equal(d.row.lesson_number, 4)
  assert.equal(d.row.queue_position, 4)
  assert.equal(d.row.scheduled_date, '2026-09-15')
  assert.equal(d.row.scheduled_source, 'today_self_heal')
})

test('87790907 after lesson 5 was done: lesson 4 is below a completed lesson, never rewritten', () => {
  // Pointer not yet settled (3), lesson 5 already completed.
  const stale = planNextRowDecision({
    goal: APOLOGIA, userId: 'u1', slot: 4, date: '2026-09-15', existingRowCount: 8,
    maxCompletedQueuePosition: 5,
  })
  assert.deepEqual(stale, { skip: 'below_completed' })
  // Pointer settled (5): Today projects slot 6, and slot 4 is not the next lesson.
  const settled = planNextRowDecision({
    goal: { ...APOLOGIA, current_lesson: 5 }, userId: 'u1', slot: 4, date: '2026-09-15', existingRowCount: 8,
    maxCompletedQueuePosition: 5,
  })
  assert.deepEqual(settled, { skip: 'below_completed' })
})

test('every refusal names its reason, for the heal_skipped_because tag', () => {
  const base = { goal: GOAL, userId: 'u1', slot: 10, date: '2026-09-14', existingRowCount: 38 }
  assert.deepEqual(planNextRowDecision({ ...base, existingRowCount: 0 }), { skip: 'empty_goal' })
  assert.deepEqual(planNextRowDecision({ ...base, slot: 0 }), { skip: 'bad_slot' })
  assert.deepEqual(planNextRowDecision({ ...base, goal: { ...GOAL, current_lesson: 40 }, slot: 41 }), { skip: 'past_end' })
  assert.deepEqual(planNextRowDecision({ ...base, skippedSlots: new Set([10]) }), { skip: 'skipped_slot' })
  assert.deepEqual(planNextRowDecision({ ...base, slot: 12 }), { skip: 'not_next_lesson' })
  assert.deepEqual(planNextRowDecision({ ...base, date: 'nope' }), { skip: 'bad_date' })
  assert.ok('row' in planNextRowDecision(base))
  assert.ok(planNextRow(base), 'planNextRow is the same decision, row or null')
})

test('readNextRowFacts: a failed read answers nothing, so nothing is healed or filed', async () => {
  const chain = (result: { data: unknown; error: unknown }) => {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'in', 'eq', 'not', 'order']) c[k] = () => c
    c.limit = async () => result
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
    return c
  }
  const failing = { from: () => chain({ data: null, error: { message: 'Failed to fetch' } }) }
  const facts = await readNextRowFacts(failing as never, ['g1'], [4])
  assert.equal(facts.size, 0)

  const ok = {
    from: (table: string) => {
      if (table === 'curriculum_goals') return chain({ data: [{ id: 'g1', current_lesson: 3 }], error: null })
      return chain({ data: [{ curriculum_goal_id: 'g1', queue_position: 4 }], error: null })
    },
  }
  const got = await readNextRowFacts(ok as never, ['g1'], [4])
  assert.equal(got.get('g1')?.currentLesson, 3)
  assert.ok(got.get('g1')?.slotsHeld.has(4), 'the row at slot 4 is seen in any state')
})
