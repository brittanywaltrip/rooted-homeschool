import { test, expect } from '@playwright/test';

import { adminClient, requireTestUserId } from '../admin';

/* ============================================================================
 * Close-year flow, end to end.
 *
 * Covers /dashboard/close-year -> /api/school-year/close -> the year-end recap,
 * plus the next-year wizard's prefill (the regression guard for 666f3c1).
 *
 * WHY THIS SPEC IS UNUSUALLY CAREFUL
 * The suite runs against the DEPLOYED staging build and writes to the SHARED
 * production database as the e2e account. This flow is the most destructive one
 * in the product: a single close archives the account's active school year,
 * archives every curriculum goal attached to it, advances every child's grade,
 * deactivates activities, and writes archive + certificate rows. So the spec
 * snapshots all of that BEFORE it acts and restores it in afterAll, which
 * Playwright runs even when the test body fails partway.
 *
 * Restore covers six tables, not the obvious two. The close route also touches
 * children (grade advancement), activities (deactivation), and stamps
 * school_year_id onto previously-NULL badges and yearbook_content rows. Leaving
 * any of those mutated would silently change the account other specs describe
 * themselves against.
 *
 * RUNS ALONE, NOT IN PARALLEL WITH THE REST OF THE SUITE.
 * playwright.config.ts uses 5 workers and does not set fullyParallel, so spec
 * FILES run concurrently. While this spec holds the account, there is no active
 * school year for a few seconds and every goal on it is archived, which other
 * specs (notably "Schedule Builder links goals to active year") read and assert
 * against. Run it on its own:
 *
 *   npx playwright test e2e/smoke/close-year.spec.ts
 *
 * Serializing the whole suite (workers: 1, or a dedicated project) is the fix
 * if this ever needs to run inside `npm run test:e2e`.
 *
 * Every service-role write here goes through e2e/admin.ts, so the account guard
 * in e2e/test-account.ts owns the scope. Every delete is keyed by user_id AND
 * by ids this spec recorded, never by name alone.
 * ==========================================================================*/

const PREFIX = 'E2E CloseSpec';
const STAMP = Date.now().toString();

const OLD_YEAR_NAME = `${PREFIX} Old`;
const NEW_YEAR_NAME = `${PREFIX} New`;

// Whether the admin client is configured at all. Without it this spec can
// neither seed nor restore, so the ENTIRE spec skips rather than running a
// half version that mutates the account with no way back.
const HAS_ADMIN = adminClient() !== null;

type SchoolYearRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
};
type GoalRow = { id: string; archived: boolean; school_year_id: string | null };
type ChildRow = { id: string; grade_level: string | null; graduated_at: string | null };
type ActivityRow = { id: string; is_active: boolean };

type Snapshot = {
  years: SchoolYearRow[];
  goals: GoalRow[];
  children: ChildRow[];
  activities: ActivityRow[];
  /** Rows whose school_year_id was NULL before the spec ran. */
  nullYearBadgeIds: string[];
  nullYearYearbookIds: string[];
  archiveIds: string[];
  certificateIds: string[];
};

