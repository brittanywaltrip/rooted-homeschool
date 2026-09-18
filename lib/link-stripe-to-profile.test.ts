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
//   • cancel_at: a scheduled cancellation is recorded without touching
//     entitlement, a resume clears it, and repeat events stay idempotent

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  cancelAtFromSubscription,
  couponIdFromSubscription,
  linkStripeSubscription,
  planTypeForPriceId,
  type LinkStripeSubscriptionOpts,
} from './link-stripe-to-profile.ts'
import { resolvePaidPeriodEnd } from './paid-through.ts'

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
    cancel_at: null,
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
      cancel_at: null,
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
      cancel_at: null,
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
    // The paid-through date now comes from a PAID invoice's billed line, which
    // the webhook resolves before calling in. The subscription's own period
    // field is no longer consulted at all.
    periodEnd: resolvePaidPeriodEnd([
      { invoiceStatus: 'paid', billedLineEnd: new Date(1800000000 * 1000) },
    ]),
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
  assert.equal(linkArgs.periodEnd!.getTime(), 1800000000 * 1000)
})

test('the manufactured now + 365 fallback is gone for good', () => {
  // periodEndFromSubscription used to answer "one year from now" whenever
  // Stripe's payload carried no period. The function is deleted, not merely
  // fallback-free, so nobody can re-fatten it. This test is its headstone.
  const src = readFileSync(new URL('./link-stripe-to-profile.ts', import.meta.url), 'utf8')
  assert.equal(
    src.includes('365 * 24 * 60 * 60 * 1000'),
    false,
    'no manufactured year may reappear in the linker',
  )
  assert.equal(
    /export function periodEndFromSubscription/.test(src),
    false,
    'periodEndFromSubscription must stay deleted',
  )
})

test('a null periodEnd stores no date and still grants access', async () => {
  const { client, updateCalls } = makeSupabase()
  const result = await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      periodEnd: null,
      planType: 'monthly',
    }),
  )

  assert.equal(result.action, 'linked')
  assert.equal(updateCalls.length, 1)
  const patch = updateCalls[0].patch
  // Never invent a date...
  assert.equal(patch.current_period_end, null)
  // ...and never withhold access that was just paid for.
  assert.equal(patch.is_pro, true)
  assert.equal(patch.subscription_status, 'active')
  assert.equal(patch.plan_type, 'monthly')
})

test('MONTHLY can never become +365: a null periodEnd stays null', async () => {
  const { client, updateCalls } = makeSupabase()
  await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      periodEnd: null,
      planType: 'monthly',
    }),
  )
  const stored = updateCalls[0].patch.current_period_end
  assert.equal(stored, null)
  assert.notEqual(
    typeof stored,
    'string',
    'a monthly subscriber must never be handed a manufactured year',
  )
})

test('ANNUAL with a missing date can never become +365 either', async () => {
  const { client, updateCalls } = makeSupabase()
  await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      periodEnd: null,
      planType: 'standard',
    }),
  )
  assert.equal(updateCalls[0].patch.current_period_end, null)
})

test('a null periodEnd is idempotent: the second event does not rewrite', async () => {
  const selectResult: SelectResult = {
    data: linkedRow({ current_period_end: null, cancel_at: null }),
    error: null,
  }
  const { client, updateCalls } = makeSupabase({ selectResult })
  const result = await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      periodEnd: null,
    }),
  )
  assert.equal(result.action, 'already_linked')
  assert.equal(updateCalls.length, 0)
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


// ── cancel_at: scheduled cancellation lifecycle ──────────────────────────────

const SCHEDULED = new Date('2027-04-23T00:00:00.000Z')

function linkedRow(overrides: Record<string, unknown> = {}) {
  return {
    is_pro: true,
    subscription_status: 'active',
    plan_type: 'founding_family',
    legacy_free: false,
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: 'sub_456',
    current_period_end: '2027-04-23T00:00:00.000Z',
    subscription_end_date: null,
    cancel_at: null,
    ...overrides,
  }
}

test('scheduled cancellation records cancel_at without touching entitlement', async () => {
  const { client, updateCalls } = makeSupabase()
  await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      cancelAt: SCHEDULED,
    }),
  )

  assert.equal(updateCalls.length, 1)
  const patch = updateCalls[0].patch
  assert.equal(patch.cancel_at, '2027-04-23T00:00:00.000Z')
  // The whole point: access is untouched while the term runs out.
  assert.equal(patch.is_pro, true)
  assert.equal(patch.subscription_status, 'active')
  assert.equal(patch.plan_type, 'founding_family')
  assert.equal(patch.subscription_end_date, null)
})

test('resumed subscription clears cancel_at', async () => {
  const selectResult: SelectResult = {
    data: linkedRow({ cancel_at: '2027-04-23T00:00:00.000Z' }),
    error: null,
  }
  const { client, updateCalls } = makeSupabase({ selectResult })
  const result = await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      cancelAt: null,
    }),
  )

  assert.equal(result.action, 'linked')
  assert.equal(updateCalls.length, 1)
  assert.equal(updateCalls[0].patch.cancel_at, null)
  // Clearing the schedule must not disturb anything else.
  assert.equal(updateCalls[0].patch.is_pro, true)
  assert.equal(updateCalls[0].patch.subscription_status, 'active')
})

