// REGRESSION GUARD: This global-setup must not touch app/dashboard/page.tsx
// or any save/capture function.

import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Required env (set locally via .env.local for `npm run test:e2e`,
// via GitHub Actions secrets for CI):
//   PLAYWRIGHT_EMAIL
//   PLAYWRIGHT_PASSWORD
// Optional:
//   TEST_BASE_URL (defaults to http://localhost:3000; falls back to playwright.config baseURL)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[global-setup] missing required env var: ${name}`);
  return v;
}

const STORAGE_PATH = path.resolve(__dirname, '.auth/user.json');

export default async function globalSetup(config: FullConfig) {
  // Prefer TEST_BASE_URL when set, fall back to the Playwright config's
  // baseURL, then localhost. This matches the spec's contract while still
  // letting CI override via PLAYWRIGHT_BASE_URL through the config layer.
  const baseURL =
    process.env.TEST_BASE_URL ||
    config.projects[0].use.baseURL ||
    'http://localhost:3000';

  const TEST_EMAIL = requireEnv('PLAYWRIGHT_EMAIL');
  const TEST_PASSWORD = requireEnv('PLAYWRIGHT_PASSWORD');

  // Drive a real browser through the app's own /login form. The app's
  // Supabase client sets the auth cookies itself — correct cookie name
  // (derived from the staging deployment's NEXT_PUBLIC_SUPABASE_URL,
  // not whatever value our env happens to hold), correct domain, correct
  // format. Eliminates the storage-key drift that broke the previous
  // approach.
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    // Selectors per spec — by input type, not by placeholder/label.
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Wait to leave the login page. The app routes signed-in users to
    // /dashboard (or /onboarding for users with onboarded !== true).
    // 20s tolerates a cold Vercel start on the staging preview.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 20_000,
    });

    const finalUrl = page.url();
    if (finalUrl.includes('/login')) {
      throw new Error(
        '[global-setup] login form submit failed — still on login page. Check PLAYWRIGHT_EMAIL/PLAYWRIGHT_PASSWORD secrets.',
      );
    }
    if (finalUrl.includes('/onboarding')) {
      throw new Error(
        `[global-setup] login succeeded but landed at /onboarding — the test user needs profile.onboarded=true. URL: ${finalUrl}`,
      );
    }
    if (!finalUrl.includes('/dashboard')) {
      throw new Error(
        `[global-setup] unexpected post-login URL: ${finalUrl}. Expected to land on /dashboard.`,
      );
    }

    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
    await context.storageState({ path: STORAGE_PATH });

    console.log(
      `[global-setup] ✓ logged in as ${TEST_EMAIL} via /login form, storageState saved to ${STORAGE_PATH}`,
    );
  } finally {
    await browser.close();
  }
}
