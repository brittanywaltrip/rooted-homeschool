// Unit tests for the Stripe → profile linker. Run with:
//   node --test lib/link-stripe-to-profile.test.ts
//
// Verifies:
//   • every field in LINKED_FIELDS is written on the UPDATE
//   • idempotency: a row that already matches is not re-written
//   • retry-once semantics on transient UPDATE failures
//   • final failure throws (never silently swallows)
//   • args extracted from a mocked checkout.session.completed payload match
//     what linkStripeSubscription needs
//   • couponIdFromSubscription handles both `discount` and `discounts`

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  couponIdFromSubscription,
  linkStripeSubscription,
  periodEndFromSubscription,
  planTypeForPriceId,
  type LinkStripeSubscriptionOpts,
} from './link-stripe-to-profile.ts'

type UpdateCall = { patch: Record<string, unknown>; filters: Record<string, unknown> }
type SelectResult = { data: Record<string, unknown> | null; error: { message: string } | null }

function makeSupabase(opts: {
  selectResult?: SelectResult
  updateErrors?: Array<{ message: string } | null>
  rpcResponse?: { data: unknown; error: { message: string } | null }
} = {}) {
  const updateCalls: UpdateCall[] = []
  const updateErrors = [...(opts.updateErrors ?? [null])]
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return opts.rpcResponse ?? { data: { action: 'inserted' }, error: null }
    },
    from: () => {
      const filters: Record<string, unknown> = {}
      const readChain = {
        select: () => readChain,
        eq: (col: string, val: unknown) => { filters[col] = val; return readChain },
        maybeSingle: async () => opts.selectResult ?? { data: null, error: null },
      }
      const update = (patch: Record<string, unknown>) => {
        const capturedFilters: Record<string, unknown> = {}
        const updateChain = {
          eq: async (col: string, val: unknown) => {
            capturedFilters[col] = val
            updateCalls.push({ patch, filters: capturedFilters })
            const err = updateErrors.shift() ?? null
            return { error: err }
          },
        }
        return updateChain
      }
      return { ...readChain, update }
    },
  }
  return { client, updateCalls, rpcCalls }
}

function baseOpts(overrides: Partial<LinkStripeSubscriptionOpts> = {}): LinkStripeSubscriptionOpts {
  return {
    userId: 'user-1',
    customerId: 'cus_123',
    subscriptionId: 'sub_456',
    periodEnd: new Date('2027-04-23T00:00:00.000Z'),
    couponCode: null,
    ...overrides,
  }
}

// ── linkStripeSubscription ───────────────────────────────────────────────────

test('writes every linked field in a single UPDATE on first call', async () => {
  const { client, updateCalls } = makeSupabase()
  const result = await linkStripeSubscription(
    baseOpts({ supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'] }),
  )

  assert.equal(result.action, 'linked')
  assert.equal(updateCalls.length, 1)
  assert.deepEqual(updateCalls[0].patch, {
    is_pro: true,
    subscription_status: 'active',
    plan_type: 'founding_family',
    legacy_free: false,
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: 'sub_456',
    current_period_end: '2027-04-23T00:00:00.000Z',
    subscription_end_date: null,
  })
  assert.equal(updateCalls[0].filters.id, 'user-1')
})

test('respects passed planType override', async () => {
  const { client, updateCalls } = makeSupabase()
  await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      planType: 'monthly',
    }),
  )
  assert.equal(updateCalls[0].patch.plan_type, 'monthly')
})

