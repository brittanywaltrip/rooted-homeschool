import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual route with isolated database/email/network adapters.
const source = readFileSync(new URL('../app/api/cron/check-links/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;

function fixture(failed: string[] = []) {
  let reads = 0;
  let writes = 0;
  let emails = 0;
  let requests = 0;
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports, process: { env: { CRON_SECRET: 'fixture-only' } },
    console: { error() {} }, AbortController, setTimeout, clearTimeout,
    fetch() { requests++; throw new Error('Network forbidden'); },
    require(name: string) {
      if (name === 'next/server') return { NextResponse: { json: Response.json } };
      if (name === '@/lib/link-check-url') return { linkCheckUrl: (raw: string) => raw };
      if (name === '@/lib/api-clients') return { resendClient: () => ({ emails: {
        send() { emails++; throw new Error('Email forbidden'); },
      } }) };
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: {
        from(table: string) {
          reads++;
          const result = { data: [], error: failed.includes(table) ? { message: 'fixture read failure' } : null };
          return { select: () => ({ ...result, eq: () => result }),
            update() { writes++; throw new Error('Write forbidden'); } };
        },
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { run: (authorized = true) => exports.GET!(new Request('https://staging.invalid/api/cron/check-links', {
    headers: authorized ? { authorization: 'Bearer fixture-only' } : {},
  })), counts: () => ({ reads, writes, emails, requests }) };
}

for (const failed of [['resources'], ['mailbox_listings'], ['resources', 'mailbox_listings']]) {
  test(`catalog failure ${failed.join('+')} stops before requests, writes or email`, async () => {
    const f = fixture(failed);
    const result = await f.run();
    assert.equal(result.status, 500);
    assert.deepEqual(await result.json(), { error: 'Link catalog read failed' });
    assert.deepEqual(f.counts(), { reads: 2, writes: 0, emails: 0, requests: 0 });
  });
}

test('genuinely empty catalogs still return a successful empty check', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { checked: 0, broken: 0 });
  assert.deepEqual(f.counts(), { reads: 2, writes: 0, emails: 0, requests: 0 });
});

test('missing cron authorization reaches no database or external service', async () => {
  const f = fixture();
  assert.equal((await f.run(false)).status, 401);
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, emails: 0, requests: 0 });
});
