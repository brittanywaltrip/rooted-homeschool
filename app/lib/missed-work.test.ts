// One definition of missed work for Today and Plan.
//
// Demonstrated before this change: last completion on day -6, lessons 3-7 due
// on days -5 to -1. Marking lesson 3 done on its planned past day re-dated the
// rest (draft PR #84), so Plan's old rule ("stored date before today") listed
// nothing while Today still asked about lessons 4-7. These tests pin the shared
// rule both screens now use, that re-dating alone never answers it, that the
// answers do, and that an overdue lesson which is also today's is flagged.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeNextLessonsForGoal,
  loadPinsByGoal,
  recomputeCurrentLesson,
  resyncGoalsForParent,
  PARENT_RESPREAD_SOURCE,
  type CurriculumGoalConfig,
} from './scheduler.ts'
import { buildCompletionPayload } from './completeLessonOnDate.ts'
import { computeMissedWork, latestCompletionByGoal, loadMissedWork, gapStartForGoal } from './missed-work.ts'
import { answerMissedNo, answerMissedYes, type MissedAnswerDeps } from './missed-work-answers.ts'
import type { MissedEntry } from './recoverySelection.ts'
import { makeMemorySupabase } from './test-helpers/memory-supabase.ts'

const USER = 'u1'
const GOAL = 'g1'
type Row = Record<string, unknown>

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function day(n: number, hour = 12): Date {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}
const TODAY = ymd(day(0))
const EVERY_DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** 12 lessons, one a day, every day a school day. 1-2 done on days -7 and -6;
 *  3-12 stored where the plan put them on day -5. */
function seed() {
  const goal: Row = {
    id: GOAL, user_id: USER, total_lessons: 12, current_lesson: 2, lessons_per_day: 1,
    lessons_per_day_overrides: null, school_days: EVERY_DAY, start_date: ymd(day(-7)), archived: false,
    catchup_answered_on: null, curriculum_name: 'Singapore Math', subject_label: 'Math', child_id: 'k1',
  }
  const planned = new Map(
    computeNextLessonsForGoal(goal as unknown as CurriculumGoalConfig, day(-5), 3650, [], 0, [])
      .map((p) => [p.lesson_number, p.date]),
  )
  const lessons: Row[] = []
  for (let n = 1; n <= 12; n++) {
    const done = n <= 2
    const d = done ? ymd(day(-8 + n)) : (planned.get(n) as string)
    lessons.push({
      id: `L${n}`, user_id: USER, curriculum_goal_id: GOAL, lesson_number: n, queue_position: n,
      completed: done, completed_at: done ? day(-8 + n).toISOString() : null,
      scheduled_date: d, date: d, scheduled_source: 'schedule_builder',
      is_backfill: false, queue_pinned: false, skipped: false,
    })
  }
  return makeMemorySupabase({ curriculum_goals: [goal], lessons, vacation_blocks: [], subjects: [{ id: 's1', user_id: USER, name: 'Math' }] })
}

/** What Today computes, from the same inputs its loadData holds. */
async function todaySide(db: ReturnType<typeof seed>): Promise<Map<string, MissedEntry[]>> {
  const t = db.tables
  const comps = t.lessons
    .filter((r) => r.completed && r.completed_at)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))) as Array<{ curriculum_goal_id: string; completed_at: string }>
  const doneToday = new Map<string, number>()
  for (const r of comps) if (ymd(new Date(r.completed_at)) === TODAY) doneToday.set(r.curriculum_goal_id, (doneToday.get(r.curriculum_goal_id) ?? 0) + 1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const holds = await loadPinsByGoal(db.client as any, USER)
  return computeMissedWork({
    goals: t.curriculum_goals.filter((g) => (g.current_lesson as number) < (g.total_lessons as number)) as never,
    lastCompletedByGoal: latestCompletionByGoal(comps),
    anyCompletion: comps.length > 0,
    todayMid: new Date(TODAY + 'T00:00:00'),
    vacations: [],
    holdsByGoal: holds,
    doneTodayByGoal: doneToday,
  })
}
async function planSide(db: ReturnType<typeof seed>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await loadMissedWork(db.client as any, USER)
  assert.ok(res)
  return res.entriesByGoal
}
const brief = (m: Map<string, MissedEntry[]>) =>
  (m.get(GOAL) ?? []).map((e) => `L${e.lesson_number}@${e.date}${e.also_today ? '+today' : ''}`)
/** Plan's OLD rule, kept here only to show why it was replaced. */
const oldPlanRule = (db: ReturnType<typeof seed>) =>
  db.tables.lessons.filter((r) => !r.completed && (r.scheduled_date as string) < TODAY).map((r) => `L${r.lesson_number}`)

