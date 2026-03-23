import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

export async function GET(req: NextRequest) {
  const couponId = req.nextUrl.searchParams.get('coupon_id')
  if (!couponId) return NextResponse.json({ error: 'Missing coupon_id' }, { status: 400 })

  try {
    const promoCodes = await stripe.promotionCodes.list({ coupon: couponId, limit: 100 })
    let totalRedemptions = 0
    let payingCount = 0
    let revenueDriven = 0

    for (const promoCode of promoCodes.data) {
      totalRedemptions += promoCode.times_redeemed
    }

    const subscriptions = await stripe.subscriptions.list({ limit: 100, status: 'active' })
    const promoIds = new Set(promoCodes.data.map(p => p.id))

    for (const sub of subscriptions.data) {
      const hasMatch = sub.discounts?.some(d => {
        if (typeof d === 'string') return false
        return d.promotion_code && promoIds.has(d.promotion_code as string)
      })
      if (hasMatch) {
        payingCount++
        revenueDriven += (sub.items.data[0]?.price?.unit_amount ?? 0) / 100
      }
    }

    return NextResponse.json({ totalRedemptions, payingCount, revenueDriven: Math.round(revenueDriven) })
  } catch (err) {
    console.error('[affiliate-stats]', err)
    return NextResponse.json({ totalRedemptions: 0, payingCount: 0, revenueDriven: 0 })
  }
}
