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

  test('loading count gives way to a populated library', async ({ page }) => {
    let releaseRead!: () => void;
    const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    let sawRead!: () => void;
    const readStarted = new Promise<void>((resolve) => { sawRead = resolve; });

    await page.route('**/rest/v1/memories?*', async (route) => {
      if (route.request().method() !== 'GET' || new URL(route.request().url()).searchParams.get('select') !== '*') {
        return route.continue();
      }
      sawRead();
      await heldRead;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: '00000000-0000-4000-8000-000000000103',
          user_id: '00000000-0000-4000-8000-000000000000',
          child_id: null,
          date: new Date().toISOString().slice(0, 10),
          type: 'win',
          title: 'Memories count check',
          caption: null,
          photo_url: null,
          include_in_book: true,
          favorite: false,
          family_visible: false,
          page_order: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }]),
      });
    });

    try {
      await page.goto('/dashboard/memories');
      await readStarted;
      await expect(page.getByText('Loading memories…').first()).toBeVisible();
      await expect(page.getByText('0 total')).toHaveCount(0);
    } finally {
      releaseRead();
    }

    await expect(page.getByText('1 total')).toBeVisible();
    await expect(page.getByText(/^1 (?:recent )?memory marked for Yearbook$/)).toBeVisible();
    await expect(page.locator('[data-memory-id="00000000-0000-4000-8000-000000000103"]')).toBeVisible();
  });

  test('empty library shows zero only after a successful read', async ({ page }) => {
    await page.route('**/rest/v1/memories?*', (route) => {
      if (route.request().method() !== 'GET' || new URL(route.request().url()).searchParams.get('select') !== '*') {
        return route.continue();
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/rest/v1/app_events?*', (route) => {
      if (route.request().method() !== 'GET' || !new URL(route.request().url()).searchParams.get('type')?.includes('memory_')) {
        return route.continue();
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/dashboard/memories');
    await expect(page.getByText('0 total')).toBeVisible();
    await expect(page.getByText('Your family story starts here')).toBeVisible();
  });

  test('failed memory read shows unavailable instead of zero', async ({ page }) => {
    await page.route('**/rest/v1/memories?*', (route) => {
      if (route.request().method() !== 'GET' || new URL(route.request().url()).searchParams.get('select') !== '*') {
        return route.continue();
      }
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"simulated read failure"}' });
    });

    await page.goto('/dashboard/memories');
    await expect(page.getByText('Something went wrong loading your memories')).toBeVisible();
    await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('Memories unavailable')).toBeVisible();
    await expect(page.getByText('0 total')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
