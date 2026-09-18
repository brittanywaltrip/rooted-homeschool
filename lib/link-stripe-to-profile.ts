import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { attributeReferral } from './referrals.ts'

// Every Stripe price id we sell maps to exactly one plan_type value. New plans
// must add a mapping here or they fall back to 'founding_family' — matches the
// webhook's historical "safe default".
const PRICE_TO_PLAN: Record<string, LinkedPlanType> = Object.fromEntries(
  (
    [
      [process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID, 'founding_family'],
      [process.env.STRIPE_STANDARD_PRICE_ID, 'standard'],
      [process.env.STRIPE_MONTHLY_PRICE_ID, 'monthly'],
    ] as const
  ).filter((pair): pair is readonly [string, LinkedPlanType] => Boolean(pair[0])),
)

export type LinkedPlanType = 'founding_family' | 'standard' | 'monthly'

export interface LinkStripeSubscriptionOpts {
  userId: string
  customerId: string
  subscriptionId: string
  /**
   * The date this subscription is PROVEN paid through, or null when Rooted
   * could not prove one. Null is a real answer, not a failure: a date is only
   * ever derived from an invoice that was actually paid (see
   * resolvePaidPeriodEnd), and this used to be a manufactured now + 365 days
   * whenever Stripe's payload did not carry a period, which was 12x too long
   * for a monthly plan.
   *
   * A null date never withholds access. Entitlement comes from the payment
   * event; this field only records when the paid term ends.
   */
  periodEnd: Date | null
  couponCode: string | null
  // Optional overrides. planType defaults to 'founding_family' — see
  // planTypeForPriceId() for resolving from a Stripe price id instead.
  planType?: LinkedPlanType
  // Stripe's scheduled-cancellation date, or null when nothing is scheduled.
  // Advisory only: it never affects is_pro, so it cannot gate access. Passed on
  // every event so a resumed subscription clears it by the same write that set
  // it. See cancelAtFromSubscription().
  cancelAt?: Date | null
  stripeSessionId?: string | null
  supabase?: SupabaseClient
  // Per-referral commission in dollars, computed from the actual Stripe
  // charge. Passed through to attributeReferral so the ledger row records
  // the real number instead of falling back to the flat $6.63 default.
  commissionAmount?: number | null
}

export interface LinkResult {
  action: 'linked' | 'already_linked'
  userId: string
  subscriptionId: string
}

// Fields the webhook owns on the profiles row. Writing every field on every
// successful subscription event means the profile is always fully linked —
// if a previous event dropped any field, the next one repairs it.
const LINKED_FIELDS = [
  'is_pro',
  'subscription_status',
  'plan_type',
  'legacy_free',
  'stripe_customer_id',
  'stripe_subscription_id',
  'current_period_end',
  'subscription_end_date',
  'cancel_at',
] as const

interface LinkedRow {
  is_pro: boolean | null
  subscription_status: string | null
  plan_type: string | null
  legacy_free: boolean | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end: string | null
  subscription_end_date: string | null
  cancel_at: string | null
}

function defaultSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Given a Stripe price id, return the plan_type string we store. Unknown
// prices fall back to 'founding_family' because founding is the only tier
// actively sold during the current window (see CLAUDE.md).
export function planTypeForPriceId(priceId: string | null | undefined): LinkedPlanType {
  if (!priceId) return 'founding_family'
  return PRICE_TO_PLAN[priceId] ?? 'founding_family'
}

function rowMatches(row: LinkedRow, desired: Record<(typeof LINKED_FIELDS)[number], unknown>): boolean {
  for (const field of LINKED_FIELDS) {
    const current = row[field] as unknown
    const next = desired[field]
    // Normalize timestamps so Postgres's ISO form compares equal to whatever
    // shape the caller passed (Date or ISO string).
    if (
      field === 'current_period_end' ||
      field === 'subscription_end_date' ||
      field === 'cancel_at'
    ) {
      const a = current ? new Date(current as string).getTime() : null
      const b = next ? new Date(next as string).getTime() : null
      if (a !== b) return false
      continue
    }
    if (current !== next) return false
  }
  return true
}

