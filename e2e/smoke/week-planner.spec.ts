import { test, expect, type Page } from '@playwright/test';
import { adminClient, requireTestUserId } from '../admin';
import { gotoAppPage } from '../helpers/overlays';

// "Plan this week": a parent plans a subject for several children, a title per
// day, on the days she picks. Each child gets their own lesson, checks it off
// separately, and it counts on their own report with the minutes she planned.
//
// Adds a temporary second child to the shared e2e account, like the shared
// one-off lesson spec, so it runs in the @curriculum-writes teardown project
// after the ordinary specs, and removes everything it made in `finally`.
// Days are chosen explicitly (today, and next Monday to Thursday) because the
// suite can run on any weekday.

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayName(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function offset(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
/** Monday of next week, and the Monday of this week (Plan's week start). */
function mondays(): { thisMon: string; nextMon: string } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const thisMon = ymd(d);
  d.setDate(d.getDate() + 7);
  return { thisMon, nextMon: ymd(d) };
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

async function openPlanner(page: Page, nextWeeks: number) {
  await gotoAppPage(page, '/dashboard/plan');
  await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < nextWeeks; i++) {
    await page.getByRole('button', { name: /^Next (week|month)$/ }).first().click();
  }
  await page.getByRole('button', { name: 'Plan this week' }).click();
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Plan this week' }) });
  await expect(form).toBeVisible();
  return form;
}

/** Choose exactly these days of the week on screen. */
async function chooseOnly(form: ReturnType<Page['locator']>, weekStart: string, days: string[]) {
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const box = form.getByRole('checkbox', { name: `Plan ${dayName(date)}` });
    if (await box.isDisabled()) continue;
    if (days.includes(date)) await box.check();
    else await box.uncheck();
  }
}

