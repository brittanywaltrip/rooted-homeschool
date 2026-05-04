// Unit tests for the cleanup planner. We invoke planRescheduleLessons
// (the same helper the cleanup script uses) against synthetic bunched
// inputs and assert:
//   - max(lessons per date) === lessons_per_day  (Invariant 2)
//   - every placed date is a school day            (Invariant 4)
//   - placement order matches lesson_number order  (Invariant 1)
//
// Run:
//   node --test scripts/cleanup-bunched-lessons.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planRescheduleLessons, schoolDayLabelsToIso } from '../app/lib/scheduler.ts'
import { addDays, isoDowFromYmd } from '../app/lib/timezone.ts'

type Lesson = { id: string; lesson_number: number }

function makeBunchedLessons(count: number): Lesson[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `L${i + 1}`,
    lesson_number: i + 1,
  }))
}

function planFor(opts: {
  count: number
  schoolDays: string[]
  lessonsPerDay: number
  startAfter: string
  vacations?: { start: string; end: string }[]
}): { id: string; newDate: string }[] {
  const goalId = 'g1'
  const lessons = makeBunchedLessons(opts.count)
  const { updates } = planRescheduleLessons({
    toReshuffle: lessons.map((l) => ({
      id: l.id,
      curriculum_goal_id: goalId,
      lesson_number: l.lesson_number,
    })),
    staying: [],
    goalConfigs: new Map([[goalId, { school_days: opts.schoolDays, lessons_per_day: opts.lessonsPerDay }]]),
    startAfterDate: opts.startAfter,
    vacations: opts.vacations ?? [],
  })
  return updates
}

test('cleanup planner: max-per-date never exceeds lessons_per_day=1', () => {
  // 30 lessons re-spread on Mon-Fri with lpd=1 starting after 2026-05-04 (Mon).
  // First lesson must land on Tue 2026-05-05; max-per-date must equal 1.
  const updates = planFor({
    count: 30,
    schoolDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    lessonsPerDay: 1,
    startAfter: '2026-05-04',
  })
  assert.equal(updates.length, 30)
  assert.equal(updates[0].newDate, '2026-05-05')
  const counts = new Map<string, number>()
  for (const u of updates) counts.set(u.newDate, (counts.get(u.newDate) ?? 0) + 1)
  for (const [date, n] of counts) {
    assert.ok(n <= 1, `${date} holds ${n} lessons (exceeds lpd=1)`)
  }
})

test('cleanup planner: max-per-date never exceeds lessons_per_day=3', () => {
  // 30 lessons, lpd=3, Mon-Fri. Should fill 3 per day.
  const updates = planFor({
    count: 30,
    schoolDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    lessonsPerDay: 3,
    startAfter: '2026-05-04',
  })
  const counts = new Map<string, number>()
  for (const u of updates) counts.set(u.newDate, (counts.get(u.newDate) ?? 0) + 1)
  for (const [date, n] of counts) {
    assert.ok(n <= 3, `${date} holds ${n} lessons (exceeds lpd=3)`)
  }
  assert.ok(Array.from(counts.values()).some((n) => n === 3), 'expected at least one date filled to lpd=3')
})

test('cleanup planner: every placed date is a school day', () => {
  // School days = Mon/Wed/Fri only. No lesson should land on Tue/Thu/Sat/Sun.
  const updates = planFor({
    count: 50,
    schoolDays: ['Mon', 'Wed', 'Fri'],
    lessonsPerDay: 1,
    startAfter: '2026-05-04',
  })
  const allowed = new Set(schoolDayLabelsToIso(['Mon', 'Wed', 'Fri']))
  for (const u of updates) {
    const dow = isoDowFromYmd(u.newDate)
    assert.ok(allowed.has(dow), `${u.newDate} is dow ${dow}, not Mon/Wed/Fri`)
  }
})

test('cleanup planner: placement order matches lesson_number order', () => {
  // Lessons fed in lesson_number ASC must come out in calendar-date ASC.
  const updates = planFor({
    count: 20,
    schoolDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    lessonsPerDay: 1,
    startAfter: '2026-05-04',
  })
  for (let i = 1; i < updates.length; i++) {
    assert.ok(
      updates[i].newDate >= updates[i - 1].newDate,
      `lesson ${updates[i].id} (${updates[i].newDate}) placed before previous lesson (${updates[i - 1].newDate})`,
    )
  }
})

test('cleanup planner: vacation block is respected', () => {
  // 10 lessons, lpd=1, Mon-Fri, vacation 2026-05-11..2026-05-15. Lessons
  // must skip that whole week and land on the surrounding school days.
  const vac = [{ start: '2026-05-11', end: '2026-05-15' }]
  const updates = planFor({
    count: 10,
    schoolDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    lessonsPerDay: 1,
    startAfter: '2026-05-04',
    vacations: vac,
  })
  for (const u of updates) {
    assert.ok(
      !(u.newDate >= vac[0].start && u.newDate <= vac[0].end),
      `lesson ${u.id} landed on ${u.newDate}, inside vacation`,
    )
  }
})

test('cleanup planner: addDays-based startAfter produces expected first date', () => {
  // Sanity check: startAfter is exclusive. startAfter=2026-05-04 (Mon) →
  // first lesson on Tue 2026-05-05. startAfter=addDays('2026-08-05',-1)
  // (Aug 4) → first lesson on Wed 2026-08-05.
  const u1 = planFor({
    count: 1,
    schoolDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    lessonsPerDay: 1,
    startAfter: '2026-05-04',
  })
  assert.equal(u1[0].newDate, '2026-05-05')

  const u2 = planFor({
    count: 1,
    schoolDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    lessonsPerDay: 1,
    startAfter: addDays('2026-08-05', -1),
  })
  assert.equal(u2[0].newDate, '2026-08-05')
})
