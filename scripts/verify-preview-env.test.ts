import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROD = 'gvkbegvvmhcrmxdorctk';
const STAGE = 'cvgqovweybggrqakhdtd';
const RECOVERY = 'drjmqjlbypostvasafke';
const script = fileURLToPath(new URL('./verify-preview-env.mjs', import.meta.url));
// Synthetic JWT-shaped claims only: no real keys and no network probes.
const key = (ref: string, role: string) => `fixture.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.fixture`;
function run(overrides: Record<string, string | undefined> = {}, production = true) {
  const ref = production ? PROD : STAGE;
  const env = { ...process.env };
  for (const name of ['VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'ROOTED_ENV', 'ROOTED_EXPECTED_SUPABASE_REF', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[name];
  Object.assign(env, {
    VERCEL_ENV: production ? 'production' : 'preview', VERCEL_GIT_COMMIT_REF: 'main',
    ROOTED_ENV: production ? 'production' : 'staging', ROOTED_EXPECTED_SUPABASE_REF: ref,
    NEXT_PUBLIC_SUPABASE_URL: production ? 'https://auth.rootedhomeschoolapp.com' : `https://${STAGE}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: key(ref, 'anon'), SUPABASE_SERVICE_ROLE_KEY: key(ref, 'service_role'),
  }, overrides);
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.ok(!result.stdout.includes(env.SUPABASE_SERVICE_ROLE_KEY ?? 'absent-secret-marker'));
  assert.ok(!result.stdout.includes(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'absent-anon-marker'));
  return result;
}
test('production alias builds with explicit production scope, identity and matching key claims', () => {
  const r = run(); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /Verified production build/);
});
test('canonical production URL follows the same production path', () => assert.equal(run({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }).status, 0));
for (const [label, env] of Object.entries({
  'preview scope': { VERCEL_ENV: 'preview' },
  'development scope': { VERCEL_ENV: 'development' },
  'missing deployment scope': { VERCEL_ENV: undefined },
  'staging label': { ROOTED_ENV: 'staging' },
  'missing database label': { ROOTED_ENV: undefined },
  'wrong expectation': { ROOTED_EXPECTED_SUPABASE_REF: STAGE },
  'pinned preview branch': { VERCEL_GIT_COMMIT_REF: 'feat/atomic-schedule-commit' },
  'wrong anon project': { NEXT_PUBLIC_SUPABASE_ANON_KEY: key(STAGE, 'anon') },
  'wrong service project': { SUPABASE_SERVICE_ROLE_KEY: key(STAGE, 'service_role') },
  'swapped service role': { SUPABASE_SERVICE_ROLE_KEY: key(PROD, 'anon') },
  'missing service key': { SUPABASE_SERVICE_ROLE_KEY: undefined },
  'unknown alias': { NEXT_PUBLIC_SUPABASE_URL: 'https://unknown.example.com' },
})) test(`production refuses ${label}`, () => { const r = run(env); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /REFUSING TO BUILD/); });
test('staging retains credential checks and can build', () => assert.equal(run({}, false).status, 0));
test('pinned staging branch can build only its correct staging configuration', () => assert.equal(run({ VERCEL_GIT_COMMIT_REF: 'feat/atomic-schedule-commit' }, false).status, 0));
test('production scope aimed at staging is refused', () => assert.equal(run({ VERCEL_ENV: 'production' }, false).status, 1));
test('recovery project remains forbidden', () => assert.equal(run({ NEXT_PUBLIC_SUPABASE_URL: `https://${RECOVERY}.supabase.co`, ROOTED_EXPECTED_SUPABASE_REF: RECOVERY }, false).status, 1));
test('pinned branch with missing expectation stays closed', () => assert.equal(run({ VERCEL_GIT_COMMIT_REF: 'feat/atomic-schedule-commit', ROOTED_EXPECTED_SUPABASE_REF: undefined }, false).status, 1));
test('legacy unpinned build with no expectation retains its skip path', () => { const r = run({ ROOTED_EXPECTED_SUPABASE_REF: undefined }); assert.equal(r.status, 0); assert.match(r.stdout, /skipping/); });
