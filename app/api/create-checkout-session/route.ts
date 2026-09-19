import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { isBillingDisabled, billingDisabledReason, billingDisabledPayload } from "@/lib/billing-guard";

// Lazy, not module scope. `new Stripe(undefined)` THROWS, so building the
// client at import turned a missing credential into a route-load crash
// instead of the explicit 503 below. Nothing constructs until the guard
// has already returned.
let _stripe: Stripe | null = null;
function stripeClient(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });
  return _stripe;
}

export async function POST(req: NextRequest) {
  // FIRST statement, before any Stripe construction or provider call.
  if (isBillingDisabled()) {
    console.warn(`[billing] refused: ${billingDisabledReason()}`);
    return NextResponse.json(billingDisabledPayload(), { status: 503 });
  }
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
