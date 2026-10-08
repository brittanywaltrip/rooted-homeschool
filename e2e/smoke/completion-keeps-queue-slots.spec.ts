import { test, expect, type Page } from '@playwright/test';

import { adminClient, cachedTestUserId } from '../admin';
import { gotoAppPage } from '../helpers/overlays';

// A family ticking a lesson on Today keeps every queue slot filled, and Today
// and Plan agree on what comes next.
//
// On 2026-09-25 an ad-hoc "orphan auto-heal" marked 250 lessons done that no
// family had finished, and nulled their queue_position. Families then saw a
// lesson vanish from both screens and an empty slot below the pointer (the
// 2026-09-28 report: Math With Confidence, Gather Round: Chemistry, Reason for
// Handwriting K). supabase/migrations/20260928205411 now refuses any
// completion that comes from neither the family nor the service_role key;
// supabase/tests/completion-needs-a-person.sql proves the refusal. This spec
// proves the other half of a fail-closed guard: the parent's real action
// still lands through the guard, the pointer moves one slot, no slot is left
// empty, and Plan's stored dates match what Today shows. Reloading Today does
// not move any date again (the re-date after a completion is stable).
//
// Seeded like move-one-lesson.spec.ts: school every day, lessons 1 to 3 done
// on the three days before today, lesson n planned for day n - 4, so lesson 4
// is due today. Tagged @curriculum-writes so it runs in the teardown project
// after every spec that loads Today.

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
      total_lessons: 12,
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
  const rows = Array.from({ length: 12 }, (_, i) => {
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

type Row = { lesson_number: number | null; queue_position: number | null; scheduled_date: string | null; completed: boolean };

async function rows(sb: Sb, goalId: string): Promise<Row[]> {
  const { data, error } = await sb
    .from('lessons')
    .select('lesson_number, queue_position, scheduled_date, completed')
    .eq('curriculum_goal_id', goalId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function pointer(sb: Sb, goalId: string): Promise<number> {
  const { data, error } = await sb.from('curriculum_goals').select('current_lesson').eq('id', goalId).single();
  if (error || !data) throw new Error(error?.message ?? 'goal missing');
  return (data as { current_lesson: number }).current_lesson;
}

/**
 * This curriculum's lessons on Today, each with its toggle state, read from
 * every completion toggle's own card (the toggle's parent row), so another
 * curriculum's open lesson can never be counted as ours.
 */
async function todaysLessons(page: Page, name: string): Promise<{ all: number[]; open: number[] }> {
  await gotoAppPage(page, '/dashboard');
  const schedule = page.getByTestId('today-schedule');
  await expect(schedule).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}[^\\n]*?Lesson (\\d+)`);
  const all: number[] = [];
  const open: number[] = [];
  const toggles = schedule.getByRole('button', { name: /^Mark lesson (in)?complete$/ });
  for (let i = 0; i < (await toggles.count()); i++) {
    const t = toggles.nth(i);
    const m = (await t.locator('xpath=..').innerText()).match(re);
    if (!m) continue;
    const n = Number(m[1]);
    all.push(n);
    if ((await t.getAttribute('aria-label')) === 'Mark lesson complete') open.push(n);
  }
  return { all: all.sort((a, b) => a - b), open: open.sort((a, b) => a - b) };
}

/** The completion toggle on this curriculum's lesson n card on Today. */
async function toggleFor(page: Page, name: string, n: number) {
  const schedule = page.getByTestId('today-schedule');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}[^\\n]*?Lesson ${n}\\b`);
  const toggles = schedule.getByRole('button', { name: /^Mark lesson (in)?complete$/ });
  for (let i = 0; i < (await toggles.count()); i++) {
    if (re.test(await toggles.nth(i).locator('xpath=..').innerText())) return toggles.nth(i);
  }
  throw new Error(`no Today card for ${name} lesson ${n}`);
}

test.describe('Completing on Today keeps queue slots whole and Plan in step', { tag: CURRICULUM_WRITES }, () => {
  const created: string[] = [];

  test.afterEach(async () => {
    const sb = adminClient();
    if (!sb) return;
    const ids = created.splice(0);
    if (ids.length === 0) return;
    await sb.from('lessons').delete().in('curriculum_goal_id', ids);
    await sb.from('curriculum_goals').delete().in('id', ids);
  });

  test('ticking lesson 4 on Today: pointer 4, slots 1..12 each held once, no done lesson loses its slot, Today and Plan agree, reload moves nothing', async ({ page }) => {
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
    const name = `SlotKeep${Date.now().toString().slice(-6)}`;
    const goalId = await seedGoal(sb, { userId, childId }, name);
    created.push(goalId);

    expect((await todaysLessons(page, name)).open, 'fixture: lesson 4 is due today and open').toEqual([4]);

    // The parent's real action: tick lesson 4 on Today.
    await (await toggleFor(page, name, 4)).click();
    const logIt = page.getByRole('button', { name: /^Log it ✓$/ });
    // Today's check-off sheet asks for time spent; the default is fine.
    if (await logIt.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) await logIt.click();

    // It landed through the guard: the database says done, pointer 4.
    await expect
      .poll(async () => (await rows(sb, goalId)).find((r) => r.lesson_number === 4)?.completed, { timeout: 60_000, intervals: [500, 1_000, 2_000] })
      .toBe(true);
    await expect.poll(() => pointer(sb, goalId), { timeout: 30_000 }).toBe(4);

    // Slots: every one of 1..12 held by exactly one row, and no completed
    // curriculum lesson without a slot (the 2026-09-25 damage).
    // Wait for the follow-up re-date to settle before reading Plan's dates.
    await page.waitForTimeout(3_000);
    const after = await rows(sb, goalId);
    const slots = after.map((r) => r.queue_position).filter((q): q is number => q != null).sort((a, b) => a - b);
    expect(slots, 'each slot 1..12 is held exactly once').toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(after.filter((r) => r.completed && r.lesson_number != null && r.queue_position == null), 'no completed lesson lost its slot').toEqual([]);
    expect(after.filter((r) => !r.completed && r.lesson_number != null && r.lesson_number <= 4), 'nothing unfinished behind the pointer').toEqual([]);

    // Today and Plan agree. Today: lesson 4 done, nothing else of this
    // curriculum open today (one a day). Plan (stored rows): the next open
    // lesson is 5, dated after today, and no open lesson is dated today.
    const today = await todaysLessons(page, name);
    expect(today.open, 'Today has nothing of this curriculum left open today').toEqual([]);
    const open = after.filter((r) => !r.completed && r.lesson_number != null).sort((a, b) => a.queue_position! - b.queue_position!);
    expect(open[0]?.lesson_number, 'Plan: next open lesson is 5').toBe(5);
    expect(open.filter((r) => r.scheduled_date === localYmd(0)), 'Plan: no open lesson left on today').toEqual([]);
    expect(open[0]?.scheduled_date, 'Plan: lesson 5 is after today').not.toBe(localYmd(0));
    expect(open[0]!.scheduled_date! > localYmd(0)).toBe(true);

    // Stable: reloading Today twice writes no new dates.
    const snapshot = JSON.stringify(after.map((r) => [r.lesson_number, r.scheduled_date]).sort());
    await todaysLessons(page, name);
    await todaysLessons(page, name);
    const again = await rows(sb, goalId);
    expect(JSON.stringify(again.map((r) => [r.lesson_number, r.scheduled_date]).sort()), 'reloading Today moved no date').toBe(snapshot);
  });
});
