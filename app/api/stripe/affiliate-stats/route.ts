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
    // Get promo code redemption count (families reached)
    let totalRedemptions = 0
    if (affiliateCode) {
      const result = await stripe.promotionCodes.list({ code: affiliateCode, limit: 1 })
      for (const pc of result.data) {
        totalRedemptions += pc.times_redeemed
      }
    } else {
      const result = await stripe.promotionCodes.list({ coupon: couponId, limit: 100 })
      for (const pc of result.data) {
        totalRedemptions += pc.times_redeemed
      }
    }

    // Now check invoices for actual paying customers (like the admin payout route does)
    let payingCount = 0
    let revenueDriven = 0
    const countedCustomers = new Set<string>()

    // Paginate through all paid invoices
    let hasMore = true
    let startingAfter: string | undefined
    while (hasMore) {
      const params: Stripe.InvoiceListParams = { limit: 100, status: 'paid' }
      if (startingAfter) params.starting_after = startingAfter
      const invoices = await stripe.invoices.list(params)

      for (const invoice of invoices.data) {
        const invoiceAny = invoice as any
        // Check both discount formats (singular and array)
        const coupon = invoiceAny.discount?.coupon?.id
          ?? invoiceAny.discounts?.[0]?.coupon?.id
          ?? null

        if (coupon === couponId) {
          revenueDriven += (invoice.total ?? 0) / 100
          // Count unique customers for payingCount
          const custId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
          if (custId && !countedCustomers.has(custId)) {
            countedCustomers.add(custId)
            payingCount++
          }
        }
      }

      hasMore = invoices.has_more
      if (invoices.data.length > 0) {
        startingAfter = invoices.data[invoices.data.length - 1].id
      }
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
