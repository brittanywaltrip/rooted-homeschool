/* ============================================================================
 * Service-role helpers for the e2e suite, with the account guard baked in.
 *
 * Extracted from critical-paths.spec.ts so every spec that needs admin access
 * resolves its user scope through ONE guarded implementation. A second copy of
 * "resolve the test user" is exactly how a spec ends up deleting from an
 * account nobody checked — see e2e/test-account.ts for the incident that
 * motivated the guard.
 *
 * Every DELETE built on these helpers must be scoped by user_id. These run as
 * service_role against the shared production database, where RLS protects
 * nobody: a DELETE keyed on a title or label alone would reach every family's
 * rows carrying that value.
 * ==========================================================================*/

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { assertIsTestAccount } from './test-account';

/** Admin client, or null when SUPABASE_SERVICE_ROLE_KEY isn't configured.
 *  Specs treat null as "skip the DB-backed assertions" — never as a reason to
 *  widen a delete. */
export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Resolve the test account's user_id via the Supabase admin auth API.
 * Returns null if the admin client isn't configured or the email isn't found.
 * (profiles has no email column; the canonical email lives on auth.users,
 * reachable only through auth.admin.)
 *
 * Paginates at 1000 per page (the admin API max) and walks until the account
 * is found or the page comes back short. The .replace strips the quotes that
 * `node --env-file` leaves on values.
 */
export async function resolveTestUserId(): Promise<string | null> {
  const sb = adminClient();
  const rawEmail = process.env.PLAYWRIGHT_EMAIL;
  if (!sb || !rawEmail) return null;
  const email = rawEmail.replace(/^['"]|['"]$/g, '').toLowerCase();
  const PER_PAGE = 1000;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ perPage: PER_PAGE, page });
    if (error || !data?.users) return null;
    const hit = data.users.find((row) => (row.email ?? '').toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < PER_PAGE) return null;
  }
  return null;
}

/**
 * Memoized resolveTestUserId, guarded.
 *
 * The admin listUsers walk pages 1000 accounts at a time and cleanup runs in
 * every afterEach, so re-resolving per call would add a full auth-API sweep to
 * each teardown. Cached per worker process; null results are cached too (a
 * missing PLAYWRIGHT_EMAIL will not start existing mid-run).
 *
 * This is the second choke point for the account guard (global-setup is the
 * first). Every service-role seed and delete in the suite resolves its scope
 * here, so asserting once covers both directions. It matters independently of
 * global-setup: a run started with a stale e2e/.auth/user.json while
 * PLAYWRIGHT_EMAIL points elsewhere would otherwise drive the browser as one
 * account and issue service-role DELETEs against another.
 *
 * A null id still returns null rather than throwing — that is the documented
 * "no SUPABASE_SERVICE_ROLE_KEY, skip the DB-backed specs" path, and it
 * performs no writes. Only a resolved id that is NOT the test account is fatal.
 */
let cachedTestUserIdPromise: Promise<string | null> | null = null;
export function cachedTestUserId(): Promise<string | null> {
  if (!cachedTestUserIdPromise) {
    cachedTestUserIdPromise = resolveTestUserId().then((id) => {
      if (id) assertIsTestAccount(id, 'e2e service-role scope');
      return id;
    });
  }
  return cachedTestUserIdPromise;
}

/**
 * The single place that enforces "no unscoped service-role DELETE": if we
 * cannot establish the user scope, THROW rather than widen the blast radius.
 * The only tolerated no-op is a missing admin client (nothing to delete
 * against), which each caller checks before getting here.
 */
export async function requireTestUserId(operation: string): Promise<string> {
  const testUserId = await cachedTestUserId();
  if (!testUserId) {
    throw new Error(
      `${operation} refused to run: could not resolve the test user id ` +
        '(PLAYWRIGHT_EMAIL missing, or no auth.users row matches it). Refusing to fall back to an ' +
        'unscoped service-role DELETE against the shared database. Set PLAYWRIGHT_EMAIL to the ' +
        'test account, or unset SUPABASE_SERVICE_ROLE_KEY to skip DB cleanup entirely.',
    );
  }
  return testUserId;
}
