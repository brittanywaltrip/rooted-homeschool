import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  sweepExpiredAccess,
  type SweepClient,
  type SubscriptionSnapshot,
} from '@/lib/expire-subscriptions'
import {
  type CollectionState,
  type InvoiceStatus,
  type RefundState,
} from '@/lib/paid-through'
import { classifyRefund } from '@/lib/invoice-refund'
import {
  selectSubscriptionInvoiceLine,
  type InvoiceLineLike,
} from '@/lib/stripe-invoice-line'

/**
 * Nightly sweep that ends access for subscriptions whose paid term is over.
 *
 * Why this exists: when a family cancels an annual plan partway through,
 * Rooted honours the term they already paid for (see the
 * customer.subscription.deleted branch in app/api/stripe/webhook/route.ts).
 * That leaves profiles sitting at is_pro = true with subscription_status
 * 'cancelled' and a subscription_end_date in the future. Nothing in the
 * Stripe event stream fires again for those subscriptions, because Stripe
 * already considers them finished, so the downgrade has to be swept for.
 *
 * Deliberately narrow. It only ever touches rows that are ALL of:
 *   - subscription_status = 'cancelled'   (Stripe told us they cancelled)
 *   - is_pro = true                       (not already downgraded)
 *   - subscription_end_date < now         (their paid term has run out)
 *
 * An active subscriber can never match, because a live subscription is
 * status 'active'. A refunded cancellation can never match either, because
 * the webhook already set is_pro = false and stamped the end date at the
 * moment of the refund.
 *
 * A second rule (September 2026) ends a gifted year that has run out; a gift
 * with a live Stripe subscription can never match. Both rules live in
 * lib/expire-subscriptions.ts, where they are tested.
 */
export const dynamic = 'force-dynamic'

/**
 * Only the gift rule asks this, and only for a gift row that still carries a
 * subscription id. A subscription that is canceled, expired before it started,
 * or gone from Stripe is over; any other status counts as live, and an error
 * is "cannot confirm", so nobody is downgraded on a guess.
 */
async function isStripeSubscriptionLive(subscriptionId: string): Promise<boolean | null> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  try {
    const stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' })
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    return !(sub.status === 'canceled' || sub.status === 'incomplete_expired')
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number })
    if (code.code === 'resource_missing' || code.statusCode === 404) return false
    console.error('[cron/expire-subscriptions] Stripe check failed for', subscriptionId, err)
    return null
  }
}

/**
 * Rule 3's view of Stripe: the subscription's current status and the end of the
 * term it was paid through. Returns null whenever Stripe cannot be asked or
 * cannot answer, which the sweep treats as "leave this family alone".
 *
 * Deliberately separate from isStripeSubscriptionLive above: that one answers a
 * yes/no for the gift rule and maps a missing subscription to "not live", while
 * rule 3 SYNCHRONISES state and so must never act on anything short of an
 * explicit answer from Stripe. A subscription Stripe cannot find is inconclusive
 * here, not cancelled.
 *
 * It reports what rule 3 needs to answer "what was PAID for", and deliberately
 * does NOT report the subscription's current_period_end. Stripe advances that
 * field when it CREATES the renewal invoice, not when the invoice is paid, so
 * reading it as a paid-through date hands a family whose card was declined a
 * free term. lib/paid-through.ts does the classifying; this only gathers.
 *
 * The billed period comes from the invoice line that belongs to this
 * subscription, chosen deterministically by lib/stripe-invoice-line.ts, never
 * from lines.data[0] and never from invoice.period_start/period_end, which
 * describe the PREVIOUS cycle. When the right line cannot be identified the
 * dates are null and rule 3 leaves the family alone.
 */
function snapshotOf(sub: Stripe.Subscription): SubscriptionSnapshot {
  const invoice =
    sub.latest_invoice && typeof sub.latest_invoice === 'object'
      ? (sub.latest_invoice as Stripe.Invoice)
      : null

  // A truncated line list could hide a second candidate and make an ambiguous
  // invoice look unambiguous, so a paged one is treated as unreadable.
  const linesTruncated = invoice?.lines?.has_more === true
  const selection = selectSubscriptionInvoiceLine({
    subscriptionId: sub.id,
    subscriptionItemIds: (sub.items?.data ?? []).map((item) => item.id),
    lines: linesTruncated
      ? null
      : ((invoice?.lines?.data ?? null) as InvoiceLineLike[] | null),
  })

  if (invoice && selection.kind === 'ambiguous') {
    console.warn(
      '[cron/expire-subscriptions] could not identify the billed line for',
      sub.id, '-', selection.reason, '- leaving this family alone',
    )
  }

  return {
    status: sub.status,
    latestInvoiceId: invoice?.id ?? null,
    latestInvoiceStatus: (invoice?.status ?? null) as InvoiceStatus | null,
    nextPaymentAttempt:
      typeof invoice?.next_payment_attempt === 'number' && invoice.next_payment_attempt > 0
        ? new Date(invoice.next_payment_attempt * 1000).toISOString()
        : null,
    // An absent next attempt is not proof that collection ended, so the
    // corroborating subscription state is carried explicitly.
    collectionState: (sub.status === 'canceled' || sub.status === 'incomplete_expired'
      ? 'terminated'
      : 'live') as CollectionState,
    linePeriodStart:
      selection.kind === 'found' ? selection.periodStart?.toISOString() ?? null : null,
    linePeriodEnd:
      selection.kind === 'found' ? selection.periodEnd?.toISOString() ?? null : null,
  }
}

