import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { COMMISSION_RATE, LEGACY_COMMISSION_PER_PAYING, displayCommission } from '@/lib/commission'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Each referral row's commission now comes from the webhook at conversion
// time (stored in referrals.commission_amount). Pre-migration rows fall
// back to the legacy flat rate exposed by lib/commission.ts.
const COMMISSION_PER_PAYING_REFERRAL = LEGACY_COMMISSION_PER_PAYING

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
      .select('id, user_id, converted, commission_note, commission_amount, stripe_session_id, created_at')
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
      commissionAmount: displayCommission({
        converted: Boolean(r.converted),
        commission_amount: (r as { commission_amount?: number | string | null }).commission_amount ?? null,
      }),
    }))

    const totalRedemptions = rows.length
    const payingCount = rows.filter((r) => r.converted).length
    const signupsThisMonth = rows.filter((r) => r.createdAt >= monthStart).length
    const payingThisMonth = rows.filter((r) => r.converted && r.createdAt >= monthStart).length
    const commissionEarned =
      Math.round(rows.reduce((sum, r) => sum + r.commissionAmount, 0) * 100) / 100
    // `revenueDriven` is kept for back-compat with older UI usages that compute
    // `revenueDriven * 0.20`. With per-row commissions, this inverts to the
    // implied gross that generated the paid commissions.
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
