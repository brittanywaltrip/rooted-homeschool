import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Webhook error' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.userId
    if (userId) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription as string)

      await supabase.from('profiles').update({
        is_pro: true,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: subscription.id,
        subscription_status: 'active',
        plan_type: subscription.items.data[0].price.id === process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID ? 'founding_family' : 'standard',
        current_period_end: new Date(subscription.items.data[0].current_period_end * 1000).toISOString(),
      }).eq('id', userId)
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', sub.customer as string)
      .maybeSingle()
    if (profile) {
      await supabase.from('profiles').update({
        is_pro: false,
        subscription_status: 'cancelled',
      }).eq('id', profile.id)
    }
  }

  return NextResponse.json({ received: true })
}
