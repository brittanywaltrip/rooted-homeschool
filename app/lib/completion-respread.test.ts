// Completing or un-completing a lesson moves the queue pointer. Today projects
// from the pointer, so Today moves at once; Plan reads the stored
// scheduled_date, which only a re-date updates. With the automatic page-load
// reconciler switched off (NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED=false), nothing
// re-dated after a completion, so Plan and Today disagreed. These tests
// reproduce that gap, then check that the parent re-date after a completion
// (source 'completion_respread') or an un-completion ('uncomplete_respread')
// makes Plan agree with Today's own projector while keeping pins, school days,
// breaks, the per-day cap, queue order and completed history.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeNextLessonsForGoal,
  recomputeCurrentLesson,
  resyncGoalsForParent,
  PARENT_RESPREAD_SOURCE,
  type CurriculumGoalConfig,
  type VacationBlock,
} from './scheduler.ts'
import { buildCompletionPayload } from './completeLessonOnDate.ts'
import { makeMemorySupabase } from './test-helpers/memory-supabase.ts'

const USER = 'u1'
const GOAL = 'g1'

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function plus(n: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}
const TODAY = ymd(plus(0))
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Every weekday except today's: today is not a school day. */
const NOT_TODAY = DOW.filter((d) => d !== DOW[new Date().getDay()])

type Row = Record<string, unknown>

/** 12 lessons, 1/day, every day a school day (so "today" always has a slot
 *  whatever day the suite runs). Lessons 1-2 done long ago; 3-12 stored on
 *  consecutive days starting at `firstDay` days from today. */
function goalFixture(opts: { firstDay?: number; schoolDays?: string[]; vac?: VacationBlock[]; pinned?: { n: number; day: number } } = {}) {
  const schoolDays = opts.schoolDays ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const goalRow: Row = {
    id: GOAL, user_id: USER, total_lessons: 12, lessons_per_day: 1, school_days: schoolDays,
    current_lesson: 2, start_date: null, start_at_lesson: 1, lessons_per_day_overrides: null,
  }
  // Unless told otherwise, the stored dates start out exactly as Today
  // projects them, so any disagreement later is caused by the test's action.
  const initial = new Map(
    computeNextLessonsForGoal(goalRow as unknown as CurriculumGoalConfig, new Date(), 3650, opts.vac ?? [], 0, [])
      .map((p) => [p.lesson_number, p.date]),
  )
  const lessons: Row[] = []
  for (let n = 1; n <= 12; n++) {
    const done = n <= 2
    const day = done
      ? ymd(plus(-30 + n))
      : opts.firstDay !== undefined ? ymd(plus(opts.firstDay + (n - 3))) : (initial.get(n) as string)
    lessons.push({
      id: `L${n}`, user_id: USER, curriculum_goal_id: GOAL, lesson_number: n, queue_position: n,
      completed: done, completed_at: done ? new Date(`${day}T12:00:00`).toISOString() : null,
      scheduled_date: day, date: day, scheduled_source: done ? 'completion_today' : 'queue_resync',
      is_backfill: false, queue_pinned: false, skipped: false,
    })
  }
  if (opts.pinned) {
    const day = ymd(plus(opts.pinned.day))
    Object.assign(lessons.find((r) => r.lesson_number === opts.pinned!.n)!, {
      queue_pinned: true, scheduled_date: day, date: day, scheduled_source: 'plan_move',
    })
  }
  return { goalRow, lessons }
}

/** What Today shows: the shared projector, from the stored pointer, counting
 *  lessons whose completed_at falls today, with pins and skips held. */
function todayView(tables: Record<string, Row[]>, vac: VacationBlock[]) {
  const g = tables.curriculum_goals[0] as unknown as CurriculumGoalConfig
  const rows = tables.lessons.filter((r) => r.curriculum_goal_id === GOAL)
  // By the LOCAL date of completed_at, as Today counts it. Slicing the ISO
  // string took the UTC date and broke every evening west of Greenwich.
  const doneToday = rows.filter((r) => r.completed && r.completed_at && ymd(new Date(r.completed_at as string)) === TODAY).length
  const holds = rows
    .filter((r) => !r.completed && (r.queue_pinned || r.skipped))
    .map((r) => (r.skipped ? { slot: r.queue_position as number, skipped: true as const } : { slot: r.queue_position as number, date: r.scheduled_date as string }))
  const proj = computeNextLessonsForGoal(g, new Date(), 3650, vac, doneToday, holds as never)
  return new Map(proj.map((p) => [p.lesson_number, p.date]))
}

