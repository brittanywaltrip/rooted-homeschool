// Unit tests for the Stripe ↔ profile linkage audit.
//   node --test lib/audit-stripe-linkage.test.ts
//
// The bug these were written for: a family mid-collection appeared in NEITHER
// Stripe listing, so they fell through to PROFILE_WITHOUT_STRIPE, which is
// meant to mean "entitlement with no Stripe backing". A bounced card looked
// exactly like a genuine orphan, and that dilution is the real harm: it makes a
// finding that should always be taken seriously easy to ignore.
//
// This is an observability module. Nothing here writes anything.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runStripeLinkageAudit, type LinkageAuditReport } from './audit-stripe-linkage.ts'

type SubSpec = {
  id: string
  customer: string
  status: string
  /** Latest invoice status; 'paid' lets the current_period_end check run. */
  invoiceStatus?: string
  periodEnd?: number
}

const ITEM_ID = 'si_1'
const PERIOD_END = 1810000000
const PERIOD_START = 1807408000

function stripeSub(spec: SubSpec) {
  const end = spec.periodEnd ?? PERIOD_END
  return {
    id: spec.id,
    customer: spec.customer,
    status: spec.status,
    created: 1780000000,
    start_date: 1780000000,
    items: { data: [{ id: ITEM_ID, current_period_end: end }] },
    latest_invoice: {
      id: `in_${spec.id}`,
      status: spec.invoiceStatus ?? 'paid',
      lines: {
        has_more: false,
        data: [
          {
            period: { start: PERIOD_START, end },
            parent: {
              subscription_item_details: {
                subscription: spec.id,
                subscription_item: ITEM_ID,
                proration: false,
              },
            },
          },
        ],
      },
    },
  }
}

function fakeStripe(subsByStatus: Record<string, SubSpec[]>) {
  const listedStatuses: string[] = []
  const client = {
    subscriptions: {
      list(params: { status: string }) {
        listedStatuses.push(params.status)
        const rows = (subsByStatus[params.status] ?? []).map(stripeSub)
        return {
          async *[Symbol.asyncIterator]() {
            for (const r of rows) yield r
          },
        }
      },
    },
  }
  return { client, listedStatuses }
}

type ProfileSpec = {
  id: string
  plan_type: string | null
  subscription_status: string | null
  is_pro: boolean
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end?: string | null
}

function fakeSupabase(profiles: ProfileSpec[]) {
  return {
    from() {
      const chain = {
        select: () => chain,
        or: () => chain,
        range: async (from: number) =>
          from === 0
            ? {
                data: profiles.map((p) => ({
                  legacy_free: false,
                  display_name: 'Family',
                  current_period_end: new Date(PERIOD_END * 1000).toISOString(),
                  ...p,
                })),
                error: null,
              }
            : { data: [], error: null },
      }
      return chain
    },
  }
}

async function audit(
  subsByStatus: Record<string, SubSpec[]>,
  profiles: ProfileSpec[],
): Promise<LinkageAuditReport & { listedStatuses: string[] }> {
  const { client, listedStatuses } = fakeStripe(subsByStatus)
  const report = await runStripeLinkageAudit(
    client as unknown as Parameters<typeof runStripeLinkageAudit>[0],
    fakeSupabase(profiles) as unknown as Parameters<typeof runStripeLinkageAudit>[1],
  )
  return { ...report, listedStatuses }
}

const linkedProfile = (over: Partial<ProfileSpec> = {}): ProfileSpec => ({
  id: 'user-1',
  plan_type: 'standard',
  subscription_status: 'active',
  is_pro: true,
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  ...over,
})

// ── population ──────────────────────────────────────────────────────────────

test('the Stripe population covers every billable status, and not incomplete', async () => {
  const out = await audit({}, [])
  assert.deepEqual(out.listedStatuses, ['active', 'trialing', 'past_due', 'unpaid'])
  assert.equal(out.listedStatuses.includes('incomplete'), false)
})

// ── healthy ─────────────────────────────────────────────────────────────────

test('a healthy ACTIVE subscription produces no issues', async () => {
  const out = await audit(
    { active: [{ id: 'sub_1', customer: 'cus_1', status: 'active' }] },
    [linkedProfile()],
  )
  assert.deepEqual(out.issues, [])
  assert.equal(out.stripeBillableCount, 1)
  assert.deepEqual(out.stripeCountsByStatus, { active: 1 })
})

test('a healthy TRIALING subscription produces no issues', async () => {
  const out = await audit(
    { trialing: [{ id: 'sub_1', customer: 'cus_1', status: 'trialing' }] },
    [linkedProfile()],
  )
  assert.deepEqual(out.issues, [])
  assert.deepEqual(out.stripeCountsByStatus, { trialing: 1 })
})

// ── dunning: the bug this fixes ─────────────────────────────────────────────

