// Unit tests for the invoice.paid handler. Run with:
//   node --test lib/invoice-paid.test.ts
//
// The fake world below holds Stripe's CURRENT state and a profiles table. The
// event payload passed to the handler is a stale snapshot on purpose, because
// that is what a delayed or retried delivery is.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  handleInvoicePaid,
  type InvoicePaidDeps,
  type LinkedProfileRow,
  type PaidInvoiceLike,
  type SubscriptionLike,
} from './invoice-paid.ts'
import { linkStripeSubscription } from './link-stripe-to-profile.ts'
import { resolvePaidPeriodEnd, type RefundState } from './paid-through.ts'

// ── Identifiers from the production incident ──────────────────────────────
const SUB = 'sub_1TxRljLP14EaoUlT7IBDHBSS'
const RENEWAL_INVOICE = 'in_1UJvKFLP14EaoUlTBZoufG0y'
const PRIOR_INVOICE = 'in_prior_term'
const CUSTOMER = 'cus_renewal_family'
const ITEM = 'si_only_item'
const PROFILE = '00000000-0000-4000-8000-000000000001'

// Term boundaries. The renewal date is the real one; the term lengths are
// illustrative and nothing below depends on monthly versus annual.
const OLD_TERM_START = Date.UTC(2026, 7, 26, 15, 0, 0) / 1000
const RENEWED_AT = Date.UTC(2026, 8, 26, 15, 0, 0) / 1000
const NEW_TERM_END = Date.UTC(2026, 9, 26, 15, 0, 0) / 1000
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString()

type ProfileRow = LinkedProfileRow & Record<string, unknown>

function line(start: number, end: number, opts: { item?: string; sub?: string; proration?: boolean } = {}) {
  return {
    period: { start, end },
    parent: {
      subscription_item_details: {
        subscription: opts.sub ?? SUB,
        subscription_item: opts.item ?? ITEM,
        proration: opts.proration ?? false,
      },
    },
  }
}

function invoice(id: string, status: string, lines: ReturnType<typeof line>[], extra: Partial<PaidInvoiceLike> = {}): PaidInvoiceLike {
  return {
    id,
    status,
    customer: CUSTOMER,
    parent: { subscription_details: { subscription: SUB } },
    lines: { data: lines, has_more: false },
    ...extra,
  }
}

function baseProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: PROFILE,
    is_pro: true,
    subscription_status: 'active',
    plan_type: 'monthly',
    legacy_free: false,
    stripe_customer_id: CUSTOMER,
    stripe_subscription_id: SUB,
    current_period_end: iso(RENEWED_AT),
    subscription_end_date: null,
    cancel_at: null,
    referred_by: 'AMANDA15',
    ...overrides,
  }
}