// Single UPDATE that writes every field owned by the Stripe webhook. Safe to
// run twice — the second call detects that all fields already match and
// returns 'already_linked' without issuing a write.
export async function linkStripeSubscription(
  opts: LinkStripeSubscriptionOpts,
): Promise<LinkResult> {
  const supabase = opts.supabase ?? defaultSupabase()
  const { userId, customerId, subscriptionId, periodEnd, couponCode } = opts
  const planType = opts.planType ?? 'founding_family'

  if (!userId) throw new Error('linkStripeSubscription: userId required')
  if (!customerId) throw new Error('linkStripeSubscription: customerId required')
  if (!subscriptionId) throw new Error('linkStripeSubscription: subscriptionId required')
  // periodEnd is deliberately NOT required. An unprovable paid-through date
  // must not block a family who has just paid; it is stored as null and logged
  // so the gap is visible rather than papered over with an invented date.
  const usablePeriodEnd =
    periodEnd instanceof Date && !Number.isNaN(periodEnd.getTime()) ? periodEnd : null
  if (!usablePeriodEnd) {
    console.warn(
      '[link-stripe] no provable paid-through date for',
      subscriptionId,
      '— storing current_period_end: null and granting access on the payment evidence',
    )
  }

  const logCtx = { userId, customerId, subscriptionId, planType }
  console.log('[link-stripe] start', logCtx)

  const desired = {
    is_pro: true,
    subscription_status: 'active',
    plan_type: planType,
    legacy_free: false,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    current_period_end: (usablePeriodEnd ? usablePeriodEnd.toISOString() : null) as string | null,
    subscription_end_date: null as string | null,
    cancel_at: (opts.cancelAt ? opts.cancelAt.toISOString() : null) as string | null,
  }

  // Idempotency: read once, skip the write if every field already matches.
  const { data: currentRow, error: readErr } = await supabase
    .from('profiles')
    .select(LINKED_FIELDS.join(','))
    .eq('id', userId)
    .maybeSingle<LinkedRow>()

  if (readErr) {
    console.error('[link-stripe] read failed', { ...logCtx, error: readErr.message })
    throw new Error(`link-stripe read failed: ${readErr.message}`)
  }

  if (currentRow && rowMatches(currentRow, desired)) {
    console.log('[link-stripe] already_linked — no write', logCtx)
    if (couponCode) {
      await attributeReferral({
        supabase,
        userId,
        affiliateCode: couponCode,
        stripeSessionId: opts.stripeSessionId ?? subscriptionId,
        converted: true,
        commissionAmount: opts.commissionAmount ?? null,
      })
    }
    return { action: 'already_linked', userId, subscriptionId }
  }

  // Retry once on transient failures (network, deadlock, RLS-eval hiccup).
  let lastErr: string | null = null
  for (const attempt of [1, 2] as const) {
    const { error: updateErr } = await supabase
      .from('profiles')
      .update(desired)
      .eq('id', userId)

    if (!updateErr) {
      console.log('[link-stripe] linked', { ...logCtx, attempt })
      if (couponCode) {
        await attributeReferral({
          supabase,
          userId,
          affiliateCode: couponCode,
          stripeSessionId: opts.stripeSessionId ?? subscriptionId,
          converted: true,
          commissionAmount: opts.commissionAmount ?? null,
        })
      }
      return { action: 'linked', userId, subscriptionId }
    }

    lastErr = updateErr.message
    console.error('[link-stripe] update attempt failed', {
      ...logCtx,
      attempt,
      error: lastErr,
    })
    if (attempt === 1) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  console.error('[link-stripe] CRITICAL — update failed twice, throwing', {
    ...logCtx,
    error: lastErr,
  })
  throw new Error(`linkStripeSubscription failed for ${userId}: ${lastErr}`)
}

// Extracts the coupon id attached to a Stripe subscription. Defensive of both
// the legacy `discount` shape and the newer `discounts` array.
export function couponIdFromSubscription(sub: Stripe.Subscription): string | null {
  const raw = sub as unknown as {
    discount?: { coupon?: { id?: string } | null } | null
    discounts?: Array<string | { coupon?: { id?: string } | null }> | null
  }
  if (raw.discount?.coupon?.id) return raw.discount.coupon.id
  if (Array.isArray(raw.discounts)) {
    for (const entry of raw.discounts) {
      if (typeof entry === 'string') continue
      if (entry?.coupon?.id) return entry.coupon.id
    }
  }
  return null
}

// periodEndFromSubscription was DELETED here.
//
// It read the subscription's own current_period_end and, when Stripe's payload
// carried none, returned `now + 365 days`. Two things were wrong with it. The
// subscription field advances when Stripe CREATES a renewal invoice rather than
// when that invoice is paid, so it describes an unpaid period during dunning;
// and the fallback manufactured a year out of nothing, which is 12x too long
// for a monthly plan and silently absorbed the API change that moved
// current_period_end onto the subscription items.
//
// A date now comes only from an invoice that was actually paid. See
// resolvePaidPeriodEnd in lib/paid-through.ts. The function is gone rather than
// merely fallback-free so nobody can re-fatten it.

// Stripe's view of a scheduled cancellation, or null when nothing is scheduled.
//
// The billing portal is configured to cancel at period end, so a self-serve
// cancellation leaves the subscription `active` and only sets
// cancel_at_period_end/cancel_at. Nothing in the status tells us it is winding
// down, which is why this is read separately.
//
// Reads cancel_at first (Stripe sets it when cancel_at_period_end flips true)
// and falls back to the subscription's period end. Deliberately NO invented
// date: a wrong cancellation date is worse than none at all. Note this is the
// one place the subscription's own period field is still read, and it is safe
// here because it answers "when is the cancellation scheduled", not "what was
// paid for".
export function cancelAtFromSubscription(sub: Stripe.Subscription): Date | null {
  const raw = sub as unknown as {
    cancel_at_period_end?: boolean | null
    cancel_at?: number | null
    current_period_end?: number | null
    items?: { data?: Array<{ current_period_end?: number | null }> } | null
  }
  if (!raw.cancel_at_period_end && !raw.cancel_at) return null
  const epoch =
    raw.cancel_at ??
    raw.current_period_end ??
    raw.items?.data?.[0]?.current_period_end ??
    null
  return typeof epoch === 'number' && epoch > 0 ? new Date(epoch * 1000) : null
}
