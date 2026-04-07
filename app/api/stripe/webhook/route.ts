import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { emailFooterHtml, emailFooterText } from '@/lib/email-footer'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'

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
const MONTHLY_PRICE_ID  = process.env.STRIPE_MONTHLY_PRICE_ID

function planLabel(priceId: string | undefined): string {
  if (priceId === FOUNDING_PRICE_ID) return 'Founding Family ($39/yr)'
  if (priceId === STANDARD_PRICE_ID) return 'Standard ($59/yr)'
  if (priceId === MONTHLY_PRICE_ID)  return 'Monthly ($6.99/mo)'
  return 'Unknown plan'
}

function planType(priceId: string | undefined): string {
  if (priceId === FOUNDING_PRICE_ID) return 'founding_family'
  if (priceId === STANDARD_PRICE_ID) return 'standard'
  if (priceId === MONTHLY_PRICE_ID)  return 'monthly'
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
  const payload: { from: string; to: string; subject: string; text: string; html?: string } = {
    from, to, subject,
    text: text + emailFooterText(),
  }
  if (html) payload.html = html + emailFooterHtml()
  const result = await resend.emails.send(payload)
  if (result.error) console.error('Resend sendEmail error:', result.error)
}


// Helper: find user by email and activate their account
async function activateByEmail(email: string, plan: string, stripeCustomerId: string, sessionId: string): Promise<{ userId: string; firstName: string; wasAlreadyActive: boolean } | null> {
  console.log('[webhook] activateByEmail called — email:', email, 'plan:', plan, 'stripeCustomerId:', stripeCustomerId)

  // Find user by email — paginated search through auth users
  let matchedUser: { id: string; email?: string } | undefined
  let page = 1
  const perPage = 200
  while (true) {
    const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage })
    if (listErr) { console.error('[webhook] FAILED to list users page', page, ':', listErr.message); break }
    if (!users || users.length === 0) break
    const match = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (match) { matchedUser = match; break }
    if (users.length < perPage) break
    page++
  }
  if (!matchedUser) {
    console.error('[webhook] NO USER FOUND for email:', email, 'sessionId:', sessionId)
    await sendEmail(
      ADMIN_EMAIL,
      '⚠️ Payment received but no matching user found',
      `A payment was received but could not be matched to a user.\n\nEmail: ${email}\nSession/Sub: ${sessionId}\n\nPlease manually update this account in Supabase.`
    ).catch(() => {})
    return null
  }

  console.log('[webhook] Found user:', matchedUser.id, 'for email:', email)

  // Check current status for idempotency — if already active, this is a retry
  const { data: currentProfile } = await supabase.from('profiles').select('subscription_status').eq('id', matchedUser.id).maybeSingle()
  const wasAlreadyActive = currentProfile?.subscription_status === 'active'
  if (wasAlreadyActive) {
    console.log('[webhook] profile already active for:', email, '— skipping activation (idempotent retry)')
  }

  const updateData = {
    is_pro: true,
    subscription_status: 'active',
    plan_type: plan,
    stripe_customer_id: stripeCustomerId,
  }
  const { error: updateErr } = await supabase.from('profiles').update(updateData).eq('id', matchedUser.id)
  if (updateErr) {
    console.error('[webhook] FAILED to update profile for:', email, 'userId:', matchedUser.id, 'error:', updateErr.message)
    // Try upsert as fallback
    const { error: upsertErr } = await supabase.from('profiles').upsert({ id: matchedUser.id, ...updateData })
    if (upsertErr) {
      console.error('[webhook] UPSERT ALSO FAILED:', upsertErr.message)
      return null
    }
    console.log('[webhook] upsert fallback succeeded for:', email)
  } else {
    console.log('[webhook] profile updated successfully for:', email, 'plan:', plan)
  }

  // Verify the update stuck
  const { data: verify } = await supabase.from('profiles').select('is_pro, plan_type, subscription_status').eq('id', matchedUser.id).maybeSingle()
  console.log('[webhook] VERIFY after update — is_pro:', verify?.is_pro, 'plan_type:', verify?.plan_type, 'subscription_status:', verify?.subscription_status)

  // Notify admin about fallback activation
  await sendEmail(
    ADMIN_EMAIL,
    `🌱 New subscriber activated via email fallback`,
    `New subscription on Rooted!\n\nEmail: ${email}\nPlan: ${plan}\nUserId: ${matchedUser.id}\nNote: matched via email fallback (no userId in metadata)\n\nRooted is growing! 🌱`
  ).catch(err => console.error('[webhook] admin notify error:', err))

  const { data: profile } = await supabase.from('profiles').select('first_name').eq('id', matchedUser.id).maybeSingle()
  return { userId: matchedUser.id, firstName: profile?.first_name ?? 'friend', wasAlreadyActive }
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

  console.log('[webhook] event received:', event.type, 'id:', event.id)

  // ── checkout.session.completed ─────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const metaUserId = session.metadata?.userId
    const customerEmail = session.customer_details?.email ?? session.customer_email ?? null
    const stripeCustomerId = session.customer as string

    console.log('[webhook] checkout.session.completed — sessionId:', session.id,
      'metaUserId:', metaUserId ?? 'MISSING',
      'email:', customerEmail ?? 'MISSING',
      'stripeCustomerId:', stripeCustomerId
    )

    // ── Handle family gift purchase (one-time payment, not subscription) ──
    if (session.metadata?.type === 'family_gift') {
      const recipientUserId = session.metadata.recipientUserId
      const gifterName = session.metadata.gifterName ?? 'Someone'
      const inviteToken = session.metadata.inviteToken

      if (recipientUserId) {
        // Extend mom's subscription by 12 months
        const { data: recipientProfile } = await supabase
          .from('profiles')
          .select('first_name, current_period_end, is_pro, subscription_status')
          .eq('id', recipientUserId)
          .maybeSingle()

        const currentEnd = recipientProfile?.current_period_end
          ? new Date(recipientProfile.current_period_end)
          : new Date()
        const newEnd = new Date(Math.max(currentEnd.getTime(), Date.now()) + 365 * 24 * 60 * 60 * 1000)

        await supabase.from('profiles').update({
          is_pro: true,
          subscription_status: 'active',
          plan_type: 'gift',
          current_period_end: newEnd.toISOString(),
        }).eq('id', recipientUserId)

        console.log('[webhook] Gift activated for userId:', recipientUserId, 'until:', newEnd.toISOString())

        // Extend all viewer trials for this mom (so viewers keep access)
        await supabase.from('family_invites')
          .update({ trial_ends_at: newEnd.toISOString() })
          .eq('user_id', recipientUserId)
          .eq('is_active', true)

        // Notification for mom
        await supabase.from('family_notifications').insert({
          user_id: recipientUserId,
          type: 'gift',
          actor_name: gifterName,
          message: `${gifterName} gifted you a year of Rooted! 🎁`,
        })

        // Email to mom
        const momEmail = (await supabase.auth.admin.getUserById(recipientUserId)).data.user?.email
        if (momEmail) {
          const momName = recipientProfile?.first_name ?? 'friend'
          await sendResendTemplate(momEmail, TEMPLATES.giftReceived, {
            firstName: momName,
            dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
          }, 'Brittany at Rooted <hello@rootedhomeschoolapp.com>'
          ).catch(err => console.error('[webhook] gift mom email error:', err))
        }

        // Email to gift buyer
        if (customerEmail) {
          const { data: momProfile } = await supabase.from('profiles').select('display_name').eq('id', recipientUserId).maybeSingle()
          const familyNameForEmail = momProfile?.display_name ?? 'The family'
          await sendResendTemplate(customerEmail, TEMPLATES.giftSent, {
            firstName: gifterName,
            familyName: familyNameForEmail,
          }, 'Brittany at Rooted <hello@rootedhomeschoolapp.com>'
          ).catch(err => console.error('[webhook] gift buyer email error:', err))
        }

        // Notify admin
        await sendEmail(
          ADMIN_EMAIL,
          `🎁 Family gift purchased! ${gifterName} gifted a year`,
          `A family gift was purchased!\n\nGifter: ${gifterName}\nEmail: ${customerEmail}\nRecipient userId: ${recipientUserId}\nInvite token: ${inviteToken}\n\n🌿`
        ).catch(err => console.error('[webhook] gift admin email error:', err))
      }

      return NextResponse.json({ received: true })
    }

    // Determine plan from line items
    let plan = 'founding_family' // safe default
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
      const priceId = lineItems.data[0]?.price?.id
      plan = planType(priceId)
      console.log('[webhook] plan determined from line items:', plan, 'priceId:', priceId)
    } catch (e) {
      console.error('[webhook] failed to get line items, defaulting to founding_family:', e)
    }

    let activated = false
    let activatedUserId: string | null = null
    let firstName = 'friend'
    let wasAlreadyActive = false

    // Path 1: use metadata userId
    if (metaUserId) {
      // Idempotency check — read status BEFORE updating
      const { data: existing } = await supabase.from('profiles').select('subscription_status, first_name').eq('id', metaUserId).maybeSingle()
      wasAlreadyActive = existing?.subscription_status === 'active'
      if (wasAlreadyActive) {
        console.log('[webhook] profile already active for metaUserId:', metaUserId, '— idempotent retry, skipping welcome email')
      }

      const updateData = {
        is_pro: true,
        subscription_status: 'active',
        plan_type: plan,
        stripe_customer_id: stripeCustomerId,
      }
      const { error } = await supabase.from('profiles').update(updateData).eq('id', metaUserId)
      if (error) {
        console.error('[webhook] metadata userId update FAILED:', error.message, '— falling back to email')
      } else {
        console.log('[webhook] metadata userId update succeeded for:', metaUserId)
        activated = true
        activatedUserId = metaUserId
        firstName = existing?.first_name ?? 'friend'
      }
    }

    // Path 2: email fallback (always try if path 1 failed or was missing)
    if (!activated && customerEmail) {
      const result = await activateByEmail(customerEmail, plan, stripeCustomerId, session.id)
      if (result) {
        activated = true
        activatedUserId = result.userId
        firstName = result.firstName
        wasAlreadyActive = result.wasAlreadyActive
      }
    }

    if (!activated) {
      console.error('[webhook] CRITICAL: could not activate account — metaUserId:', metaUserId, 'email:', customerEmail, 'sessionId:', session.id)
    }

    // Send emails — but only welcome email on FIRST activation (idempotency)
    if (customerEmail && activated) {
      const { data: prof } = await supabase.from('profiles').select('display_name').eq('stripe_customer_id', stripeCustomerId).maybeSingle()
      const familyName = prof?.display_name ?? 'Unknown Family'
      const activeCount = await getActiveSubCount()
      const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })

      // Always notify admin (idempotent — admin can de-dupe)
      await sendEmail(
        ADMIN_EMAIL,
        `🌱 New ${plan === 'founding_family' ? 'Founding Member' : 'Subscriber'}! ${familyName} just subscribed`,
        `New subscription on Rooted!\n\nFamily: ${familyName}\nEmail: ${customerEmail}\nPlan: ${planLabel(undefined)}\nTime: ${now}\nTotal active subscribers: ${activeCount}\n\nRooted is growing! 🌱`
      ).catch((err) => console.error('[webhook] admin email error:', err))

      // Welcome email — only on first activation, not retries
      if (!wasAlreadyActive) {
        const isFounding = plan === 'founding_family'
        const templateId = isFounding ? TEMPLATES.welcomeFounding : TEMPLATES.welcomeStandard
        await sendResendTemplate(customerEmail, templateId, {
          firstName,
          dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
        }, 'Brittany at Rooted <hello@rootedhomeschoolapp.com>'
        ).catch((err) => console.error('[webhook] welcome email FAILED for:', customerEmail, err))
        console.log('[webhook] welcome email sent to', customerEmail)

        // Log to email_log for audit trail + dedup
        if (activatedUserId) {
          const emailType = isFounding ? 'welcome_founding' : 'welcome_standard'
          await supabase.from('email_log').insert({ user_id: activatedUserId, email_type: emailType }).catch(() => {})
        }
      } else {
        console.log('[webhook] skipped welcome email for', customerEmail, '— already active (retry)')
      }
    }
  }

  // ── customer.subscription.created ────────────────────────────────────────
  if (event.type === 'customer.subscription.created') {
    const sub = event.data.object as Stripe.Subscription
    const customerId = sub.customer as string
    const priceId = sub.items.data[0]?.price?.id
    const plan = planType(priceId)
    console.log('[webhook] subscription.created — customerId:', customerId, 'plan:', plan, 'status:', sub.status)

    if (sub.status === 'active' || sub.status === 'trialing') {
      // Try to update by stripe_customer_id first
      const { data: existing } = await supabase.from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle()
      if (existing) {
        await supabase.from('profiles').update({
          is_pro: true,
          subscription_status: 'active',
          plan_type: plan,
        }).eq('id', existing.id)
        console.log('[webhook] subscription.created — updated existing profile:', existing.id)
      } else {
        // Fallback: look up customer email from Stripe
        try {
          const customer = await stripe.customers.retrieve(customerId)
          if (!customer.deleted && (customer as Stripe.Customer).email) {
            const email = (customer as Stripe.Customer).email!
            console.log('[webhook] subscription.created — no profile with customerId, trying email:', email)
            await activateByEmail(email, plan, customerId, sub.id)
          }
        } catch (e) {
          console.error('[webhook] subscription.created — customer lookup failed:', e)
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
    const customerId = sub.customer as string
    const priceId = sub.items.data[0]?.price.id
    const plan = planType(priceId)
    const isActive = sub.status === 'active'
    console.log('[webhook] subscription.updated — customerId:', customerId, 'plan:', plan, 'status:', sub.status)

    const updateData = {
      is_pro: isActive,
      subscription_status: isActive ? 'active' : sub.status,
      plan_type: isActive ? plan : 'free',
    }

    const { data: existing } = await supabase.from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle()
    if (existing) {
      await supabase.from('profiles').update(updateData).eq('id', existing.id)
      console.log('[webhook] subscription.updated — updated profile:', existing.id)
    } else if (isActive) {
      // No profile with this customer ID — try email lookup
      try {
        const customer = await stripe.customers.retrieve(customerId)
        if (!customer.deleted && (customer as Stripe.Customer).email) {
          const email = (customer as Stripe.Customer).email!
          console.log('[webhook] subscription.updated — no profile with customerId, trying email:', email)
          await activateByEmail(email, plan, customerId, sub.id)
        }
      } catch (e) {
        console.error('[webhook] subscription.updated — customer lookup failed:', e)
      }
    }
  }

  return NextResponse.json({ received: true })
}
