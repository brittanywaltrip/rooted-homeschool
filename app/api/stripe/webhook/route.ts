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

const ADMIN_EMAIL = 'hello.rootedapp@gmail.com'
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

async function sendEmail(to: string, subject: string, text: string, from = 'Rooted <hello@rootedhomeschoolapp.com>', html?: string) {
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const payload: { from: string; to: string; subject: string; text: string; html?: string } = { from, to, subject, text }
  if (html) payload.html = html
  const result = await resend.emails.send(payload)
  if (result.error) console.error('Resend sendEmail error:', result.error)
}

function foundingWelcomeHtml(firstName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Rooted</title>
</head>
<body style="margin:0;padding:0;background-color:#f8f7f4;font-family:'Georgia',serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f7f4;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding:0 0 32px 0;">
              <div style="background-color:#3d5c42;border-radius:16px;padding:24px 32px;text-align:center;">
                <div style="font-size:36px;margin-bottom:8px;">🌱</div>
                <div style="color:#ffffff;font-size:24px;font-weight:bold;letter-spacing:-0.5px;">Rooted Homeschool</div>
                <div style="color:#a8c5ad;font-size:14px;margin-top:4px;">Founding Family Member</div>
              </div>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background-color:#fefcf9;border-radius:16px;padding:40px;border:1px solid #e8e2d9;">

              <!-- Greeting -->
              <p style="margin:0 0 8px 0;font-size:13px;color:#7a6f65;text-transform:uppercase;letter-spacing:1px;">A personal note</p>
              <h1 style="margin:0 0 24px 0;font-size:28px;color:#2d2926;line-height:1.3;">
                Welcome to the Rooted family, ${firstName}. 🌿
              </h1>

              <p style="margin:0 0 16px 0;font-size:16px;color:#3d3530;line-height:1.7;">
                I'm Brittany — homeschool mom of 2 and the person who built Rooted from scratch because I was tired of feeling disorganized and constantly wondering if we were doing enough.
              </p>

              <p style="margin:0 0 16px 0;font-size:16px;color:#3d3530;line-height:1.7;">
                You just became one of our <strong style="color:#3d5c42;">Founding Members</strong> — one of the very first families to believe in what we're building here. That genuinely means everything to me.
              </p>

              <p style="margin:0 0 32px 0;font-size:16px;color:#3d3530;line-height:1.7;">
                Your $39/yr rate is <strong style="color:#3d5c42;">locked in forever</strong>. No matter how much Rooted grows, your price never increases. That's my promise to you for being here at the beginning. 🎁
              </p>

              <!-- What you get -->
              <div style="background-color:#f0f7f0;border-radius:12px;padding:24px;margin-bottom:32px;border:1px solid #c8dfc9;">
                <p style="margin:0 0 16px 0;font-size:13px;color:#5c7f63;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">✨ As a Founding Member you get</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0;font-size:15px;color:#2d2926;">🌱 &nbsp;Unlimited photos &amp; full memory history</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:15px;color:#2d2926;">📅 &nbsp;Finish Line curriculum pacing</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:15px;color:#2d2926;">✨ &nbsp;AI Family Update — share with grandparents</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:15px;color:#2d2926;">🎓 &nbsp;AI Graduation Letter</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:15px;color:#2d2926;">⭐ &nbsp;Exclusive Founding Member badge in your Garden</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:15px;color:#2d2926;">🔒 &nbsp;Your $39/yr price locked in forever</td>
                  </tr>
                </table>
              </div>

              <!-- Get started steps -->
              <p style="margin:0 0 16px 0;font-size:16px;font-weight:bold;color:#2d2926;">Here's where to start 👇</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e2d9;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="36" style="font-size:20px;vertical-align:top;padding-top:2px;">1️⃣</td>
                        <td style="font-size:15px;color:#3d3530;line-height:1.6;"><strong>Set up your curriculum</strong><br>Go to Plan → add your curriculum for each child. Rooted will auto-schedule lessons across your school week.</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #e8e2d9;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="36" style="font-size:20px;vertical-align:top;padding-top:2px;">2️⃣</td>
                        <td style="font-size:15px;color:#3d3530;line-height:1.6;"><strong>Check off your first lesson</strong><br>Open Today and tap the circle next to a lesson. Watch your Garden grow its first leaf. 🍃</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="36" style="font-size:20px;vertical-align:top;padding-top:2px;">3️⃣</td>
                        <td style="font-size:15px;color:#3d3530;line-height:1.6;"><strong>Log a memory</strong><br>Tap + Log something to save a field trip, book, or moment. These are the things you'll want to look back on.</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <a href="https://rootedhomeschoolapp.com/dashboard"
                       style="display:inline-block;background-color:#3d5c42;color:#ffffff;font-size:16px;font-weight:bold;padding:16px 40px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;">
                      Open Rooted →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Personal close -->
              <div style="border-top:1px solid #e8e2d9;padding-top:24px;">
                <p style="margin:0 0 12px 0;font-size:15px;color:#3d3530;line-height:1.7;">
                  I'd genuinely love to hear how it goes for your family. Hit reply on this email anytime — I read every one.
                </p>
                <p style="margin:0;font-size:15px;color:#3d3530;line-height:1.7;">
                  From our family to yours — welcome home. 🌿
                </p>
                <p style="margin:16px 0 0 0;font-size:15px;color:#5c7f63;font-weight:bold;">
                  — Brittany, founder &amp; homeschool mom
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 0 0 0;">
              <p style="margin:0;font-size:13px;color:#7a6f65;">Rooted Homeschool · rootedhomeschoolapp.com</p>
              <p style="margin:4px 0 0 0;font-size:13px;color:#7a6f65;">Questions? Reply to this email or reach us at hello@rootedhomeschoolapp.com</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`
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
    console.log('[webhook] checkout.session.completed fired',
      'sessionId:', session.id,
      'userId:', session.metadata?.userId ?? 'MISSING',
      'email:', session.customer_details?.email ?? 'none'
    )
    if (userId) {
      // Determine plan from line items
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
      const priceId = lineItems.data[0]?.price?.id
      const plan = planType(priceId)

      await supabase.from('profiles').update({
        is_pro: true,
        subscription_status: plan === 'founding_family' ? 'founding' : 'standard',
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
        if (isFounding) {
          await sendEmail(
            customerEmail,
            subjectLine,
            `Hi ${firstName}, welcome to Rooted! You're a Founding Member — your $39/yr is locked forever. Open the app at rootedhomeschoolapp.com/dashboard. — Brittany`,
            'Brittany at Rooted <hello@rootedhomeschoolapp.com>',
            foundingWelcomeHtml(firstName)
          ).catch((err) => console.error("Resend sendEmail error:", err))
        } else {
          await sendEmail(
            customerEmail,
            subjectLine,
            `Hi ${firstName},\n\nThank you so much for subscribing to Rooted — welcome to the family! 🌱\n\nI'm so glad you're here. Rooted is built for families like yours, and I'm genuinely excited to be a part of your homeschool journey.\n\nIf you ever have questions, ideas, or just want to share how it's going — reply to this email anytime. I personally read every response.\n\nThank you for being here. 🌱\n\n${SIGNATURE}`,
            'Brittany at Rooted <hello@rootedhomeschoolapp.com>'
          ).catch((err) => console.error("Resend sendEmail error:", err))
        }
      }
    }

    if (!userId) {
      const customerEmail = session.customer_details?.email
      console.log('[webhook] no userId in metadata, trying email fallback for:', customerEmail)
      if (customerEmail) {
        const { data: { users } } = await supabase.auth.admin.listUsers()
        const matchedUser = users?.find(u => u.email === customerEmail)
        if (matchedUser) {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
          const priceId = lineItems.data[0]?.price?.id
          const plan = planType(priceId)
          await supabase.from('profiles').update({
            is_pro: true,
            subscription_status: plan === 'founding_family' ? 'founding' : 'standard',
            plan_type: plan,
            stripe_customer_id: session.customer as string,
          }).eq('id', matchedUser.id)
          console.log('[webhook] fallback succeeded: updated', customerEmail, 'to', plan)

          // Still send the welcome email using fallback path
          const { data: profile } = await supabase
            .from('profiles')
            .select('display_name, first_name')
            .eq('id', matchedUser.id)
            .maybeSingle()
          const firstName = profile?.first_name ?? 'friend'
          const isFounding = plan === 'founding_family'
          if (isFounding) {
            await sendEmail(
              customerEmail,
              `Welcome to the Rooted family, ${firstName}! 🌱`,
              `Hi ${firstName}, welcome to Rooted! You're a Founding Member — your $39/yr is locked forever. Open the app at rootedhomeschoolapp.com/dashboard. — Brittany`,
              'Brittany at Rooted <hello@rootedhomeschoolapp.com>',
              foundingWelcomeHtml(firstName)
            ).catch(err => console.error('[webhook] fallback email error:', err))
          } else {
            await sendEmail(
              customerEmail,
              `Welcome to Rooted, ${firstName}! 🌱`,
              `Hi ${firstName},\n\nThank you so much for subscribing to Rooted — welcome to the family! 🌱\n\nFeel free to reply anytime. I personally read every response.\n\nThank you for being here. 🌱\n\n— Brittany Waltrip\nFounder, Rooted Homeschool\nhello@rootedhomeschoolapp.com`,
              'Brittany at Rooted <hello@rootedhomeschoolapp.com>'
            ).catch(err => console.error('[webhook] fallback email error:', err))
          }
        } else {
          console.error('[webhook] PAYMENT MISSED — no user found for email:', customerEmail, 'sessionId:', session.id)
          // Alert Brittany so she can fix manually
          await sendEmail(
            'hello.rootedapp@gmail.com',
            '⚠️ Payment received but no matching user found',
            `A payment was received but could not be matched to a user.\n\nEmail: ${customerEmail}\nSession: ${session.id}\n\nPlease manually update this account in Supabase.`
          ).catch(() => {})
        }
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
      subscription_status: isActive ? (plan === 'founding_family' ? 'founding' : 'standard') : sub.status,
      plan_type: isActive ? plan : 'free',
    }).eq('stripe_customer_id', sub.customer as string)
  }

  return NextResponse.json({ received: true })
}
