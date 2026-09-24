import { test, expect, type Page } from '@playwright/test';

import { adminClient, cachedTestUserId } from '../admin';
import { gotoAppPage } from '../helpers/overlays';

// Invariant 24: moving one lesson moves one lesson, on Plan AND on Today.
//
// Plan's reschedule dialog offers "Move just this lesson" ("Only this lesson
// moves. Lessons after it stay on their dates.") and "Shift all remaining
// lessons forward". Plan draws each lesson on its stored scheduled_date; Today
// draws the projector's answer over the queue. Before this spec's fix the two
// disagreed after either choice: moving lesson 4 off today put lesson 5 on
// Today while Plan kept it tomorrow, and Shift all pulled the later lessons
// EARLIER. "I'm actually on lesson 4" afterwards changed nothing on Today.
// Reproduced on rooted-staging 2026-09-24 against main 54bf23b.
//
// Each test seeds its own curriculum on the test account, school every day of
// the week so the weekday the suite runs on cannot matter: lessons 1 to 3 done
// on the three days before today, lesson 4 today, lesson n on day n - 4.
// Plan's side is asserted on the stored rows, which is what Plan renders;
// Today's side is asserted on the rendered page, which is the screen that was
// wrong. Tagged @curriculum-writes: it writes curricula, so it runs in the
// teardown project after every spec that loads Today (playwright.config.ts).

const CURRICULUM_WRITES = '@curriculum-writes';

function localYmd(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Sb = NonNullable<ReturnType<typeof adminClient>>;

async function seedGoal(sb: Sb, ctx: { userId: string; childId: string }, name: string): Promise<string> {
  const { data: goalRow, error: goalErr } = await sb
    .from('curriculum_goals')
    .insert({
      user_id: ctx.userId,
      child_id: ctx.childId,
      curriculum_name: name,
      subject_label: name,
      total_lessons: 20,
      current_lesson: 3,
      start_at_lesson: 1,
      start_date: localYmd(-3),
      lessons_per_day: 1,
      school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      default_minutes: 30,
      archived: false,
    })
    .select('id')
    .single();
  if (goalErr || !goalRow) throw new Error(`seed goal failed: ${goalErr?.message}`);
  const goalId = (goalRow as { id: string }).id;
  const rows = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    const day = localYmd(n - 4);
    return {
      user_id: ctx.userId,
      child_id: ctx.childId,
      curriculum_goal_id: goalId,
      title: `${name} Lesson ${n}`,
      lesson_number: n,
      queue_position: n,
      scheduled_date: day,
      date: day,
      completed: n <= 3,
      completed_at: n <= 3 ? `${day}T12:00:00Z` : null,
      minutes_spent: n <= 3 ? 30 : null,
      hours: n <= 3 ? 0.5 : 0,
      scheduled_source: 'wizard_create',
      is_backfill: false,
      queue_pinned: false,
    };
  });
  const { error: lessonErr } = await sb.from('lessons').insert(rows);
  if (lessonErr) throw new Error(`seed lessons failed: ${lessonErr.message}`);
  return goalId;
}

type Stored = { lesson_number: number; queue_position: number | null; scheduled_date: string | null; queue_pinned: boolean; scheduled_source: string | null; completed: boolean };

async function stored(sb: Sb, goalId: string): Promise<Map<number, Stored>> {
  const { data, error } = await sb
    .from('lessons')
    .select('lesson_number, queue_position, scheduled_date, queue_pinned, scheduled_source, completed')
    .eq('curriculum_goal_id', goalId);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as Stored[]).map((r) => [r.lesson_number, r]));
}