test.describe('Close year flow', () => {
  // One test, but keep the group serial so a future second test can never
  // interleave with this one's snapshot/restore window.
  test.describe.configure({ mode: 'serial' });
  test.skip(!HAS_ADMIN, 'SUPABASE_SERVICE_ROLE_KEY not set — close-year needs admin access to seed AND to restore the account, so the whole spec skips.');

  let userId: string | null = null;
  let childId: string | null = null;
  let snapshot: Snapshot | null = null;
  /** Set when the spec cannot run for a data reason; the test skips on it. */
  let skipReason: string | null = null;

  /** School year the spec closes. Pre-existing unless the account had none. */
  let oldYearId: string | null = null;
  /** Non-null only when this spec had to create the active year itself. */
  let createdYearId: string | null = null;
  const seededGoalIds: string[] = [];

  test.beforeAll(async () => {
    const sb = adminClient();
    if (!sb) return;

    userId = await requireTestUserId('close-year spec seed');

    // ── Snapshot BEFORE any write ──────────────────────────────────────────
    const [yearsRes, goalsRes, kidsRes, actsRes, badgeRes, ybRes, archRes, certRes] =
      await Promise.all([
        sb.from('school_years').select('id, name, start_date, end_date, status').eq('user_id', userId),
        sb.from('curriculum_goals').select('id, archived, school_year_id').eq('user_id', userId),
        sb.from('children').select('id, grade_level, graduated_at').eq('user_id', userId),
        sb.from('activities').select('id, is_active').eq('user_id', userId),
        sb.from('badges').select('id').eq('user_id', userId).is('school_year_id', null),
        sb.from('yearbook_content').select('id').eq('user_id', userId).is('school_year_id', null),
        sb.from('school_year_archives').select('id').eq('user_id', userId),
        sb.from('year_archive_certificates').select('id').eq('user_id', userId),
      ]);

    const firstError = [yearsRes, goalsRes, kidsRes, actsRes, badgeRes, ybRes, archRes, certRes]
      .map((r) => r.error)
      .find(Boolean);
    if (firstError) throw new Error(`close-year snapshot failed: ${firstError.message}`);

    snapshot = {
      years: (yearsRes.data ?? []) as SchoolYearRow[],
      goals: (goalsRes.data ?? []) as GoalRow[],
      children: (kidsRes.data ?? []) as ChildRow[],
      activities: (actsRes.data ?? []) as ActivityRow[],
      nullYearBadgeIds: ((badgeRes.data ?? []) as { id: string }[]).map((r) => r.id),
      nullYearYearbookIds: ((ybRes.data ?? []) as { id: string }[]).map((r) => r.id),
      archiveIds: ((archRes.data ?? []) as { id: string }[]).map((r) => r.id),
      certificateIds: ((certRes.data ?? []) as { id: string }[]).map((r) => r.id),
    };

    // The account's first non-archived child. Never created here: this spec
    // borrows the account's real child rather than inventing family data.
    const { data: kids } = await sb
      .from('children')
      .select('id')
      .eq('user_id', userId)
      .eq('archived', false)
      .order('sort_order')
      .limit(1);
    childId = ((kids ?? [])[0] as { id: string } | undefined)?.id ?? null;
    if (!childId) {
      skipReason = 'Test account has no non-archived child; close-year seeds goals against a real child.';
      return;
    }

    // ── An active year to close ────────────────────────────────────────────
    const active = snapshot.years.find((y) => y.status === 'active');
    if (active) {
      oldYearId = active.id;
    } else {
      const now = new Date();
      const { data: created, error: yearErr } = await sb
        .from('school_years')
        .insert({
          user_id: userId,
          name: `${PREFIX} Seed Year ${STAMP}`,
          start_date: `${now.getFullYear()}-01-01`,
          end_date: `${now.getFullYear()}-12-31`,
          status: 'active',
        })
        .select('id')
        .single();
      if (yearErr || !created) {
        skipReason = `Could not create an active school year to close: ${yearErr?.message ?? 'unknown'}`;
        return;
      }
      oldYearId = (created as { id: string }).id;
      createdYearId = oldYearId;
    }

    // ── Seed the three goals the close must sweep ──────────────────────────
    // Names are unique per row: curriculum_goals_user_child_name_subject_active_uidx
    // is unique on (user_id, child_id, lower(name), lower(subject)) for rows that
    // are active and uncompleted, so the normal and NULL-year rows would collide
    // on a shared name.
    const baseGoal = {
      user_id: userId,
      child_id: childId,
      total_lessons: 10,
      current_lesson: 0,
      lessons_per_day: 1,
      school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      default_minutes: 30,
      archived: false,
    };

    const { data: goalRows, error: goalErr } = await sb
      .from('curriculum_goals')
      .insert([
        {
          ...baseGoal,
          curriculum_name: `${PREFIX} Normal ${STAMP}`,
          subject_label: `${PREFIX} Normal`,
          school_year_id: oldYearId,
        },
        {
          // Completed goals used to survive the close (the `.is("completed_at",
          // null)` filter), which is how last year's finished subjects carried
          // into the new year.
          ...baseGoal,
          curriculum_name: `${PREFIX} Completed ${STAMP}`,
          subject_label: `${PREFIX} Completed`,
          school_year_id: oldYearId,
          current_lesson: 10,
          completed_at: new Date().toISOString(),
        },
        {
          // Legacy shape: never stamped with a school year, so no year-scoped
          // filter ever reached it.
          ...baseGoal,
          curriculum_name: `${PREFIX} NullYear ${STAMP}`,
          subject_label: `${PREFIX} NullYear`,
          school_year_id: null,
        },
      ])
      .select('id');
    if (goalErr || !goalRows) throw new Error(`close-year goal seed failed: ${goalErr?.message}`);
    seededGoalIds.push(...(goalRows as { id: string }[]).map((r) => r.id));
  });

  test.afterAll(async () => {
    const sb = adminClient();
    if (!sb || !userId || !snapshot) return;

    const snap = snapshot;

    // ── 1. Remove everything this spec (or the close it triggered) created ──
    // Archives and certificates first: both carry ON DELETE CASCADE from
    // school_years, but the year they hang off usually SURVIVES restore, so
    // they have to be deleted by id. Only ids absent from the snapshot are
    // touched, so a keepsake the account already had is never removed.
    const { data: archNow } = await sb.from('school_year_archives').select('id').eq('user_id', userId);
    const newArchiveIds = ((archNow ?? []) as { id: string }[])
      .map((r) => r.id)
      .filter((id) => !snap.archiveIds.includes(id));
    if (newArchiveIds.length > 0) {
      await sb.from('school_year_archives').delete().in('id', newArchiveIds).eq('user_id', userId);
    }

    const { data: certNow } = await sb.from('year_archive_certificates').select('id').eq('user_id', userId);
    const newCertIds = ((certNow ?? []) as { id: string }[])
      .map((r) => r.id)
      .filter((id) => !snap.certificateIds.includes(id));
    if (newCertIds.length > 0) {
      await sb.from('year_archive_certificates').delete().in('id', newCertIds).eq('user_id', userId);
    }

    if (seededGoalIds.length > 0) {
      await sb.from('lessons').delete().in('curriculum_goal_id', seededGoalIds).eq('user_id', userId);
      await sb.from('curriculum_goals').delete().in('id', seededGoalIds).eq('user_id', userId);
    }

    // School years the close created (plus the seed year, if this spec made
    // one). These MUST go before the old year is set back to active:
    // idx_school_years_active is unique per user on status='active'.
    const knownYearIds = snap.years.map((y) => y.id);
    const { data: yearsNow } = await sb.from('school_years').select('id').eq('user_id', userId);
    const strayYearIds = ((yearsNow ?? []) as { id: string }[])
      .map((r) => r.id)
      .filter((id) => !knownYearIds.includes(id) || id === createdYearId);
    if (strayYearIds.length > 0) {
      await sb.from('curriculum_goals').update({ school_year_id: null }).in('school_year_id', strayYearIds).eq('user_id', userId);
      await sb.from('school_years').delete().in('id', strayYearIds).eq('user_id', userId);
    }

    // ── 2. Write the snapshotted values back onto surviving rows ───────────
    for (const y of snap.years) {
      if (y.id === createdYearId) continue; // already deleted
      await sb
        .from('school_years')
        .update({ name: y.name, start_date: y.start_date, end_date: y.end_date, status: y.status })
        .eq('id', y.id)
        .eq('user_id', userId);
    }

    for (const g of snap.goals) {
      await sb
        .from('curriculum_goals')
        .update({ archived: g.archived, school_year_id: g.school_year_id })
        .eq('id', g.id)
        .eq('user_id', userId);
    }

    // Grade advancement is per child and irreversible from the app's side.
    for (const c of snap.children) {
      await sb
        .from('children')
        .update({ grade_level: c.grade_level, graduated_at: c.graduated_at })
        .eq('id', c.id)
        .eq('user_id', userId);
    }

    for (const a of snap.activities) {
      await sb.from('activities').update({ is_active: a.is_active }).eq('id', a.id).eq('user_id', userId);
    }

    // Step 10 and 11 of the close stamp school_year_id onto rows that had
    // NULL. Put the NULLs back so the account reads exactly as before.
    if (snap.nullYearBadgeIds.length > 0) {
      await sb.from('badges').update({ school_year_id: null }).in('id', snap.nullYearBadgeIds).eq('user_id', userId);
    }
    if (snap.nullYearYearbookIds.length > 0) {
      await sb.from('yearbook_content').update({ school_year_id: null }).in('id', snap.nullYearYearbookIds).eq('user_id', userId);
    }
  });

  test('closing a year renames it, starts the chosen next year, and sweeps every old goal', async ({ page }) => {
    // The close route runs ~15 sequential Supabase round trips (stats, per-child
    // rollups, garden snapshot, archive, create, certificates) against a
    // possibly-cold staging function, then the year-end recap loads its own
    // summary API. 120s keeps a slow-but-correct close from reading as a failure.
    test.setTimeout(120_000);

    if (skipReason) {
      test.skip(true, skipReason);
      return;
    }
    const sb = adminClient();
    expect(sb, 'admin client should exist here — the group-level skip covers the null case').not.toBeNull();
    if (!sb || !oldYearId || !userId) return;

    const oldYear = (snapshot as Snapshot).years.find((y) => y.id === oldYearId);
    const originalActiveName =
      oldYear?.status === 'active' ? oldYear.name : `${PREFIX} Seed Year ${STAMP}`;

    // ── 2. The close page prefills from the active year ────────────────────
    await page.goto('/dashboard/close-year');

    const closingName = page.locator('#closing-year-name');
    await expect(closingName, 'close page should load with the active year').toBeVisible({ timeout: 20_000 });
    await expect(
      closingName,
      'the closing-year field prefills with the active year name so it can be renamed on the way out',
    ).toHaveValue(originalActiveName);

    const newName = page.locator('#new-year-name');
    const newStart = page.locator('#new-year-start');
    const newEnd = page.locator('#new-year-end');
    await expect(newName, 'next-year name should be prefilled with the rollover name').not.toHaveValue('');
    await expect(newStart, 'next-year start date should be prefilled').not.toHaveValue('');
    await expect(newEnd, 'next-year end date should be prefilled').not.toHaveValue('');

    // ── 3. Free-text names, no derived format required ─────────────────────
    await closingName.fill(OLD_YEAR_NAME);
    await newName.fill(NEW_YEAR_NAME);

    // ── 4. Confirmation is the word CLOSE, case-insensitive ────────────────
    const submit = page.getByRole('button', { name: /close this school year/i });
    await expect(submit, 'submit stays disabled until CLOSE is typed').toBeDisabled();

    // Lowercase on purpose: the old flow required retyping the stored year
    // name exactly, which was impossible for names holding an en dash.
    await page.locator('#close-confirm').fill('close');
    await expect(submit, 'lowercase "close" must satisfy the confirmation').toBeEnabled();

    // ── 5. Submit and land on the year-end recap ───────────────────────────
    await submit.click();
    await page.waitForURL(/\/dashboard\/year-end\/[0-9a-f-]+/i, { timeout: 90_000 });
    expect(page.url(), 'the recap should be for the year that was just archived').toContain(
      `/dashboard/year-end/${oldYearId}`,
    );
    await expect(
      page.getByRole('heading', { name: OLD_YEAR_NAME }).first(),
      'the recap heading shows the name the year was renamed to',
    ).toBeVisible({ timeout: 30_000 });

    // ── 6. DB assertions ───────────────────────────────────────────────────
    const { data: oldYearAfter } = await sb
      .from('school_years')
      .select('id, name, status')
      .eq('id', oldYearId)
      .single();
    const archived = oldYearAfter as { name: string; status: string };
    expect(archived.status, 'the closed year must be archived').toBe('archived');
    expect(archived.name, 'the closed year keeps the name entered on the close page').toBe(OLD_YEAR_NAME);

    const { data: activeAfter } = await sb
      .from('school_years')
      .select('id, name')
      .eq('user_id', userId)
      .eq('status', 'active');
    const activeYears = (activeAfter ?? []) as { id: string; name: string }[];
    expect(activeYears.length, 'exactly one active year after a close, never zero and never two').toBe(1);
    expect(activeYears[0].name, 'the new active year carries the name chosen on the close page').toBe(NEW_YEAR_NAME);

    const { data: goalsAfter } = await sb
      .from('curriculum_goals')
      .select('id, curriculum_name, archived, school_year_id')
      .in('id', seededGoalIds);
    const goals = (goalsAfter ?? []) as Array<{
      id: string;
      curriculum_name: string;
      archived: boolean;
      school_year_id: string | null;
    }>;
    expect(goals.length, 'all three seeded goals should still exist').toBe(3);
    for (const g of goals) {
      expect(
        g.archived,
        `${g.curriculum_name} must be archived by the close — completed goals and NULL-year goals included, or last year's subjects carry into the new year`,
      ).toBe(true);
    }
    const nullYearGoal = goals.find((g) => g.curriculum_name.includes('NullYear'));
    expect(
      nullYearGoal?.school_year_id,
      'the legacy NULL-school-year goal must be stamped onto the year that just closed',
    ).toBe(oldYearId);

    const { data: archiveRow } = await sb
      .from('school_year_archives')
      .select('year_name')
      .eq('school_year_id', oldYearId)
      .maybeSingle();
    expect(
      (archiveRow as { year_name: string } | null)?.year_name,
      'the keepsake archive row records the renamed year',
    ).toBe(OLD_YEAR_NAME);

    // ── 7. The next-year wizard prefills from the year the close created ───
    // Regression guard for 666f3c1: it used to derive the name from the OLD
    // year, so submitting overwrote the name the user chose at close.
    await page.goto(`/dashboard/plan/new-year?from=${oldYearId}`);
    const wizardName = page.locator('input[placeholder="e.g. 2026-2027"]');
    await expect(wizardName, 'the wizard should load with the year form').toBeVisible({ timeout: 30_000 });
    await expect(
      wizardName,
      'the wizard prefills from the ACTIVE year, not a name derived from the old one',
    ).toHaveValue(NEW_YEAR_NAME);
    await expect(
      page.getByRole('button', { name: new RegExp(`^Save ${NEW_YEAR_NAME}`) }),
      'with a year already created, the wizard saves into it rather than creating a second one',
    ).toBeVisible();
    // Deliberately NOT submitted: the prefill is the regression guard, and a
    // submit would write subjects the restore would then have to unpick.
  });
});
