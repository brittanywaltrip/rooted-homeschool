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
  const { plan } = body
  console.log('[checkout] plan:', plan, '| userId:', user.id)

  const priceId = PRICE_IDS[plan]
  if (!priceId) {
    console.error('[checkout] Invalid plan or missing price ID for:', plan)
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }
  console.log('[checkout] priceId:', priceId)

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://www.rootedhomeschoolapp.com/dashboard?upgraded=true',
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
