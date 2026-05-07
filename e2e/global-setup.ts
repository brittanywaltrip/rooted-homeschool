import { chromium, type FullConfig } from '@playwright/test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// Required env (set locally via .env.local for `npm run test:e2e`,
// via GitHub Actions secrets for CI):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   TEST_USER_EMAIL
//   TEST_USER_PASSWORD
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[global-setup] missing required env var: ${name}`);
  return v;
}

const STORAGE_PATH = path.resolve(__dirname, '.auth/user.json');

type CapturedCookie = { name: string; value: string; options: CookieOptions };

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL;
  if (!baseURL) throw new Error('[global-setup] baseURL not configured');
  const cookieDomain = new URL(baseURL).hostname;

  const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const SUPABASE_ANON_KEY = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const TEST_EMAIL = requireEnv('TEST_USER_EMAIL');
  const TEST_PASSWORD = requireEnv('TEST_USER_PASSWORD');

  // ── Sign in via @supabase/ssr with a captured-cookie adapter.
  // Supabase calls setAll with the auth cookies it wants the browser
  // to hold. We collect them here and forward to the Playwright
  // BrowserContext below — same shape, no hand-rolling.
  const captured: CapturedCookie[] = [];
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (toSet) => {
        for (const c of toSet) captured.push({ name: c.name, value: c.value, options: c.options ?? {} });
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (error || !data.session || !data.user) {
    throw new Error(`[global-setup] sign-in failed: ${error?.message ?? 'no session'}`);
  }
  if (captured.length === 0) {
    throw new Error('[global-setup] no auth cookies captured — @supabase/ssr setAll never fired');
  }

  // ── plan_type guard. Yearbook spread-cap test asserts free behavior;
  // upstream login should be a free user. Throw early with a clear
  // message rather than letting the yearbook test fail mysteriously.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('plan_type, is_pro')
    .eq('id', data.user.id)
    .single();
  if (profErr) {
    throw new Error(`[global-setup] failed to read test user profile: ${profErr.message}`);
  }
  if (profile?.plan_type || profile?.is_pro) {
    throw new Error(
      `[global-setup] test user must be on free plan (plan_type=null, is_pro=false), got plan_type=${profile?.plan_type ?? 'null'}, is_pro=${profile?.is_pro ?? 'null'}. Yearbook spread-cap test would not pass.`,
    );
  }

  // ── Install captured cookies into a Playwright context, then save
  // the resulting storageState. All test files reference this path
  // via projects[].use.storageState (see playwright.config.ts).
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });

  await context.addCookies(captured.map((c) => {
    const opts = c.options;
    const sameSiteRaw = (opts.sameSite ?? '').toString().toLowerCase();
    const sameSite: 'Lax' | 'Strict' | 'None' =
      sameSiteRaw === 'strict' ? 'Strict' : sameSiteRaw === 'none' ? 'None' : 'Lax';
    const expires = typeof opts.maxAge === 'number'
      ? Math.floor(Date.now() / 1000) + opts.maxAge
      : -1;
    return {
      name: c.name,
      value: c.value,
      domain: cookieDomain,
      path: opts.path ?? '/',
      httpOnly: opts.httpOnly ?? true,
      secure: opts.secure ?? true,
      sameSite,
      expires,
    };
  }));

  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  await context.storageState({ path: STORAGE_PATH });
  await browser.close();
}