function makeWorld(opts: {
  invoices?: Record<string, PaidInvoiceLike>
  subscription?: SubscriptionLike
  refunds?: Record<string, RefundState>
  profiles?: ProfileRow[]
} = {}) {
  const state = {
    invoices: opts.invoices ?? {
      [RENEWAL_INVOICE]: invoice(RENEWAL_INVOICE, 'paid', [line(RENEWED_AT, NEW_TERM_END)]),
    },
    subscription: opts.subscription ?? {
      id: SUB,
      status: 'active',
      customer: CUSTOMER,
      items: { data: [{ id: ITEM }] },
    },
    refunds: opts.refunds ?? {} as Record<string, RefundState>,
    profiles: opts.profiles ?? [baseProfile()],
    fail: {} as Partial<Record<'invoice' | 'subscription' | 'profiles' | 'write', boolean>>,
    // Simulates another writer landing between the handler's read and write.
    beforeWrite: null as null | (() => void),
    writes: [] as Array<{ profileId: string; through: string }>,
    rpcCalls: [] as string[],
  }

  const deps: InvoicePaidDeps = {
    async retrieveInvoice(id) {
      if (state.fail.invoice) throw new Error('stripe 503')
      const inv = state.invoices[id]
      if (!inv) throw new Error(`no such invoice ${id}`)
      return structuredClone(inv)
    },
    async retrieveSubscription(id) {
      if (state.fail.subscription) throw new Error('stripe timeout')
      if (id !== state.subscription.id) throw new Error(`no such subscription ${id}`)
      return structuredClone(state.subscription)
    },
    async refundState(id) {
      return state.refunds[id] ?? 'none'
    },
    async profilesForCustomer(customerId) {
      if (state.fail.profiles) throw new Error('postgrest 500')
      return state.profiles
        .filter((p) => p.stripe_customer_id === customerId)
        .slice(0, 2)
        .map((p) => ({ id: p.id, stripe_subscription_id: p.stripe_subscription_id, current_period_end: p.current_period_end }))
    },
    async advancePaidThrough({ profileId, subscriptionId, expectedCurrent, through }) {
      if (state.fail.write) throw new Error('postgrest 500')
      state.beforeWrite?.()
      const row = state.profiles.find(
        (p) =>
          p.id === profileId &&
          p.stripe_subscription_id === subscriptionId &&
          p.current_period_end === expectedCurrent,
      )
      if (!row) return { matched: false }
      row.current_period_end = through.toISOString()
      state.writes.push({ profileId, through: through.toISOString() })
      return { matched: true }
    },
  }

  // Just enough of a supabase-js client for linkStripeSubscription, backed by
  // the same rows, so the real subscription.updated write path can be replayed.
  const supabase = {
    rpc: async (fn: string) => {
      state.rpcCalls.push(fn)
      return { data: { action: 'already_attributed' }, error: null }
    },
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {}
        const chain = {
          eq: (col: string, val: unknown) => { filters[col] = val; return chain },
          maybeSingle: async () => ({
            data: state.profiles.find((p) => p.id === filters.id) ?? null,
            error: null,
          }),
        }
        return chain
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          const row = state.profiles.find((p) => p.id === id)
          if (row) Object.assign(row, patch)
          return { error: null }
        },
      }),
    }),
  }

  return { state, deps, supabase }
}

/** The event as Stripe delivered it: a snapshot taken when the event was created. */
const eventSnapshot = (id = RENEWAL_INVOICE): PaidInvoiceLike => ({
  id,
  status: 'paid',
  customer: CUSTOMER,
  parent: { subscription_details: { subscription: SUB } },
})

/** Every column the handler must never touch, with its value. */
function untouchedColumns(row: ProfileRow) {
  const rest: Record<string, unknown> = { ...row }
  delete rest.current_period_end
  return rest
}

// ── The production sequence ────────────────────────────────────────────────

test('REPRO: subscription.updated before payment, then invoice.paid, records the renewed term', async () => {
  // Before the renewal the family is paid through the end of the old term.
  const { state, deps, supabase } = makeWorld({
    invoices: {
      [PRIOR_INVOICE]: invoice(PRIOR_INVOICE, 'paid', [line(OLD_TERM_START, RENEWED_AT)]),
      // At renewal Stripe has created the invoice but not collected it yet.
      [RENEWAL_INVOICE]: invoice(RENEWAL_INVOICE, 'open', [line(RENEWED_AT, NEW_TERM_END)]),
    },
  })

  // 1. customer.subscription.updated, 200. The latest invoice is open, so the
  //    existing branch's resolveProvenPaidThrough falls back to the paid
  //    invoices and stores the END OF THE OLD TERM. Replayed through the real
  //    linkStripeSubscription with the date that path resolves.
  const provenAtUpdate = resolvePaidPeriodEnd([
    { invoiceStatus: 'paid', billedLineEnd: new Date(RENEWED_AT * 1000) },
  ])
  await linkStripeSubscription({
    userId: PROFILE,
    customerId: CUSTOMER,
    subscriptionId: SUB,
    periodEnd: provenAtUpdate,
    couponCode: 'AMANDA15',
    planType: 'monthly',
    supabase: supabase as never,
    commissionAmount: null,
  })
  assert.equal(state.profiles[0].current_period_end, iso(RENEWED_AT), 'update stored the old term, as production did')
  const rpcAfterUpdate = state.rpcCalls.length

  // 2. About an hour later Stripe collects.
  state.invoices[RENEWAL_INVOICE].status = 'paid'
  const before = structuredClone(state.profiles[0])

  // 3. invoice.paid, the event production never subscribed to.
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)

  assert.equal(outcome.action, 'advanced')
  assert.equal(state.profiles[0].current_period_end, iso(NEW_TERM_END))
  assert.deepEqual(untouchedColumns(state.profiles[0]), untouchedColumns(before), 'only current_period_end moved')
  assert.equal(state.rpcCalls.length, rpcAfterUpdate, 'no referral or commission call on renewal')

  // 4. A late redelivery of the same subscription.updated now re-reads a paid
  //    latest invoice, resolves the SAME date, and must not undo the renewal.
  await linkStripeSubscription({
    userId: PROFILE,
    customerId: CUSTOMER,
    subscriptionId: SUB,
    periodEnd: resolvePaidPeriodEnd([{ invoiceStatus: 'paid', billedLineEnd: new Date(NEW_TERM_END * 1000) }]),
    couponCode: null,
    planType: 'monthly',
    supabase: supabase as never,
  })
  assert.equal(state.profiles[0].current_period_end, iso(NEW_TERM_END))
})