/**
 * Rule 3's view of Stripe for the whole run, in one listing instead of one API
 * call per paid subscriber.
 *
 * Why a listing is as safe as retrieving each subscription: the sweep only ever
 * acts on an id that IS in the returned map AND carries a terminal status. An id
 * the listing did not return is inconclusive and its family is left alone, which
 * is exactly what a failed retrieve produced before. So a truncated page, a
 * mid-listing error or a subscription Stripe simply did not hand back can never
 * cause a cancellation to be recorded, only skipped.
 *
 * A partial map is therefore returned rather than discarded on error: every
 * entry in it came from Stripe directly and is definitive on its own, and every
 * id missing from it is treated as unknown. null is reserved for "could not ask
 * Stripe at all", which makes rule 3 sit the whole run out.
 *
 * status: 'all' is deliberate. Listing only the cancelled statuses would be
 * cheaper, but then an active subscriber and an unreachable one would look
 * identical (both absent), and the distinction between "Stripe says they are
 * fine" and "Stripe did not answer" is the thing that keeps this conservative.
 */
async function getStripeSubscriptionSnapshots(
  subscriptionIds: string[],
): Promise<Map<string, SubscriptionSnapshot> | null> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null

  const wanted = new Set(subscriptionIds)
  const found = new Map<string, SubscriptionSnapshot>()
  if (wanted.size === 0) return found

  let pages = 0
  try {
    const stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' })
    // latest_invoice is expanded so rule 3 can tell a PAID period from an
    // advanced-but-unpaid one, still in a single listing rather than one
    // retrieve per subscriber.
    for await (const sub of stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      expand: ['data.latest_invoice'],
    })) {
      if (!wanted.has(sub.id)) continue
      found.set(sub.id, snapshotOf(sub))
      if (found.size === wanted.size) break
    }
    pages++
  } catch (err) {
    console.error(
      '[cron/expire-subscriptions] Stripe listing failed after',
      found.size, 'of', wanted.size,
      'subscriptions; the rest are treated as unknown and left alone.',
      err,
    )
    // Nothing found before the failure means we never really reached Stripe.
    if (found.size === 0) return null
  }

  // How many carried a readable invoice matters as much as how many were
  // found: rule 3 classifies from the invoice, so if the expand ever stopped
  // working every family would be left alone and the run would look identical
  // to a healthy "nothing due". This counter is what tells those two apart.
  let withReadableInvoice = 0
  for (const snap of found.values()) {
    if (snap.latestInvoiceStatus !== null) withReadableInvoice++
  }
  console.log(
    '[cron/expire-subscriptions] Stripe listing resolved',
    found.size, 'of', wanted.size, 'subscriptions in one pass', pages ? '' : '(partial)',
    '-', withReadableInvoice, 'with a readable invoice',
  )
  return found
}

/**
 * Invoice-scoped refund evidence, called LAZILY by rule 3 and only for
 * candidates that already passed the terminal-status gate. Today that is zero
 * subscriptions, and in normal operation a handful, so the run stays at one
 * listing plus a couple of lookups.
 *
 * Every failure path is 'unknown', never 'none'. A lookup that succeeded and
 * found nothing refunded is evidence; a lookup that failed is not, and the
 * classifier turns 'unknown' into "leave this family alone".
 */
async function resolveInvoiceRefundState(invoiceId: string | null): Promise<RefundState> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !invoiceId) return classifyRefund({ lookupSucceeded: false, charge: null })
  try {
    const stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' })
    const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 })
    const paid = payments.data.find((p) => p.status === 'paid')
    if (!paid) return classifyRefund({ lookupSucceeded: true, charge: null })

    const piRef = paid.payment?.payment_intent
    const piId = typeof piRef === 'string' ? piRef : piRef?.id ?? null
    if (!piId) return classifyRefund({ lookupSucceeded: false, charge: null })

    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] })
    const charge =
      pi.latest_charge && typeof pi.latest_charge === 'object'
        ? (pi.latest_charge as Stripe.Charge)
        : null
    if (!charge) return classifyRefund({ lookupSucceeded: false, charge: null })

    return classifyRefund({
      lookupSucceeded: true,
      charge: { amount: charge.amount, amountRefunded: charge.amount_refunded },
    })
  } catch (err) {
    console.error('[cron/expire-subscriptions] refund lookup failed for invoice', invoiceId, err)
    return classifyRefund({ lookupSucceeded: false, charge: null })
  }
}

export async function GET(request: Request) {
  // Vercel cron authentication, same shape as the other cron routes.
  if (
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // All three rules, and why each is this narrow, are in
  // lib/expire-subscriptions.ts.
  //
  // Rule 3 (reconcile against Stripe) writes only when RECONCILE_LIVE is
  // exactly 'true'. Until then every run reports what it WOULD change and
  // changes nothing, including rules 1 and 2, because dryRun suppresses the
  // whole sweep. ?dryRun=1 forces a dry run regardless, for checking by hand.
  const forcedDryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  const dryRun = forcedDryRun || process.env.RECONCILE_LIVE !== 'true'

  const result = await sweepExpiredAccess(
    supabaseAdmin as unknown as SweepClient,
    new Date(),
    console.log,
    isStripeSubscriptionLive,
    {
      dryRun,
      getSubscriptionSnapshots: getStripeSubscriptionSnapshots,
      getInvoiceRefundState: resolveInvoiceRefundState,
    },
  )
  if (!result.ok) {
    console.error('[cron/expire-subscriptions] failed:', result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({
    dryRun: result.dryRun,
    expired: result.expired,
    ids: result.ids,
    giftsExpired: result.giftsExpired,
    giftIds: result.giftIds,
    reconciled: result.reconciled,
    reconciledIds: result.reconciledIds,
    planned: result.planned,
  })
}
