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

const ADMIN_EMAIL = 'garfieldbrittany@gmail.com'
const FOUNDING_PRICE_ID = process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID
const STANDARD_PRICE_ID = process.env.STRIPE_STANDARD_PRICE_ID

function planLabel(priceId: string | undefined): string {
  if (priceId === FOUNDING_PRICE_ID) return 'Founding Family ($39/yr)'
  if (priceId === STANDARD_PRICE_ID) return 'Standard ($59/yr)'
  return 'Unknown plan'
}

function planType(priceId: string | undefined): string {
  if (priceId === FOUNDING_PRICE_ID) return 'founding_family'
  if (priceId === STANDARD_PRICE_ID) return 'standard'
  return 'free'
}

async function getActiveSubCount(): Promise<number> {
  try {
    const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 })
    return subs.data.length
  } catch {
    return 0
  }
}

async function sendEmail(to: string, subject: string, text: string, from = 'Rooted <hello@rootedhomeschoolapp.com>') {
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const result = await resend.emails.send({ from, to, subject, text })
  if (result.error) console.error('Resend sendEmail error:', result.error)
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  // ── checkout.session.completed ─────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.userId
    if (userId) {
      // Determine plan from line items
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
      const priceId = lineItems.data[0]?.price?.id
      const plan = planType(priceId)

      await supabase.from('profiles').update({
        is_pro: true,
        subscription_status: 'active',
        plan_type: plan,
        stripe_customer_id: session.customer as string,
      }).eq('id', userId)

      // Look up family name + first name for emails
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, first_name')
        .eq('id', userId)
        .maybeSingle()

      const familyName    = profile?.display_name ?? 'Unknown Family'
      const firstName     = profile?.first_name ?? 'friend'
      const customerEmail = session.customer_details?.email ?? '—'
      const activeCount   = await getActiveSubCount()
      const now           = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })

      const SIGNATURE = `— Brittany Waltrip\nFounder, Rooted Homeschool App\nhello@rootedhomeschoolapp.com\nrootedhomeschoolapp.com`

      // Notify Brittany
      await sendEmail(
        ADMIN_EMAIL,
        `🌱 New ${plan === 'founding_family' ? 'Founding Member' : 'Subscriber'}! ${familyName} just subscribed`,
        `New subscription on Rooted!\n\nFamily: ${familyName}\nEmail: ${customerEmail}\nPlan: ${planLabel(priceId)}\nTime: ${now}\nTotal active subscribers: ${activeCount}\n\nRooted is growing! 🌱`
      ).catch((err) => console.error("Resend sendEmail error:", err))

      // Thank-you email to the new subscriber
      if (customerEmail !== '—') {
        const isFounding = plan === 'founding_family'
        const subjectLine = isFounding
          ? `Welcome to the Rooted family, ${firstName}! 🌱`
          : `Welcome to Rooted, ${firstName}! 🌱`
        const body = isFounding
          ? `Hi ${firstName},\n\nI just wanted to personally thank you for becoming a Founding Member of Rooted.\n\nYou're one of the first families to believe in what we're building here — and that genuinely means the world to me. Rooted exists because of families like yours.\n\nAs a Founding Member, you've locked in your $39/yr rate forever. While I keep building and improving Rooted, your price will never go up.\n\nI'd love to hear how it's going for your family. Feel free to reply to this email anytime — I personally read every response.\n\nThank you for being here. 🌱\n\n${SIGNATURE}`
          : `Hi ${firstName},\n\nThank you so much for subscribing to Rooted — welcome to the family! 🌱\n\nI'm so glad you're here. Rooted is built for families like yours, and I'm genuinely excited to be a part of your homeschool journey.\n\nIf you ever have questions, ideas, or just want to share how it's going — reply to this email anytime. I personally read every response.\n\nThank you for being here. 🌱\n\n${SIGNATURE}`
        await sendEmail(
          customerEmail,
          subjectLine,
          body,
          'Brittany at Rooted <hello@rootedhomeschoolapp.com>'
        ).catch((err) => console.error("Resend sendEmail error:", err))
      }
    }
  }

  // ── customer.subscription.deleted ─────────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('stripe_customer_id', sub.customer as string)
      .maybeSingle()

    if (profile) {
      const priceId = sub.items.data[0]?.price.id
      await supabase.from('profiles').update({
        is_pro: false,
        subscription_status: 'cancelled',
        plan_type: 'free',
      }).eq('id', profile.id)

      // Look up customer email from Stripe
      let customerEmail = '—'
      try {
        const customer = await stripe.customers.retrieve(sub.customer as string)
        if (!customer.deleted) customerEmail = (customer as Stripe.Customer).email ?? '—'
      } catch { /* best-effort */ }

      const familyName = profile.display_name ?? 'Unknown Family'
      const activeCount = await getActiveSubCount()

      // Calculate membership duration
      const startDate = new Date(sub.created * 1000).toLocaleDateString('en-US', { dateStyle: 'medium' })
      const endDate = sub.canceled_at
        ? new Date(sub.canceled_at * 1000).toLocaleDateString('en-US', { dateStyle: 'medium' })
        : new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })

      await sendEmail(
        ADMIN_EMAIL,
        `💔 Subscription cancelled — ${familyName}`,
        `A subscription was cancelled.\n\nFamily: ${familyName}\nEmail: ${customerEmail}\nPlan: ${planLabel(priceId)}\nMember since: ${startDate}\nCancelled: ${endDate}\n\nRemaining active subscribers: ${activeCount}\n\nConsider reaching out personally to learn why.`
      ).catch((err) => console.error("Resend sendEmail error:", err)) // fire-and-forget
    }
  }

  // ── customer.subscription.updated ─────────────────────────────────────────
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const priceId = sub.items.data[0]?.price.id
    const plan = planType(priceId)
    const isActive = sub.status === 'active'

    await supabase.from('profiles').update({
      is_pro: isActive,
      subscription_status: sub.status,
      plan_type: isActive ? plan : 'free',
    }).eq('stripe_customer_id', sub.customer as string)
  }

  return NextResponse.json({ received: true })
}