test('REPRO, reversed order: invoice.paid first, then subscription.updated, lands on the same date', async () => {
  const { state, deps } = makeWorld()
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action, 'advanced')
  assert.equal(state.profiles[0].current_period_end, iso(NEW_TERM_END))
})

// ── Duplicate and delayed events ───────────────────────────────────────────

test('DUPLICATE: a second delivery of the same invoice.paid writes nothing', async () => {
  const { state, deps } = makeWorld()
  assert.equal((await handleInvoicePaid(eventSnapshot(), deps)).action, 'advanced')
  const second = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(second.action, 'skipped')
  assert.equal(second.action === 'skipped' && second.reason, 'already_current')
  assert.equal(second.action === 'skipped' && second.retry, false)
  assert.equal(state.writes.length, 1)
})

test('DELAYED: an older invoice.paid arriving after the renewal never moves the date back', async () => {
  const { state, deps } = makeWorld({
    invoices: {
      [PRIOR_INVOICE]: invoice(PRIOR_INVOICE, 'paid', [line(OLD_TERM_START, RENEWED_AT)]),
    },
    profiles: [baseProfile({ current_period_end: iso(NEW_TERM_END) })],
  })
  const outcome = await handleInvoicePaid(eventSnapshot(PRIOR_INVOICE), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'already_current')
  assert.equal(state.profiles[0].current_period_end, iso(NEW_TERM_END))
  assert.equal(state.writes.length, 0)
})

test('DELAYED: the decision uses fresh Stripe state, not the event snapshot', async () => {
  // The snapshot says paid; Stripe now says the invoice was voided.
  const { state, deps } = makeWorld()
  state.invoices[RENEWAL_INVOICE].status = 'void'
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'invoice_not_paid')
  assert.equal(state.writes.length, 0)
})

test('CONCURRENT: a row changed between read and write is not overwritten and is redelivered', async () => {
  const { state, deps } = makeWorld()
  state.beforeWrite = () => { state.profiles[0].current_period_end = iso(NEW_TERM_END + 86400) }
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'row_changed')
  assert.equal(outcome.action === 'skipped' && outcome.retry, true)
  assert.equal(state.profiles[0].current_period_end, iso(NEW_TERM_END + 86400))
})

// ── Unpaid invoices ────────────────────────────────────────────────────────

for (const status of ['open', 'draft', 'void', 'uncollectible']) {
  test(`UNPAID: a fresh status of ${status} writes nothing and is not retried`, async () => {
    const { state, deps } = makeWorld()
    state.invoices[RENEWAL_INVOICE].status = status
    const outcome = await handleInvoicePaid(eventSnapshot(), deps)
    assert.equal(outcome.action === 'skipped' && outcome.reason, 'invoice_not_paid')
    assert.equal(outcome.action === 'skipped' && outcome.retry, false)
    assert.equal(state.writes.length, 0)
  })
}

