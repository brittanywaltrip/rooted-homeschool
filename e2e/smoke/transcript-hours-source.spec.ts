/**
 * Transcript hours a family entered survive reopening the page.
 *
 * Before transcript_courses.hours_source, every page open recalculated each
 * linked course from its lessons and wrote over hours and credits a family had
 * typed. This drives the three paths on a real deployment:
 *
 *   calculated    the page keeps it in step with lessons
 *   family        typed in the form; never rewritten, even after reopening
 *   unclassified  NULL, like the 33 existing courses nobody could prove; never
 *                 rewritten
 *
 * plus "Use hours from lessons" switching a family course back to calculated.
 *
 * Synthetic data only, on the e2e account: an ARCHIVED goal (so Today and Plan
 * never show it and the page does not import it), four completed 60-minute
 * lessons (4 hours by the page's rule), and three linked courses. Opening the
 * transcript also imports the account's active seeded curriculum as a course;
 * the teardown deletes that too. The account held no transcript courses or
 * settings before this spec (checked 2026-09-23), so the teardown removes every
 * transcript row it finds for the test child created since the test began.
 */
import { test, expect, type Page } from '@playwright/test'

import { adminClient, requireTestUserId } from '../admin'

const TAG = '@curriculum-writes'
const GOAL_NAME = 'E2E Transcript Hours Goal'
const NAMES = {
  calculated: 'E2E TH calculated',
  family: 'E2E TH family',
  unclassified: 'E2E TH unclassified',
  // Calculated, holding the 1 credit an import gives a curriculum with no
  // completed lessons yet: the refresh must move its hours and keep the credit.
  creditsKept: 'E2E TH credits kept',
}
// Four completed lessons at 60 minutes: round(240 / 60) = 4 hours, 0.5 credit.
const LESSON_HOURS = 4

type Row = { id: string; course_name: string; hours_logged: number | null; credits_earned: number; hours_source: string | null }