test.describe('Plan this week', { tag: '@curriculum-writes' }, () => {
  test('a parent plans a week for two children; each checks off their own and it counts on their own report', async ({ page }) => {
    test.setTimeout(180_000);
    const sb = adminClient();
    test.skip(!sb, 'Needs the guarded staging test account and service-role key');
    const uid = await requireTestUserId('week planner test');
    const { data: existing, error: childrenError } = await sb!.from('children')
      .select('id, name').eq('user_id', uid).eq('archived', false).order('sort_order').limit(1);
    expect(childrenError).toBeNull();
    const first = existing?.[0];
    test.skip(!first, 'Test account needs its original child');

    const stamp = Date.now().toString();
    const secondName = `QA planner ${stamp}`;
    const subject = `QA${stamp.slice(-6)} Unit`;
    const today = offset(0);
    const { thisMon, nextMon } = mondays();
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    let secondId: string | null = null;

    async function planned() {
      const { data, error } = await sb!.from('lessons')
        .select('id, child_id, title, completed, minutes_spent, curriculum_goal_id, queue_position, lesson_number, scheduled_date, scheduled_source')
        .eq('user_id', uid).like('title', `${subject} · %`);
      if (error) throw new Error(error.message);
      return data ?? [];
    }

    try {
      const { data: second, error: childError } = await sb!.from('children')
        .insert({ user_id: uid, name: secondName, sort_order: 9999 }).select('id').single();
      if (childError || !second) throw new Error(`Second child seed failed: ${childError?.message}`);
      secondId = second.id;

      // ── Plan today for both children ──────────────────────────────────────
      let form = await openPlanner(page, 0);
      await form.getByLabel('Subject').fill(subject);
      await expect(form.getByRole('checkbox', { name: first!.name, exact: true })).toBeChecked();
      await expect(form.getByRole('checkbox', { name: secondName, exact: true })).toBeChecked();
      await chooseOnly(form, thisMon, [today]);
      await form.getByRole('textbox', { name: `Lesson title for ${dayName(today)}` }).fill('Week 1.1');
      await form.getByLabel('Minutes each').fill('45');
      await expect(form.getByRole('status')).toContainText(`Adds 2 lessons: 1 day each for ${first!.name} and ${secondName}`);
      await form.getByRole('button', { name: 'Add to the week' }).click();
      await expect(form).toHaveCount(0, { timeout: 30_000 });
      await expect.poll(async () => (await planned()).length, { timeout: 30_000 }).toBe(2);
      const todays = await planned();
      expect(new Set(todays.map((r) => r.child_id))).toEqual(new Set([first!.id, secondId]));
      for (const r of todays) {
        expect(r).toMatchObject({
          title: `${subject} · Week 1.1`, scheduled_date: today, completed: false, minutes_spent: 45,
          curriculum_goal_id: null, queue_position: null, lesson_number: null, scheduled_source: 'week_plan',
        });
      }

      // ── Today: one lesson per child, under the subject (not "Untitled") ──
      await gotoAppPage(page, '/dashboard');
      const schedule = page.getByTestId('today-schedule');
      await expect(schedule.getByText(`${subject} · Week 1.1`, { exact: true })).toHaveCount(2, { timeout: 20_000 });
      await expect(schedule.getByText(subject, { exact: true }).first()).toBeVisible();

      // Check off the first child's only: the sheet offers the planned 45.
      const toggles = schedule.getByRole('button', { name: /^Mark lesson complete$/ });
      let target = -1;
      for (let i = 0; i < await toggles.count(); i++) {
        const text = await toggles.nth(i).evaluate((b) => {
          let el = b.parentElement;
          while (el && !(el.innerText || '').includes(' · ')) el = el.parentElement;
          return el?.innerText ?? '';
        });
        if (text.includes(`${subject} · Week 1.1`) && text.includes(first!.name)) { target = i; break; }
      }
      expect(target, "the first child's planned lesson has its own toggle").toBeGreaterThanOrEqual(0);
      await toggles.nth(target).click();
      await expect(page.getByText('You planned 45 min, change it if today was different')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: /^Log it ✓$/ }).click();
      await expect.poll(async () => (await planned()).filter((r) => r.completed).map((r) => r.child_id), { timeout: 30_000 })
        .toEqual([first!.id]);
      const done = (await planned()).find((r) => r.completed)!;
      expect(done.minutes_spent, 'the planned minutes are what was logged').toBe(45);

      // ── Reports: the lesson is on the first child's log only ──────────────
      await gotoAppPage(page, '/dashboard/reports');
      await page.getByRole('button', { name: 'Preview Log' }).click();
      await page.getByRole('button', { name: first!.name, exact: true }).click();
      await expect(page.getByText(`${subject} · Week 1.1`, { exact: true })).toHaveCount(1, { timeout: 15_000 });
      await page.getByRole('button', { name: secondName, exact: true }).click();
      await expect(page.getByText(`${subject} · Week 1.1`, { exact: true })).toHaveCount(0);

      // ── Next week: pick Monday to Thursday; titles count up; Undo ────────
      form = await openPlanner(page, 1);
      await form.getByLabel('Subject').fill(subject);
      const days = [0, 1, 2, 3].map((i) => addDays(nextMon, i));
      await chooseOnly(form, nextMon, days);
      await form.getByRole('textbox', { name: `Lesson title for ${dayName(days[0])}` }).fill('Week 12.1');
      for (const [i, d] of days.entries()) {
        await expect(form.getByRole('textbox', { name: `Lesson title for ${dayName(d)}` })).toHaveValue(`Week 12.${i + 1}`);
      }
      await expect(form.getByRole('status')).toContainText('Adds 8 lessons: 4 days each');
      await form.getByRole('button', { name: 'Add to the week' }).click();
      await expect.poll(async () => (await planned()).length, { timeout: 30_000 }).toBe(10);
      const week = (await planned()).filter((r) => r.scheduled_date >= nextMon);
      expect(week.map((r) => `${r.scheduled_date} ${r.title.split(' · ')[1]}`).sort()).toEqual(
        days.flatMap((d, i) => [`${d} Week 12.${i + 1}`, `${d} Week 12.${i + 1}`]).sort(),
      );
      await page.getByRole('button', { name: /^Undo$/ }).first().click();
      await expect.poll(async () => (await planned()).length, { timeout: 30_000 }).toBe(2);
      expect((await planned()).every((r) => r.scheduled_date === today), "Undo removed the week, not today's lessons").toBe(true);
    } finally {
      const { data: rows } = await sb!.from('lessons').select('id').eq('user_id', uid).like('title', `${subject} · %`);
      const ids = (rows ?? []).map((r) => r.id);
      if (ids.length) await sb!.from('lessons').delete().eq('user_id', uid).in('id', ids);
      const { data: events } = await sb!.from('app_events').select('id, payload')
        .eq('user_id', uid).eq('type', 'lesson.bulk_action').gte('created_at', startedAt);
      const eventIds = (events ?? [])
        .filter((e) => (e.payload as { action?: string; subject?: string })?.action === 'week_plan'
          && (e.payload as { subject?: string })?.subject === subject)
        .map((e) => e.id);
      if (eventIds.length) await sb!.from('app_events').delete().eq('user_id', uid).in('id', eventIds);
      if (secondId) await sb!.from('children').delete().eq('user_id', uid).eq('id', secondId);
    }
  });
});