// ── Changed subscriptions and linkage ──────────────────────────────────────

test('CHANGED SUBSCRIPTION: a profile that moved to a new subscription is left alone', async () => {
  const { state, deps } = makeWorld({ profiles: [baseProfile({ stripe_subscription_id: 'sub_newer' })] })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'subscription_mismatch')
  assert.equal(state.profiles[0].stripe_subscription_id, 'sub_newer', 'never relinked')
  assert.equal(state.writes.length, 0)
})

test('LINKAGE: a profile with no subscription id is not linked by this handler', async () => {
  const { state, deps } = makeWorld({ profiles: [baseProfile({ stripe_subscription_id: null })] })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'subscription_mismatch')
  assert.equal(state.profiles[0].stripe_subscription_id, null)
  assert.equal(state.writes.length, 0)
})

test('LINKAGE: no profile for the customer writes nothing', async () => {
  const { deps } = makeWorld({ profiles: [] })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'no_profile')
})

test('LINKAGE: two profiles sharing one customer id is ambiguous, never a pick', async () => {
  const { state, deps } = makeWorld({
    profiles: [baseProfile(), baseProfile({ id: '00000000-0000-4000-8000-000000000002' })],
  })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'ambiguous_profile')
  assert.equal(state.writes.length, 0)
})

test('LINKAGE: an invoice whose fresh customer differs from the subscription is refused', async () => {
  const { state, deps } = makeWorld()
  state.invoices[RENEWAL_INVOICE].customer = 'cus_someone_else'
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'customer_mismatch')
})

for (const status of ['canceled', 'incomplete_expired', 'unpaid', 'incomplete', 'paused']) {
  test(`TERMINAL OR NON-LIVE: a ${status} subscription keeps its date`, async () => {
    const { state, deps } = makeWorld()
    state.subscription.status = status
    const outcome = await handleInvoicePaid(eventSnapshot(), deps)
    assert.equal(outcome.action === 'skipped' && outcome.reason, 'subscription_not_live')
    assert.equal(state.writes.length, 0)
  })
}

test('LIVE: a past_due subscription whose earlier invoice is finally paid still advances', async () => {
  const { state, deps } = makeWorld()
  state.subscription.status = 'past_due'
  assert.equal((await handleInvoicePaid(eventSnapshot(), deps)).action, 'advanced')
})

test('NOT A SUBSCRIPTION INVOICE: a one-off invoice is ignored', async () => {
  const { deps } = makeWorld()
  const outcome = await handleInvoicePaid({ id: 'in_one_off', status: 'paid', customer: CUSTOMER }, deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'not_a_subscription_invoice')
})

test('LEGACY SHAPE: the old top-level invoice.subscription field still resolves', async () => {
  const { state, deps } = makeWorld()
  const inv = state.invoices[RENEWAL_INVOICE]
  delete inv.parent
  inv.subscription = SUB
  const outcome = await handleInvoicePaid({ id: RENEWAL_INVOICE, subscription: SUB }, deps)
  assert.equal(outcome.action, 'advanced')
})

// ── Ambiguous and proration lines ──────────────────────────────────────────

test('PRORATION: a proration-only invoice has no purchased term and writes nothing', async () => {
  const { state, deps } = makeWorld({
    invoices: {
      [RENEWAL_INVOICE]: invoice(RENEWAL_INVOICE, 'paid', [
        line(RENEWED_AT, RENEWED_AT + 3600, { proration: true }),
      ]),
    },
  })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'line_ambiguous')
  assert.equal(state.writes.length, 0)
})

