import { test, expect } from '@playwright/test';

// Smoke-level only: confirm the yearbook route loads for an authenticated
// user and isn't bouncing back to /login. The free-tier 4-spread cap and
// upgrade-prompt assertions need a test user with seeded yearbook content
// and belong in a feature suite — not here. The current test account has
// zero memories, so the reader short-circuits to its empty state and the
// reader chrome (← Memories link, progress indicator, arrows) never renders.
test.describe('Yearbook', () => {
  test('yearbook page loads for authenticated user', async ({ page }) => {
    // /dashboard/memories/yearbook redirects to /read, so the URL settles
    // at /dashboard/memories/yearbook/read. The regex below matches both.
    await page.goto('/dashboard/memories/yearbook');

    // Confirm we weren't redirected to /login. If auth is broken upstream
    // this is where it surfaces.
    await expect(page).toHaveURL(/yearbook/);

    // The dashboard layout always renders <main> even when the yearbook
    // reader overlays it with a fixed-position empty-state or reader
    // panel. Main visibility is the cleanest "page rendered" gate that
    // works for both content states.
    await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
  });
});