test('PAST_DUE is reported as dunning, never as an orphan', async () => {
  const out = await audit(
    { past_due: [{ id: 'sub_1', customer: 'cus_1', status: 'past_due', invoiceStatus: 'open' }] },
    // linkStripeSubscription writes 'active' even while past_due, so the
    // profile looks healthy from the database side. That is exactly why the
    // Stripe side had to widen.
    [linkedProfile()],
  )
  const kinds = out.issues.map((i) => i.kind)
  assert.ok(kinds.includes('PROFILE_IN_DUNNING'), 'must be classified as dunning')
  assert.equal(
    kinds.includes('PROFILE_WITHOUT_STRIPE'),
    false,
    'a bounced card must never masquerade as a missing subscription',
  )
  const dunning = out.issues.find((i) => i.kind === 'PROFILE_IN_DUNNING')!
  assert.equal(dunning.userId, 'user-1')
  assert.equal(dunning.subscriptionId, 'sub_1')
  assert.match(dunning.details, /informational/)
})

test('UNPAID is treated the same as past_due', async () => {
  const out = await audit(
    { unpaid: [{ id: 'sub_1', customer: 'cus_1', status: 'unpaid', invoiceStatus: 'open' }] },
    [linkedProfile()],
  )
  const kinds = out.issues.map((i) => i.kind)
  assert.ok(kinds.includes('PROFILE_IN_DUNNING'))
  assert.equal(kinds.includes('PROFILE_WITHOUT_STRIPE'), false)
})

test('dunning still receives the drift checks that remain meaningful', async () => {
  const out = await audit(
    { past_due: [{ id: 'sub_1', customer: 'cus_1', status: 'past_due', invoiceStatus: 'open' }] },
    // Genuinely wrong: the profile points at a different subscription.
    [linkedProfile({ stripe_subscription_id: 'sub_OLD' })],
  )
  const drift = out.issues.find((i) => i.kind === 'FIELD_DRIFT')
  assert.ok(drift, 'real drift must still be reported during dunning')
  assert.match(drift!.details, /stripe_subscription_id/)
})

test('dunning does NOT produce current_period_end drift, because the invoice is unpaid', async () => {
  const out = await audit(
    { past_due: [{ id: 'sub_1', customer: 'cus_1', status: 'past_due', invoiceStatus: 'open' }] },
    // The stored date is the last PAID period, deliberately behind the
    // subscription's advanced period. That is correct, not drift.
    [linkedProfile({ current_period_end: new Date(PERIOD_START * 1000).toISOString() })],
  )
  const drift = out.issues.find((i) => i.kind === 'FIELD_DRIFT')
  assert.equal(drift, undefined, 'a mid-collection family is not drifting')
})

// ── cancelled with paid time remaining ──────────────────────────────────────

test('a CANCELLED profile with paid time left is not an orphan', async () => {
  // Rooted honours the term already paid for: is_pro stays true with a future
  // end date and no live subscription, by design, until the nightly sweep
  // downgrades them. There are 2 such profiles in production today.
  const out = await audit({}, [
    linkedProfile({ subscription_status: 'cancelled', is_pro: true }),
  ])
  assert.deepEqual(out.issues, [])
})

// ── genuine orphan ──────────────────────────────────────────────────────────

test('a genuine orphan still produces PROFILE_WITHOUT_STRIPE', async () => {
  const out = await audit({}, [linkedProfile()])
  assert.equal(out.issues.length, 1)
  assert.equal(out.issues[0].kind, 'PROFILE_WITHOUT_STRIPE')
  assert.equal(out.issues[0].userId, 'user-1')
  assert.match(out.issues[0].details, /no billable subscription/)
})

test('a Stripe subscription with no profile still produces STRIPE_WITHOUT_PROFILE', async () => {
  const out = await audit(
    { active: [{ id: 'sub_stray', customer: 'cus_stray', status: 'active' }] },
    [],
  )
  assert.equal(out.issues.length, 1)
  assert.equal(out.issues[0].kind, 'STRIPE_WITHOUT_PROFILE')
  assert.match(out.issues[0].details, /active/, 'the message reports the real status')
})

test('gift and partner_comp profiles are still exempt from the orphan check', async () => {
  const out = await audit({}, [
    linkedProfile({ id: 'u-gift', plan_type: 'gift' }),
    linkedProfile({ id: 'u-comp', plan_type: 'partner_comp' }),
  ])
  assert.deepEqual(out.issues, [])
})

// ── reporting ───────────────────────────────────────────────────────────────

test('the report counts billable subs and breaks them down by status', async () => {
  const out = await audit(
    {
      active: [
        { id: 'sub_1', customer: 'cus_1', status: 'active' },
        { id: 'sub_2', customer: 'cus_2', status: 'active' },
      ],
      past_due: [{ id: 'sub_3', customer: 'cus_3', status: 'past_due', invoiceStatus: 'open' }],
    },
    [
      linkedProfile({ id: 'u1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }),
      linkedProfile({ id: 'u2', stripe_customer_id: 'cus_2', stripe_subscription_id: 'sub_2' }),
      linkedProfile({ id: 'u3', stripe_customer_id: 'cus_3', stripe_subscription_id: 'sub_3' }),
    ],
  )
  assert.equal(out.stripeBillableCount, 3)
  assert.deepEqual(out.stripeCountsByStatus, { active: 2, past_due: 1 })
  // "how many are actually active" stays answerable after the rename.
  assert.equal(out.stripeCountsByStatus.active, 2)
})