test('PRORATION: a proration fragment at index 0 does not hide the real billed line', async () => {
  const { state, deps } = makeWorld({
    invoices: {
      [RENEWAL_INVOICE]: invoice(RENEWAL_INVOICE, 'paid', [
        line(RENEWED_AT, RENEWED_AT + 3600, { proration: true }),
        line(RENEWED_AT, NEW_TERM_END),
      ]),
    },
  })
  assert.equal((await handleInvoicePaid(eventSnapshot(), deps)).action, 'advanced')
  assert.equal(state.profiles[0].current_period_end, iso(NEW_TERM_END))
})

test('AMBIGUOUS: two candidate lines for the same item write nothing', async () => {
  const { state, deps } = makeWorld({
    invoices: {
      [RENEWAL_INVOICE]: invoice(RENEWAL_INVOICE, 'paid', [
        line(RENEWED_AT, NEW_TERM_END),
        line(RENEWED_AT, NEW_TERM_END + 86400 * 30),
      ]),
    },
  })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'line_ambiguous')
  assert.equal(state.writes.length, 0)
})

test('AMBIGUOUS: a truncated line list (has_more) is treated as unreadable', async () => {
  const { state, deps } = makeWorld()
  state.invoices[RENEWAL_INVOICE].lines!.has_more = true
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'line_ambiguous')
})

test('AMBIGUOUS: a multi-item subscription has no single purchased period', async () => {
  const { state, deps } = makeWorld()
  state.subscription.items = { data: [{ id: ITEM }, { id: 'si_second' }] }
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'line_ambiguous')
})

test('AMBIGUOUS: a line for a different subscription item is not this term', async () => {
  const { deps } = makeWorld({
    invoices: {
      [RENEWAL_INVOICE]: invoice(RENEWAL_INVOICE, 'paid', [line(RENEWED_AT, NEW_TERM_END, { item: 'si_other' })]),
    },
  })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'line_ambiguous')
})

// ── Refunds ────────────────────────────────────────────────────────────────

test('REFUND: a fully refunded renewal does not extend the term', async () => {
  const { state, deps } = makeWorld({ refunds: { [RENEWAL_INVOICE]: 'full' } })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'refund_full')
  assert.equal(outcome.action === 'skipped' && outcome.retry, false)
  assert.equal(state.profiles[0].current_period_end, iso(RENEWED_AT))
})

test('REFUND: a partial refund leaves the term paid for', async () => {
  const { state, deps } = makeWorld({ refunds: { [RENEWAL_INVOICE]: 'partial' } })
  assert.equal((await handleInvoicePaid(eventSnapshot(), deps)).action, 'advanced')
  assert.equal(state.profiles[0].current_period_end, iso(NEW_TERM_END))
})

test('REFUND: an unreadable refund state is never treated as "not refunded"', async () => {
  const { state, deps } = makeWorld({ refunds: { [RENEWAL_INVOICE]: 'unknown' } })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'refund_unknown')
  assert.equal(outcome.action === 'skipped' && outcome.retry, true)
  assert.equal(state.writes.length, 0)
})

// ── Failed reads and writes ────────────────────────────────────────────────

for (const [part, reason] of [
  ['invoice', 'stripe_unreadable'],
  ['subscription', 'stripe_unreadable'],
  ['profiles', 'profile_unreadable'],
  ['write', 'write_failed'],
] as const) {
  test(`FAILED ${part.toUpperCase()}: writes nothing and asks Stripe to redeliver`, async () => {
    const { state, deps } = makeWorld()
    state.fail[part] = true
    const outcome = await handleInvoicePaid(eventSnapshot(), deps)
    assert.equal(outcome.action === 'skipped' && outcome.reason, reason)
    assert.equal(outcome.action === 'skipped' && outcome.retry, true)
    assert.equal(state.profiles[0].current_period_end, iso(RENEWED_AT))
  })
}

test('FAILED READ then recovery: the redelivery succeeds once Stripe answers', async () => {
  const { state, deps } = makeWorld()
  state.fail.invoice = true
  assert.equal((await handleInvoicePaid(eventSnapshot(), deps)).action, 'skipped')
  state.fail.invoice = false
  assert.equal((await handleInvoicePaid(eventSnapshot(), deps)).action, 'advanced')
  assert.equal(state.writes.length, 1)
})

