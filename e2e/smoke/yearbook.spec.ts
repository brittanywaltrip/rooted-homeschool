import { test, expect } from '@playwright/test';

test.describe('Yearbook reader — free user spread cap', () => {
  test('free user navigation stops at spread 4 with upgrade prompt', async ({ page }) => {
    await page.goto('/dashboard/memories/yearbook/read');

    // The reader has both mobile and desktop views; chromium default
    // viewport (1280x720) renders the desktop view (md:flex visible,
    // mobile md:hidden hidden). We assert against the desktop progress
    // indicator and arrow buttons.

    // Wait for the cover spread to render. The reader picks the back-
    // button bar before the AnimatePresence settles, so use the
    // ← Memories link as the "page is ready" signal. Both views render it.
    await expect(page.getByRole('link', { name: /← Memories/i }).first()).toBeVisible({ timeout: 20_000 });

    // Empty-yearbook short-circuit: the reader returns an early state
    // with text "Your yearbook is empty" when memories.length === 0.
    // For a fresh test user that's likely. In that case there are no
    // spreads to test. Skip with a clear message — running this test
    // requires the test user to have at least one memory included in
    // the yearbook.
    if ((await page.getByText(/Your yearbook is empty/i).count()) > 0) {
      test.skip(true, 'Test user has no yearbook memories — seed at least one memory with include_in_book=true to exercise the spread cap.');
      return;
    }

    // Desktop view: progress text reads "{spreadIndex + 1} / {displaySpreads.length}".
    // For a free user displaySpreads.length is 4. Click the right-arrow
    // button up to 6 times to test that we cannot go past spread 4.
    const nextBtn = page.locator('button', { hasText: '→' }).first();
    let lastProgress = '';
    for (let i = 0; i < 6; i++) {
      const progress = (await page.getByText(/^\d+ \/ \d+$/).first().textContent()) ?? '';
      lastProgress = progress;
      const disabled = await nextBtn.isDisabled();
      if (disabled) break;
      await nextBtn.click();
      await page.waitForTimeout(350); // page-turn animation
    }

    // Final state: progress should be "4 / 4" (free cap), not the
    // full spread count. The display denominator IS the cap, by design.
    expect(lastProgress, `expected spread progress to cap at 4, got "${lastProgress}"`).toMatch(/\b4 \/ 4\b/);

    // Upgrade prompt is rendered when spreadIndex >= FREE_SPREAD_LIMIT - 1
    // (i.e. on the wall). The "Upgrade to see the full yearbook" link
    // points at /dashboard/settings?tab=account.
    const upgradeLink = page.getByRole('link', { name: /Upgrade to see the full yearbook/i });
    await expect(upgradeLink).toBeVisible();
    await expect(upgradeLink).toHaveAttribute('href', /\/dashboard\/settings\?tab=account/);
  });
});
