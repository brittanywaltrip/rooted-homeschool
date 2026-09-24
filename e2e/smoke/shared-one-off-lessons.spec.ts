import { test, expect } from '@playwright/test';
import { adminClient, requireTestUserId } from '../admin';
import { gotoAppPage } from '../helpers/overlays';

// Adds a child to the shared e2e account. Run after ordinary smoke specs so
// their child selectors cannot observe this temporary fixture.
test.describe('Shared one-off lessons', { tag: '@curriculum-writes' }, () => {
test('a reused one-off lesson creates independent entries and report time for two children', async ({ page }) => {
  test.setTimeout(120_000);
  const sb = adminClient();
  test.skip(!sb, 'Needs the guarded staging test account and service-role key');
  const uid = await requireTestUserId('shared one-off lesson test');
  const { data: existing, error: childrenError } = await sb!.from('children')
    .select('id, name').eq('user_id', uid).eq('archived', false).limit(1);
  expect(childrenError).toBeNull();
  const first = existing?.[0];
  test.skip(!first, 'Test account needs its original child');

  const stamp = Date.now().toString();
  const secondName = `QA shared ${stamp}`;
  const title = `QA${stamp} Nature Study · Compare leaves`;
  const day = new Date().toISOString().slice(0, 10);
  let secondId: string | null = null;
  let seededId: string | null = null;
  const createdIds: string[] = [];
  const startedAt = new Date(Date.now() - 10_000).toISOString();

  async function newRows() {
    const { data, error } = await sb!.from('lessons')
      .select('id, child_id, completed, minutes_spent, curriculum_goal_id, title, scheduled_date')
      .eq('user_id', uid).eq('title', title).neq('id', seededId!);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  try {
    const { data: second, error: childError } = await sb!.from('children')
      .insert({ user_id: uid, name: secondName, sort_order: 9999 })
      .select('id').single();
    if (childError || !second) throw new Error(`Second child seed failed: ${childError?.message}`);
    secondId = second.id;

    const { data: seeded, error: seedError } = await sb!.from('lessons')
      .insert({ user_id: uid, child_id: first!.id, title, date: day,
        scheduled_date: day, completed: false, scheduled_source: 'plan_move' })
      .select('id').single();
    if (seedError || !seeded) throw new Error(`Prior lesson seed failed: ${seedError?.message}`);
    seededId = seeded.id;

    await gotoAppPage(page, '/dashboard/plan');
    await page.getByRole('button', { name: 'Add to your plan' }).click();
    await page.getByRole('dialog', { name: 'Add to your plan' })
      .getByText('Add a lesson', { exact: true }).click();
    const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add a lesson' }) });
    await expect(form.getByLabel('Use a past one-off lesson')).toBeVisible();
    await form.getByLabel('Use a past one-off lesson').selectOption({ label: title });
    await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Compare leaves');
    await form.getByRole('checkbox', { name: secondName }).check();
    await form.getByRole('button', { name: 'Add lesson', exact: true }).click();
    await expect.poll(async () => (await newRows()).length, { timeout: 30_000 }).toBe(2);
    const planned = await newRows();
    createdIds.push(...planned.map((row) => row.id));
    expect(new Set(planned.map((row) => row.child_id))).toEqual(new Set([first!.id, secondId]));
    expect(planned.every((row) => !row.completed && row.curriculum_goal_id === null && row.scheduled_date === day)).toBe(true);

    // Log the same saved title once more; each child's completion and minutes
    // must be independent on the report, not one shared lesson counted twice.
    await page.getByRole('button', { name: 'Add to your plan' }).click();
    await page.getByRole('dialog', { name: 'Add to your plan' })
      .getByText('Log a lesson you did', { exact: true }).click();
    const logForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Log a lesson you did' }) });
    await logForm.getByLabel('Use a past one-off lesson').selectOption({ label: title });
    await logForm.getByRole('checkbox', { name: secondName }).check();
    await logForm.getByLabel('Minutes').fill('40');
    await logForm.getByRole('button', { name: 'Log as done' }).click();
    await expect.poll(async () => (await newRows()).length, { timeout: 30_000 }).toBe(4);
    const all = await newRows();
    createdIds.push(...all.filter((row) => !createdIds.includes(row.id)).map((row) => row.id));
    const done = all.filter((row) => row.completed);
    expect(done.map((row) => row.child_id).sort()).toEqual([first!.id, secondId!].sort());
    expect(done.every((row) => row.minutes_spent === 40 && row.curriculum_goal_id === null)).toBe(true);

    await gotoAppPage(page, '/dashboard/reports');
    await page.getByRole('button', { name: first!.name, exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: secondName, exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(1);
  } finally {
    const ids = [...createdIds];
    const { data: late } = await sb!.from('lessons').select('id').eq('user_id', uid).eq('title', title);
    ids.push(...(late ?? []).map((row) => row.id));
    const unique = [...new Set(ids)];
    if (unique.length) {
      await sb!.from('lessons').delete().eq('user_id', uid).in('id', unique);
      const { data: events } = await sb!.from('app_events').select('id, payload')
        .eq('user_id', uid).eq('type', 'lesson.created').gte('created_at', startedAt);
      const eventIds = (events ?? []).filter((event) => unique.includes((event.payload as { lesson_id?: string })?.lesson_id ?? ''))
        .map((event) => event.id);
      if (eventIds.length) await sb!.from('app_events').delete().eq('user_id', uid).in('id', eventIds);
    }
    if (secondId) await sb!.from('children').delete().eq('user_id', uid).eq('id', secondId);
  }
});
});
