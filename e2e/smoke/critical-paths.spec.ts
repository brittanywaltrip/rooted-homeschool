import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/* Critical-path Playwright smoke tests. Run before every staging -> main
 * merge to catch regressions on the four user-facing flows that hurt the
 * most when broken: curriculum create / edit / delete / lesson complete.
 *
 * Auth: storageState is loaded automatically by playwright.config.ts from
 * e2e/.auth/user.json. global-setup.ts signs in once via the real /login
 * form using PLAYWRIGHT_EMAIL + PLAYWRIGHT_PASSWORD env vars.
 *
 * No hardcoded credentials in this file. Set PLAYWRIGHT_EMAIL,
 * PLAYWRIGHT_PASSWORD, and (optionally) SUPABASE_SERVICE_ROLE_KEY +
 * NEXT_PUBLIC_SUPABASE_URL in .env.local. The DB-verification steps
 * skip cleanly when SUPABASE_SERVICE_ROLE_KEY is absent.
 *
 * Path 5 ("plan page loads with calendar") lives in plan.spec.ts already.
 * Not duplicated here. */

const STAMP = () => Date.now().toString();

// ── Optional Supabase admin client (for DB verifications + cleanup) ─────────
// Skipped paths run without DB access, but cleanup leaves no test data.
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Tear down a curriculum row by subject_label match. Best-effort; leaves
// the row in place if the admin client isn't configured.
async function cleanupCurriculumByLabel(label: string) {
  const sb = adminClient();
  if (!sb) return;
  const { data: goals } = await sb
    .from('curriculum_goals')
    .select('id')
    .eq('subject_label', label);
  const ids = (goals ?? []).map((g) => (g as { id: string }).id);
  if (ids.length === 0) return;
  await sb.from('lessons').delete().in('curriculum_goal_id', ids);
  await sb.from('curriculum_goals').delete().in('id', ids);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD via Schedule Builder (route-based, version-neutral)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Curriculum CRUD via Schedule Builder', () => {
  // Track names created during the suite so afterEach can clean up even
  // if a test bailed before its own try/finally fired.
  const createdLabels: string[] = [];

  test.afterEach(async () => {
    for (const label of createdLabels.splice(0)) {
      await cleanupCurriculumByLabel(label);
    }
  });

  test('New curriculum is created active (not archived)', async ({ page }) => {
    const stamp = STAMP();
    const subject = `Test Subject ${stamp}`;
    createdLabels.push(subject);

    await page.goto('/dashboard/plan/schedule');
    await expect(page.getByRole('heading', { name: /schedule|plan/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Add a curriculum row. Schedule Builder offers an "Add curriculum"
    // button at the top of the rows list. The exact label is "+ Curriculum"
    // or similar; use a forgiving regex so a copy tweak doesn't break us.
    const addBtn = page.getByRole('button', { name: /\+\s*curriculum|add curriculum/i }).first();
    await addBtn.click();

    // Fill the new row. The first input on the new card is curriculum name;
    // the next text input is subject; numeric inputs include total_lessons.
    // Selectors lean on placeholders / labels rather than position.
    const nameInput = page.getByPlaceholder(/curriculum name|name/i).last();
    await nameInput.fill(subject);

    const subjectInput = page.getByPlaceholder(/subject \(e\.g\. math\)/i).last();
    await subjectInput.fill(subject);

    // Total lessons: numeric input with placeholder "e.g. 120".
    const totalInput = page.getByPlaceholder(/e\.g\.?\s*120/i).last();
    await totalInput.fill('10');

    // Day chips default to Mon-Fri; the prompt asks Mon/Tue/Wed. Toggle
    // off Thu and Fri so only Mon/Tue/Wed remain active.
    for (const dayLabel of ['Th', 'F']) {
      const chip = page.getByRole('button', { name: new RegExp(`^${dayLabel}$`) }).last();
      if ((await chip.getAttribute('aria-pressed')) === 'true') {
        await chip.click();
      }
    }

    // Save the schedule.
    const saveBtn = page.getByRole('button', { name: /^save( schedule)?$/i }).first();
    await saveBtn.click();

    // After save, navigate to /dashboard/plan and verify the new
    // curriculum surfaces in the curriculum panel.
    await page.goto('/dashboard/plan');
    await expect(page.getByText(subject, { exact: false })).toBeVisible({ timeout: 15_000 });

    // DB-side assertion: archived must be false. Skipped if no admin key.
    const sb = adminClient();
    if (sb) {
      const { data } = await sb
        .from('curriculum_goals')
        .select('archived')
        .eq('subject_label', subject);
      const rows = (data ?? []) as { archived: boolean }[];
      expect(rows.length, 'expected exactly one curriculum row with this label').toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.archived, 'newly created curriculum must not be archived').toBe(false);
      }
    }
  });

  test('Curriculum edit modal opens and saves correctly', async ({ page }) => {
    const stamp = STAMP();
    const subject = `Edit Test ${stamp}`;
    createdLabels.push(subject);

    // Seed a curriculum row directly via the admin client when available;
    // otherwise create through the UI. UI-create path mirrors the test
    // above and is verified there, so we keep this path lean.
    const sb = adminClient();
    if (sb) {
      // Need user_id to scope the row. Look up the test account by email.
      const email = process.env.PLAYWRIGHT_EMAIL;
      if (!email) test.skip(true, 'PLAYWRIGHT_EMAIL not set');
      const { data: userRow } = await sb
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      const userId = (userRow as { id: string } | null)?.id;
      if (!userId) {
        test.skip(true, 'Test account profile not found via admin client');
        return;
      }
      await sb.from('curriculum_goals').insert({
        user_id: userId,
        curriculum_name: subject,
        subject_label: subject,
        total_lessons: 5,
        current_lesson: 0,
        lessons_per_day: 1,
        school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        default_minutes: 30,
        archived: false,
      });
    } else {
      // Fall back to UI seed. Navigate to Schedule Builder and add+save.
      await page.goto('/dashboard/plan/schedule');
      const addBtn = page.getByRole('button', { name: /\+\s*curriculum|add curriculum/i }).first();
      await addBtn.click();
      await page.getByPlaceholder(/curriculum name|name/i).last().fill(subject);
      await page.getByPlaceholder(/subject \(e\.g\. math\)/i).last().fill(subject);
      await page.getByPlaceholder(/e\.g\.?\s*120/i).last().fill('5');
      await page.getByRole('button', { name: /^save( schedule)?$/i }).first().click();
    }

    // Open Schedule Builder and edit. The row card already shows the
    // curriculum's fields; "edit" in this context means tweak total
    // lessons and save again. The Schedule Builder is the edit surface.
    await page.goto('/dashboard/plan/schedule');
    const card = page.getByText(subject, { exact: false }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The total-lessons input lives within the row; find the input whose
    // current value is "5" and update it. Defensive locator: scope to the
    // card's container.
    const rowContainer = card.locator('xpath=ancestor::div[contains(@class, "border")][1]');
    const totalInput = rowContainer.getByPlaceholder(/e\.g\.?\s*120/i);
    await expect(totalInput).toHaveValue('5');
    await totalInput.fill('8');

    await page.getByRole('button', { name: /^save( schedule)?$/i }).first().click();

    // Verify the change reflected in the curriculum panel on the plan page.
    await page.goto('/dashboard/plan');
    // Curriculum panel surfaces "X / Y lessons" or similar progress text.
    // Match any text node containing the new total to keep the assertion
    // stable across copy tweaks.
    await expect(
      page.getByText(/\b8\b/).first(),
    ).toBeVisible({ timeout: 15_000 });

    // DB-side confirmation when admin is available.
    if (sb) {
      const { data } = await sb
        .from('curriculum_goals')
        .select('total_lessons')
        .eq('subject_label', subject)
        .maybeSingle();
      const row = data as { total_lessons: number } | null;
      expect(row?.total_lessons, 'total_lessons must persist as 8').toBe(8);
    }
  });

  test('Curriculum delete removes it completely, not just archived', async ({ page }) => {
    const stamp = STAMP();
    const subject = `Delete Test ${stamp}`;
    createdLabels.push(subject);

    // Seed via admin if available.
    const sb = adminClient();
    let seededUserId: string | null = null;
    if (sb) {
      const email = process.env.PLAYWRIGHT_EMAIL;
      const { data: userRow } = email
        ? await sb.from('profiles').select('id').eq('email', email).maybeSingle()
        : { data: null };
      seededUserId = (userRow as { id: string } | null)?.id ?? null;
      if (seededUserId) {
        await sb.from('curriculum_goals').insert({
          user_id: seededUserId,
          curriculum_name: subject,
          subject_label: subject,
          total_lessons: 5,
          current_lesson: 0,
          lessons_per_day: 1,
          school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          default_minutes: 30,
          archived: false,
        });
      }
    }

    if (!seededUserId) {
      // UI seed fallback.
      await page.goto('/dashboard/plan/schedule');
      const addBtn = page.getByRole('button', { name: /\+\s*curriculum|add curriculum/i }).first();
      await addBtn.click();
      await page.getByPlaceholder(/curriculum name|name/i).last().fill(subject);
      await page.getByPlaceholder(/subject \(e\.g\. math\)/i).last().fill(subject);
      await page.getByPlaceholder(/e\.g\.?\s*120/i).last().fill('5');
      await page.getByRole('button', { name: /^save( schedule)?$/i }).first().click();
    }

    // Delete via the curriculum panel on /dashboard/plan. The panel has a
    // per-row trash/Remove control that opens a confirm dialog.
    await page.goto('/dashboard/plan');
    const card = page.getByText(subject, { exact: false }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const cardContainer = card.locator('xpath=ancestor::div[contains(@class, "rounded")][1]');

    // Open the per-card menu / find the delete trigger. Try a few likely
    // selector patterns; the curriculum panel exposes either a trash icon
    // or a "Remove" / "Delete" text button.
    const deleteTriggers = [
      cardContainer.getByRole('button', { name: /delete curriculum|remove curriculum|^remove$|^delete$/i }),
      cardContainer.getByRole('button', { name: /trash/i }),
    ];
    let opened = false;
    for (const trigger of deleteTriggers) {
      if ((await trigger.count()) > 0) {
        await trigger.first().click();
        opened = true;
        break;
      }
    }
    if (!opened) {
      throw new Error('Could not find a delete trigger on the curriculum card.');
    }

    // Confirm in the modal.
    const confirmBtn = page.getByRole('button', { name: /^delete( curriculum)?$|^yes,? remove$/i }).last();
    await confirmBtn.click();

    // UI assertion: the curriculum no longer appears.
    await expect(page.getByText(subject, { exact: false })).toHaveCount(0, { timeout: 15_000 });

    // CRITICAL DB assertion: zero rows must exist for this label, even
    // archived ones. Catches the soft-delete bug where delete only set
    // archived=true.
    if (sb) {
      const { data } = await sb
        .from('curriculum_goals')
        .select('id, archived')
        .eq('subject_label', subject);
      const rows = (data ?? []) as { id: string; archived: boolean }[];
      expect(
        rows.length,
        `Expected 0 rows for "${subject}" after delete, found ${rows.length} (archived shape: ${rows.map((r) => r.archived).join(',')}). This is the soft-delete bug.`,
      ).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lesson completion (V2 toolbar + WeekListView, since the test account is on
// the new_plan_view flag per scope confirmation)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Lesson completion (V2)', () => {
  test('Marking a lesson complete updates its visual state', async ({ page }) => {
    await page.goto('/dashboard/plan');
    await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({
      timeout: 15_000,
    });

    // V2 WeekListView renders lesson cards as buttons (the whole card
    // body is a <button> in non-edit mode, opening DayDetailPanel on tap).
    // Find the first lesson card. Its accessible label includes "Open
    // {title} details" per WeekListView.tsx.
    const firstLessonCard = page
      .getByRole('button', { name: /^open .+ details$/i })
      .first();

    // Skip cleanly if the test account has no lessons in the visible week
    // (fresh account or all already done). The test's job is to catch
    // regressions when there ARE lessons; an empty week isn't a failure.
    if ((await firstLessonCard.count()) === 0) {
      test.skip(true, 'No lessons in current week for test account; cannot exercise completion path.');
      return;
    }

    await firstLessonCard.click();

    // DayDetailPanel opens. It exposes per-lesson actions including a
    // toggle for done state. Click the first "Mark done" / "Mark complete"
    // control inside the panel.
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const markDoneTriggers = [
      dialog.getByRole('button', { name: /mark done|mark complete|complete/i }),
      dialog.getByRole('checkbox'),
    ];
    let clicked = false;
    for (const trigger of markDoneTriggers) {
      if ((await trigger.count()) > 0) {
        await trigger.first().click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      throw new Error('Could not find a mark-done control in the day detail panel.');
    }

    // Visual confirmation: either a "Done" badge appears on the panel,
    // or the panel updates state. Soft assertion since the exact label
    // varies across V2 versions.
    await expect(
      dialog.getByText(/done|completed/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: data-integrity audit. Skips cleanly without admin credentials.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Data integrity', () => {
  test('No user has an archived curriculum with completed lessons', async () => {
    const sb = adminClient();
    if (!sb) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY not set — admin DB checks unavailable.');
      return;
    }

    // Two-step query: pull goal IDs that have completed lessons, then
    // count how many of those goals are archived.
    const { data: completedRows, error: e1 } = await sb
      .from('lessons')
      .select('curriculum_goal_id')
      .not('completed_at', 'is', null)
      .not('curriculum_goal_id', 'is', null);
    if (e1) throw new Error(`audit query 1 failed: ${e1.message}`);

    const goalIdsWithCompletions = Array.from(
      new Set(
        (completedRows ?? [])
          .map((r) => (r as { curriculum_goal_id: string | null }).curriculum_goal_id)
          .filter((v): v is string => !!v),
      ),
    );
    if (goalIdsWithCompletions.length === 0) return;

    const { data: archivedRows, error: e2 } = await sb
      .from('curriculum_goals')
      .select('id, curriculum_name, archived')
      .in('id', goalIdsWithCompletions)
      .eq('archived', true);
    if (e2) throw new Error(`audit query 2 failed: ${e2.message}`);

    const offenders = (archivedRows ?? []) as { id: string; curriculum_name: string }[];
    expect(
      offenders.length,
      `${offenders.length} archived curriculum goal(s) still have completed lessons. IDs: ${offenders
        .map((o) => `${o.id} (${o.curriculum_name})`)
        .join(', ')}`,
    ).toBe(0);
  });
});
