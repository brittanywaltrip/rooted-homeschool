// Stripe ↔ profile linkage audit.
//
// Compares every active Stripe subscription against the paid profiles in
// Supabase and flags drift in both directions. Reused by:
//   • scripts/audit-stripe-linkage.ts (CLI, reads .env.local locally)
//   • app/api/cron/audit-stripe-linkage/route.ts (Vercel cron endpoint)
//
// The function takes the Stripe + Supabase clients as args so each caller
// can wire its own environment — the CLI uses the service role key from
// the local env file, the cron endpoint uses Vercel runtime env.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePaidPeriodEnd } from './paid-through.ts'
import {
  selectSubscriptionInvoiceLine,
  type InvoiceLineLike,
} from './stripe-invoice-line.ts'

const PAID_PLAN_TYPES = ['founding_family', 'standard', 'monthly', 'gift'] as const

export type LinkageIssueKind =
  | 'STRIPE_WITHOUT_PROFILE'
  | 'PROFILE_WITHOUT_STRIPE'
  | 'FIELD_DRIFT'

export interface LinkageIssue {
  kind: LinkageIssueKind
  customerId?: string
  subscriptionId?: string
  userId?: string
  details: string
}

export interface LinkageAuditReport {
  stripeActiveCount: number
  paidProfilesCount: number
  issueCount: number
  issues: LinkageIssue[]
  generatedAt: string
}

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

/**
 * What the writer would have stored for this subscription, judged from the same
 * evidence: the billed line end of a PAID latest invoice.
 *
 * Returns null when the latest invoice is not paid or its line cannot be
 * identified. The audit deliberately does not fall back to older invoices the
 * way the webhook does, because an auditor that cannot prove the expectation
 * should stay silent rather than manufacture a finding.
 */
function expectedPaidThrough(sub: Stripe.Subscription): Date | null {
  const invoice =
    sub.latest_invoice && typeof sub.latest_invoice === 'object'
      ? (sub.latest_invoice as Stripe.Invoice)
      : null
  if (invoice?.status !== 'paid') return null
  const selection = selectSubscriptionInvoiceLine({
    subscriptionId: sub.id,
    subscriptionItemIds: (sub.items?.data ?? []).map((item) => item.id),
    lines:
      invoice.lines?.has_more === true
        ? null
        : ((invoice.lines?.data ?? null) as InvoiceLineLike[] | null),
  })
  return selection.kind === 'found'
    ? resolvePaidPeriodEnd([{ invoiceStatus: 'paid', billedLineEnd: selection.periodEnd }])
    : null
}

async function listActiveStripeSubscriptions(stripe: Stripe): Promise<Stripe.Subscription[]> {
  const all: Stripe.Subscription[] = []
  // latest_invoice is expanded so the audit can judge current_period_end by the
  // same evidence the writer used: a PAID invoice's billed line.
  for await (const sub of stripe.subscriptions.list({
    status: 'active', limit: 100, expand: ['data.latest_invoice'],
  })) {
    all.push(sub)
  }
  for await (const sub of stripe.subscriptions.list({
    status: 'trialing', limit: 100, expand: ['data.latest_invoice'],
  })) {
    all.push(sub)
  }
  return all
}

async function listPaidProfiles(supabase: SupabaseClient): Promise<ProfileRow[]> {
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
    out.push(...(data as ProfileRow[]))
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

function detectFieldDrift(profile: ProfileRow, sub: Stripe.Subscription): string[] {
  const drift: string[] = []
  if (profile.is_pro !== true) drift.push(`is_pro=${profile.is_pro}`)
  if (profile.subscription_status !== 'active') {
    drift.push(`subscription_status=${profile.subscription_status}`)
  }
  if (profile.legacy_free === true) drift.push('legacy_free=true')
  if (profile.stripe_subscription_id !== sub.id) {
    drift.push(`stripe_subscription_id=${profile.stripe_subscription_id} (stripe says ${sub.id})`)
  }
  // profiles.current_period_end means "the date Rooted can PROVE this family
  // paid through". Judge it by that same evidence, not by the subscription's
  // own period field, which advances when Stripe CREATES a renewal invoice
  // rather than when it is paid. Comparing against the subscription field would
  // report a family mid-collection as drift when the stored value is exactly
  // what it should be.
  const expected = expectedPaidThrough(sub)
  if (expected && profile.current_period_end) {
    const profileMs = new Date(profile.current_period_end).getTime()
    if (Math.abs(expected.getTime() - profileMs) > 24 * 60 * 60 * 1000) {
      drift.push(
        `current_period_end drift (paid-through=${expected.toISOString()} profile=${profile.current_period_end})`,
      )
    }
  } else if (expected && !profile.current_period_end) {
    drift.push('current_period_end missing on profile')
  }
  // expected === null means this audit cannot establish a paid-through date
  // from the latest invoice alone. It does not chase older invoices, so it
  // asserts nothing either way rather than reporting drift it cannot prove.
  return drift
}

export async function runStripeLinkageAudit(
  stripe: Stripe,
  supabase: SupabaseClient,
): Promise<LinkageAuditReport> {
  const stripeSubs = await listActiveStripeSubscriptions(stripe)
  const profiles = await listPaidProfiles(supabase)

  const profilesByCustomer = new Map<string, ProfileRow>()
  const profilesBySubscription = new Map<string, ProfileRow>()
  for (const p of profiles) {
    if (p.stripe_customer_id) profilesByCustomer.set(p.stripe_customer_id, p)
    if (p.stripe_subscription_id) profilesBySubscription.set(p.stripe_subscription_id, p)
  }
  const stripeCustomerIds = new Set(stripeSubs.map((s) => s.customer as string))

  const issues: LinkageIssue[] = []

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

  return {
    stripeActiveCount: stripeSubs.length,
    paidProfilesCount: profiles.length,
    issueCount: issues.length,
    issues,
    generatedAt: new Date().toISOString(),
  }
}
