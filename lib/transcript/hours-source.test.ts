// The transcript page used to recalculate every linked course on open and
// write over hours and credits a family had typed. These pin who may write
// what: the page writes 'calculated' rows only; 'family' and unclassified
// (null) rows are kept exactly as stored.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  calculateCreditsFromHours,
  calculatedNumbers,
  hoursSourceOnSave,
  planLinkedCourseRefresh,
  planRefreshWrites,
  useCalculatedFromRead,
  USE_CALCULATED_READ_FAILED,
  type LessonMinutesRead,
} from './hours-source.ts'

const course = (over: Partial<Parameters<typeof planLinkedCourseRefresh>[0]> = {}) => ({
  hours_source: 'calculated' as const,
  hours_logged: 10,
  credits_earned: calculateCreditsFromHours(10),
  grade_letter: null,
  ...over,
})

// 40 lessons at 45 minutes = 30 hours.
const MINUTES_30H = 40 * 45

test('refresh: a calculated course follows its lessons, hours and credits', () => {
  assert.deepEqual(planLinkedCourseRefresh(course(), MINUTES_30H), {
    hours_logged: 30,
    credits_earned: calculateCreditsFromHours(30),
  })
})

test('refresh: a calculated course already in step is not rewritten', () => {
  assert.equal(planLinkedCourseRefresh(course({ hours_logged: 30 }), MINUTES_30H), null)
})

test('refresh: a family-entered course is never rewritten, hours or credits', () => {
  assert.equal(planLinkedCourseRefresh(course({ hours_source: 'family', hours_logged: 150, credits_earned: 1 }), MINUTES_30H), null)
})

test('refresh: an unclassified course is never rewritten either', () => {
  // The 33 existing courses whose stored hours are not provably the page's own
  // calculation stay null, and null means protected, not "ours to fix".
  assert.equal(planLinkedCourseRefresh(course({ hours_source: null, hours_logged: 4 }), MINUTES_30H), null)
})

test('refresh: a graded calculated course keeps credits set by hand, as before', () => {
  const plan = planLinkedCourseRefresh(course({ grade_letter: 'A', credits_earned: 1 }), MINUTES_30H)
  assert.deepEqual(plan, { hours_logged: 30 }, 'hours follow the lessons, the hand-set credit stays')
})

test('refresh: zero lessons stores null hours, the way the page always has', () => {
  assert.deepEqual(planLinkedCourseRefresh(course({ hours_logged: 5 }), 0), { hours_logged: null, credits_earned: 0.5 })
})

const opened = { hours_logged: 10, credits_earned: 0.5 }
const linked = 'goal-1'

test('save: typing new hours marks the course family-entered', () => {
  assert.equal(
    hoursSourceOnSave({
      opened,
      saved: { hours_logged: 150, credits_earned: 0.5, curriculum_goal_id: linked },
      previous: 'calculated',
      isNew: false,
      useCalculated: false,
    }),
    'family',
  )
})

test('save: typing new credits alone also marks it family-entered', () => {
  assert.equal(
    hoursSourceOnSave({
      opened,
      saved: { hours_logged: 10, credits_earned: 1, curriculum_goal_id: linked },
      previous: 'calculated',
      isNew: false,
      useCalculated: false,
    }),
    'family',
  )
})

test('save: editing only the name or grade keeps the source it had', () => {
  for (const previous of ['calculated', 'family', null] as const) {
    assert.equal(
      hoursSourceOnSave({
        opened,
        saved: { ...opened, curriculum_goal_id: linked },
        previous,
        isNew: false,
        useCalculated: false,
      }),
      previous,
      `previous=${previous}`,
    )
  }
})

test('save: "Use hours from lessons" switches back to calculated', () => {
  const numbers = calculatedNumbers(MINUTES_30H)
  assert.equal(
    hoursSourceOnSave({
      opened: { hours_logged: 150, credits_earned: 1 },
      saved: { ...numbers, curriculum_goal_id: linked },
      previous: 'family',
      isNew: false,
      useCalculated: true,
    }),
    'calculated',
    'the numbers changed, but because the family asked the page to own them',
  )
  assert.deepEqual(numbers, { hours_logged: 30, credits_earned: calculateCreditsFromHours(30) })
})

test('save: "Use hours from lessons" means nothing on an unlinked course', () => {
  assert.equal(
    hoursSourceOnSave({
      opened,
      saved: { hours_logged: 30, credits_earned: 0.5, curriculum_goal_id: null },
      previous: null,
      isNew: false,
      useCalculated: true,
    }),
    'family',
  )
})

test('save: linking an existing course does not hand its stored hours to the refresh', () => {
  assert.equal(
    hoursSourceOnSave({
      opened,
      saved: { ...opened, curriculum_goal_id: linked },
      previous: null,
      isNew: false,
      useCalculated: false,
    }),
    null,
  )
})

test('save: a new linked course with nothing typed is calculated; with hours typed, family', () => {
  const blank = { hours_logged: null, credits_earned: 1 }
  assert.equal(
    hoursSourceOnSave({ opened: blank, saved: { ...blank, curriculum_goal_id: linked }, previous: null, isNew: true, useCalculated: false }),
    'calculated',
  )
  assert.equal(
    hoursSourceOnSave({ opened: blank, saved: { hours_logged: 90, credits_earned: 1, curriculum_goal_id: linked }, previous: null, isNew: true, useCalculated: false }),
    'family',
  )
})

