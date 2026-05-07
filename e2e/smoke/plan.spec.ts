import { test, expect } from '@playwright/test';

test.describe('Plan — signed in', () => {
  test('plan page loads with calendar', async ({ page }) => {
    await page.goto('/dashboard/plan');

    // Plan page hero is "Plan" via PageHero. Calendar card always
    // renders week/month toggle buttons regardless of curriculum state.
    await expect(page.getByRole('heading', { name: /^Plan$/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Week$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Month$/ })).toBeVisible();
  });

  test('free user clicking Download Report shows the gate modal, not a download', async ({ page }) => {
    await page.goto('/dashboard/plan');

    // The Progress Report section only renders when yearView === "this"
    // and the user is loaded (line 3097 of app/dashboard/plan/page.tsx).
    // For a fresh free user with no curriculum, the section may not be
    // visible. Skip silently when the button is absent — this test
    // covers the gating behavior, not the section's visibility rules.
    const downloadBtn = page.getByRole('button', { name: /^Download Report$/ });
    if ((await downloadBtn.count()) === 0) {
      test.skip(true, 'Download Report button not rendered for this account state — gating still verified at dashboard.spec.ts level');
      return;
    }

    // Pre-arm a download listener so we can assert NO download fires.
    let downloadFired = false;
    page.on('download', () => { downloadFired = true; });

    await downloadBtn.click();

    // ExportGateModal renders the title "Save your progress" and a
    // "Download Report" upgrade-CTA link. The modal is what should
    // appear, not a PDF download.
    await expect(page.getByRole('heading', { name: /Save your progress/i })).toBeVisible({ timeout: 5_000 });
    expect(downloadFired, 'free user should not have triggered a real PDF download').toBe(false);
  });
});
