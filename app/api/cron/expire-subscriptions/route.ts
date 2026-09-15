import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sweepExpiredAccess, type SweepClient } from '@/lib/expire-subscriptions'

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

export async function GET(request: Request) {
  // Vercel cron authentication, same shape as the other cron routes.
  if (
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Both rules, and why each is this narrow, are in lib/expire-subscriptions.ts.
  const result = await sweepExpiredAccess(
    supabaseAdmin as unknown as SweepClient,
    new Date(),
    console.log,
    isStripeSubscriptionLive,
  )
  if (!result.ok) {
    console.error('[cron/expire-subscriptions] failed:', result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({
    expired: result.expired,
    ids: result.ids,
    giftsExpired: result.giftsExpired,
    giftIds: result.giftIds,
  })
}
