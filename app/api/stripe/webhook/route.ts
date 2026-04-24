import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { emailFooterHtml, emailFooterText } from '@/lib/email-footer'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'
import { affiliateCodeForStripeCoupon } from '@/lib/referrals'
import {
  couponIdFromSubscription,
  linkStripeSubscription,
  periodEndFromSubscription,
  planTypeForPriceId,
  type LinkedPlanType,
} from '@/lib/link-stripe-to-profile'
import { commissionFromCents } from '@/lib/commission'

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
  if (priceId === FOUNDING_PRICE_ID) return 'Rooted+ Founding Family ($39/yr)'
  if (priceId === STANDARD_PRICE_ID) return 'Rooted+ ($59/yr)'
  if (priceId === MONTHLY_PRICE_ID)  return 'Rooted+ Monthly ($6.99/mo)'
  return 'Unknown plan'
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


// Find a user by email. Returns the auth user id plus some cached profile
// fields the webhook needs for idempotent email decisions. Writes nothing —
// linkStripeSubscription() owns every subscription write so there is a single
// place to audit field-level linkage.
async function findUserByEmail(
  email: string,
  sourceEventId: string,
): Promise<{ userId: string; firstName: string; wasAlreadyActive: boolean } | null> {
  let matchedUser: { id: string; email?: string } | undefined
  let page = 1
  const perPage = 200
  while (true) {
    const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage })
    if (listErr) { console.error('[webhook] listUsers page', page, 'failed:', listErr.message); break }
    if (!users || users.length === 0) break
    const match = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (match) { matchedUser = match; break }
    if (users.length < perPage) break
    page++
  }
  if (!matchedUser) {
    console.error('[webhook] NO USER FOUND for email:', email, 'source:', sourceEventId)
    await sendEmail(
      ADMIN_EMAIL,
      '⚠️ Payment received but no matching user found',
      `A payment was received but could not be matched to a user.\n\nEmail: ${email}\nSession/Sub: ${sourceEventId}\n\nPlease manually update this account in Supabase.`,
    ).catch(() => {})
    return null
  }

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('subscription_status, first_name')
    .eq('id', matchedUser.id)
    .maybeSingle()

  return {
    userId: matchedUser.id,
    firstName: currentProfile?.first_name ?? 'friend',
    wasAlreadyActive: currentProfile?.subscription_status === 'active',
  }
}

// Expand a checkout session so we can read total_details.breakdown.discounts
// (the coupon info Stripe attached to the checkout). Swallows errors — the
// caller falls back to profiles.referred_by when this returns null.
async function couponCodeForCheckoutSession(sessionId: string): Promise<string | null> {
  try {
    const expanded = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['total_details.breakdown.discounts'],
    })
    const discountList = expanded.total_details?.breakdown?.discounts ?? []
    for (const entry of discountList) {
      const coupon = entry.discount?.source?.coupon
      const couponId = typeof coupon === 'string' ? coupon : coupon?.id ?? null
      if (!couponId) continue
      const code = await affiliateCodeForStripeCoupon(supabase, couponId)
      if (code) return code
    }
  } catch (e) {
    console.error('[webhook] coupon attribution lookup failed:', e)
  }
  return null
}

// Returns the dollars-commission a partner earned for a given subscription,
// based on what Stripe actually charged after any coupon. Prefers the
// latest invoice's `amount_paid` (real money that moved); falls back to the
// subscription line's `unit_amount` when the invoice isn't available yet.
// Returns null if no signal can be derived — the caller leaves the
// referrals.commission_amount column NULL and display falls back to $6.63.
async function commissionFromSubscription(sub: Stripe.Subscription): Promise<number | null> {
  const latest = (sub as unknown as { latest_invoice?: string | Stripe.Invoice | null }).latest_invoice
  const invoiceId = typeof latest === 'string' ? latest : latest?.id ?? null
  if (invoiceId) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId)
      const paid = (invoice as unknown as { amount_paid?: number | null }).amount_paid ?? null
      const viaPaid = commissionFromCents(paid)
      if (viaPaid !== null) return viaPaid
      const due = (invoice as unknown as { amount_due?: number | null }).amount_due ?? null
      const viaDue = commissionFromCents(due)
      if (viaDue !== null) return viaDue
    } catch (e) {
      console.error('[webhook] failed to retrieve latest invoice for commission:', e)
    }
  }
  const unitAmount = sub.items?.data?.[0]?.price?.unit_amount ?? null
  return commissionFromCents(unitAmount)
}

