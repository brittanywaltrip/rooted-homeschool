import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { daysToUpgrade, discoveryLabel, firstPayments, type PaidInvoiceEvidence } from './signup-upgrade-insights.ts';
import { buildExclusions } from './admin/excluded-user-ids.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const paidAt = Date.parse('2026-10-07T19:22:13Z') / 1000;
const invoice = (paid = paidAt, amount = 5900): PaidInvoiceEvidence => ({ customer: 'cus_family', status: 'paid', amount_paid: amount, parent: { subscription_details: { subscription: 'sub_family' } }, status_transitions: { paid_at: paid } });

test('account age uses elapsed days; missing or impossible dates stay unknown', () => {
  assert.equal(daysToUpgrade('2026-09-10T12:50:43Z', paidAt), 27);
  assert.equal(daysToUpgrade('2026-10-07T19:00:00Z', paidAt), 0);
  assert.equal(daysToUpgrade('2026-10-08T00:00:00Z', paidAt), null);
  assert.equal(daysToUpgrade('invalid', paidAt), null);
  assert.equal(daysToUpgrade('2026-09-01', null), null);
});
test('renewals do not reset the first paid upgrade; zero-dollar and unrelated invoices are excluded', () => {
  const result = firstPayments([invoice(paidAt + 3000), invoice(), invoice(paidAt - 1000, 0), { ...invoice(paidAt - 2000), parent: null }, { ...invoice(paidAt - 3000), status: 'open' }]);
  assert.equal(result.get('cus_family'), paidAt);
});
test('unknown and untrusted discovery answers do not become inferred attribution', () => {
  assert.equal(discoveryLabel('facebook'), 'Facebook');
  for (const value of [null, undefined, '', 'constructor', 'toString', '<script>']) assert.equal(discoveryLabel(value), 'Unknown');
});
test('undated positive payments keep first-upgrade timing unknown regardless of invoice order', () => {
  const undated = { ...invoice(), status_transitions: { paid_at: null } };
  for (const invoices of [[undated, invoice()], [invoice(), undated]]) {
    assert.equal(firstPayments(invoices).get('cus_family'), null);
  }
  for (const paid of [NaN, Infinity, -1]) assert.equal(firstPayments([invoice(paid)]).get('cus_family'), null);
  assert.equal(daysToUpgrade('2026-09-01', Infinity), null);
});

