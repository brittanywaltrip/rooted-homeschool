import { test, expect } from '@playwright/test';

import { adminClient, cachedTestUserId } from '../admin';
import { gotoAppPage } from '../helpers/overlays';

// An open catch-up sheet must not rewrite a lesson that changed after it
// opened (draft PR #109).
//
// The sheet asks "did you do these?" about projected queue slots. Before the
// guard, its Yes path looked each slot up and wrote a completion without
// checking the row, so a lesson finished in another tab while the sheet stayed
// open got its completion date replaced by the sheet's proposed day.
//
// This seeds one curriculum on the test account, school every day so the
// weekday cannot matter: lessons 1 to 3 done on days -7 to -5, lessons 4 to 7
// unfinished on days -4 to -1, so Plan offers 4 to 7 as missed work. With the
// sheet open, lesson 4 is marked done through the admin client (the other
// tab). "Mark ... done" must then refuse, and nothing may be written: lesson
// 4 keeps the other tab's completion, 5 to 7 stay unfinished, and no
// curriculum on the account records a catch-up answer.
//
// Tagged @curriculum-writes: it writes curricula, so it runs in the teardown
// project after every spec that loads Today (playwright.config.ts).

const CURRICULUM_WRITES = '@curriculum-writes';

function localYmd(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Sb = NonNullable<ReturnType<typeof adminClient>>;
type Stored = { lesson_number: number; completed: boolean; completed_at: string | null; date: string | null };

test.describe('Catch-up refuses a lesson that changed while the sheet was open', { tag: CURRICULUM_WRITES }, () => {
  const created: string[] = [];

  test.afterEach(async () => {
    const sb = adminClient();
    if (!sb) return;
    const ids = created.splice(0);
    if (ids.length === 0) return;
    // Lessons first: the lessons FK is ON DELETE SET NULL.
    await sb.from('lessons').delete().in('curriculum_goal_id', ids);
    await sb.from('curriculum_goals').delete().in('id', ids);
  });

  test('a lesson finished elsewhere keeps its completion and nothing is recorded', async ({ page }) => {
    test.setTimeout(180_000);
    const sb = adminClient();
    const userId = await cachedTestUserId();
    if (!sb || !userId) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY + a test account are required');
      return;
    }
    const { data: kids } = await sb.from('children').select('id').eq('user_id', userId).eq('archived', false).order('sort_order').limit(1);
    const childId = (kids ?? [])[0]?.id as string | undefined;
    if (!childId) {
      test.skip(true, 'the test account needs a child');
      return;
    }

    const name = `StaleCatchup${Date.now().toString().slice(-6)}`;
    const goalId = await seed(sb, { userId, childId }, name);
    created.push(goalId);

    // Answers already recorded on the account's other curricula, so the
    // assertion below is about this click and not about earlier specs.
    const answeredBefore = await answered(sb, userId);

    await gotoAppPage(page, '/dashboard/plan');
    await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /^Review \d+ lessons? from earlier$/ }).first().click({ timeout: 30_000 });
    const sheet = page.locator('[role="dialog"][aria-labelledby="missed-recovery-title"]');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText(name).first(), 'fixture: the seeded curriculum is offered').toBeVisible();

    // The other tab finishes lesson 4 on its own day while the sheet is open.
    const otherTabAt = `${localYmd(-4)}T15:00:00Z`;
    const { error: otherErr } = await sb
      .from('lessons')
      .update({ completed: true, completed_at: otherTabAt })
      .eq('curriculum_goal_id', goalId)
      .eq('lesson_number', 4);
    expect(otherErr).toBeNull();

    await sheet.getByRole('button', { name: /^Mark \d+ done/ }).click();
    await expect(sheet.getByRole('alert')).toContainText(/lessons changed/i, { timeout: 30_000 });

    const rows = await stored(sb, goalId);
    expect(rows.get(4)!.completed_at, 'the other tab\'s completion is kept').toBe(otherTabAt);
    expect(rows.get(4)!.date).toBe(localYmd(-4));
    for (const n of [5, 6, 7]) expect(rows.get(n)!.completed, `lesson ${n} stays unfinished`).toBe(false);
    expect(await answered(sb, userId), 'no curriculum records a catch-up answer').toEqual(answeredBefore);
  });
});

async function seed(sb: Sb, ctx: { userId: string; childId: string }, name: string): Promise<string> {
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
      start_date: localYmd(-7),
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
    const day = localYmd(n - 8);
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

async function stored(sb: Sb, goalId: string): Promise<Map<number, Stored>> {
  const { data, error } = await sb
    .from('lessons')
    .select('lesson_number, completed, completed_at, date')
    .eq('curriculum_goal_id', goalId);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as Stored[]).map((r) => [r.lesson_number, r]));
}

async function answered(sb: Sb, userId: string): Promise<Record<string, string | null>> {
  const { data, error } = await sb.from('curriculum_goals').select('id, catchup_answered_on').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return Object.fromEntries(((data ?? []) as { id: string; catchup_answered_on: string | null }[]).map((g) => [g.id, g.catchup_answered_on]));
}