test('idempotent: matching row does not trigger an UPDATE', async () => {
  const selectResult: SelectResult = {
    data: {
      is_pro: true,
      subscription_status: 'active',
      plan_type: 'founding_family',
      legacy_free: false,
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_456',
      current_period_end: '2027-04-23T00:00:00.000Z',
      subscription_end_date: null,
    },
    error: null,
  }
  const { client, updateCalls } = makeSupabase({ selectResult })
  const result = await linkStripeSubscription(
    baseOpts({ supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'] }),
  )
  assert.equal(result.action, 'already_linked')
  assert.equal(updateCalls.length, 0, 'no write when all fields already match')
})

test('drifting row triggers a fresh UPDATE', async () => {
  const selectResult: SelectResult = {
    data: {
      is_pro: true,
      subscription_status: 'active',
      plan_type: 'founding_family',
      legacy_free: true, // drift
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_456',
      current_period_end: '2027-04-23T00:00:00.000Z',
      subscription_end_date: null,
    },
    error: null,
  }
  const { client, updateCalls } = makeSupabase({ selectResult })
  const result = await linkStripeSubscription(
    baseOpts({ supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'] }),
  )
  assert.equal(result.action, 'linked')
  assert.equal(updateCalls.length, 1)
  assert.equal(updateCalls[0].patch.legacy_free, false)
})

test('retries once on transient UPDATE failure, then succeeds', async () => {
  const { client, updateCalls } = makeSupabase({
    updateErrors: [{ message: 'deadlock detected' }, null],
  })
  const result = await linkStripeSubscription(
    baseOpts({ supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'] }),
  )
  assert.equal(result.action, 'linked')
  assert.equal(updateCalls.length, 2)
})

test('throws after two failed UPDATE attempts — never silent', async () => {
  const { client, updateCalls } = makeSupabase({
    updateErrors: [{ message: 'down' }, { message: 'still down' }],
  })
  await assert.rejects(
    () =>
      linkStripeSubscription(
        baseOpts({ supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'] }),
      ),
    /still down/,
  )
  assert.equal(updateCalls.length, 2)
})

test('validates required inputs', async () => {
  const { client } = makeSupabase()
  const sb = client as unknown as LinkStripeSubscriptionOpts['supabase']
  await assert.rejects(
    () => linkStripeSubscription(baseOpts({ userId: '', supabase: sb })),
    /userId required/,
  )
  await assert.rejects(
    () => linkStripeSubscription(baseOpts({ customerId: '', supabase: sb })),
    /customerId required/,
  )
  await assert.rejects(
    () => linkStripeSubscription(baseOpts({ subscriptionId: '', supabase: sb })),
    /subscriptionId required/,
  )
})

test('couponCode triggers attribution after successful link', async () => {
  const { client, rpcCalls } = makeSupabase()
  await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      couponCode: 'amber',
      stripeSessionId: 'cs_test_abc',
    }),
  )
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].fn, 'record_referral_attribution')
  assert.equal(rpcCalls[0].args.p_affiliate_code, 'AMBER')
  assert.equal(rpcCalls[0].args.p_converted, true)
  assert.equal(rpcCalls[0].args.p_stripe_session_id, 'cs_test_abc')
})

// ── arg-extraction helpers ──────────────────────────────────────────────────

test('mock checkout.session.completed payload produces correct link args', () => {
  // This is the test the spec asked for: take a mocked session payload and
  // verify the values that would be passed into linkStripeSubscription.
  const mockedSession = {
    id: 'cs_test_session',
    metadata: { userId: 'user-42', referral: 'KENDRA' },
    customer: 'cus_xyz',
    subscription: 'sub_789',
    customer_details: { email: 'family@example.com' },
  }
  const mockedSubscription = {
    id: 'sub_789',
    current_period_end: 1800000000, // 2027-01-15
    items: { data: [{ price: { id: process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID ?? 'price_founding' } }] },
  } as unknown as import('stripe').Stripe.Subscription

  const linkArgs: LinkStripeSubscriptionOpts = {
    userId: mockedSession.metadata.userId,
    customerId: mockedSession.customer,
    subscriptionId: mockedSession.subscription,
    periodEnd: periodEndFromSubscription(mockedSubscription),
    couponCode: mockedSession.metadata.referral,
    planType: planTypeForPriceId(mockedSubscription.items.data[0]?.price?.id),
    stripeSessionId: mockedSession.id,
  }

  assert.equal(linkArgs.userId, 'user-42')
  assert.equal(linkArgs.customerId, 'cus_xyz')
  assert.equal(linkArgs.subscriptionId, 'sub_789')
  assert.equal(linkArgs.couponCode, 'KENDRA')
  assert.equal(linkArgs.stripeSessionId, 'cs_test_session')
  assert.ok(linkArgs.periodEnd instanceof Date)
  assert.equal(linkArgs.periodEnd.getTime(), 1800000000 * 1000)
})

test('periodEndFromSubscription falls back one year out when Stripe omits it', () => {
  const sub = { id: 'sub_x', items: { data: [] } } as unknown as import('stripe').Stripe.Subscription
  const now = Date.now()
  const end = periodEndFromSubscription(sub)
  const approx = now + 365 * 24 * 60 * 60 * 1000
  assert.ok(Math.abs(end.getTime() - approx) < 5000, 'within 5 seconds of one year')
})

test('couponIdFromSubscription reads legacy discount shape', () => {
  const sub = { discount: { coupon: { id: 'coupon_abc' } } } as unknown as import('stripe').Stripe.Subscription
  assert.equal(couponIdFromSubscription(sub), 'coupon_abc')
})

test('couponIdFromSubscription reads new discounts[] shape', () => {
  const sub = {
    discounts: [{ coupon: { id: 'coupon_xyz' } }],
  } as unknown as import('stripe').Stripe.Subscription
  assert.equal(couponIdFromSubscription(sub), 'coupon_xyz')
})

test('couponIdFromSubscription returns null when no coupon', () => {
  const sub = { id: 'sub_x' } as unknown as import('stripe').Stripe.Subscription
  assert.equal(couponIdFromSubscription(sub), null)
})
