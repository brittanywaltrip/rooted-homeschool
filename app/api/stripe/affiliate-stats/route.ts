import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Commissioned plans only. Monthly subscriptions intentionally excluded — Brittany's
// policy as of 2026-04-21 is to not pay partner commissions on monthly subs (revisit
// when the partner program scales). If a customer signs up monthly via a partner code,
// that referral counts toward conversion stats but contributes $0 to revenueDriven.
const PLAN_PRICES: Record<string, number> = {
  founding_family: 39,
  standard: 59,
}

const DISCOUNT_MULTIPLIER = 0.85

export async function GET(req: NextRequest) {
  const affiliateCode = req.nextUrl.searchParams.get('code')?.toUpperCase()
  if (!affiliateCode) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 })
  }

  try {
    const { data: referred, error } = await supabase
      .from('profiles')
      .select('is_pro, plan_type, subscription_status')
      .eq('referred_by', affiliateCode)

    if (error) {
      console.error('[affiliate-stats] DB error:', error.message)
      return NextResponse.json({ totalRedemptions: 0, payingCount: 0, revenueDriven: 0 })
    }

    const totalRedemptions = referred?.length ?? 0

    const paying = referred?.filter(
      (p) => p.is_pro && p.subscription_status === 'active'
    ) ?? []
    const payingCount = paying.length

    let revenueDriven = 0
    for (const p of paying) {
      const basePrice = PLAN_PRICES[p.plan_type ?? ''] ?? 0
      revenueDriven += Math.round(basePrice * DISCOUNT_MULTIPLIER * 100) / 100
    }

    return NextResponse.json({
      totalRedemptions,
      payingCount,
      revenueDriven: Math.round(revenueDriven * 100) / 100,
    })
  } catch (err) {
    console.error('[affiliate-stats]', err)
    return NextResponse.json({ totalRedemptions: 0, payingCount: 0, revenueDriven: 0 })
  }
}
