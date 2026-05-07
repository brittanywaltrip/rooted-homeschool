// REGRESSION GUARD: This global-setup must not touch app/dashboard/page.tsx
// or any save/capture function.

import { chromium, type FullConfig } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// Required env (set locally via .env.local for `npm run test:e2e`,
// via GitHub Actions secrets for CI):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   PLAYWRIGHT_EMAIL
//   PLAYWRIGHT_PASSWORD
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[global-setup] missing required env var: ${name}`);
  return v;
}

const STORAGE_PATH = path.resolve(__dirname, '.auth/user.json');

// @supabase/ssr v0.9 cookie format constants. The browser client reads the
// session via document.cookie; the server client reads it from the request
// cookies. Both expect:
//   - name:  sb-<projectRef>-auth-token (or chunked: name.0, name.1, …)
//   - value: "base64-" + base64URL(JSON.stringify(session))
// Anything else and getSession() returns null and the dashboard auth
// gate redirects to /login.
const BASE64_PREFIX = 'base64-';
const MAX_CHUNK_SIZE = 3180;
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function stringToBase64URL(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Mirrors @supabase/ssr/utils/chunker.createChunks. The library URL-encodes
// the value, slices at MAX_CHUNK_SIZE chars, and stores the decoded chunk
// in each cookie. combineChunks reassembles by concatenating in order.
function createCookieChunks(key: string, value: string): { name: string; value: string }[] {
  let encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= MAX_CHUNK_SIZE) {
    return [{ name: key, value }];
  }
  const chunks: string[] = [];
  while (encodedValue.length > 0) {
    let encodedChunkHead = encodedValue.slice(0, MAX_CHUNK_SIZE);
    const lastEscapePos = encodedChunkHead.lastIndexOf('%');
    if (lastEscapePos > MAX_CHUNK_SIZE - 3) {
      encodedChunkHead = encodedChunkHead.slice(0, lastEscapePos);
    }
    let valueHead = '';
    while (encodedChunkHead.length > 0) {
      try {
        valueHead = decodeURIComponent(encodedChunkHead);
        break;
      } catch (error) {
        if (
          error instanceof URIError &&
          encodedChunkHead.at(-3) === '%' &&
          encodedChunkHead.length > 3
        ) {
          encodedChunkHead = encodedChunkHead.slice(0, encodedChunkHead.length - 3);
        } else {
          throw error;
        }
      }
    }
    chunks.push(valueHead);
    encodedValue = encodedValue.slice(encodedChunkHead.length);
  }
  return chunks.map((value, i) => ({ name: `${key}.${i}`, value }));
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL;
  if (!baseURL) throw new Error('[global-setup] baseURL not configured');
  const cookieDomain = new URL(baseURL).hostname;

  const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const SUPABASE_ANON_KEY = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const TEST_EMAIL = requireEnv('PLAYWRIGHT_EMAIL');
  const TEST_PASSWORD = requireEnv('PLAYWRIGHT_PASSWORD');

  // ── Open a real browser at the staging origin so the password-grant
  // fetch runs from the correct context. The token endpoint itself is
  // CORS-permissive so this isn't strictly required, but the user's
  // diagnosis was that doing this from the browser side avoids any
  // origin-derived storage-key drift.
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  const signInResult = await page.evaluate(
    async ({ supabaseUrl, supabaseAnonKey, email, password }) => {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        return { error: `${res.status}: ${await res.text()}`, session: null };
      }
      const data = await res.json();
      return { error: null, session: data };
    },
    {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  );

  if (signInResult.error || !signInResult.session?.access_token || !signInResult.session?.user?.id) {
    throw new Error(`[global-setup] sign-in failed: ${signInResult.error}`);
  }

  // ── Plan-type guard, using the user id we just got from sign-in.
  // Done after sign-in so we don't have to paginate auth.admin.listUsers
  // (the Supabase project has hundreds of accounts).
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('plan_type, is_pro')
    .eq('id', signInResult.session.user.id)
    .single();
  if (profErr) throw new Error(`[global-setup] profile lookup failed: ${profErr.message}`);
  if (profile?.plan_type || profile?.is_pro) {
    await browser.close();
    throw new Error(
      `[global-setup] test user must be on free plan (plan_type=null, is_pro=false), got plan_type=${profile?.plan_type ?? 'null'}, is_pro=${profile?.is_pro ?? 'null'}. Yearbook spread-cap test would not pass.`,
    );
  }

  // ── Write the session as cookies in @supabase/ssr's exact format.
  // Cookie name follows the storage-key convention: sb-<projectRef>-auth-token.
  // The value is the JSON-stringified session, base64URL-encoded, prefixed
  // with "base64-". Chunked across cookies if URL-encoded length exceeds 3180.
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const cookieKey = `sb-${projectRef}-auth-token`;
  const sessionJson = JSON.stringify(signInResult.session);
  const encodedValue = BASE64_PREFIX + stringToBase64URL(sessionJson);
  const chunks = createCookieChunks(cookieKey, encodedValue);
  const expires = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;

  await context.addCookies(
    chunks.map((c) => ({
      name: c.name,
      value: c.value,
      domain: cookieDomain,
      path: '/',
      httpOnly: false, // browser client reads via document.cookie
      secure: true,
      sameSite: 'Lax' as const,
      expires,
    })),
  );

  // ── Navigate to /dashboard and confirm we land there. If the staging
  // server's NEXT_PUBLIC_SUPABASE_URL differs from the value we used to
  // derive the cookie key, the auth gate will redirect to /login — this
  // check surfaces that mismatch immediately with a clear message.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  const finalUrl = page.url();
  if (finalUrl.includes('/login')) {
    throw new Error(
      `[global-setup] auth failed — navigating to /dashboard redirected to: ${finalUrl}. ` +
        `Wrote ${chunks.length} cookie(s): ${chunks.map((c) => c.name).join(', ')}. ` +
        `Likely cause: staging server's NEXT_PUBLIC_SUPABASE_URL doesn't match what we used to derive the cookie key (${cookieKey}). ` +
        `Verify the GitHub Actions secret matches the value the staging deployment is running with.`,
    );
  }

  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  await context.storageState({ path: STORAGE_PATH });
  await browser.close();

  console.log(
    `[global-setup] ✓ authenticated as ${TEST_EMAIL}, wrote ${chunks.length} cookie(s) (${chunks.map((c) => c.name).join(', ')}), storageState saved to ${STORAGE_PATH}`,
  );
}
