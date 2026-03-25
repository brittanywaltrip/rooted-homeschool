import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

export async function GET(req: NextRequest) {
  const couponId = req.nextUrl.searchParams.get('coupon_id')
  const affiliateCode = req.nextUrl.searchParams.get('code')?.toUpperCase()
  if (!couponId) return NextResponse.json({ error: 'Missing coupon_id' }, { status: 400 })

  try {
    // If affiliate code provided, look up that specific promo code in Stripe.
    // Otherwise fall back to listing all promo codes for the coupon (admin view).
    let promoCodes: Stripe.PromotionCode[] = []
    if (affiliateCode) {
      const result = await stripe.promotionCodes.list({ code: affiliateCode, limit: 1 })
      promoCodes = result.data
    } else {
      const result = await stripe.promotionCodes.list({ coupon: couponId, limit: 100 })
      promoCodes = result.data
    }

    let totalRedemptions = 0
    let payingCount = 0
    let revenueDriven = 0

    for (const promoCode of promoCodes) {
      totalRedemptions += promoCode.times_redeemed
    }

    const promoIds = new Set(promoCodes.map(p => p.id))

    // Paginate through all active subscriptions to find matches
    let hasMore = true
    let startingAfter: string | undefined
    while (hasMore) {
      const params: Stripe.SubscriptionListParams = { limit: 100, status: 'active' }
      if (startingAfter) params.starting_after = startingAfter
      const subscriptions = await stripe.subscriptions.list(params)

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

      hasMore = subscriptions.has_more
      if (subscriptions.data.length > 0) {
        startingAfter = subscriptions.data[subscriptions.data.length - 1].id
      }
    }

    return NextResponse.json({ totalRedemptions, payingCount, revenueDriven: Math.round(revenueDriven) })
  } catch (err) {
    console.error('[affiliate-stats]', err)
    return NextResponse.json({ totalRedemptions: 0, payingCount: 0, revenueDriven: 0 })
  }
}
