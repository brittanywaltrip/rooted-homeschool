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
  periodEnd: Date
  couponCode: string | null
  // Optional overrides. planType defaults to 'founding_family' — see
  // planTypeForPriceId() for resolving from a Stripe price id instead.
  planType?: LinkedPlanType
  stripeSessionId?: string | null
  supabase?: SupabaseClient
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
    if (field === 'current_period_end' || field === 'subscription_end_date') {
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
  if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
    throw new Error('linkStripeSubscription: valid periodEnd required')
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
    current_period_end: periodEnd.toISOString(),
    subscription_end_date: null as string | null,
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

// Resolves the `current_period_end` timestamp off a subscription, with a
// safe fallback of "one year from now" if Stripe doesn't include it on the
// event (which can happen on partial payloads / trialing subs).
export function periodEndFromSubscription(sub: Stripe.Subscription): Date {
  const raw = sub as unknown as {
    current_period_end?: number | null
    items?: { data?: Array<{ current_period_end?: number | null }> } | null
  }
  const epoch =
    raw.current_period_end ??
    raw.items?.data?.[0]?.current_period_end ??
    null
  if (typeof epoch === 'number' && epoch > 0) return new Date(epoch * 1000)
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
}
