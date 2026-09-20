import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

// Lazy, not module scope. `new Stripe(undefined)` THROWS, so building the
// client at import turns a missing credential into a route-load crash that
// fails `next build` during page-data collection. That is what stopped this
// branch deploying to rooted-staging, which has no Stripe key by design.
let _stripe: Stripe | null = null;
function stripeClient(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});
  return _stripe;
}
export async function POST(req: NextRequest) {
  try {
    const { priceId, userId, email } = await req.json()

    // Idempotency key: same user + plan + day = same session
    const idempotencyKey = `checkout-${userId}-${priceId}-${new Date().toDateString()}`

    const session = await stripeClient().checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgraded=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/upgrade`,
      customer_email: email,
      metadata: { userId },
    }, { idempotencyKey })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}
