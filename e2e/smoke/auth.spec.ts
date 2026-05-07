import { test, expect } from '@playwright/test';

// These tests observe the unauthenticated experience. The default project
// applies storageState — we override it here with an empty state so the
// browser arrives at /login as a fresh visitor.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth — unauthenticated', () => {
  test('login page shows Continue with Google button', async ({ page }) => {
    await page.goto('/login');
    // Match the visible button text. Case-insensitive in case copy drifts
    // between "Continue with Google" and "Sign in with Google".
    const button = page.getByRole('button', { name: /continue with google|sign in with google/i });
    await expect(button).toBeVisible();
  });

  test('/dashboard redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    // The dashboard layout calls supabase.auth.getSession(); without a
    // session it routes to /login. Allow either an immediate redirect or
    // a brief intermediate render before the client-side replace.
    await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 10_000 });
  });
});
