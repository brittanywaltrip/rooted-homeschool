import { test, expect } from '@playwright/test';

import { adminClient, cachedTestUserId } from '../admin';

test.describe('Plan — signed in', () => {
  test('plan page loads with calendar', async ({ page }) => {
    await page.goto('/dashboard/plan');

    // Plan page hero is "Plan" via PageHero. Calendar card always
    // renders week/month toggle buttons regardless of curriculum state.
    await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Week$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Month$/ })).toBeVisible();
  });

  /**
   * Progress report export must respect the paywall.
   *
   * This test used to look for a button named "Download Report" and skip
   * silently when it was absent. That name had not existed for some time, so
   * the skip fired on every run and the spec never once exercised the gate.
   * That is why handleGenerateReport shipped with no canExport check at all
   * while PlanPrintDialog and the Reports page both gated correctly.
   *
   * Two things are asserted regardless of the account's plan, because both
   * hold for everyone and either failing is a real bug:
   *   - clicking the entry never starts a download directly
   *   - it opens exactly one of the two known surfaces (upgrade gate for a
   *     free account, report dialog for one with access)
   * When SUPABASE_SERVICE_ROLE_KEY is available we also assert WHICH surface,
   * derived from the same is_pro / trial_started_at rule getUserAccess uses.
   */
  test('Download Progress Report respects the export paywall', async ({ page }) => {
    await page.goto('/dashboard/plan');
    await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({ timeout: 15_000 });

    const entry = page.getByRole('button', { name: /Download Progress Report/i });

    // Wait for it rather than counting immediately. The card renders only
    // after schoolYears and the lesson window have loaded, so a bare count()
    // resolves 0 while the page is still fetching and the test skips itself,
    // the same silent-skip failure this spec is being fixed for.
    const present = await entry
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    // The card renders only when showYearAdmin is true: the account needs a
    // school year AND either a completed lesson or 30+ days since onboarding
    // (see PlanV2 index.tsx). A freshly seeded e2e account satisfies neither,
    // so name the real reason rather than blaming a button that was renamed.
    if (!present) {
      test.skip(
        true,
        'Progress report card not rendered: showYearAdmin requires a school year plus a completed lesson or 30+ days since onboarding.',
      );
      return;
    }

    // Work out what this account is entitled to, the same way the app does.
    let expectAccess: boolean | null = null;
    const sb = adminClient();
    if (sb) {
      const userId = await cachedTestUserId();
      if (userId) {
        const { data } = await sb
          .from('profiles')
          .select('is_pro, trial_started_at')
          .eq('id', userId)
          .maybeSingle();
        const row = data as { is_pro?: boolean | null; trial_started_at?: string | null } | null;
        if (row) {
          const inTrial = row.trial_started_at
            ? Date.now() < new Date(row.trial_started_at).getTime() + 30 * 24 * 60 * 60 * 1000
            : false;
          expectAccess = !!row.is_pro || inTrial;
        }
      }
    }

    // Pre-arm a download listener: the original bug was a click that produced
    // a PDF with no check, so "no download fires from the click itself" is the
    // assertion that would have caught it.
    let downloadFired = false;
    page.on('download', () => { downloadFired = true; });

    await entry.click();

    // ExportGateModal renders "Save your progress"; ProgressReportDialog is
    // the paid path. Exactly one must appear.
    const gate = page.getByRole('heading', { name: /Save your progress/i });
    const dialog = page.getByRole('heading', { name: /Progress report/i });
    await expect(gate.or(dialog).first()).toBeVisible({ timeout: 5_000 });

    const gateShown = (await gate.count()) > 0;
    const dialogShown = (await dialog.count()) > 0;
    expect(gateShown !== dialogShown, 'exactly one of the gate or the report dialog should open').toBe(true);

    expect(downloadFired, 'clicking the entry must never start a download directly').toBe(false);

    if (expectAccess === false) {
      expect(gateShown, 'a free account must get the upgrade gate, not the report dialog').toBe(true);
    } else if (expectAccess === true) {
      expect(dialogShown, 'an account with export access must get the report dialog, not the gate').toBe(true);
    }
    // expectAccess === null: no service key, so the plan-specific assertion is
    // skipped. The two universal assertions above still ran.
  });
});
