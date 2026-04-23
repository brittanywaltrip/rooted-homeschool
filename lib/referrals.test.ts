// Unit tests for partner attribution. Run with:
//   node --test lib/referrals.test.ts
//
// Covers the three paths that must never silently drift:
//   Path 1 — URL ?ref= at signup (converted=false)
//   Path 2 — Stripe coupon maps back to an affiliate (converted=true)
//   Path 3 — free user with referred_by upgrades to paid (converted=true)

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { affiliateCodeForStripeCoupon, attributeReferral } from './referrals.ts'

type RpcCall = { fn: string; args: Record<string, unknown> }

function makeSupabase(opts: {
  rpcResponse?: { data?: unknown; error?: { message: string } | null }
  affiliateResponse?: { data?: { code: string } | null; error?: { message: string } | null }
} = {}) {
  const rpcCalls: RpcCall[] = []
  const fromCalls: { table: string; filters: Record<string, unknown> }[] = []
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return opts.rpcResponse ?? { data: { action: 'inserted' }, error: null }
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      fromCalls.push({ table, filters })
      const chain = {
        select: () => chain,
        or: (expr: string) => { filters.or = expr; return chain },
        eq: (col: string, val: unknown) => { filters[col] = val; return chain },
        maybeSingle: async () =>
          opts.affiliateResponse ?? { data: null, error: null },
      }
      return chain
    },
  }
  return { client, rpcCalls, fromCalls }
}

// ── attributeReferral ────────────────────────────────────────────────────────

test('Path 1 — URL ref on signup creates row with converted=false', async () => {
  const { client, rpcCalls } = makeSupabase({
    rpcResponse: { data: { action: 'inserted' }, error: null },
  })

  const result = await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-123',
    affiliateCode: 'amber',
    converted: false,
  })

  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].fn, 'record_referral_attribution')
  assert.deepEqual(rpcCalls[0].args, {
    p_user_id: 'user-123',
    p_affiliate_code: 'AMBER',
    p_stripe_session_id: null,
    p_converted: false,
  })
  assert.equal(result.action, 'inserted')
  assert.equal(result.affiliateCode, 'AMBER')
})

test('Path 2 — coupon-driven attribution passes session id and converted=true', async () => {
  const { client, rpcCalls } = makeSupabase({
    rpcResponse: { data: { action: 'converted' }, error: null },
  })

  const result = await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-456',
    affiliateCode: 'KENDRA',
    stripeSessionId: 'cs_test_abc123',
    converted: true,
  })

  assert.equal(rpcCalls[0].args.p_converted, true)
  assert.equal(rpcCalls[0].args.p_stripe_session_id, 'cs_test_abc123')
  assert.equal(result.action, 'converted')
})

test('Path 3 — re-attributing an existing referral flips converted and records session', async () => {
  const { client, rpcCalls } = makeSupabase({
    rpcResponse: { data: { action: 'converted' }, error: null },
  })

  await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-789',
    affiliateCode: 'sabbath',
    stripeSessionId: 'sub_test_xyz',
    converted: true,
  })

  assert.equal(rpcCalls[0].args.p_affiliate_code, 'SABBATH', 'code uppercased')
  assert.equal(rpcCalls[0].args.p_converted, true)
  assert.equal(rpcCalls[0].args.p_stripe_session_id, 'sub_test_xyz')
})

test('missing code is skipped without calling the RPC', async () => {
  const { client, rpcCalls } = makeSupabase()
  const result = await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-1',
    affiliateCode: '',
    converted: false,
  })
  assert.equal(rpcCalls.length, 0)
  assert.equal(result.action, 'skipped')
  assert.equal(result.error, 'missing_code')
})

test('missing user is skipped without calling the RPC', async () => {
  const { client, rpcCalls } = makeSupabase()
  const result = await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: '',
    affiliateCode: 'AMBER',
    converted: false,
  })
  assert.equal(rpcCalls.length, 0)
  assert.equal(result.action, 'skipped')
  assert.equal(result.error, 'missing_user_id')
})

test('RPC error surfaces as skipped with message, never silently succeeds', async () => {
  const { client } = makeSupabase({
    rpcResponse: { data: null, error: { message: 'Unknown affiliate code: FAKE' } },
  })

  const result = await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-1',
    affiliateCode: 'FAKE',
    converted: false,
  })

  assert.equal(result.action, 'skipped')
  assert.match(result.error ?? '', /Unknown affiliate code/)
})

// ── affiliateCodeForStripeCoupon ─────────────────────────────────────────────

test('coupon lookup returns affiliate code in uppercase', async () => {
  const { client } = makeSupabase({
    affiliateResponse: { data: { code: 'amber' }, error: null },
  })

  const code = await affiliateCodeForStripeCoupon(
    client as unknown as Parameters<typeof affiliateCodeForStripeCoupon>[0],
    'coupon_123',
  )
  assert.equal(code, 'AMBER')
})

test('coupon lookup returns null when no affiliate matches', async () => {
  const { client } = makeSupabase({
    affiliateResponse: { data: null, error: null },
  })

  const code = await affiliateCodeForStripeCoupon(
    client as unknown as Parameters<typeof affiliateCodeForStripeCoupon>[0],
    'coupon_doesnt_exist',
  )
  assert.equal(code, null)
})

test('coupon lookup returns null for empty input', async () => {
  const { client, fromCalls } = makeSupabase()
  const code = await affiliateCodeForStripeCoupon(
    client as unknown as Parameters<typeof affiliateCodeForStripeCoupon>[0],
    '',
  )
  assert.equal(code, null)
  assert.equal(fromCalls.length, 0, 'should short-circuit without hitting DB')
})