function routeFixture(email = 'garfieldbrittany@gmail.com', fail?: string, duplicate = false, options: { paginated?: boolean; lateFailure?: string; invoices?: PaidInvoiceEvidence[] } = {}) {
  const source = readFileSync(new URL('../app/api/admin/signup-upgrade-insights/route.ts', import.meta.url), 'utf8');
  const reads: string[] = [];
  const exports: { GET?: (req: Request) => Promise<{ status: number; body: { medianDays?: number | null; rows?: { daysToUpgrade: number | null; firstPaidAt: string | null }[] } }> } = {};
  const tables: Record<string, unknown[]> = { profiles: [{ id: 'family', stripe_customer_id: 'cus_family' }, ...(duplicate ? [{ id: 'other', stripe_customer_id: 'cus_family' }] : [])], affiliates: [] };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Date, process: { env: { STRIPE_SECRET_KEY: 'fake' } },
    require: (name: string) => {
      if (name === 'next/server') return { NextResponse: { json: (body: unknown, opts?: { status: number }) => ({ body, status: opts?.status ?? 200 }) } };
      if (name === '@/lib/signup-upgrade-insights') return { daysToUpgrade, discoveryLabel, firstPayments };
      if (name === '@/lib/admin/excluded-user-ids') return { buildExclusions };
      if (name === 'stripe') return { default: class { invoices = { list: async function* () { if (fail === 'stripe') throw Error('stripe failed'); yield* options.invoices ?? [invoice()]; if (options.lateFailure === 'stripe') throw Error('later invoice page failed'); } }; } };
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: {
        auth: { getUser: async () => ({ data: { user: { email } }, error: null }), admin: { listUsers: async ({ page }: { page: number }) => {
          reads.push(`auth:${page}`);
          const family = { id: 'family', email: 'family@example.invalid', created_at: '2026-09-10T12:50:43Z', user_metadata: {} };
          const users = options.paginated && page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ ...family, id: `filler-${i}` })) : [family];
          return { data: { users }, error: fail === 'auth' || (page > 1 && options.lateFailure === 'auth') ? Error('auth failed') : null };
        } } },
        from: (table: string) => { const q = { select: () => q, eq: () => q, order: () => q, range: async (offset: number, end: number) => {
          reads.push(`${table}:${offset}-${end}`);
          const data = options.paginated && offset === 0 ? Array.from({ length: 1000 }, (_, i) => table === 'profiles' ? { id: `filler-${i}`, stripe_customer_id: null } : { user_id: `comped-${i}` }) : tables[table];
          return { data, error: fail === table || (offset > 0 && options.lateFailure === table) ? Error('read failed') : null };
        } }; return q; },
      } };
      throw Error(name);
    },
  });
  return { reads, run: (token = true) => exports.GET!(new Request('https://fixture.invalid', { headers: token ? { Authorization: 'Bearer fake' } : {} })) };
}
test('admin endpoint refuses anonymous and non-admin callers before reading records', async () => {
  for (const [email, token, status] of [['family@example.invalid', true, 403], ['garfieldbrittany@gmail.com', false, 401]] as const) {
    const f = routeFixture(email); assert.equal((await f.run(token)).status, status); assert.equal(f.reads.length, 0);
  }
});
test('admin endpoint joins verified customer ownership to signup and payment', async () => {
  const r = await routeFixture().run(); assert.equal(r.status, 200); assert.equal(r.body.rows?.[0].daysToUpgrade, 27);
});
for (const failure of ['auth', 'profiles', 'affiliates', 'stripe']) test(`${failure} failure refuses partial insights`, async () => { assert.equal((await routeFixture(undefined, failure).run()).status, 503); });
test('ambiguous customer ownership is not attributed to either family', async () => { assert.equal((await routeFixture(undefined, undefined, true).run()).body.rows?.length, 0); });
test('admin endpoint reads beyond 1000 users, profiles and affiliates before matching upgrades', async () => {
  const f = routeFixture(undefined, undefined, false, { paginated: true });
  const r = await f.run(); assert.equal(r.status, 200); assert.equal(r.body.rows?.length, 1); assert.equal(r.body.rows?.[0].daysToUpgrade, 27);
  assert.deepEqual(f.reads, ['auth:1', 'auth:2', 'profiles:0-999', 'profiles:1000-1999', 'affiliates:0-999', 'affiliates:1000-1999']);
});
for (const lateFailure of ['auth', 'profiles', 'affiliates', 'stripe']) test(`later ${lateFailure} page failure refuses partial insights`, async () => {
  const r = await routeFixture(undefined, undefined, false, { paginated: true, lateFailure }).run();
  assert.equal(r.status, 503); assert.equal(r.body.rows, undefined);
});
test('matched undated payment remains visible as unknown and is excluded from median', async () => {
  const r = await routeFixture(undefined, undefined, false, { invoices: [invoice(), { ...invoice(), status_transitions: { paid_at: null } }] }).run();
  assert.equal(r.status, 200); assert.equal(r.body.rows?.length, 1); assert.equal(r.body.rows?.[0].firstPaidAt, null); assert.equal(r.body.rows?.[0].daysToUpgrade, null); assert.equal(r.body.medianDays, null);
});

function discoveryFixture(authenticated = true, writeFails = false) {
  const source = readFileSync(new URL('../app/api/account/discovery-source/route.ts', import.meta.url), 'utf8');
  const writes: { id: string; patch: unknown }[] = [];
  const exports: { POST?: (req: Request) => Promise<{ status: number }> } = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require: (name: string) => {
      if (name === 'next/server') return { NextResponse: { json: (_body: unknown, opts?: { status: number }) => ({ status: opts?.status ?? 200 }) } };
      if (name === '@/lib/signup-upgrade-insights') return { DISCOVERY_SOURCES: { facebook: 'Facebook' } };
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: { auth: {
        getUser: async () => ({ data: { user: authenticated ? { id: 'own-account' } : null }, error: null }),
        admin: { updateUserById: async (id: string, patch: unknown) => { writes.push({ id, patch }); return { error: writeFails ? Error('write failed') : null }; } },
      } } };
      throw Error(name);
    },
  });
  return { writes, run: (body: string, token = true) => exports.POST!(new Request('https://fixture.invalid', { method: 'POST', headers: token ? { Authorization: 'Bearer fake', 'Content-Type': 'application/json' } : {}, body })) };
}
test('discovery source only updates authenticated account and ignores caller-supplied identity', async () => {
  const f = discoveryFixture(); assert.equal((await f.run(JSON.stringify({ source: 'facebook', user_id: 'someone-else', is_pro: true }))).status, 200);
  assert.equal(f.writes[0].id, 'own-account');
  assert.equal(JSON.stringify(f.writes[0].patch), JSON.stringify({ user_metadata: { rooted_discovery_source: 'facebook' } }));
});
test('invalid discovery answers and missing authentication never write', async () => {
  for (const body of ['{', 'null', '{}', '{"source":"constructor"}', '{"source":"invented"}']) {
    const f = discoveryFixture(); assert.equal((await f.run(body)).status, 400); assert.equal(f.writes.length, 0);
  }
  const f = discoveryFixture(false); assert.equal((await f.run('{"source":"facebook"}')).status, 401); assert.equal(f.writes.length, 0);
});
test('discovery storage failure is not shown as saved', async () => { assert.equal((await discoveryFixture(true, true).run('{"source":"facebook"}')).status, 503); });
