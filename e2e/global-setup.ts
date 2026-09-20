// REGRESSION GUARD: This global-setup must not touch app/dashboard/page.tsx
// or any save/capture function.

import { chromium, type BrowserContext, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { adminClient } from './admin';
import { seedE2ECurriculum } from './seed-curriculum';
import { assertIsTestAccount, E2E_EMAIL } from './test-account';
import { evaluateHealthGate } from './health-gate';
import { assertSafeForTestWrites, supabaseKeyIdentity } from '../lib/env-identity';

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
/**
 * The signed-in EMAIL, from the same session cookie as the id above.
 *
 * Read from the session rather than from PLAYWRIGHT_EMAIL for the same reason
 * the id is: env may be wrong, and the guard exists to catch exactly that. An
 * id that matches while the email does not means the two came from different
 * places, which the account guard refuses rather than resolve by preference.
 *
 * Returns null on any parse failure; a null email simply skips the email cross
 * check, because the id check above is already fail-closed on its own.
 */
async function resolveSignedInEmail(context: BrowserContext): Promise<string | null> {
  try {
    const session = await readSessionCookie(context);
    if (typeof session?.user?.email === 'string') return session.user.email;
    const jwt: string | undefined = session?.access_token;
    if (typeof jwt === 'string') {
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
      if (typeof claims?.email === 'string') return claims.email;
    }
    return null;
  } catch {
    return null;
  }
}

/** The decoded @supabase/ssr session cookie, or null. Shared by both resolvers
 *  so they can never disagree about which session they are reading. */
async function readSessionCookie(context: BrowserContext): Promise<any | null> {
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
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

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
  // ── PROJECT GUARD ────────────────────────────────────────────────────────
  // FIRST. Before the browser, before storageState, before authentication,
  // before any service-role client exists.
  //
  // The account guard further down checks WHO is signed in. It never checked
  // WHICH database, and until 2026-09-19 the staging Vercel environment pointed
  // at the PRODUCTION Supabase project, so every staging push ran this suite
  // against real customer data. The account guard kept the blast radius to the
  // e2e account; it was never isolation.
  //
  // Fails closed: a missing ROOTED_ENV or ROOTED_EXPECTED_SUPABASE_REF is a
  // refusal, because an absent expectation is exactly what a misconfigured
  // runner looks like.
  const envIdentity = assertSafeForTestWrites(
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
      rootedEnv: process.env.ROOTED_ENV,
      expectedRef: process.env.ROOTED_EXPECTED_SUPABASE_REF,
    },
    'e2e/global-setup',
  );
  console.log(
    `[global-setup] ✓ project guard passed — ROOTED_ENV=${envIdentity.env}, project ${envIdentity.projectRef} (not production, not recovery)`,
  );

  // The runner's OWN credentials must name this project AND carry the right
  // role. The build-time gate checks this on Vercel, but nothing checked the
  // machine running the suite, and the two are configured separately.
  //
  // Caught a real one on 2026-09-20: the anon key had been pasted into
  // SUPABASE_SERVICE_ROLE_KEY. Right project, wrong role. Every admin call
  // failed with a bare "Invalid API key", which names neither the key nor the
  // reason. A key in the wrong slot is a privilege error, not a typo.
  const serviceKeyId = supabaseKeyIdentity(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (serviceKeyId) {
    if (serviceKeyId.ref !== envIdentity.projectRef) {
      throw new Error(
        `[global-setup] SUPABASE_SERVICE_ROLE_KEY belongs to project ${serviceKeyId.ref}, ` +
          `not ${envIdentity.projectRef}. Refusing to run.`,
      );
    }
    if (serviceKeyId.role !== 'service_role') {
      throw new Error(
        `[global-setup] SUPABASE_SERVICE_ROLE_KEY carries role "${serviceKeyId.role}", ` +
          'expected "service_role". An anon key in the service-role slot cannot perform ' +
          'admin operations and fails later as a bare "Invalid API key". Refusing to run.',
      );
    }
    console.log(`[global-setup] ✓ service-role key names ${serviceKeyId.ref} with role service_role`);
  }

  // Prefer TEST_BASE_URL when set, fall back to the Playwright config's
  // baseURL, then localhost. This matches the spec's contract while still
  // letting CI override via PLAYWRIGHT_BASE_URL through the config layer.
  const baseURL =
    process.env.TEST_BASE_URL ||
    config.projects[0].use.baseURL ||
    'http://localhost:3000';

  // ── Gate 2: is THIS BUILD the commit under test, and is it staging? ──────
  //
  // The identity guard above proves what the RUNNER expects. It says nothing
  // about which build is serving. Vercel keeps serving the previous deployment
  // until the new one is READY, so a healthy response can come from code that
  // predates the change being gated.
  //
  // Server-to-server fetch, NOT a browser request: the bypass secret goes from
  // Node to the approved origin only. `redirect: 'error'` means it can never be
  // replayed to a third-party origin by a redirect.
  // EXPECTED_COMMIT pins the build for a manual run; GITHUB_SHA does it in CI.
  // Previously the whole gate was gated on GITHUB_SHA, so every manual run
  // skipped it silently. Now the identity checks ALWAYS run against a remote
  // deployment and only the commit comparison is optional.
  const expectedCommit = process.env.EXPECTED_COMMIT ?? process.env.GITHUB_SHA ?? null;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const isRemote = !/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(baseURL);

  if (isRemote) {
    const healthUrl = new URL('/api/health', baseURL);
    // Server-to-server fetch, NOT a browser request: the bypass secret goes
    // from Node to the approved origin only. `redirect: 'error'` means it can
    // never be replayed to a third-party origin by a redirect.
    let status: number;
    let bodyText: string;
    let location: string | null = null;
    try {
      // redirect: 'manual' -- NOT 'follow' and not 'error'. The bypass secret
      // must never be replayed to a third-party origin by a redirect, so we do
      // not follow. But 'error' throws on the protection redirect and loses the
      // status, which is how a correctly protected deployment came back as
      // "could not reach". 'manual' surfaces the 302 and its Location without
      // ever sending the header onward.
      const res = await fetch(healthUrl, {
        headers: bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {},
        redirect: 'manual',
      });
      status = res.status;
      location = res.headers.get('location');
      bodyText = await res.text();
    } catch (err) {
      throw new Error(
        `[global-setup] could not reach ${healthUrl.host}/api/health ` +
          `(${err instanceof Error ? err.message : String(err)}). Refusing to run.`,
      );
    }

    const gate = evaluateHealthGate({
      status,
      location,
      bodyText,
      expectedRef: envIdentity.projectRef,
      expectedCommit,
      bypassConfigured: Boolean(bypassSecret),
      host: healthUrl.host,
    });

    if (!gate.ok) {
      throw new Error(`[global-setup] ${gate.message} (${gate.code}) Refusing to run.`);
    }
    if (gate.commitPinned) {
      console.log(`[global-setup] ✓ build guard passed — ${gate.projectRef} @ ${gate.commit}`);
    } else {
      console.warn(
        `[global-setup] ⚠ identity verified (${gate.projectRef}) but the COMMIT IS NOT PINNED. ` +
          `Serving ${gate.commit ?? 'unknown'}. Set EXPECTED_COMMIT to prove the deployment ` +
          'under test is the commit you think it is.',
      );
    }
  }

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

  // Preview deployments are protection-enabled. The bypass is installed as an
  // ORIGIN-SCOPED COOKIE, never as a header.
  //
  // Playwright's `extraHTTPHeaders` apply to EVERY request a context makes,
  // including cross-origin calls to Supabase, PostHog and Sentry. That would
  // hand the bypass secret to third parties on every page load. A cookie is
  // scoped to one host by the browser and cannot be forwarded off it.
  if (bypassSecret) {
    const approvedHost = new URL(baseURL).host;
    const res = await context.request.get(
      `${new URL(baseURL).origin}/api/health` +
        `?x-vercel-protection-bypass=${encodeURIComponent(bypassSecret)}` +
        `&x-vercel-set-bypass-cookie=true`,
      { maxRedirects: 0 },
    );
    // A 307 is the SUCCESS path, not a rejection. Vercel answers the
    // set-bypass-cookie request with `307 -> same host, same path` and a
    // Set-Cookie: _vercel_jwt. Verified against the live deployment:
    //   status 307, location host = this host, path /api/health,
    //   set-cookie names: _vercel_jwt
    // Treating anything non-2xx as a rejection failed the run with
    // "protection bypass rejected (307)" while the bypass was working.
    //
    // A genuinely rejected secret redirects to /sso-api instead, so that is
    // what to refuse on. Everything else is settled by the _vercel_jwt
    // assertion below, which is the authoritative check.
    const installStatus = res.status();
    const installLocation = res.headers()['location'] ?? '';
    if (installStatus >= 400 || /\/sso-api\b/.test(installLocation)) {
      throw new Error(
        `[global-setup] protection bypass rejected by ${approvedHost} (${installStatus}` +
          `${/\/sso-api\b/.test(installLocation) ? ', redirected to Vercel SSO' : ''}).`,
      );
    }
    // Prove it actually landed in THIS browser context and is scoped to the
    // approved host. An assertion, because a silently missing cookie would
    // surface later as an unexplained Vercel login page mid-suite.
    const cookies = await context.cookies();
    const jwt = cookies.find((c) => c.name === '_vercel_jwt');
    if (!jwt) throw new Error('[global-setup] bypass cookie was not installed in the browser context.');
    const scopedHost = jwt.domain.replace(/^\./, '');
    if (!approvedHost.endsWith(scopedHost)) {
      throw new Error(`[global-setup] bypass cookie is scoped to ${jwt.domain}, not ${approvedHost}.`);
    }
    const offHost = cookies.filter((c) => c.name === '_vercel_jwt' && !approvedHost.endsWith(c.domain.replace(/^\./, '')));
    if (offHost.length > 0) throw new Error('[global-setup] a bypass cookie exists for an unapproved host.');
    console.log(`[global-setup] ✓ bypass cookie installed, scoped to ${jwt.domain} only`);
  }

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
    const signedInEmail = await resolveSignedInEmail(context);
    try {
      assertIsTestAccount(signedInUserId, 'global-setup', {
        projectRef: envIdentity.projectRef,
        email: signedInEmail,
      });
    } catch (err) {
      if (fs.existsSync(STORAGE_PATH)) fs.rmSync(STORAGE_PATH);
      throw err;
    }

    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
    await context.storageState({ path: STORAGE_PATH });

    console.log(
      `[global-setup] ✓ logged in as ${TEST_EMAIL} (${signedInUserId}) via /login form, storageState saved to ${STORAGE_PATH}`,
    );
    // Name the account for THIS project, not the production constant: the
    // guard validated against the project's own entry, and logging E2E_EMAIL
    // here printed "rooted.e2e@rootedhomeschoolapp.com" during a staging run,
    // which reads as though the suite had authenticated against production.
    console.log(
      `[global-setup] ✓ account guard passed — e2e test account for ${envIdentity.projectRef} ` +
        `(${signedInEmail ?? signedInUserId})`,
    );

    // ── Seed the curriculum the completion flows need ──────────────────────
    // AFTER the guard, never before: this writes and deletes, and it must only
    // ever reach the account the guard has just vouched for.
    //
    // Re-run every time because FLOW 2 completes the lesson it depends on, so
    // yesterday's seed is spent by the time the next run starts. Without this
    // the suite skips nine tests, including every path that completes a
    // lesson, and reports a green summary while doing it.
    const sb = adminClient();
    if (!sb) {
      console.warn(
        '[global-setup] SUPABASE_SERVICE_ROLE_KEY not set — skipping curriculum seed. Lesson-completion flows will skip.',
      );
    } else {
      try {
        const seeded = await seedE2ECurriculum(sb, signedInUserId as string);
        if (seeded) {
          console.log(
            `[global-setup] ✓ seeded curriculum ${seeded.goalId}: lesson due today (${seeded.todayDate}), pinned past lesson (${seeded.pastDate})`,
          );
        }
      } catch (err) {
        // Non-fatal. A seed failure must not take the whole suite down — the
        // specs that need it skip with their own message, which is strictly
        // more informative than a global-setup crash before anything runs.
        console.warn(
          `[global-setup] curriculum seed failed, lesson flows may skip: ${(err as Error).message}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
}