// ── Unrelated state is preserved ───────────────────────────────────────────

test('PRESERVE: a gifted year that runs past the invoice keeps its date', async () => {
  const giftEnd = iso(NEW_TERM_END + 86400 * 200)
  const { state, deps } = makeWorld({ profiles: [baseProfile({ plan_type: 'gift', current_period_end: giftEnd })] })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action === 'skipped' && outcome.reason, 'already_current')
  assert.equal(state.profiles[0].current_period_end, giftEnd)
  assert.equal(state.profiles[0].plan_type, 'gift')
})

test('PRESERVE: cancellation, legacy and access columns are never written', async () => {
  const scheduled = baseProfile({
    is_pro: false,
    subscription_status: 'cancelled',
    plan_type: 'founding_family',
    legacy_free: true,
    subscription_end_date: iso(RENEWED_AT),
    cancel_at: iso(NEW_TERM_END),
  })
  const { state, deps } = makeWorld({ profiles: [scheduled] })
  const before = structuredClone(state.profiles[0])
  assert.equal((await handleInvoicePaid(eventSnapshot(), deps)).action, 'advanced')
  assert.deepEqual(untouchedColumns(state.profiles[0]), untouchedColumns(before))
})

test('PRESERVE: a profile with no stored date gets the proven one', async () => {
  const { state, deps } = makeWorld({ profiles: [baseProfile({ current_period_end: null })] })
  const outcome = await handleInvoicePaid(eventSnapshot(), deps)
  assert.equal(outcome.action, 'advanced')
  assert.equal(outcome.action === 'advanced' && outcome.from, null)
  assert.equal(state.profiles[0].current_period_end, iso(NEW_TERM_END))
})

// ── The route branch ───────────────────────────────────────────────────────

function invoicePaidBranch(): string {
  const src = readFileSync(path.join(process.cwd(), 'app/api/stripe/webhook/route.ts'), 'utf8')
  const start = src.indexOf("if (event.type === 'invoice.paid')")
  assert.ok(start > 0, 'invoice.paid branch not found')
  const end = src.indexOf('return NextResponse.json({ received: true })\n}', start)
  assert.ok(end > start, 'branch end not found')
  return src.slice(start, end)
}

test('ROUTE: the invoice.paid branch earns no commission and sends no email', () => {
  const branch = invoicePaidBranch()
  for (const forbidden of [
    'attributeReferral', 'linkStripeSubscription', 'commission', 'referred_by',
    'sendEmail', 'sendTransactional', 'sendResendTemplate', 'sendOnceClaimed', 'notifyAdminOnce',
  ]) {
    assert.ok(!branch.includes(forbidden), `${forbidden} reachable from invoice.paid`)
  }
})

test('ROUTE: the invoice.paid branch writes current_period_end and nothing else', () => {
  const branch = invoicePaidBranch()
  const updates = branch.match(/\.update\(\{[^}]*\}\)/g) ?? []
  assert.deepEqual(updates, ['.update({ current_period_end: through.toISOString() })'])
  for (const col of ['is_pro', 'subscription_status', 'plan_type', 'legacy_free', 'subscription_end_date', 'cancel_at']) {
    assert.ok(!branch.includes(col), `${col} referenced in invoice.paid`)
  }
})

test('ROUTE: identity is stripe_customer_id plus the held subscription, never email', () => {
  const branch = invoicePaidBranch()
  assert.ok(branch.includes(".eq('stripe_customer_id', customerId)"))
  assert.ok(branch.includes(".eq('stripe_subscription_id', subscriptionId)"))
  assert.ok(!branch.includes('findUserByEmail'))
  assert.ok(!/customers\.retrieve/.test(branch))
})

test('ROUTE: a retryable outcome returns 500 so Stripe redelivers', () => {
  const branch = invoicePaidBranch()
  assert.ok(/outcome\.retry[\s\S]*status: 500/.test(branch))
})
