// Moving one lesson: Plan and Today must agree on every lesson's day.
//
// Plan draws each lesson on its stored scheduled_date. Today draws the
// projector's answer: computeNextLessonsForGoal over the goal's queue slots and
// holds (pins and skips) from today. So "what Plan shows" is the rows, and
// "what Today shows" is the projection over the same rows; the family sees a
// contradiction whenever the two differ for an unfinished lesson dated today
// or later. That comparison is `disagreements()` below, and it is the
// regression: "Move just this lesson" must leave it empty, and so must "Shift
// all remaining lessons forward", which must also actually shift.
//
// The shape is the one reproduced on rooted-staging 2026-09-24 (and a
// family's, August 2026): 20 lessons, 1 a day Monday to Friday, lessons 1 to
// 3 done, lesson 4 due today (Thursday), moved to next Tuesday.
//
// Run with: node --test app/lib/move-keep-slot.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  computeNextLessonsForGoal,
  queueHoldsFromRows,
  planQueueMove,
  nthSchoolDay,
  type CurriculumGoalConfig,
} from './scheduler.ts'
import {
  MOVE_HOLD_SOURCE,
  bookOrderView,
  keepSlotUndoRows,
  parseKeepSlotMove,
  parseRestoreBookOrder,
  planKeepSlotMove,
  queueOutOfBookOrder,
} from './move-keep-slot.ts'

const GOAL = 'g'
const TODAY = '2026-09-24' // Thursday
const TUE = '2026-09-29'

type Row = {
  id: string
  lesson_number: number
  queue_position: number | null
  scheduled_date: string | null
  completed: boolean
  skipped: boolean
  queue_pinned: boolean
  scheduled_source: string
  curriculum_goal_id: string
}

