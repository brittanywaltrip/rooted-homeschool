// Monthly integrity check for Stripe → profile linkage.
//
// Compares every active Stripe subscription against the paid profiles in
// Supabase and flags drift in both directions:
//   • STRIPE_WITHOUT_PROFILE — Stripe has an active sub but no profile carries
//     the matching customer/subscription id (user paid but webhook didn't
//     land the linkage).
//   • PROFILE_WITHOUT_STRIPE — profile says subscription_status='active' and
//     plan_type is paid, but Stripe has no active subscription for that
//     customer id (ghost-active, possibly from a cancellation we missed).
//   • FIELD_DRIFT — linkage is present but one of the webhook-owned fields
//     (is_pro, legacy_free, plan_type, current_period_end, …) doesn't match
//     what Stripe reports.
//
// Usage:
//   node --env-file=.env.local scripts/audit-stripe-linkage.ts
//
// Set AUDIT_JSON=1 to emit a JSON report instead of human-friendly text.

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const PAID_PLAN_TYPES = ['founding_family', 'standard', 'monthly', 'gift']

interface ProfileRow {
  id: string
  plan_type: string | null
  subscription_status: string | null
  is_pro: boolean | null
  legacy_free: boolean | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end: string | null
  display_name: string | null
}

interface Issue {
  kind: 'STRIPE_WITHOUT_PROFILE' | 'PROFILE_WITHOUT_STRIPE' | 'FIELD_DRIFT'
  customerId?: string
  subscriptionId?: string
  userId?: string
  details: string
}

async function listActiveStripeSubscriptions(): Promise<Stripe.Subscription[]> {
  const all: Stripe.Subscription[] = []
  for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100 })) {
    all.push(sub)
  }
  for await (const sub of stripe.subscriptions.list({ status: 'trialing', limit: 100 })) {
    all.push(sub)
  }
  return all
}

async function listPaidProfiles(): Promise<ProfileRow[]> {
  const out: ProfileRow[] = []
  let from = 0
  const pageSize = 500
  while (true) {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, plan_type, subscription_status, is_pro, legacy_free, stripe_customer_id, stripe_subscription_id, current_period_end, display_name',
      )
      .or(
        'subscription_status.eq.active,' +
          PAID_PLAN_TYPES.map((p) => `plan_type.eq.${p}`).join(','),
      )
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`profiles read failed: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data as ProfileRow[])
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

function detectFieldDrift(profile: ProfileRow, sub: Stripe.Subscription): string[] {
  const drift: string[] = []
  if (profile.is_pro !== true) drift.push(`is_pro=${profile.is_pro}`)
  if (profile.subscription_status !== 'active') drift.push(`subscription_status=${profile.subscription_status}`)
  if (profile.legacy_free === true) drift.push('legacy_free=true')
  if (profile.stripe_subscription_id !== sub.id) {
    drift.push(`stripe_subscription_id=${profile.stripe_subscription_id} (stripe says ${sub.id})`)
  }
  // Trust Stripe's current_period_end; off-by-more-than-1-day counts as drift.
  const subPeriodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items.data[0]?.current_period_end ??
    null
  if (subPeriodEnd && profile.current_period_end) {
    const stripeMs = subPeriodEnd * 1000
    const profileMs = new Date(profile.current_period_end).getTime()
    if (Math.abs(stripeMs - profileMs) > 24 * 60 * 60 * 1000) {
      drift.push(
        `current_period_end drift (stripe=${new Date(stripeMs).toISOString()} profile=${profile.current_period_end})`,
      )
    }
  } else if (subPeriodEnd && !profile.current_period_end) {
    drift.push('current_period_end missing on profile')
  }
  return drift
}

async function main() {
  console.log('[audit] fetching Stripe subscriptions…')
  const stripeSubs = await listActiveStripeSubscriptions()
  console.log(`[audit] found ${stripeSubs.length} active/trialing Stripe subs`)

  console.log('[audit] fetching paid profiles…')
  const profiles = await listPaidProfiles()
  console.log(`[audit] found ${profiles.length} paid profiles`)

  const profilesByCustomer = new Map<string, ProfileRow>()
  const profilesBySubscription = new Map<string, ProfileRow>()
  for (const p of profiles) {
    if (p.stripe_customer_id) profilesByCustomer.set(p.stripe_customer_id, p)
    if (p.stripe_subscription_id) profilesBySubscription.set(p.stripe_subscription_id, p)
  }
  const stripeCustomerIds = new Set(stripeSubs.map((s) => s.customer as string))

  const issues: Issue[] = []

  for (const sub of stripeSubs) {
    const customerId = sub.customer as string
    const profile = profilesByCustomer.get(customerId) ?? profilesBySubscription.get(sub.id)
    if (!profile) {
      issues.push({
        kind: 'STRIPE_WITHOUT_PROFILE',
        customerId,
        subscriptionId: sub.id,
        details: `active Stripe sub has no profile linked — ${sub.status}, created ${new Date(sub.created * 1000).toISOString()}`,
      })
      continue
    }
    const drift = detectFieldDrift(profile, sub)
    if (drift.length > 0) {
      issues.push({
        kind: 'FIELD_DRIFT',
        customerId,
        subscriptionId: sub.id,
        userId: profile.id,
        details: drift.join('; '),
      })
    }
  }

  for (const profile of profiles) {
    if (!profile.stripe_customer_id) continue
    if (profile.plan_type === 'gift') continue
    if (profile.plan_type === 'partner_comp') continue
    if (!stripeCustomerIds.has(profile.stripe_customer_id)) {
      issues.push({
        kind: 'PROFILE_WITHOUT_STRIPE',
        userId: profile.id,
        customerId: profile.stripe_customer_id,
        details: `profile is ${profile.plan_type}/${profile.subscription_status} but Stripe has no active sub for customer ${profile.stripe_customer_id}`,
      })
    }
  }

  const asJson = process.env.AUDIT_JSON === '1'
  if (asJson) {
    console.log(JSON.stringify({
      stripe_active_count: stripeSubs.length,
      paid_profiles_count: profiles.length,
      issue_count: issues.length,
      issues,
    }, null, 2))
  } else {
    console.log('\n=== Stripe ↔ Profile linkage audit ===')
    console.log(`Stripe active/trialing subs: ${stripeSubs.length}`)
    console.log(`Paid profiles: ${profiles.length}`)
    console.log(`Issues found: ${issues.length}`)
    for (const issue of issues) {
      console.log(`\n[${issue.kind}]`)
      if (issue.userId) console.log(`  userId:         ${issue.userId}`)
      if (issue.customerId) console.log(`  customerId:     ${issue.customerId}`)
      if (issue.subscriptionId) console.log(`  subscriptionId: ${issue.subscriptionId}`)
      console.log(`  details:        ${issue.details}`)
    }
    console.log()
  }

  process.exit(issues.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[audit] fatal error:', err)
  process.exit(2)
})