test('repeat event with the same cancel_at is idempotent, no UPDATE', async () => {
  // The regression guard for rowMatches. Note the row uses the shape Postgres
  // ACTUALLY returns ("2027-04-23 00:00:00+00"), not the idealized JS
  // "2027-04-23T00:00:00.000Z". Those two strings are not equal, so without
  // cancel_at in the timestamp-normalizing branch every Stripe event would see
  // drift and issue a redundant write forever. current_period_end is given the
  // same treatment here because the older tests only ever used the JS shape,
  // which left the existing normalization unexercised too.
  const selectResult: SelectResult = {
    data: linkedRow({
      cancel_at: '2027-04-23 00:00:00+00',
      current_period_end: '2027-04-23 00:00:00+00',
    }),
    error: null,
  }
  const { client, updateCalls } = makeSupabase({ selectResult })
  const result = await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      cancelAt: SCHEDULED,
    }),
  )

  assert.equal(result.action, 'already_linked')
  assert.equal(updateCalls.length, 0, 'no write when cancel_at already matches')
})

test('cancel_at drift (row null, Stripe scheduled) triggers an UPDATE', async () => {
  const { client, updateCalls } = makeSupabase({
    selectResult: { data: linkedRow(), error: null },
  })
  const result = await linkStripeSubscription(
    baseOpts({
      supabase: client as unknown as LinkStripeSubscriptionOpts['supabase'],
      cancelAt: SCHEDULED,
    }),
  )

  assert.equal(result.action, 'linked')
  assert.equal(updateCalls.length, 1)
  assert.equal(updateCalls[0].patch.cancel_at, '2027-04-23T00:00:00.000Z')
})

// ── cancelAtFromSubscription ─────────────────────────────────────────────────

test('cancelAtFromSubscription returns null when nothing is scheduled', () => {
  const sub = {
    cancel_at_period_end: false,
    cancel_at: null,
    current_period_end: 1_800_000_000,
  } as unknown as Parameters<typeof cancelAtFromSubscription>[0]
  assert.equal(cancelAtFromSubscription(sub), null)
})

test('cancelAtFromSubscription prefers cancel_at', () => {
  const sub = {
    cancel_at_period_end: true,
    cancel_at: 1_800_000_000,
    current_period_end: 1_700_000_000,
  } as unknown as Parameters<typeof cancelAtFromSubscription>[0]
  assert.equal(
    cancelAtFromSubscription(sub)?.toISOString(),
    new Date(1_800_000_000 * 1000).toISOString(),
  )
})

test('cancelAtFromSubscription falls back to top-level then item period end', () => {
  const topLevel = {
    cancel_at_period_end: true,
    current_period_end: 1_700_000_000,
  } as unknown as Parameters<typeof cancelAtFromSubscription>[0]
  assert.equal(
    cancelAtFromSubscription(topLevel)?.toISOString(),
    new Date(1_700_000_000 * 1000).toISOString(),
  )

  const itemOnly = {
    cancel_at_period_end: true,
    items: { data: [{ current_period_end: 1_650_000_000 }] },
  } as unknown as Parameters<typeof cancelAtFromSubscription>[0]
  assert.equal(
    cancelAtFromSubscription(itemOnly)?.toISOString(),
    new Date(1_650_000_000 * 1000).toISOString(),
  )
})

test('cancelAtFromSubscription never invents a date', () => {
  // Unlike periodEndFromSubscription there is no now + 365 fallback: a wrong
  // cancellation date is worse than none at all.
  const sub = {
    cancel_at_period_end: true,
  } as unknown as Parameters<typeof cancelAtFromSubscription>[0]
  assert.equal(cancelAtFromSubscription(sub), null)
})

test('stale event: the freshly retrieved subscription wins over the snapshot', () => {
  // The webhook re-reads the subscription and derives both period end and
  // cancellation state from that object, never from event.data.object, which is
  // a snapshot from when the event was CREATED. Stripe does not guarantee
  // ordering and retries for up to three days, so a delayed "not cancelling"
  // event must not erase a cancellation that Stripe currently reports.
  const snapshot = {
    cancel_at_period_end: false,
    cancel_at: null,
    current_period_end: 1_700_000_000,
  } as unknown as Parameters<typeof cancelAtFromSubscription>[0]
  const fresh = {
    cancel_at_period_end: true,
    cancel_at: 1_800_000_000,
    current_period_end: 1_800_000_000,
  } as unknown as Parameters<typeof cancelAtFromSubscription>[0]

  assert.equal(cancelAtFromSubscription(snapshot), null, 'snapshot alone would erase it')
  assert.equal(
    cancelAtFromSubscription(fresh)?.toISOString(),
    new Date(1_800_000_000 * 1000).toISOString(),
    'fresh retrieve preserves the scheduled cancellation',
  )
})
