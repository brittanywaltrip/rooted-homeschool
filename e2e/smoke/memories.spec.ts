import { test, expect } from '@playwright/test';

test.describe('Memories — signed in', () => {
  test('memories grid loads and FAB is visible', async ({ page }) => {
    await page.goto('/dashboard/memories');

    // Memories page renders a hero "Memories" heading via PageHero.
    // For a fresh test user with no memories, the empty state shows
    // "Your family story starts here". Either path is a non-blank page.
    await expect(
      page.getByRole('heading', { name: /Memories|Your family story starts here/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The floating camera FAB is rendered by app/dashboard/layout.tsx
    // (line ~530) with aria-label="Quick photo" and data-fab-trigger.
    // Free users at the limit get a hidden FAB on Today only — Memories
    // page should always show it.
    await expect(page.locator('[data-fab-trigger]')).toBeVisible();
  });
});