// Read the stored profiles.referred_by so a URL-ref signup still gets
// credited when the checkout itself didn't carry a coupon.
async function storedReferralCode(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('referred_by')
    .eq('id', userId)
    .maybeSingle()
  return data?.referred_by ? String(data.referred_by).toUpperCase() : null
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

    // Determine plan_type + priceId from the session's line items.
    let priceId: string | undefined
    let plan: LinkedPlanType = 'founding_family'
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
      priceId = lineItems.data[0]?.price?.id
      plan = planTypeForPriceId(priceId)
      console.log('[webhook] plan determined from line items:', plan, 'priceId:', priceId)
    } catch (e) {
      console.error('[webhook] failed to get line items, defaulting to founding_family:', e)
    }

    // ── Resolve the user ───────────────────────────────────────────────────
    // metadata.userId is the primary path (set by /api/stripe/checkout). Fall
    // back to the email on the session when metadata is missing (manual
    // payment links, legacy flows).
    let activatedUserId: string | null = null
    let firstName = 'friend'
    let wasAlreadyActive = false
    let viaEmailFallback = false

    if (metaUserId) {
      const { data: existing } = await supabase
        .from('profiles')
        .select('subscription_status, first_name')
        .eq('id', metaUserId)
        .maybeSingle()
      activatedUserId = metaUserId
      firstName = existing?.first_name ?? 'friend'
      wasAlreadyActive = existing?.subscription_status === 'active'
    } else if (customerEmail) {
      const result = await findUserByEmail(customerEmail, session.id)
      if (result) {
        activatedUserId = result.userId
        firstName = result.firstName
        wasAlreadyActive = result.wasAlreadyActive
        viaEmailFallback = true
      }
    }

    if (!activatedUserId) {
      console.error('[webhook] CRITICAL: could not activate account — metaUserId:', metaUserId, 'email:', customerEmail, 'sessionId:', session.id)
      return NextResponse.json({ received: true })
    }

    // ── Resolve referral code (metadata → coupon → stored referred_by) ────
    let attributedCode: string | null =
      (session.metadata?.referral ?? '').trim().toUpperCase() || null
    if (!attributedCode) attributedCode = await couponCodeForCheckoutSession(session.id)
    if (!attributedCode) attributedCode = await storedReferralCode(activatedUserId)

    // ── Link Stripe to the profile (idempotent + retries) ─────────────────
    const subscriptionId = (session.subscription as string | null) ?? null
    let activated = wasAlreadyActive
    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId)
        // Prefer session.amount_total (what Stripe actually charged on this
        // checkout, post-coupon) — it's the most accurate signal at this
        // event time. Fall back to the subscription invoice for parity with
        // the subscription.created path.
        const commissionAmount =
          commissionFromCents(session.amount_total ?? null) ??
          (await commissionFromSubscription(sub))
        await linkStripeSubscription({
          userId: activatedUserId,
          customerId: stripeCustomerId,
          subscriptionId,
          periodEnd: periodEndFromSubscription(sub),
          couponCode: attributedCode,
          planType: plan,
          stripeSessionId: session.id,
          supabase,
          commissionAmount,
        })
        activated = true
      } catch (e) {
        console.error('[webhook] linkStripeSubscription threw for session:', session.id, e)
        throw e
      }
    } else {
      console.warn('[webhook] checkout.session.completed with no subscription id — skipping link, sessionId:', session.id)
    }

    if (viaEmailFallback && activated) {
      await sendEmail(
        ADMIN_EMAIL,
        `🌱 New subscriber activated via email fallback`,
        `New subscription on Rooted!\n\nEmail: ${customerEmail}\nPlan: ${plan}\nUserId: ${activatedUserId}\nNote: matched via email fallback (no userId in session metadata)\n\nRooted is growing! 🌱`,
      ).catch(err => console.error('[webhook] admin notify error:', err))
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
        `New subscription on Rooted!\n\nFamily: ${familyName}\nEmail: ${customerEmail}\nPlan: ${planLabel(priceId)}\nTime: ${now}\nTotal active subscribers: ${activeCount}\n\nRooted is growing! 🌱`
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
          try { await supabase.from('email_log').insert({ user_id: activatedUserId, email_type: emailType }) } catch {}
        }
      } else {
        console.log('[webhook] skipped welcome email for', customerEmail, '— already active (retry)')
      }
    }
  }

  // ── customer.subscription.created / customer.subscription.updated ──────
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const customerId = sub.customer as string
    const priceId = sub.items.data[0]?.price?.id
    const plan = planTypeForPriceId(priceId)
    const isActive = sub.status === 'active' || sub.status === 'trialing'
    console.log('[webhook]', event.type, '— customerId:', customerId, 'plan:', plan, 'status:', sub.status, 'subId:', sub.id)

    // Find the user — either by stored customerId or by email fallback.
    let userId: string | null = null
    let storedReferredBy: string | null = null
    const { data: byCustomer } = await supabase
      .from('profiles')
      .select('id, referred_by')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    if (byCustomer) {
      userId = byCustomer.id
      storedReferredBy = byCustomer.referred_by
        ? String(byCustomer.referred_by).toUpperCase()
        : null
    } else if (isActive) {
      try {
        const customer = await stripe.customers.retrieve(customerId)
        if (!customer.deleted && (customer as Stripe.Customer).email) {
          const email = (customer as Stripe.Customer).email!
          console.log('[webhook]', event.type, '— no profile for customerId, trying email:', email)
          const result = await findUserByEmail(email, sub.id)
          if (result) userId = result.userId
        }
      } catch (e) {
        console.error('[webhook]', event.type, '— customer lookup failed:', e)
      }
    }

    if (isActive && userId) {
      // Resolve the coupon code either from the subscription's coupon or the
      // profile's stored referred_by (URL ?ref= on signup).
      let couponCode = storedReferredBy ?? (await storedReferralCode(userId))
      if (!couponCode) {
        const couponId = couponIdFromSubscription(sub)
        if (couponId) couponCode = await affiliateCodeForStripeCoupon(supabase, couponId)
      }

      const commissionAmount = await commissionFromSubscription(sub)

      await linkStripeSubscription({
        userId,
        customerId,
        subscriptionId: sub.id,
        periodEnd: periodEndFromSubscription(sub),
        couponCode,
        planType: plan,
        stripeSessionId: sub.id,
        supabase,
        commissionAmount,
      })
    } else if (!isActive && userId) {
      // Non-terminal non-active state (past_due, unpaid, incomplete). Mirror
      // Stripe's status onto the profile but don't promote them to paid.
      await supabase.from('profiles').update({
        is_pro: false,
        subscription_status: sub.status,
      }).eq('id', userId)
      console.log('[webhook]', event.type, '— mirrored non-active status', { userId, status: sub.status })
    } else if (!userId) {
      console.error('[webhook]', event.type, '— could not resolve user for customerId:', customerId, 'subId:', sub.id)
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
        subscription_end_date: new Date().toISOString(),
      }).eq('id', profile.id)
      console.log('[webhook] subscription.deleted — cancelled profile:', profile.id, 'family:', profile.display_name)

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

  // ── invoice.payment_failed ───────────────────────────────────────────────
  // Fires when Stripe fails to charge a renewal. Stripe will keep retrying on
  // its own schedule (and eventually fire subscription.updated/deleted once
  // the final state is known), so we don't touch profile state here — we just
  // log + notify admin so we can reach out before the sub goes to past_due.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null
    }
    const customerId = invoice.customer as string
    const subId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id ?? null
    const amountDue = invoice.amount_due ? invoice.amount_due / 100 : 0
    console.warn('[webhook] invoice.payment_failed', {
      customerId,
      subscriptionId: subId,
      invoiceId: invoice.id,
      attempt: invoice.attempt_count,
      amountDue,
    })

    let customerEmail = '—'
    let familyName = 'Unknown Family'
    try {
      const customer = await stripe.customers.retrieve(customerId)
      if (!customer.deleted) customerEmail = (customer as Stripe.Customer).email ?? '—'
    } catch { /* best-effort */ }
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    if (profile?.display_name) familyName = profile.display_name

    await sendEmail(
      ADMIN_EMAIL,
      `⚠️ Payment failed — ${familyName}`,
      `A subscription payment just failed on Rooted.\n\nFamily: ${familyName}\nEmail: ${customerEmail}\nCustomer: ${customerId}\nSubscription: ${subId ?? '—'}\nAmount due: $${amountDue.toFixed(2)}\nAttempt #: ${invoice.attempt_count ?? '—'}\n\nStripe will retry automatically. Watch for a follow-up subscription.updated event if the retry fails.`,
    ).catch((err) => console.error('[webhook] payment_failed admin email error:', err))
  }

  return NextResponse.json({ received: true })
}