test.describe('Transcript hours source', { tag: TAG }, () => {
  test.describe.configure({ mode: 'serial' })

  let goalId: string | null = null
  let childId: string | null = null
  let startedAt = ''

  test.afterAll(async () => {
    const sb = adminClient()
    if (!sb) return
    const uid = await requireTestUserId('transcript hours source teardown')
    if (childId && startedAt) {
      await sb.from('transcript_courses').delete().eq('user_id', uid).eq('child_id', childId).gte('created_at', startedAt)
      await sb.from('transcript_settings').delete().eq('user_id', uid).eq('child_id', childId).gte('created_at', startedAt)
    }
    if (goalId) {
      // Lessons first: the lessons FK is ON DELETE SET NULL, so deleting the
      // goal first would orphan them instead of removing them.
      await sb.from('lessons').delete().eq('user_id', uid).eq('curriculum_goal_id', goalId)
      await sb.from('curriculum_goals').delete().eq('user_id', uid).eq('id', goalId)
    }
  })

  async function rows(): Promise<Record<string, Row>> {
    const sb = adminClient()!
    const uid = await requireTestUserId('transcript hours source read')
    const { data, error } = await sb
      .from('transcript_courses')
      .select('id, course_name, hours_logged, credits_earned, hours_source')
      .eq('user_id', uid)
      .eq('child_id', childId!)
    expect(error).toBeNull()
    return Object.fromEntries((data as Row[]).map((r) => [r.course_name, r]))
  }

  async function openTranscript(page: Page) {
    await page.goto(`/dashboard/transcript/${childId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(NAMES.unclassified).first()).toBeVisible({ timeout: 30_000 })
    // The page refreshes linked courses right after load. There is no on-screen
    // signal for "refresh finished", so give it the network and a settle.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(2_000)
  }

  async function openCourse(page: Page, name: string) {
    await page.getByRole('button', { name: new RegExp(name) }).first().click()
    await expect(page.getByRole('button', { name: /Update course/ })).toBeVisible({ timeout: 10_000 })
  }

  const hoursInput = (page: Page) => page.locator('label:has-text("Hours logged") + input')

  test('calculated follows lessons; family and unclassified are kept; the family can switch back', async ({ page }) => {
    const sb = adminClient()
    test.skip(!sb, 'needs SUPABASE_SERVICE_ROLE_KEY to seed and to read what was written')
    const uid = await requireTestUserId('transcript hours source seed')
    startedAt = new Date(Date.now() - 5_000).toISOString()

    const { data: kids } = await sb!.from('children').select('id').eq('user_id', uid).eq('archived', false).order('sort_order').limit(1)
    childId = (kids ?? [])[0]?.id ?? null
    test.skip(!childId, 'test account has no active child')

    const today = new Date().toISOString().slice(0, 10)
    const { data: goal, error: goalErr } = await sb!
      .from('curriculum_goals')
      .insert({
        user_id: uid, child_id: childId, curriculum_name: GOAL_NAME, subject_label: 'E2E Science',
        total_lessons: 4, current_lesson: 4, start_at_lesson: 1, lessons_per_day: 1,
        school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start_date: today, default_minutes: 30,
        archived: true, completed_at: null,
      })
      .select('id')
      .single()
    expect(goalErr).toBeNull()
    goalId = (goal as { id: string }).id

    const { error: lessonErr } = await sb!.from('lessons').insert(
      [1, 2, 3, 4].map((n) => ({
        user_id: uid, child_id: childId, curriculum_goal_id: goalId, hours: 0,
        title: `E2E Science — Lesson ${n}`, lesson_number: n, queue_position: n,
        scheduled_date: today, date: today, completed: true, completed_at: `${today}T12:00:00Z`,
        scheduled_source: 'completion_today', minutes_spent: 60, queue_pinned: false,
      })),
    )
    expect(lessonErr).toBeNull()

    const base = {
      user_id: uid, child_id: childId, curriculum_goal_id: goalId, school_year: '2026-2027',
      subject_category: 'science', credit_type: 'standard', course_level: 'standard', semester: 'full_year',
      is_external: false,
    }
    const { error: tcErr } = await sb!.from('transcript_courses').insert([
      { ...base, course_name: NAMES.calculated, hours_logged: 1, credits_earned: 0.5, hours_source: 'calculated' },
      { ...base, course_name: NAMES.family, hours_logged: 150, credits_earned: 1, hours_source: 'family' },
      { ...base, course_name: NAMES.unclassified, hours_logged: 7, credits_earned: 1, hours_source: null },
      { ...base, course_name: NAMES.creditsKept, hours_logged: null, credits_earned: 1, hours_source: 'calculated' },
    ])
    expect(tcErr).toBeNull()

    // 1. Opening the page: only the calculated course follows its lessons.
    await openTranscript(page)
    // Positive signal that the refresh ran: the calculated course reaches 4.
    await expect.poll(async () => (await rows())[NAMES.calculated]?.hours_logged, { timeout: 20_000 }).toBe(LESSON_HOURS)
    await expect.poll(async () => (await rows())[NAMES.creditsKept]?.hours_logged, { timeout: 20_000 }).toBe(LESSON_HOURS)
    let r = await rows()
    expect(r[NAMES.calculated]).toMatchObject({ hours_logged: LESSON_HOURS, credits_earned: 0.5, hours_source: 'calculated' })
    expect(r[NAMES.family]).toMatchObject({ hours_logged: 150, credits_earned: 1, hours_source: 'family' })
    expect(r[NAMES.unclassified]).toMatchObject({ hours_logged: 7, credits_earned: 1, hours_source: null })
    // Hours follow the lessons; the credit is left exactly as it was (it used
    // to be silently replaced with 0.5, the credit 4 hours works out to).
    expect(r[NAMES.creditsKept]).toMatchObject({ hours_logged: LESSON_HOURS, credits_earned: 1, hours_source: 'calculated' })
    // A course imported from Plan on this open starts calculated.
    const imported = Object.values(r).filter((x) => !Object.values(NAMES).includes(x.course_name))
    for (const x of imported) expect(x.hours_source, `imported ${x.course_name}`).toBe('calculated')

    // 2. Manual: typing hours into the calculated course makes it the family's.
    await openCourse(page, NAMES.calculated)
    await hoursInput(page).fill('20')
    await expect(page.locator('[data-hours-source="family"]')).toBeVisible()
    await page.getByRole('button', { name: /Update course/ }).click()
    await expect(page.getByText('Course updated')).toBeVisible({ timeout: 10_000 })
    r = await rows()
    expect(r[NAMES.calculated]).toMatchObject({ hours_logged: 20, hours_source: 'family' })

    // ...and reopening the page does not overwrite it, or the other two.
    await openTranscript(page)
    r = await rows()
    expect(r[NAMES.calculated]).toMatchObject({ hours_logged: 20, hours_source: 'family' })
    expect(r[NAMES.family]).toMatchObject({ hours_logged: 150, credits_earned: 1, hours_source: 'family' })
    expect(r[NAMES.unclassified]).toMatchObject({ hours_logged: 7, credits_earned: 1, hours_source: null })

    // 3. Unclassified: the form says the numbers are kept and offers the switch.
    await openCourse(page, NAMES.unclassified)
    await expect(page.locator('[data-hours-source="unclassified"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use hours from lessons' })).toBeVisible()
    await page.goto(`/dashboard/transcript/${childId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(NAMES.family).first()).toBeVisible({ timeout: 30_000 })

    // 4. Switch back: "Use hours from lessons" on the family course.
    await openCourse(page, NAMES.family)
    await page.getByRole('button', { name: 'Use hours from lessons' }).click()
    await expect(hoursInput(page)).toHaveValue(String(LESSON_HOURS))
    await expect(page.locator('[data-hours-source="calculated"]')).toBeVisible()
    await page.getByRole('button', { name: /Update course/ }).click()
    await expect(page.getByText('Course updated')).toBeVisible({ timeout: 10_000 })
    r = await rows()
    expect(r[NAMES.family]).toMatchObject({ hours_logged: LESSON_HOURS, credits_earned: 0.5, hours_source: 'calculated' })
    expect(r[NAMES.unclassified]).toMatchObject({ hours_logged: 7, credits_earned: 1, hours_source: null })

    // 5. On a calculated course the button is offered too, and it is the one
    //    way credits get recalculated: the family asks, and both move.
    await page.goto(`/dashboard/transcript/${childId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(NAMES.creditsKept).first()).toBeVisible({ timeout: 30_000 })
    await openCourse(page, NAMES.creditsKept)
    await expect(page.getByText('Hours update from logged lessons. Credits stay as they are.')).toBeVisible()
    await page.getByRole('button', { name: 'Use hours from lessons' }).click()
    await expect(hoursInput(page)).toHaveValue(String(LESSON_HOURS))
    await expect(page.locator('label:has-text("Credits earned") + input')).toHaveValue('0.5')
    await page.getByRole('button', { name: /Update course/ }).click()
    await expect(page.getByText('Course updated')).toBeVisible({ timeout: 10_000 })
    r = await rows()
    expect(r[NAMES.creditsKept]).toMatchObject({ hours_logged: LESSON_HOURS, credits_earned: 0.5, hours_source: 'calculated' })
  })

  // A failed lesson read used to look like "no lessons": 0 minutes. The button
  // then filled 0 hours and 0.5 credit, and the page-open refresh wrote 0 hours
  // onto calculated courses. Only the lessons read for THIS goal is failed.
  const failLessonsRead = (page: Page) =>
    page.route(
      (url) =>
        url.pathname.endsWith('/rest/v1/lessons') &&
        decodeURIComponent(url.search).includes('select=curriculum_goal_id,minutes_spent,completed') &&
        !!goalId && url.search.includes(goalId),
      (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'e2e: simulated read failure' }) }),
    )
  const creditsInput = (page: Page) => page.locator('label:has-text("Credits earned") + input')

  test('a failed lesson read is an error, never zero: the button changes nothing and the refresh writes nothing', async ({ page }) => {
    const sb = adminClient()
    test.skip(!sb || !goalId || !childId, 'needs the courses seeded by the previous test')

    // 1. The button. Unclassified course: 7 hours, 1 credit, no source.
    await openTranscript(page)
    await openCourse(page, NAMES.unclassified)
    await expect(hoursInput(page)).toHaveValue('7')
    await expect(creditsInput(page)).toHaveValue('1')
    await failLessonsRead(page)
    await page.getByRole('button', { name: 'Use hours from lessons' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /couldn't read this curriculum's lessons, so nothing was changed/i }))
      .toBeVisible({ timeout: 10_000 })
    await expect(hoursInput(page), 'hours unchanged, not 0').toHaveValue('7')
    await expect(creditsInput(page), 'credits unchanged, not 0.5').toHaveValue('1')
    await expect(page.locator('[data-hours-source="unclassified"]'), 'source unchanged').toBeVisible()
    // Saving now writes exactly what the family already had.
    await page.getByRole('button', { name: /Update course/ }).click()
    await expect(page.getByText('Course updated')).toBeVisible({ timeout: 10_000 })
    let r = await rows()
    expect(r[NAMES.unclassified]).toMatchObject({ hours_logged: 7, credits_earned: 1, hours_source: null })
    await page.unrouteAll({ behavior: 'ignoreErrors' })

    // 2. The page-open refresh. A calculated course whose stored hours differ
    // from its lessons (9 vs 4): a successful open writes 4; a failed read
    // must leave 9.
    const uid = await requireTestUserId('transcript hours source failed read')
    const { error: setErr } = await sb!
      .from('transcript_courses')
      .update({ hours_logged: 9, credits_earned: 0.5 })
      .eq('user_id', uid)
      .eq('id', r[NAMES.family].id)
    expect(setErr).toBeNull()
    expect((await rows())[NAMES.family]).toMatchObject({ hours_logged: 9, hours_source: 'calculated' })

    await failLessonsRead(page)
    await openTranscript(page)
    r = await rows()
    expect(r[NAMES.family], 'a failed read writes nothing').toMatchObject({ hours_logged: 9, credits_earned: 0.5, hours_source: 'calculated' })
    expect(r[NAMES.unclassified]).toMatchObject({ hours_logged: 7, credits_earned: 1, hours_source: null })
    await page.unrouteAll({ behavior: 'ignoreErrors' })

    // And the same open with the read working brings it back in step, so the
    // 9 above was the failure being respected, not a refresh that never ran.
    await openTranscript(page)
    await expect.poll(async () => (await rows())[NAMES.family]?.hours_logged, { timeout: 20_000 }).toBe(LESSON_HOURS)
  })
})
