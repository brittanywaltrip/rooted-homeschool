// One-time backfill for referrals.commission_amount. Safe to re-run — rows
// that already have a commission_amount are skipped unless BACKFILL_FORCE=1
// is set.
//
// For every converted referral:
//   1. Look up the referred user's stripe_subscription_id from profiles
//      (falling back to looking up the Stripe customer by auth email if the
//      profile has no subscription id stored).
//   2. Fetch the subscription's latest invoice.
//   3. commission_amount = 20% × invoice.amount_paid (post-coupon).
//   4. UPDATE the referrals row.
//
// Run with:
//   node --env-file=.env.local scripts/backfill-commission-amounts.ts
// Or via the npm script:
//   npm run backfill:commission-amounts

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

import { commissionFromCents } from '../lib/commission.ts'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const FORCE = process.env.BACKFILL_FORCE === '1'

interface ReferralRow {
  id: string
  affiliate_code: string | null
  user_id: string | null
  stripe_session_id: string | null
  converted: boolean | null
  commission_amount: number | string | null
}

interface ProfileRow {
  id: string
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
}

async function commissionForSubscription(subscriptionId: string): Promise<number | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    const latest = (sub as unknown as { latest_invoice?: string | Stripe.Invoice | null }).latest_invoice
    const invoiceId = typeof latest === 'string' ? latest : latest?.id ?? null
    if (invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId)
      const paid = (invoice as unknown as { amount_paid?: number | null }).amount_paid ?? null
      const viaPaid = commissionFromCents(paid)
      if (viaPaid !== null) return viaPaid
      const due = (invoice as unknown as { amount_due?: number | null }).amount_due ?? null
      const viaDue = commissionFromCents(due)
      if (viaDue !== null) return viaDue
    }
    const unitAmount = sub.items?.data?.[0]?.price?.unit_amount ?? null
    return commissionFromCents(unitAmount)
  } catch (err) {
    console.error('  ↳ subscription lookup failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function commissionForCustomer(customerId: string): Promise<number | null> {
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 })
    const active = subs.data.find((s) => s.status === 'active' || s.status === 'trialing') ?? subs.data[0]
    if (!active) return null
    return await commissionForSubscription(active.id)
  } catch (err) {
    console.error('  ↳ customer subscription list failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function findCustomerIdByEmail(email: string): Promise<string | null> {
  try {
    const customers = await stripe.customers.list({ email, limit: 1 })
    return customers.data[0]?.id ?? null
  } catch (err) {
    console.error('  ↳ customer email lookup failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function main() {
  console.log('[backfill] scanning referrals with converted=true…')
  const { data: allReferrals, error } = await supabase
    .from('referrals')
    .select('id, affiliate_code, user_id, stripe_session_id, converted, commission_amount')
    .eq('converted', true)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[backfill] failed to read referrals:', error.message)
    process.exit(2)
  }

  const referrals = (allReferrals ?? []) as ReferralRow[]
  const pending = FORCE
    ? referrals
    : referrals.filter((r) => r.commission_amount === null || r.commission_amount === undefined)
  console.log(`[backfill] ${pending.length} of ${referrals.length} need backfill (FORCE=${FORCE})`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const ref of pending) {
    const tag = `[${ref.affiliate_code ?? '?'}][${ref.id.slice(0, 8)}]`
    if (!ref.user_id) {
      console.warn(`${tag} skipped — no user_id`)
      skipped++
      continue
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, stripe_subscription_id, stripe_customer_id')
      .eq('id', ref.user_id)
      .maybeSingle<ProfileRow>()

    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(ref.user_id)
    const email = authUser?.email ?? null

    let commission: number | null = null
    if (profile?.stripe_subscription_id) {
      commission = await commissionForSubscription(profile.stripe_subscription_id)
    }
    if (commission === null && profile?.stripe_customer_id) {
      commission = await commissionForCustomer(profile.stripe_customer_id)
    }
    if (commission === null && email) {
      const customerId = await findCustomerIdByEmail(email)
      if (customerId) commission = await commissionForCustomer(customerId)
    }

    if (commission === null) {
      console.warn(`${tag} ${email ?? 'no-email'} — could not compute commission, leaving NULL`)
      failed++
      continue
    }

    const { error: updateErr } = await supabase
      .from('referrals')
      .update({ commission_amount: commission })
      .eq('id', ref.id)
    if (updateErr) {
      console.error(`${tag} UPDATE failed:`, updateErr.message)
      failed++
      continue
    }

    console.log(`${tag} ${email ?? 'no-email'} → commission_amount = $${commission.toFixed(2)}`)
    updated++
  }

  console.log(`\n[backfill] done — updated=${updated} skipped=${skipped} failed=${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[backfill] fatal error:', err)
  process.exit(2)
})
