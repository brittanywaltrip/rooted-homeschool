import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
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

export async function POST() {
  // FIRST statement, before any Stripe construction or provider call.
  if (isBillingDisabled()) {
    console.warn(`[billing] refused: ${billingDisabledReason()}`);
    return NextResponse.json(billingDisabledPayload(), { status: 503 });
  }
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Read-only route. Session refresh writes are not needed here.
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'no_customer' }, { status: 400 })
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://rootedhomeschoolapp.com'

  try {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/dashboard/settings`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('stripeClient().billingPortal.sessions.create failed:', message)
    return NextResponse.json(
      { error: 'stripe_error', message },
      { status: 500 },
    )
  }
}