async function markOnPlannedDay(db: ReturnType<typeof seed>, n: number) {
  const row = db.tables.lessons.find((r) => r.lesson_number === n)!
  Object.assign(row, buildCompletionPayload({ dateStr: row.scheduled_date as string, choice: 'planned', todayStr: TODAY }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recomputeCurrentLesson(db.client as any, GOAL)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await resyncGoalsForParent(db.client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.completion)
}

function deps(db: ReturnType<typeof seed>, entriesByGoal: Map<string, MissedEntry[]>): MissedAnswerDeps {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: db.client as any,
    userId: USER,
    todayStr: TODAY,
    entriesByGoal,
    goals: [{ id: GOAL, curriculum_name: 'Singapore Math', subject_label: 'Math', child_id: 'k1' }],
    subjects: [{ id: 's1', name: 'Math' }],
    track: () => {},
  }
}

test('both screens list the same lessons, and the one due first is flagged as also today', async () => {
  const db = seed()
  const today = await todaySide(db)
  const plan = await planSide(db)
  assert.deepEqual(brief(plan), brief(today))
  assert.deepEqual(brief(today), [
    `L3@${ymd(day(-5))}+today`, `L4@${ymd(day(-4))}`, `L5@${ymd(day(-3))}`, `L6@${ymd(day(-2))}`, `L7@${ymd(day(-1))}`,
  ])
})

test('the demonstrated gap: one lesson marked on its planned day no longer empties Plan', async () => {
  const db = seed()
  await markOnPlannedDay(db, 3)
  assert.deepEqual(oldPlanRule(db), [], 'the old stored-date rule listed nothing here')
  const today = await todaySide(db)
  const plan = await planSide(db)
  assert.deepEqual(brief(plan), brief(today))
  assert.deepEqual(brief(plan), [
    `L4@${ymd(day(-4))}+today`, `L5@${ymd(day(-3))}`, `L6@${ymd(day(-2))}`, `L7@${ymd(day(-1))}`,
  ])
})

test('re-dating alone never answers the question', async () => {
  const db = seed()
  const before = brief(await planSide(db))
  // Every unfinished lesson moved to today or later, as the daily
  // reconciliation or a parent re-date would.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await resyncGoalsForParent(db.client as any, USER, [GOAL], PARENT_RESPREAD_SOURCE.recalibrate)
  assert.ok(db.tables.lessons.every((r) => r.completed || (r.scheduled_date as string) >= TODAY))
  assert.deepEqual(oldPlanRule(db), [])
  assert.deepEqual(brief(await planSide(db)), before)
  assert.deepEqual(brief(await todaySide(db)), before)
})

test('"not done, keep them in the plan" answers it on both screens', async () => {
  const db = seed()
  await answerMissedNo(deps(db, await planSide(db)))
  assert.equal(db.tables.curriculum_goals[0].catchup_answered_on, TODAY)
  assert.deepEqual(brief(await planSide(db)), [])
  assert.deepEqual(brief(await todaySide(db)), [])
  assert.equal(db.tables.lessons.find((r) => r.id === 'L3')!.scheduled_date, TODAY)
  assert.equal(db.tables.lessons.filter((r) => r.completed).length, 2, 'nothing marked done')
})

test('yes for some: those are filed on their days, the rest answered and moved ahead', async () => {
  const db = seed()
  const offered = await planSide(db)
  const rows = (offered.get(GOAL) ?? []).slice(0, 2).map((e) => ({ goal_id: GOAL, lesson_number: e.lesson_number, date: e.date, choice: 'planned' as const }))
  await answerMissedYes(deps(db, offered), rows)
  const l3 = db.tables.lessons.find((r) => r.id === 'L3')!
  const l4 = db.tables.lessons.find((r) => r.id === 'L4')!
  assert.equal(l3.completed, true)
  assert.equal(l3.scheduled_date, ymd(day(-5)))
  assert.equal(l4.completed, true)
  assert.equal(l4.scheduled_date, ymd(day(-4)))
  assert.equal(db.tables.curriculum_goals[0].catchup_answered_on, TODAY, 'unchecked rows are an answer')
  assert.deepEqual(brief(await planSide(db)), [])
  assert.deepEqual(brief(await todaySide(db)), [])
  assert.equal(db.tables.lessons.find((r) => r.id === 'L5')!.scheduled_date, TODAY)
})

test('yes for all: every lesson filed on its day, nothing left to ask', async () => {
  const db = seed()
  const offered = await planSide(db)
  const rows = (offered.get(GOAL) ?? []).map((e) => ({ goal_id: GOAL, lesson_number: e.lesson_number, date: e.date, choice: 'planned' as const }))
  await answerMissedYes(deps(db, offered), rows)
  assert.equal(db.tables.lessons.filter((r) => r.completed).length, 7)
  assert.deepEqual(brief(await planSide(db)), [])
  assert.deepEqual(brief(await todaySide(db)), [])
})

test('catch-up refuses stale selections before changing any lesson or recording an answer', async () => {
  const db = seed()
  const offered = await planSide(db)
  const rows = (offered.get(GOAL) ?? []).slice(0, 2).map((e) => ({
    goal_id: GOAL, lesson_number: e.lesson_number, date: e.date, choice: 'planned' as const,
  }))
  const changedElsewhere = db.tables.lessons.find((r) => r.id === 'L3')!
  changedElsewhere.completed = true
  const otherCompletionAt = day(-1).toISOString()
  changedElsewhere.completed_at = otherCompletionAt

  await assert.rejects(answerMissedYes(deps(db, offered), rows), /lessons changed/i)
  assert.equal(changedElsewhere.completed_at, otherCompletionAt)
  assert.equal(db.tables.lessons.find((r) => r.id === 'L4')!.completed, false)
  assert.equal(db.tables.curriculum_goals[0].catchup_answered_on, null)
})

test('catch-up does not call a reordered queue slot by the wrong book lesson', async () => {
  const db = seed()
  const offered = await planSide(db)
  const first = (offered.get(GOAL) ?? [])[0]
  const row = db.tables.lessons.find((r) => r.id === 'L3')!
  db.tables.lessons.find((r) => r.id === 'L9')!.lesson_number = 3
  row.lesson_number = 9

  await assert.rejects(answerMissedYes(deps(db, offered), [{
    goal_id: GOAL, lesson_number: first.lesson_number, date: first.date, choice: 'planned',
  }]), /lesson order has changed/i)
  assert.equal(row.completed, false)
  assert.equal(db.tables.curriculum_goals[0].catchup_answered_on, null)
})

test('catch-up leaves a hand-placed lesson unfinished on its chosen day', async () => {
  const db = seed()
  const offered = await planSide(db)
  const first = (offered.get(GOAL) ?? [])[0]
  const row = db.tables.lessons.find((r) => r.id === 'L3')!
  row.queue_pinned = true
  row.scheduled_date = '2026-10-20'
  await assert.rejects(answerMissedYes(deps(db, offered), [{
    goal_id: GOAL, lesson_number: first.lesson_number, date: first.date, choice: 'planned',
  }]), /lessons changed/i)
  assert.equal(row.completed, false)
  assert.equal(row.scheduled_date, '2026-10-20')
  assert.equal(db.tables.curriculum_goals[0].catchup_answered_on, null)
})

test('catch-up refuses a lesson changed between its read and conditional write', async () => {
  const db = seed()
  const offered = await planSide(db)
  const first = (offered.get(GOAL) ?? [])[0]
  const original = db.client.from.bind(db.client)
  let changed = false
  // Change the row immediately before the guarded UPDATE is evaluated.
  db.client.from = ((table: string) => {
    const q = original(table)
    if (table !== 'lessons') return q
    const update = q.update
    return { ...q, update: (payload: Row) => {
      if (payload.completed === true && !changed) {
        changed = true
        const row = db.tables.lessons.find((r) => r.id === 'L3')!
        row.completed = true
        row.completed_at = '2026-09-20T12:00:00Z'
      }
      return update(payload)
    } }
  }) as typeof db.client.from
  await assert.rejects(answerMissedYes(deps(db, offered), [{ goal_id: GOAL, lesson_number: first.lesson_number, date: first.date, choice: 'planned' }]), /lessons changed/i)
  assert.equal(db.tables.lessons.find((r) => r.id === 'L3')!.completed_at, '2026-09-20T12:00:00Z')
  assert.equal(db.tables.curriculum_goals[0].catchup_answered_on, null)
})

test('catch-up refuses an un-slotted book lesson rather than inserting a duplicate', async () => {
  const db = seed()
  const offered = await planSide(db)
  const first = (offered.get(GOAL) ?? [])[0]
  db.tables.lessons.find((r) => r.id === 'L3')!.queue_position = null
  await assert.rejects(answerMissedYes(deps(db, offered), [{ goal_id: GOAL, lesson_number: first.lesson_number, date: first.date, choice: 'planned' }]), /lessons changed/i)
  assert.equal(db.tables.curriculum_goals[0].catchup_answered_on, null)
})

test('the gap window: after the last completion, two weeks at most, after the last answer', () => {
  const todayMid = new Date(2026, 8, 21)
  const at = (iso: string | null, start: string | null, answered: string | null) =>
    ymd(gapStartForGoal({ lastCompletedIso: iso, startDate: start, answeredOn: answered, todayMid })!)
  assert.equal(at(new Date(2026, 8, 15, 15).toISOString(), null, null), '2026-09-16')
  assert.equal(at(new Date(2026, 7, 1, 15).toISOString(), null, null), '2026-09-07')
  assert.equal(at(null, '2026-09-18', null), '2026-09-18')
  assert.equal(at(new Date(2026, 8, 15, 15).toISOString(), null, '2026-09-18'), '2026-09-19')
  assert.equal(gapStartForGoal({ lastCompletedIso: null, startDate: null, answeredOn: null, todayMid }), null)
})
