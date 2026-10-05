import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePartnerCard, type CardDependencies } from './partner-card-access.ts';
import { printCardHtml, shareCardHtml } from './partner-cards.ts';

function fixture(overrides: Partial<CardDependencies> = {}) {
  const calls: unknown[][] = [];
  const deps: CardDependencies = {
    getUser: async token => { calls.push(['auth', token]); return { data: { id: 'owner' }, error: null }; },
    findPartner: async (code, owner) => { calls.push(['lookup', code, owner]); return { data: { name: 'Saved Partner', code: 'SAVED', user_id: 'owner', is_active: true }, error: null }; },
    render: async (name, code, url) => { calls.push(['render', name, code, url]); return { cardHtml: printCardHtml(name, code, url, 'data:image/png;base64,TEST'), shareHtml: shareCardHtml(name, code, url, 'data:image/png;base64,TEST'), qrDataUrl: 'TEST' }; },
    ...overrides,
  };
  return { deps, calls };
}
function request(query = 'code=SAVED', authorization: string | null = 'Bearer token') {
  return new Request(`https://rootedhomeschoolapp.com/api/affiliate/cards?${query}`, { headers: authorization ? { authorization } : {} });
}

for (const header of [null, 'Basic token', 'Bearer ', 'Bearer token extra']) {
  test(`refuses malformed/missing credentials (${header}) without a lookup or render`, async () => {
    const { deps, calls } = fixture();
    const res = await handlePartnerCard(request('code=SAVED', header), deps);
    assert.equal(res.status, 401); assert.deepEqual(calls, []);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
  });
}
test('invalid and anonymous users cannot probe partner codes', async () => {
  for (const result of [{ data: null, error: new Error('invalid') }, { data: { id: 'anonymous', is_anonymous: true }, error: null }]) {
    const { deps, calls } = fixture({ getUser: async () => result });
    assert.equal((await handlePartnerCard(request(), deps)).status, 401);
    assert.deepEqual(calls, []);
  }
});
test('partner uses saved identity and a canonical encoded Rooted destination, ignoring forged inputs', async () => {
  const { deps, calls } = fixture();
  const res = await handlePartnerCard(request('code=%20saved%20&name=Fake&url=evil.example'), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [['auth', 'token'], ['lookup', 'SAVED', 'owner'], ['render', 'Saved Partner', 'SAVED', 'rootedhomeschoolapp.com/?ref=SAVED']]);
  const data = await res.json();
  for (const html of [data.cardHtml, data.shareHtml]) {
    assert.ok(html.includes('Saved Partner')); assert.ok(!html.includes('evil.example')); assert.ok(!html.includes('Fake'));
    assert.ok(html.includes('I may earn a commission'));
  }
  assert.equal(res.headers.get('vary'), 'Authorization');
});
for (const partner of [null, { name: 'Other', code: 'SAVED', user_id: 'other', is_active: true }, { name: 'Inactive', code: 'SAVED', user_id: 'owner', is_active: false }]) {
  test(`unknown, foreign or inactive partner never renders (${partner?.name ?? 'unknown'})`, async () => {
    const { deps, calls } = fixture({ findPartner: async () => ({ data: partner, error: null }) });
    assert.equal((await handlePartnerCard(request(), deps)).status, 403);
    assert.ok(!calls.some(c => c[0] === 'render'));
  });
}
test('only a verified admin can preview an active partner without owner filtering', async () => {
  for (const verified of [true, false]) {
    const { deps, calls } = fixture({ getUser: async () => ({ data: { id: 'admin', email: 'hello@rootedhomeschoolapp.com', email_confirmed_at: verified ? '2026-09-01' : undefined }, error: null }) });
    const res = await handlePartnerCard(request(), deps);
    assert.equal(res.status, verified ? 200 : 403);
    assert.deepEqual(calls[0], ['lookup', 'SAVED', verified ? null : 'admin']);
  }
});
test('database failure and thrown dependencies fail closed without leaking error details', async () => {
  for (const overrides of [
    { findPartner: async () => ({ data: null, error: new Error('secret') }) },
    { getUser: async () => { throw new Error('secret'); } },
    { render: async () => { throw new Error('secret'); } },
  ]) {
    const { deps } = fixture(overrides);
    const res = await handlePartnerCard(request(), deps);
    assert.equal(res.status, 503); assert.ok(!(await res.text()).includes('secret'));
  }
});
test('missing or oversized code refuses before partner query', async () => {
  for (const query of ['', `code=${'A'.repeat(129)}`]) {
    const { deps, calls } = fixture();
    assert.equal((await handlePartnerCard(request(query), deps)).status, 400);
    assert.deepEqual(calls, [['auth', 'token']]);
  }
});
test('stored code cannot add an outside destination or extra URL parameters', async () => {
  const { deps, calls } = fixture({ findPartner: async () => ({ data: { name: 'Saved', code: 'A&next=https://evil.example', user_id: 'owner', is_active: true }, error: null }) });
  assert.equal((await handlePartnerCard(request(), deps)).status, 200);
  const url = new URL('https://' + String(calls.find(c => c[0] === 'render')?.[3]));
  assert.equal(url.origin, 'https://rootedhomeschoolapp.com');
  assert.deepEqual([...url.searchParams.keys()], ['ref']);
});