/** Plan's stored date for every incomplete, unskipped row, against Today. */
function disagreements(tables: Record<string, Row[]>, vac: VacationBlock[]) {
  const view = todayView(tables, vac)
  return tables.lessons
    .filter((r) => r.curriculum_goal_id === GOAL && !r.completed && !r.skipped)
    .filter((r) => view.get(r.queue_position as number) !== r.scheduled_date)
    .map((r) => ({ n: r.lesson_number, plan: r.scheduled_date, today: view.get(r.queue_position as number) }))
}

async function complete(client: unknown, tables: Record<string, Row[]>, n: number, choice: 'today' | 'planned' | 'picked', dateStr: string) {
  const payload = buildCompletionPayload({ dateStr, choice, todayStr: TODAY })
  Object.assign(tables.lessons.find((r) => r.lesson_number === n)!, payload)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recomputeCurrentLesson(client as any, GOAL)
}

async function uncomplete(client: unknown, tables: Record<string, Row[]>, n: number) {
  // What the Plan and Today un-check writes: back to the queue, dates left alone.
  Object.assign(tables.lessons.find((r) => r.lesson_number === n)!, {
    completed: false, completed_at: null, is_backfill: false, queue_pinned: false, scheduled_source: 'manual_uncomplete',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recomputeCurrentLesson(client as any, GOAL)
}

function completedHistory(tables: Record<string, Row[]>) {
  return JSON.stringify(tables.lessons.filter((r) => r.completed).map((r) => [r.id, r.scheduled_date, r.completed_at, r.queue_position]))
}

function noDayOverCap(tables: Record<string, Row[]>) {
  const perDay = new Map<string, number>()
  for (const r of tables.lessons) {
    if (r.completed || r.skipped || r.queue_pinned || !r.scheduled_date) continue
    perDay.set(r.scheduled_date as string, (perDay.get(r.scheduled_date as string) ?? 0) + 1)
  }
  return [...perDay.values()].every((c) => c <= 1)
}

test('the gap: finishing ahead on a non-school day moves Today but not Plan until the parent re-date runs', async () => {
  // The shape seen in production on 2026-09-21: lessons done "today" on a day
  // that is not a school day, so they do not use up any school day, and the
  // next lesson moves up to the first school day.
  const { goalRow, lessons } = goalFixture({ schoolDays: NOT_TODAY })
  const { client, tables } = makeMemorySupabase({ curriculum_goals: [goalRow], vacation_blocks: [], lessons })
  const next = (n: number) => tables.lessons.find((r) => r.lesson_number === n)!.scheduled_date
  const firstSchoolDay = next(3)
  for (const n of [3, 4, 5]) await complete(client, tables, n, 'today', TODAY)
  assert.equal(tables.curriculum_goals[0].current_lesson, 5)
  const before = disagreements(tables, [])
  assert.ok(before.length > 0, 'reproduces the gap')
  assert.deepEqual(before[0], { n: 6, plan: before[0].plan, today: firstSchoolDay })
  assert.notEqual(before[0].plan, firstSchoolDay)

  const history = completedHistory(tables)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
  assert.equal(res.ok, true)
  assert.ok(res.written > 0)
  assert.deepEqual(disagreements(tables, []), [], 'Plan agrees with Today')
  assert.equal(next(6), firstSchoolDay)
  assert.equal(completedHistory(tables), history, 'completed history untouched')
  for (const r of tables.lessons.filter((r) => !r.completed && r.scheduled_source !== 'queue_resync')) {
    assert.equal(r.scheduled_source, 'completion_respread')
  }
  assert.ok(noDayOverCap(tables))
})

test("finishing ahead on a school day: today's done lessons keep their days, exactly as Today counts them", async () => {
  const { goalRow, lessons } = goalFixture()
  const { client, tables } = makeMemorySupabase({ curriculum_goals: [goalRow], vacation_blocks: [], lessons })
  await complete(client, tables, 3, 'today', TODAY)
  await complete(client, tables, 4, 'today', TODAY)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
  assert.equal(res.ok, true)
  assert.deepEqual(disagreements(tables, []), [])
  // Two done today on a one-a-day curriculum: both done cards stay on today
  // (PR #87: a lesson done today never spills onto tomorrow's capacity), so
  // lesson 5 is tomorrow, which is exactly what Today shows tomorrow. The old
  // projector put the second done card on tomorrow and lesson 5 two days out.
  assert.equal(tables.lessons.find((r) => r.lesson_number === 5)!.scheduled_date, ymd(plus(1)))
})

test('completing overdue work re-dates the rest from today', async () => {
  // Behind: lesson 3 was due two days ago, 4 yesterday, 5 today.
  const { goalRow, lessons } = goalFixture({ firstDay: -2 })
  const { client, tables } = makeMemorySupabase({ curriculum_goals: [goalRow], vacation_blocks: [], lessons })
  // Filed on its planned (past) day: completed_at is noon that day, not today.
  await complete(client, tables, 3, 'planned', ymd(plus(-2)))
  assert.ok(disagreements(tables, []).length > 0, 'lesson 4 still sits on yesterday in Plan')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
  assert.equal(res.ok, true)
  assert.deepEqual(disagreements(tables, []), [])
  assert.equal(tables.lessons.find((r) => r.lesson_number === 4)!.scheduled_date, TODAY, 'a backdated completion does not use up today')
})

test('undoing a completion re-dates the queue so the lesson comes back in order', async () => {
  const { goalRow, lessons } = goalFixture()
  const { client, tables } = makeMemorySupabase({ curriculum_goals: [goalRow], vacation_blocks: [], lessons })
  await complete(client, tables, 3, 'today', TODAY)
  await complete(client, tables, 4, 'today', TODAY)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
  await uncomplete(client, tables, 4)
  assert.equal(tables.curriculum_goals[0].current_lesson, 3)
  assert.ok(disagreements(tables, []).length > 0, 'the tail is a day early for the restored lesson')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.uncompletion)
  assert.equal(res.ok, true)
  assert.deepEqual(disagreements(tables, []), [])
  const four = tables.lessons.find((r) => r.lesson_number === 4)!
  assert.equal(four.scheduled_date, ymd(plus(1)), 'lesson 3 still used today, so 4 is tomorrow')
  assert.equal(four.scheduled_source, 'uncomplete_respread')
})

test('several completions including a backdated one count today exactly like Today', async () => {
  const { goalRow, lessons } = goalFixture({ firstDay: -1 })
  const { client, tables } = makeMemorySupabase({ curriculum_goals: [goalRow], vacation_blocks: [], lessons })
  await complete(client, tables, 3, 'picked', ymd(plus(-5)))  // backdated: not today
  await complete(client, tables, 4, 'today', TODAY)
  await complete(client, tables, 5, 'today', TODAY)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
  assert.equal(res.ok, true)
  assert.deepEqual(disagreements(tables, []), [])
  // Two completions today (4 and 5), the backdated one is not counted: both
  // done cards stay on today (PR #87), so 6 is tomorrow. Counting the
  // backdated one as well would push 6 a day further.
  assert.equal(tables.lessons.find((r) => r.lesson_number === 6)!.scheduled_date, ymd(plus(1)))
  assert.ok(noDayOverCap(tables))
})

test('a pinned future lesson keeps its day, and nothing else lands on it', async () => {
  const { goalRow, lessons } = goalFixture({ pinned: { n: 9, day: 20 } })
  const { client, tables } = makeMemorySupabase({ curriculum_goals: [goalRow], vacation_blocks: [], lessons })
  await complete(client, tables, 3, 'today', TODAY)
  await complete(client, tables, 4, 'today', TODAY)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
  assert.equal(res.ok, true)
  const nine = tables.lessons.find((r) => r.lesson_number === 9)!
  assert.equal(nine.scheduled_date, ymd(plus(20)))
  assert.equal(nine.queue_pinned, true)
  assert.equal(nine.scheduled_source, 'plan_move')
  assert.ok(!tables.lessons.some((r) => r.id !== 'L9' && !r.completed && r.scheduled_date === ymd(plus(20))))
  assert.deepEqual(disagreements(tables, []), [])
  const slots = tables.lessons.map((r) => r.queue_position)
  assert.deepEqual(slots, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'queue order untouched')
})

test('school days and breaks are honoured when the rest is re-dated', async () => {
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const vac: VacationBlock[] = [{ start_date: ymd(plus(3)), end_date: ymd(plus(9)) }]
  const { goalRow, lessons } = goalFixture({ schoolDays: weekdays, vac, firstDay: 0 })
  const { client, tables } = makeMemorySupabase({ curriculum_goals: [goalRow], vacation_blocks: vac.map((v) => ({ ...v, user_id: USER })), lessons })
  await complete(client, tables, 3, 'today', TODAY)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
  assert.equal(res.ok, true)
  assert.deepEqual(disagreements(tables, vac), [])
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  for (const r of tables.lessons.filter((r) => !r.completed && r.scheduled_date)) {
    const d = new Date(`${r.scheduled_date as string}T12:00:00`)
    assert.ok(weekdays.includes(dow[d.getDay()]), `lesson ${r.lesson_number} on a school day`)
    assert.ok(!((r.scheduled_date as string) >= vac[0].start_date && (r.scheduled_date as string) <= vac[0].end_date), `lesson ${r.lesson_number} not in the break`)
  }
})

test('a re-date the database silently refuses is reported, not counted as done', async () => {
  const { goalRow, lessons } = goalFixture({ schoolDays: NOT_TODAY })
  const { client, tables } = makeMemorySupabase(
    { curriculum_goals: [goalRow], vacation_blocks: [], lessons },
    { refuseUpdate: (_t, r) => r.id === 'L7' },
  )
  for (const n of [3, 4, 5]) await complete(client, tables, n, 'today', TODAY)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await resyncGoalsForParent(client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
  assert.equal(res.ok, false)
  assert.deepEqual(res.failedGoals, [GOAL])
})

// ── Wiring: every live completion and un-completion re-dates afterwards ──────
// Inventory 2026-09-21. Paths that already re-date (catch-up Yes via the
// catchUp source, Recalibrate, the Schedule Builder save) and paths that
// cannot move the pointer (off-queue backfill rows, past-year filing) are not
// listed. Dead code (Today's markMissedComplete, logExtraLesson,
// rescheduleMissedDay) is not either.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..', '..')
const src = (p: string) =>
  readFileSync(join(REPO, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a)
  assert.ok(i !== -1, `missing ${a}`)
  const j = s.indexOf(b, i + a.length)
  return s.slice(i, j === -1 ? undefined : j)
}
function redatesAfterRecompute(body: string, redate: RegExp, label: string) {
  const r = body.indexOf('recomputeCurrentLesson(')
  const m = body.search(redate)
  assert.ok(m !== -1, `${label}: re-dates the curriculum`)
  if (r !== -1) assert.ok(m > r, `${label}: re-dates after the pointer moved`)
}

function assertRedateAfterUntick(body: string, redate: RegExp, label: string) {
  const call = body.indexOf('untickLessonThen(')
  assert.ok(call !== -1, `${label}: unticks through the one transaction`)
  const after = body.slice(call)
  const m = after.search(redate)
  assert.ok(m !== -1, `${label}: re-dates the curriculum inside the follow-up`)
  assert.ok(!/\.from\("lessons"\)\s*\.update\(\{\s*completed: false/.test(body), `${label}: no separate un-complete write`)
}

test('Plan: single check, uncheck, bulk done and its undo, logged lessons, past-day and past-date completions re-date', () => {
  const hook = src('app/components/PlanV2/usePlanLessonActions.ts')
  const helper = between(hook, 'const redateAfter = useCallback', 'const completeWithChoice')
  assert.ok(/resyncGoalsForParent\(supabase, effectiveUserId, \[goalId\], PARENT_RESPREAD_SOURCE\[kind\]\)/.test(helper))
  assert.ok(/COMPLETION_RESPREAD_FAILED_NOTE/.test(helper), 'a failed re-date is said')
  redatesAfterRecompute(between(hook, 'const completeWithChoice', 'const toggleLesson'), /redateAfter\([^)]*"completion"\)/, 'Plan check')
  const uncheck = between(hook, 'const patch = (l: T): T => (l.id !== id ? l : { ...l, completed: false });', 'const deleteLesson')
  // PR #87: the uncheck is reopen_lesson (one transaction, confirmed by its
  // status), and the re-date runs in untickLessonThen's `after` step, only
  // once the un-tick and any make-up pin exist.
  assertRedateAfterUntick(uncheck, /redateAfter\([^)]*"uncompletion"\)/, 'Plan uncheck')

  const plan = src('app/components/PlanV2/index.tsx')
  const bulk = between(plan, 'const completeBulk = useCallback', '// ── Bulk: skip')
  const undoAt = bulk.indexOf('onUndo:')
  redatesAfterRecompute(bulk.slice(0, undoAt), /PARENT_RESPREAD_SOURCE\.completion/, 'bulk done')
  redatesAfterRecompute(bulk.slice(undoAt), /PARENT_RESPREAD_SOURCE\.uncompletion/, 'bulk done undo')
  const logged = between(plan, 'const handleSubmitAddLesson = useCallback', 'const handleSubmitEditLesson')
  redatesAfterRecompute(logged.slice(0, logged.indexOf('onUndo:')), /PARENT_RESPREAD_SOURCE\.completion/, 'log a lesson you did')
  assert.ok(/PARENT_RESPREAD_SOURCE\.uncompletion/.test(logged.slice(logged.indexOf('onUndo:'))), 'its undo re-dates')
  const pastDay = between(plan, 'const handleLogCatchUp = useCallback', 'const missedLessonsInView')
  assert.ok(pastDay.indexOf('PARENT_RESPREAD_SOURCE.completion') > pastDay.indexOf('logPastDayLessons('), 'past-day checklist')
  redatesAfterRecompute(between(plan, 'const handlePastDateMove = useCallback', '// ── Vacation block modal handlers'), /PARENT_RESPREAD_SOURCE\.completion/, 'past-date move and complete')
  assert.ok(/onScheduleRedated:/.test(plan) && /onRedateFailed:/.test(plan), 'Plan reloads after a re-date and says when one failed')
})

test('Today: check-off, uncheck, extra lessons and the prior-lesson card re-date', () => {
  const today = src('app/dashboard/page.tsx')
  const helper = between(today, 'async function redateAfterCompletionChange', '\n  }\n')
  assert.ok(/resyncGoalsForParent\(supabase, effectiveUserId, goalIds, PARENT_RESPREAD_SOURCE\[kind\]\)/.test(helper))
  assert.ok(/COMPLETION_RESPREAD_FAILED_NOTE/.test(helper))
  redatesAfterRecompute(between(today, 'async function runCompletion', 'async function beginCompletion'), /redateAfterCompletionChange\([^;]*"completion"\)/, 'Today check-off')
  const uncheck = between(today, 'setLessons(lessons.map((l) => (l.id === id ? { ...l, completed: false } : l)));', 'async function redateAfterCompletionChange')
  assertRedateAfterUntick(uncheck, /redateAfterCompletionChange\([^;]*"uncompletion"\)/, 'Today uncheck')
  redatesAfterRecompute(between(today, 'async function confirmExtraLessons', 'onLogAction({ userId: effectiveUserId, actionType: "lesson" });'), /redateAfterCompletionChange\([^;]*"completion"\)/, 'extra lessons')
  redatesAfterRecompute(between(today, 'async function confirmPriorLessonComplete', 'await loadData();'), /redateAfterCompletionChange\([^;]*"completion"\)/, 'prior-lesson card')
})

test('Reports: editing or deleting a completed record re-dates that curriculum', () => {
  const reports = src('app/dashboard/reports/page.tsx')
  assert.ok(/redateAfterRecordChange\(goalId, "completion"\)/.test(between(reports, 'async function updateLessonRecord', 'async function deleteLessonRecord')))
  const del = between(reports, 'async function deleteLessonRecord', 'async function redateAfterRecordChange')
  assert.ok(del.indexOf('redateAfterRecordChange(goalId, "uncompletion")') > del.indexOf('"delete_report_lesson_record"'))
  assert.ok(/resyncGoalsForParent\(supabase, effectiveUserId, \[goalId\], PARENT_RESPREAD_SOURCE\[kind\]\)/.test(between(reports, 'async function redateAfterRecordChange', '\n  }\n')))
})

test('the completion sources are parent sources, never the automatic one', () => {
  assert.equal(PARENT_RESPREAD_SOURCE.completion, 'completion_respread')
  assert.equal(PARENT_RESPREAD_SOURCE.uncompletion, 'uncomplete_respread')
  assert.ok(!Object.values(PARENT_RESPREAD_SOURCE).includes('queue_resync' as never))
})
