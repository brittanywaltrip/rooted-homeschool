import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

const PRICE_IDS: Record<string, string> = {
  founding: process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID!,
  standard: process.env.STRIPE_STANDARD_PRICE_ID!,
}

export async function POST(req: NextRequest) {
  // Verify user via Bearer token
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    console.error('[checkout] No authorization header')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    console.error('[checkout] Auth error:', error?.message)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { plan, ref } = body
  console.log('[checkout] plan:', plan, '| userId:', user.id, '| ref:', ref ?? 'none')

  const priceId = PRICE_IDS[plan]
  if (!priceId) {
    console.error('[checkout] Invalid plan or missing price ID for:', plan)
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }
  console.log('[checkout] priceId:', priceId)

  try {
    // If ref code provided, look up the Stripe promotion code to pre-apply
    let discounts: { promotion_code: string }[] | undefined = undefined
    if (ref) {
      try {
        const promoCodes = await stripe.promotionCodes.list({ code: (ref as string).toUpperCase(), active: true, limit: 1 })
        if (promoCodes.data.length > 0) {
          discounts = [{ promotion_code: promoCodes.data[0].id }]
        }
      } catch (e) {
        console.log('[checkout] promo code lookup failed, continuing without discount', e)
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: !discounts,
      ...(discounts ? { discounts } : {}),
      success_url: 'https://www.rootedhomeschoolapp.com/dashboard/welcome',
      cancel_url: 'https://www.rootedhomeschoolapp.com/upgrade',
      customer_email: user.email,
      metadata: { userId: user.id },
    })
    console.log('[checkout] session created:', session.id)
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[checkout] Stripe error:', err)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
