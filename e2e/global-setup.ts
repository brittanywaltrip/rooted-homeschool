// REGRESSION GUARD: This global-setup must not touch app/dashboard/page.tsx
// or any save/capture function.

import { chromium, type BrowserContext, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { assertIsTestAccount, E2E_EMAIL } from './test-account';

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

/**
 * Read the signed-in user id out of the Supabase auth cookie.
 *
 * @supabase/ssr writes the session as `sb-<project-ref>-auth-token`, split into
 * `.0`, `.1`, … chunks when it exceeds the 4KB cookie limit, with the first
 * chunk prefixed `base64-`. Concatenate in index order, decode, and the session
 * JSON carries `user.id`; if a future client version drops that, fall back to
 * the `sub` claim of the access token.
 *
 * We read who ACTUALLY authenticated rather than trusting PLAYWRIGHT_EMAIL,
 * because the whole point of the guard is that env may be wrong. Returns null
 * on any parse failure, which the caller treats as a hard stop.
 */
async function resolveSignedInUserId(context: BrowserContext): Promise<string | null> {
  try {
    const cookies = await context.cookies();
    const chunks = cookies
      .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
      .sort((a, b) => {
        const idx = (n: string) => Number(n.split('.').pop()) || 0;
        return idx(a.name) - idx(b.name);
      });
    if (chunks.length === 0) return null;

    const raw = chunks.map((c) => c.value).join('');
    const payload = raw.startsWith('base64-') ? raw.slice('base64-'.length) : raw;
    const session = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));

    if (typeof session?.user?.id === 'string') return session.user.id;

    const jwt: string | undefined = session?.access_token;
    if (typeof jwt === 'string') {
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
      if (typeof claims?.sub === 'string') return claims.sub;
    }
    return null;
  } catch {
    return null;
  }
}

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

    // ── ACCOUNT GUARD ──────────────────────────────────────────────────────
    // Runs BEFORE storageState is written, so a session for the wrong account
    // never reaches disk for a later run to pick up. Any stale state file is
    // deleted on failure for the same reason. See e2e/test-account.ts.
    const signedInUserId = await resolveSignedInUserId(context);
    try {
      assertIsTestAccount(signedInUserId, 'global-setup');
    } catch (err) {
      if (fs.existsSync(STORAGE_PATH)) fs.rmSync(STORAGE_PATH);
      throw err;
    }

    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
    await context.storageState({ path: STORAGE_PATH });

    console.log(
      `[global-setup] ✓ logged in as ${TEST_EMAIL} (${signedInUserId}) via /login form, storageState saved to ${STORAGE_PATH}`,
    );
    console.log(`[global-setup] ✓ account guard passed — this is the e2e test account (${E2E_EMAIL})`);
  } finally {
    await browser.close();
  }
}
