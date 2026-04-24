import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Conservative flat commission per paying referral. Matches Brittany's current
// policy of assuming every paying referral used the 15%-off coupon ($39 × 0.85
// = $33.15 net) and paying 20% on that net. Not plan-specific.
//
// TODO: track coupon_used on referrals row so commission math can
// differentiate $33.15 vs $39 per referral.
const NET_PER_PAYING_REFERRAL = 33.15
const COMMISSION_RATE = 0.20
const COMMISSION_PER_PAYING_REFERRAL =
  Math.round(NET_PER_PAYING_REFERRAL * COMMISSION_RATE * 100) / 100 // $6.63

function firstOfMonthISO(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

interface AnonymizedRow {
  id: string
  createdAt: string
  converted: boolean
  commissionNote: string | null
  hasSubscription: boolean
  commissionAmount: number
}

export async function GET(req: NextRequest) {
  const affiliateCode = req.nextUrl.searchParams.get('code')?.toUpperCase()
  if (!affiliateCode) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 })
  }

  try {
    const { data: referrals, error: refErr } = await supabase
      .from('referrals')
      .select('id, user_id, converted, commission_note, stripe_session_id, created_at')
      .ilike('affiliate_code', affiliateCode)
      .order('created_at', { ascending: false })

    if (refErr) {
      console.error('[affiliate-stats] referrals read failed:', refErr.message)
      return NextResponse.json(emptyPayload())
    }

    const referralRows = referrals ?? []
    const payingUserIds = referralRows.filter((r) => r.converted && r.user_id).map((r) => r.user_id!) as string[]
    const subscriptionMap = new Map<string, boolean>()
    if (payingUserIds.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, stripe_subscription_id')
        .in('id', payingUserIds)
      for (const p of profileRows ?? []) {
        subscriptionMap.set(p.id, Boolean(p.stripe_subscription_id))
      }
    }

    const monthStart = firstOfMonthISO()

    const rows: AnonymizedRow[] = referralRows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      converted: Boolean(r.converted),
      commissionNote: r.commission_note ?? null,
      hasSubscription: r.user_id ? subscriptionMap.get(r.user_id) === true : false,
      commissionAmount: r.converted ? COMMISSION_PER_PAYING_REFERRAL : 0,
    }))

    const totalRedemptions = rows.length
    const payingCount = rows.filter((r) => r.converted).length
    const signupsThisMonth = rows.filter((r) => r.createdAt >= monthStart).length
    const payingThisMonth = rows.filter((r) => r.converted && r.createdAt >= monthStart).length
    const commissionEarned = Math.round(payingCount * COMMISSION_PER_PAYING_REFERRAL * 100) / 100
    // `revenueDriven` is kept for back-compat with older UI usages that compute
    // `revenueDriven * 0.20`. With the flat commission model, that expression
    // now equals `commissionEarned`.
    const revenueDriven = Math.round((commissionEarned / COMMISSION_RATE) * 100) / 100

    // Clicks live on the affiliates table as a single all-time counter — there's
    // no timestamped click log, so "this month" can't be derived. Return all-time
    // only and let the UI show a dash for the monthly figure.
    const { data: affiliateRow } = await supabase
      .from('affiliates')
      .select('clicks')
      .ilike('code', affiliateCode)
      .maybeSingle()
    const clicksAllTime = (affiliateRow as { clicks?: number } | null)?.clicks ?? 0

    // Next payout fires on the 1st of next month. "Amount owed" is the
    // commission earned to date minus anything already paid out.
    const { data: payments } = await supabase
      .from('commission_payments')
      .select('amount')
      .ilike('affiliate_code', affiliateCode)
    const paidToDate = (payments ?? []).reduce(
      (sum, p) => sum + Number((p as { amount: number | string }).amount ?? 0),
      0,
    )
    const amountOwed = Math.max(0, Math.round((commissionEarned - paidToDate) * 100) / 100)
    const nextPayoutAt = new Date()
    nextPayoutAt.setMonth(nextPayoutAt.getMonth() + 1, 1)
    nextPayoutAt.setHours(0, 0, 0, 0)

    return NextResponse.json({
      // Legacy fields — preserved for existing UI consumers.
      totalRedemptions,
      payingCount,
      revenueDriven,
      // New aggregate fields.
      commissionEarned,
      commissionPerPayingReferral: COMMISSION_PER_PAYING_REFERRAL,
      clicksAllTime,
      signupsThisMonth,
      payingThisMonth,
      amountOwed,
      nextPayoutAt: nextPayoutAt.toISOString(),
      // Anonymized per-row table. STRICT: no PII. user_id is intentionally
      // omitted; the opaque referrals.id is the only identifier.
      rows,
    })
  } catch (err) {
    console.error('[affiliate-stats]', err)
    return NextResponse.json(emptyPayload())
  }
}

function emptyPayload() {
  const nextPayoutAt = new Date()
  nextPayoutAt.setMonth(nextPayoutAt.getMonth() + 1, 1)
  nextPayoutAt.setHours(0, 0, 0, 0)
  return {
    totalRedemptions: 0,
    payingCount: 0,
    revenueDriven: 0,
    commissionEarned: 0,
    commissionPerPayingReferral: COMMISSION_PER_PAYING_REFERRAL,
    clicksAllTime: 0,
    signupsThisMonth: 0,
    payingThisMonth: 0,
    amountOwed: 0,
    nextPayoutAt: nextPayoutAt.toISOString(),
    rows: [] as AnonymizedRow[],
  }
}