// ── The page wires these rules in, not a copy of them ──────────────────────

const page = readFileSync(resolve(process.cwd(), 'app/dashboard/transcript/[childId]/page.tsx'), 'utf8')

test('page: the page-open refresh reads only calculated courses and guards its update', () => {
  const refresh = page.slice(page.indexOf('async function refreshLinkedCourseHours('), page.indexOf('async function handleManualSync('))
  assert.match(refresh, /c\.hours_source === "calculated"/)
  assert.match(refresh, /planRefreshWrites\(linkedCourses, read\)/, 'every write comes from the failure-aware plan')
  assert.match(refresh, /\.eq\("hours_source", "calculated"\)/, 'a row made family in another tab is not overwritten')
  assert.doesNotMatch(refresh, /calculateCreditsFromHours\(/, 'no second copy of the credit rule')
})

test('page: courses imported from Plan start calculated, and the form save writes the source', () => {
  const sync = page.slice(page.indexOf('async function syncCoursesFromPlan('), page.indexOf('async function lessonMinutesByGoal('))
  assert.match(sync, /hours_source: "calculated"/)
  const save = page.slice(page.indexOf('async function saveCourse('), page.indexOf('async function deleteCourse('))
  assert.match(save, /hours_source: pendingHoursSource\(\)/)
})

// ── A failed lesson read is never a zero ─────────────────────────────────
//
// The page read `data ?? []` and ignored `error`, so a failed read looked like
// "no lessons". "Use hours from lessons" then filled 0 hours and 0.5 credits,
// and the page-open refresh wrote 0 hours onto every calculated course.

const FAILED: LessonMinutesRead = { ok: false }

test('"Use hours from lessons": a failed read is an error and changes nothing', () => {
  const failed = useCalculatedFromRead(FAILED, 'g1')
  assert.deepEqual(failed, { ok: false, error: USE_CALCULATED_READ_FAILED })
  assert.equal('numbers' in failed, false, 'no numbers exist to put in the form')
  // A successful read of a goal with no completed lessons IS a real zero.
  assert.deepEqual(useCalculatedFromRead({ ok: true, byGoal: {} }, 'g1'), {
    ok: true, numbers: { hours_logged: null, credits_earned: 0.5 },
  })
  assert.deepEqual(useCalculatedFromRead({ ok: true, byGoal: { g1: 150 * 60 } }, 'g1'), {
    ok: true, numbers: { hours_logged: 150, credits_earned: 1.5 },
  })
})

test('refresh: a failed read writes nothing, even to calculated courses that would change', () => {
  const courses = [
    { id: 'c1', curriculum_goal_id: 'g1', hours_source: 'calculated' as const, hours_logged: 40, credits_earned: 0.5, grade_letter: null },
    { id: 'c2', curriculum_goal_id: 'g2', hours_source: 'calculated' as const, hours_logged: 12, credits_earned: 0.5, grade_letter: null },
  ]
  assert.deepEqual(planRefreshWrites(courses, FAILED), [])
  // The same courses after a successful read: g1 moved, g2 has no lessons now.
  assert.deepEqual(planRefreshWrites(courses, { ok: true, byGoal: { g1: 50 * 60 } }), [
    { id: 'c1', update: { hours_logged: 50, credits_earned: 0.5 } },
    { id: 'c2', update: { hours_logged: null, credits_earned: 0.5 } },
  ])
})

test('page: the lessons read reports failure, and the button leaves the form alone on one', () => {
  const helper = page.slice(page.indexOf('async function lessonMinutesByGoal('), page.indexOf('async function refreshLinkedCourseHours('))
  assert.match(helper, /Promise<LessonMinutesRead>/)
  assert.match(helper, /if \(error\) return \{ ok: false \};/)
  assert.match(helper, /catch \{\s*return \{ ok: false \};/)

  const button = page.slice(page.indexOf('async function useHoursFromLessons('), page.indexOf('function pendingHoursSource('))
  const failBranch = button.indexOf('if (!result.ok) {')
  assert.ok(failBranch !== -1, 'the button handles a failed read')
  const branch = button.slice(failBranch, button.indexOf('}', failBranch))
  assert.match(branch, /setFormHoursError\(result\.error\);\s*return;/, 'shows the error and stops')
  assert.doesNotMatch(branch, /setForm\(|setFormUseCalculated/, 'hours, credits and source are not touched')
  assert.ok(button.indexOf('setForm(prev') > failBranch, 'the form is only filled after the failure check')
  assert.match(page, /\{formHoursError && \(\s*<p role="alert"/)

  const sync = page.slice(page.indexOf('async function syncCoursesFromPlan('), page.indexOf('async function lessonMinutesByGoal('))
  assert.match(sync, /if \(lessonErr\) \{\s*await refreshLinkedCourseHours\(uid, existingCourses\);\s*return 0;/, 'no import with guessed-zero hours')
})