/** The lesson numbers of this curriculum Today lists for today. */
async function todaysLessons(page: Page, name: string): Promise<number[]> {
  await gotoAppPage(page, '/dashboard');
  const schedule = page.getByTestId('today-schedule');
  await expect(schedule).toBeVisible({ timeout: 20_000 });
  // Give the projection time to land before reading an absence.
  await page.waitForTimeout(2_000);
  const text = await schedule.innerText();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = new Set<number>();
  for (const m of text.matchAll(new RegExp(`${esc}[^\\n]*?Lesson (\\d+)`, 'g'))) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

/** Open Plan's Reschedule dialog for lesson 4 and pick a day three days out. */
async function rescheduleLesson4(page: Page, name: string, target: string) {
  await gotoAppPage(page, '/dashboard/plan');
  await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({ timeout: 20_000 });
  const kebab = page.getByRole('button', { name: new RegExp(`^More actions for ${name} · Lesson 4$`) }).first();
  await kebab.scrollIntoViewIfNeeded();
  await kebab.click();
  await page.getByRole('menuitem', { name: /^Reschedule$/ }).click();
  await page.locator('input[type="date"]').last().fill(target);
  await page.getByRole('button', { name: /Save new date/ }).click();
  await expect(page.getByText('What about the lessons after it?')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Only this lesson moves. Lessons after it stay on their dates.')).toBeVisible();
}

async function waitForUndoBar(page: Page) {
  await expect(page.getByRole('button', { name: /^Undo$/ }).first()).toBeVisible({ timeout: 20_000 });
}

test.describe('Moving one lesson moves one lesson, on Plan and Today (Invariant 24)', { tag: CURRICULUM_WRITES }, () => {
  const created: string[] = [];

  test.afterEach(async () => {
    const sb = adminClient();
    if (!sb) return;
    const ids = created.splice(0);
    if (ids.length === 0) return;
    await sb.from('lessons').delete().in('curriculum_goal_id', ids);
    await sb.from('curriculum_goals').delete().in('id', ids);
  });

  async function setup(label: string): Promise<{ sb: Sb; goalId: string; name: string } | null> {
    const sb = adminClient();
    const userId = await cachedTestUserId();
    if (!sb || !userId) return null;
    const { data: kids } = await sb.from('children').select('id').eq('user_id', userId).eq('archived', false).order('sort_order').limit(1);
    const childId = (kids ?? [])[0]?.id as string | undefined;
    if (!childId) return null;
    const name = `${label}${Date.now().toString().slice(-6)}`;
    const goalId = await seedGoal(sb, { userId, childId }, name);
    created.push(goalId);
    return { sb, goalId, name };
  }

  test('Move just this lesson: Today stops showing the curriculum today, every later lesson keeps its day, and "I\'m actually on lesson 4" brings lesson 4 back', async ({ page }) => {
    test.setTimeout(180_000);
    const ctx = await setup('MoveOne');
    if (!ctx) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY + a test account with a child are required');
      return;
    }
    const { sb, goalId, name } = ctx;
    expect(await todaysLessons(page, name), 'fixture: lesson 4 is due today').toEqual([4]);
    const before = await stored(sb, goalId);

    await rescheduleLesson4(page, name, localYmd(3));
    await page.getByRole('button', { name: /Move just this lesson/ }).click();
    await waitForUndoBar(page);

    // Plan (the stored rows): only lesson 4 moved.
    const after = await stored(sb, goalId);
    expect(after.get(4)!.scheduled_date).toBe(localYmd(3));
    for (let n = 5; n <= 20; n++) {
      expect(after.get(n)!.scheduled_date, `lesson ${n} kept its date on Plan`).toBe(before.get(n)!.scheduled_date);
    }
    for (let n = 1; n <= 20; n++) {
      expect(after.get(n)!.queue_position, `lesson ${n} kept its queue slot`).toBe(n);
    }
    // Today, reloaded: nothing of this curriculum today. Before the fix: [5].
    expect(await todaysLessons(page, name), 'Today shows no lesson of this curriculum today').toEqual([]);

    // "I'm actually on lesson 4": lesson 4 is due today on both screens.
    await gotoAppPage(page, '/dashboard/plan');
    const kebab = page.getByRole('button', { name: `More actions for ${name}`, exact: true });
    await kebab.scrollIntoViewIfNeeded();
    await kebab.click();
    await page.getByRole('menuitem', { name: /actually on/ }).click();
    const form = page
      .getByText('Which lesson are you actually on?')
      .locator('xpath=ancestor::div[.//input[@aria-label="Current lesson"]][1]');
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.getByLabel('Current lesson').fill('4');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toHaveCount(0, { timeout: 30_000 });

    const recal = await stored(sb, goalId);
    expect(recal.get(4)!.scheduled_date, 'Plan shows lesson 4 today').toBe(localYmd(0));
    expect(await todaysLessons(page, name), 'Today shows lesson 4').toEqual([4]);
    for (let n = 5; n <= 7; n++) {
      expect(recal.get(n)!.scheduled_date, `lesson ${n} still on its day`).toBe(before.get(n)!.scheduled_date);
    }
  });

  test('Shift all remaining lessons forward: every later lesson moves the named school days, and Undo puts every row back', async ({ page }) => {
    test.setTimeout(180_000);
    const ctx = await setup('ShiftAll');
    if (!ctx) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY + a test account with a child are required');
      return;
    }
    const { sb, goalId, name } = ctx;
    const before = await stored(sb, goalId);

    await rescheduleLesson4(page, name, localYmd(3));
    // Every day is a school day here, so today to three days out is 3 school days.
    await expect(page.getByText(/16 later lessons shift by 3 school days\. New finish date: /)).toBeVisible();
    await page.getByRole('button', { name: /Shift all remaining lessons forward/ }).click();
    await waitForUndoBar(page);

    const after = await stored(sb, goalId);
    expect(after.get(4)!.scheduled_date).toBe(localYmd(3));
    for (let n = 5; n <= 20; n++) {
      expect(after.get(n)!.scheduled_date, `lesson ${n} shifted three days later`).toBe(localYmd(n - 4 + 3));
    }
    for (let n = 1; n <= 20; n++) {
      expect(after.get(n)!.queue_position, `lesson ${n} kept its queue slot`).toBe(n);
    }

    // Undo, on the same page, puts every row back exactly.
    await page.getByRole('button', { name: /^Undo$/ }).first().click();
    await expect.poll(async () => (await stored(sb, goalId)).get(4)!.scheduled_date, { timeout: 20_000 }).toBe(localYmd(0));
    const undone = await stored(sb, goalId);
    for (const [n, r] of before) {
      const u = undone.get(n)!;
      expect([u.scheduled_date, u.queue_position, u.queue_pinned, u.scheduled_source], `lesson ${n} back exactly`).toEqual([
        r.scheduled_date, r.queue_position, r.queue_pinned, r.scheduled_source,
      ]);
    }

    // Shift again and read Today, reloaded: nothing was pulled onto today.
    // Before the fix Today showed lesson 5 here, and the finish date never moved.
    await rescheduleLesson4(page, name, localYmd(3));
    await page.getByRole('button', { name: /Shift all remaining lessons forward/ }).click();
    await waitForUndoBar(page);
    expect(await todaysLessons(page, name)).toEqual([]);
    expect((await stored(sb, goalId)).get(20)!.scheduled_date, 'the finish date moved three days').toBe(localYmd(19));
  });
});