function weekdaysFrom(start: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00`)
  while (out.length < n) {
    const dow = d.getDay()
    if (dow >= 1 && dow <= 5) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
    d.setDate(d.getDate() + 1)
  }
  return out
}

function fixture(): { goal: CurriculumGoalConfig; rows: Row[] } {
  const days = weekdaysFrom('2026-09-21', 20)
  const rows: Row[] = days.map((d, i) => ({
    id: `L${i + 1}`,
    lesson_number: i + 1,
    queue_position: i + 1,
    scheduled_date: d,
    completed: i < 3,
    skipped: false,
    queue_pinned: false,
    scheduled_source: 'wizard_create',
    curriculum_goal_id: GOAL,
  }))
  const goal: CurriculumGoalConfig = {
    id: GOAL,
    total_lessons: 20,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    current_lesson: 3,
    start_date: '2026-09-21',
    lessons_per_day_overrides: null,
  }
  return { goal, rows }
}

/** Today's answer: slot -> date, from the projector over these rows' holds. */
function todayProjection(goal: CurriculumGoalConfig, rows: Row[]): Map<number, string> {
  const holds = queueHoldsFromRows(rows, GOAL)
  const proj = computeNextLessonsForGoal(goal, new Date(`${TODAY}T00:00:00`), 3650, [], 0, holds)
  return new Map(proj.map((p) => [p.lesson_number, p.date]))
}

/** The lessons Today lists for today, by lesson number. */
function todaysLessons(goal: CurriculumGoalConfig, rows: Row[]): number[] {
  const bySlot = todayProjection(goal, rows)
  return [...bySlot.entries()]
    .filter(([, d]) => d === TODAY)
    .map(([slot]) => rows.find((r) => r.queue_position === slot)!.lesson_number)
}

/** Every unfinished lesson whose day on Plan is not its day on Today. */
function disagreements(goal: CurriculumGoalConfig, rows: Row[]): string[] {
  const bySlot = todayProjection(goal, rows)
  return rows
    .filter((r) => !r.completed && !r.skipped && r.queue_position != null && r.scheduled_date != null && r.scheduled_date >= TODAY)
    .filter((r) => bySlot.get(r.queue_position!) !== r.scheduled_date)
    .map((r) => `lesson ${r.lesson_number}: Plan ${r.scheduled_date}, Today ${bySlot.get(r.queue_position!) ?? 'none'}`)
}

/** Apply move_lesson_keep_slot's writes, as planKeepSlotMove decides them. */
function applyKeepSlot(goal: CurriculumGoalConfig, rows: Row[], lessonId: string, target: string, holdBetween: boolean): Row[] {
  const plan = planKeepSlotMove({ rows, lessonId, targetDate: target, localDay: TODAY, currentLesson: goal.current_lesson, holdBetween })
  assert.ok(plan, 'the move is one the function accepts')
  const hold = new Set(plan.holdIds)
  return rows.map((r) =>
    r.id === lessonId
      ? { ...r, scheduled_date: target, queue_pinned: true, scheduled_source: 'plan_move' }
      : hold.has(r.id)
        ? { ...r, queue_pinned: true, scheduled_source: MOVE_HOLD_SOURCE }
        : r,
  )
}

/** Apply move_lesson_to_date's writes, as its mirror planQueueMove decides them. */
function applyQueueMove(rows: Row[], lessonId: string, target: string): Row[] {
  const plan = planQueueMove({ movingLessonId: lessonId, targetDate: target, goalLessons: rows })
  assert.ok(plan && !plan.noop)
  const shift = new Map(plan.shifts.map((s) => [s.id, s.queue_position]))
  return rows.map((r) =>
    r.id === lessonId
      ? { ...r, queue_position: plan.movedNewQp, scheduled_date: target, queue_pinned: true, scheduled_source: 'plan_move' }
      : shift.has(r.id) ? { ...r, queue_position: shift.get(r.id)! } : r,
  )
}

/** reprojectGoalForParent: every unfinished row but `keep` unpinned and dated from the projection. */
function reproject(goal: CurriculumGoalConfig, rows: Row[], keep: string): Row[] {
  const unpinned = rows.map((r) => (r.id === keep || r.completed ? r : { ...r, queue_pinned: false }))
  const bySlot = todayProjection(goal, unpinned)
  return unpinned.map((r) =>
    r.id === keep || r.completed || r.skipped || r.queue_position == null ? r : { ...r, scheduled_date: bySlot.get(r.queue_position) ?? r.scheduled_date },
  )
}

const dateOf = (rows: Row[], n: number) => rows.find((r) => r.lesson_number === n)!.scheduled_date

// ── The fixture is sound ────────────────────────────────────────────────────

test('fixture: before any move, Plan and Today agree and lesson 4 is due today', () => {
  const { goal, rows } = fixture()
  assert.deepEqual(disagreements(goal, rows), [])
  assert.deepEqual(todaysLessons(goal, rows), [4])
})

// ── Move just this lesson ──────────────────────────────────────────────────

test('Move just this lesson: only lesson 4 moves, on Plan AND on Today', () => {
  const { goal, rows } = fixture()
  const after = applyKeepSlot(goal, rows, 'L4', TUE, true)
  assert.deepEqual(disagreements(goal, after), [], 'Plan and Today agree on every lesson')
  assert.deepEqual(todaysLessons(goal, after), [], 'nothing for this curriculum today: lesson 5 stays on Friday')
  for (const n of [5, 6, 7, 8, 9, 10, 20]) assert.equal(dateOf(after, n), dateOf(rows, n), `lesson ${n} kept its date`)
  assert.equal(dateOf(after, 4), TUE)
  assert.deepEqual(after.map((r) => r.queue_position), rows.map((r) => r.queue_position), 'no queue slot changed')
})

test('the old write for the same dialog: move_lesson_to_date renumbers the queue and Today shows lesson 5 today', () => {
  // Pins the defect this change fixes, so the reason for the new path stays
  // written down: Plan kept its promise (lesson 5 on Friday) and Today did not.
  const { goal, rows } = fixture()
  const after = applyQueueMove(rows, 'L4', TUE)
  assert.deepEqual(todaysLessons(goal, after), [5])
  assert.equal(dateOf(after, 5), '2026-09-25', 'Plan still says Friday')
  assert.ok(disagreements(goal, after).length > 0)
})

test('Move just this lesson holds exactly the lessons the pin would push: later slots dated today through the target', () => {
  const { rows } = fixture()
  const plan = planKeepSlotMove({ rows, lessonId: 'L4', targetDate: TUE, localDay: TODAY, currentLesson: 3, holdBetween: true })
  assert.deepEqual(plan?.holdIds, ['L5', 'L6', 'L7'], 'Fri, Mon, and Tue (the target day); lesson 8 on Wednesday is not held')
})

test('Move just this lesson keeps pins, skips, completed history and make-ups as they are, and Plan and Today still agree', () => {
  const { goal, rows } = fixture()
  // Lesson 6 already pinned by the family (on its Monday), lesson 5 skipped,
  // lesson 2 reopened as a make-up on Friday (the day lesson 5 left free).
  const seeded = rows.map((r) =>
    r.lesson_number === 6 ? { ...r, queue_pinned: true, scheduled_source: 'plan_move' }
    : r.lesson_number === 5 ? { ...r, skipped: true, scheduled_date: null }
    : r.lesson_number === 2 ? { ...r, completed: false, queue_pinned: true, scheduled_source: 'reopened', scheduled_date: '2026-09-25' }
    : r,
  )
  assert.deepEqual(disagreements(goal, seeded), [], 'the seeded plan is consistent before the move')
  const plan = planKeepSlotMove({ rows: seeded, lessonId: 'L4', targetDate: TUE, localDay: TODAY, currentLesson: 3, holdBetween: true })
  assert.deepEqual(plan?.holdIds, ['L7'], 'the skip, the existing pin and the completed lessons are never held')
  const after = applyKeepSlot(goal, seeded, 'L4', TUE, true)
  assert.equal(after.find((r) => r.lesson_number === 6)!.scheduled_source, 'plan_move', 'the family pin keeps its source')
  assert.equal(after.find((r) => r.lesson_number === 5)!.skipped, true)
  for (const n of [1, 3]) assert.equal(after.find((r) => r.lesson_number === n)!.completed, true)
  assert.equal(after.find((r) => r.lesson_number === 2)!.scheduled_date, '2026-09-25', 'the make-up keeps its day')
  assert.deepEqual(disagreements(goal, after), [])
})

test('Move just this lesson from an overdue day holds today onward and never holds the overdue lessons', () => {
  const { rows } = fixture()
  // Family is behind: it is Thursday and lessons 4 (Thu) and 5 (Fri) were
  // really due Monday and Tuesday. Lesson 4 is moved to Tuesday.
  const behind = rows.map((r) =>
    r.lesson_number === 4 ? { ...r, scheduled_date: '2026-09-22' }
    : r.lesson_number === 5 ? { ...r, scheduled_date: '2026-09-23' }
    : r,
  )
  const plan = planKeepSlotMove({ rows: behind, lessonId: 'L4', targetDate: TUE, localDay: TODAY, currentLesson: 3, holdBetween: true })
  assert.ok(!plan!.holdIds.includes('L5'), 'an overdue lesson is not pinned to a day already past')
})

test('the capacity rule: the target day holds the moved lesson and its own, and nothing unpinned is stacked beside them', () => {
  const { goal, rows } = fixture()
  const after = applyKeepSlot(goal, rows, 'L4', TUE, true)
  const bySlot = todayProjection(goal, after)
  const onTue = [...bySlot.entries()].filter(([, d]) => d === TUE).map(([s]) => s).sort((a, b) => a - b)
  assert.deepEqual(onTue, [4, 7], 'the family asked for two on Tuesday (soft warning); the projector adds none')
  assert.equal(bySlot.get(8), '2026-09-30', 'lesson 8 keeps Wednesday')
})

test('Undo restores exactly the rows the move changed, from the prior state the function returns', () => {
  const parsed = parseKeepSlotMove({
    status: 'moved',
    moved: { id: 'L4', lesson_number: 4, queue_position: 4, scheduled_date: TODAY, date: TODAY, queue_pinned: false, scheduled_source: 'wizard_create' },
    held: [
      { id: 'L5', lesson_number: 5, queue_position: 5, scheduled_date: '2026-09-25', date: '2026-09-25', queue_pinned: false, scheduled_source: 'wizard_create' },
    ],
  }, null)
  assert.equal(parsed.status, 'moved')
  if (parsed.status !== 'moved') return
  const undo = keepSlotUndoRows(parsed)
  assert.deepEqual(undo.map((r) => [r.id, r.scheduled_date, r.queue_pinned, r.scheduled_source]), [
    ['L4', TODAY, false, 'wizard_create'],
    ['L5', '2026-09-25', false, 'wizard_create'],
  ])
})

// ── Shift all remaining lessons forward ────────────────────────────────────

test('Shift all: every later lesson moves by the school days the dialog named, and the finish date with them', () => {
  const { goal, rows } = fixture()
  const moved = applyKeepSlot(goal, rows, 'L4', TUE, false)
  const after = reproject(goal, moved, 'L4')
  assert.deepEqual(disagreements(goal, after), [])
  assert.deepEqual(todaysLessons(goal, after), [], 'lesson 4 left today and nothing was pulled onto it')
  // Thursday to Tuesday is 3 school days, which is what the dialog says.
  for (const n of [5, 6, 7, 20]) {
    assert.equal(dateOf(after, n), nthSchoolDay(dateOf(rows, n)!, goal.school_days!, 3, []), `lesson ${n} shifted 3 school days`)
  }
  assert.equal(dateOf(after, 20), '2026-10-21', 'the finish date the dialog promised (Oct 21, 2026)')
  assert.deepEqual(after.map((r) => r.queue_position), rows.map((r) => r.queue_position), 'queue order unchanged')
})

test('the old write for Shift all: renumbering first made the re-spread pull the later lessons EARLIER', () => {
  const { goal, rows } = fixture()
  const after = reproject(goal, applyQueueMove(rows, 'L4', TUE), 'L4')
  assert.deepEqual(todaysLessons(goal, after), [5], 'lesson 5 landed on today')
  assert.equal(dateOf(after, 20), '2026-10-16', 'and the finish date never moved')
})

// ── The rule's edges ───────────────────────────────────────────────────────

test('planKeepSlotMove refuses what the function refuses: earlier or same day, completed, skipped, no slot', () => {
  const { rows } = fixture()
  const ask = (id: string, target: string, rs = rows) => planKeepSlotMove({ rows: rs, lessonId: id, targetDate: target, localDay: TODAY, currentLesson: 3, holdBetween: true })
  assert.equal(ask('L5', TODAY), null)
  assert.equal(ask('L5', '2026-09-25'), null)
  assert.equal(ask('L2', TUE), null)
  assert.equal(ask('L5', TUE, rows.map((r) => (r.id === 'L5' ? { ...r, skipped: true } : r))), null)
  assert.equal(ask('L5', TUE, rows.map((r) => (r.id === 'L5' ? { ...r, queue_position: null } : r))), null)
})

test('a make-up holds no place in the queue, so moving it holds nothing', () => {
  const { rows } = fixture()
  const withMakeUp = rows.map((r) => (r.id === 'L2' ? { ...r, completed: false, queue_pinned: true, scheduled_date: TODAY } : r))
  assert.deepEqual(planKeepSlotMove({ rows: withMakeUp, lessonId: 'L2', targetDate: TUE, localDay: TODAY, currentLesson: 3, holdBetween: true })?.holdIds, [])
})

test('parseKeepSlotMove: a missing function is "unavailable", a refusal is "not_movable", anything else fails closed', () => {
  assert.deepEqual(parseKeepSlotMove(null, { code: 'PGRST202', message: 'x' }), { status: 'unavailable' })
  assert.deepEqual(parseKeepSlotMove({ status: 'not_movable', reason: 'no_slot' }, null), { status: 'not_movable', reason: 'no_slot' })
  assert.equal(parseKeepSlotMove({ status: 'invalid', reason: 'local_day' }, null).status, 'failed')
  assert.equal(parseKeepSlotMove({ status: 'moved', moved: null, held: [] }, null).status, 'failed')
  assert.equal(parseKeepSlotMove(null, { code: '42501', message: 'denied' }).status, 'failed')
})

// ── Book order, for "I'm actually on lesson X" ─────────────────────────────

test('queueOutOfBookOrder: an out-of-order slot is a drift, a gap in the numbering is not', () => {
  assert.equal(queueOutOfBookOrder([{ lesson_number: 5, queue_position: 6 }, { lesson_number: 6, queue_position: 5 }]), true)
  assert.equal(queueOutOfBookOrder([{ lesson_number: 5, queue_position: 5 }, { lesson_number: 7, queue_position: 6 }]), false)
  assert.equal(queueOutOfBookOrder([{ lesson_number: 5, queue_position: null }, { lesson_number: 6, queue_position: 5 }]), false)
})

test('bookOrderView on the stranded-lesson shape: lesson 5 done in slot 6 hid lesson 6; in book order lesson 6 is next', () => {
  const rows = [
    { id: 'L4', lesson_number: 4, queue_position: 4, completed: true },
    { id: 'L5', lesson_number: 5, queue_position: 6, completed: true },
    { id: 'L6', lesson_number: 6, queue_position: 5, completed: false },
    { id: 'L7', lesson_number: 7, queue_position: 7, completed: false },
  ]
  const before = Math.max(...rows.filter((r) => r.completed).map((r) => r.queue_position))
  assert.equal(before, 6, 'the stored pointer: lesson 6 sits behind it')
  const view = bookOrderView(rows, { start_at_lesson: 5, total_lessons: 21 })
  assert.equal(view.drifted, true)
  assert.deepEqual(view.rows.map((r) => [r.lesson_number, r.queue_position]), [[4, 4], [5, 5], [6, 6], [7, 7]])
  assert.equal(view.currentLesson, 5, 'lesson 6 is next')
})

test('parseRestoreBookOrder reads every answer', () => {
  assert.deepEqual(parseRestoreBookOrder({ status: 'restored', changed: 2 }, null), { status: 'restored', changed: 2 })
  assert.deepEqual(parseRestoreBookOrder({ status: 'in_order', changed: 0 }, null), { status: 'in_order' })
  assert.deepEqual(parseRestoreBookOrder(null, { code: 'PGRST202' }), { status: 'unavailable' })
  assert.equal(parseRestoreBookOrder({ status: 'invalid', reason: 'not_owner' }, null).status, 'failed')
})

// ── Every single-move entry point goes through the one write ────────────────

test('Plan: every single-lesson move, and the Shift all trigger lesson, go through move_lesson_keep_slot', () => {
  const src = readFileSync(new URL('../components/PlanV2/index.tsx', import.meta.url), 'utf8')
  // The one writer, with holds, for a later day.
  const writer = src.slice(src.indexOf('const writeSingleMove = useCallback'), src.indexOf('// ── Move a single lesson to a new date'))
  assert.match(writer, /moveLessonKeepSlot\(supabase, \{[^}]*holdBetween: true/)
  assert.match(writer, /toDateStr > fromDateStr/)
  // Both single-move handlers call it, and neither calls the RPC directly any more.
  for (const name of ['const performMove = useCallback', 'const moveLessonToDate = useCallback']) {
    const start = src.indexOf(name)
    const body = src.slice(start, src.indexOf('\n  );\n', start) > 0 ? src.indexOf('}, [', start) : start + 4000)
    assert.match(body, /writeSingleMove\(/, `${name} uses writeSingleMove`)
    assert.doesNotMatch(body, /rpc\("move_lesson_to_date"/, `${name} does not renumber the queue itself`)
  }
  // "Move just this lesson" is performMove.
  assert.match(src, /onMoveJustThis=\{\(\) => \{[\s\S]{0,200}performMove\(c\.lessonId, c\.fromDateStr, c\.toDateStr\)/)
  // Shift all pins the trigger lesson without holds, then re-spreads.
  const shift = src.slice(src.indexOf('const handleShiftAllForward = useCallback'), src.indexOf('// ── Past-date move with optional completion'))
  assert.match(shift, /moveLessonKeepSlot\(supabase, \{[^}]*holdBetween: false/)
  assert.ok(shift.indexOf('moveLessonKeepSlot(') < shift.indexOf('reprojectGoalTail('), 'the pin lands before the re-spread')
})

test('the dialog still offers both choices and still makes its promise', () => {
  const src = readFileSync(new URL('../components/PlanV2/index.tsx', import.meta.url), 'utf8')
  assert.match(src, /Move just this lesson/)
  assert.match(src, /Only this lesson moves\. Lessons after it stay on their dates\./)
  assert.match(src, /Shift all remaining lessons forward/)
})
