import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ESTIMATED_MINUTES_PER_LESSON,
  lessonMinutes,
  sumLessonMinutes,
} from './lesson-minutes.ts'

// ── The rule ────────────────────────────────────────────────────────────────

test('recorded minutes count exactly as recorded', () => {
  assert.deepEqual(lessonMinutes({ minutes_spent: 40 }), { minutes: 40, source: 'recorded', estimated: false })
  assert.deepEqual(lessonMinutes({ minutes_spent: 40, hours: 2 }), { minutes: 40, source: 'recorded', estimated: false },
    'minutes win over the older hours column when both are there')
})

test('a recorded 0 is 0, never the estimate', () => {
  // The regression this guards is `minutes_spent || 30`, which re-bills a
  // family who said a lesson took no time. `??` happened to get it right; the
  // rule should not depend on which of the two a future edit types.
  assert.deepEqual(lessonMinutes({ minutes_spent: 0 }), { minutes: 0, source: 'recorded', estimated: false })
  assert.deepEqual(lessonMinutes({ minutes_spent: 0, hours: 0.5 }), { minutes: 0, source: 'recorded', estimated: false })
  assert.equal(sumLessonMinutes([{ minutes_spent: 0 }, { minutes_spent: 0 }]).minutes, 0)
})

test('a saved hours value counts when minutes are missing, but an hours of 0 does not', () => {
  assert.deepEqual(lessonMinutes({ minutes_spent: null, hours: 0.75 }), { minutes: 45, source: 'recorded_hours', estimated: false })
  // Insert paths write `hours: 0` whenever minutes are blank, so 0 there means
  // "nothing entered", not "took no time".
  assert.deepEqual(lessonMinutes({ minutes_spent: null, hours: 0 }),
    { minutes: ESTIMATED_MINUTES_PER_LESSON, source: 'estimated', estimated: true })
})

test('no time at all is the estimate, and says so', () => {
  for (const l of [{}, { minutes_spent: null }, { minutes_spent: undefined, hours: null }, { minutes_spent: Number.NaN }]) {
    assert.deepEqual(lessonMinutes(l), { minutes: ESTIMATED_MINUTES_PER_LESSON, source: 'estimated', estimated: true })
  }
})

test('the proposed estimate is 30, the number Reports already uses', () => {
  // Changing this moves every family's hours. It is PROPOSED, not approved for
  // release: change it only with the impact measured.
  assert.equal(ESTIMATED_MINUTES_PER_LESSON, 30)
})

// ── The synthetic case from the investigation ─────────────────────────────
//
// One curriculum, four completed lessons: 40 minutes logged, a recorded 0, and
// two with no minutes (a recalibrate estimate and a check-off whose minutes
// write never landed). Before this file the surfaces read them as 100, 130, 160
// and 40 minutes. Now every surface reads the same total, and can tell how much
// of it is estimated.

test('the four-lesson example totals the same everywhere, split into recorded and estimated', () => {
  const lessons = [
    { minutes_spent: 40 },
    { minutes_spent: 0 },
    { minutes_spent: null },
    { minutes_spent: null, hours: 0 },
  ]
  assert.deepEqual(sumLessonMinutes(lessons), {
    minutes: 100,
    recordedMinutes: 40,
    estimatedMinutes: 60,
    estimatedCount: 2,
  })
})

// ── Nobody writes their own fallback again ─────────────────────────────────

const READERS = [
  'app/dashboard/reports/page.tsx',
  'app/dashboard/years/page.tsx',
  'app/components/PlanV2/StatsBar.tsx',
  'app/components/PlanV2/index.tsx',
  'app/dashboard/transcript/[childId]/page.tsx',
  'lib/progress-report.ts',
  'app/api/year-end-summary/[schoolYearId]/route.ts',
  'app/api/school-year/close/route.ts',
  'app/lib/past-year-dates.ts',
]

test('every lesson-time total goes through lib/lesson-minutes.ts', () => {
  for (const f of READERS) {
    const src = readFileSync(resolve(process.cwd(), f), 'utf8')
    assert.match(src, /lesson-minutes/, `${f} imports the shared rule`)
    // A reader's own fallback on a lesson's minutes: `?? 30`, `|| 45`, `?? 0`,
    // or the typeof-else-0 spelling. Activity logs are a different table and
    // keep their own rule; in the progress report those read `a.minutes_spent`.
    const own = src.match(/(?<!\ba)\.minutes_spent\s*(\?\?|\|\|)\s*\d+|typeof \w+\.minutes_spent === "number" \? \w+\.minutes_spent : 0/g) ?? []
    assert.deepEqual(own, [], `${f} computes lesson time with its own fallback`)
  }
})
