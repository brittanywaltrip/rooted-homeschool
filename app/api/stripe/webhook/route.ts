import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { emailFooterHtml, emailFooterText } from '@/lib/email-footer'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'
import { affiliateCodeForStripeCoupon } from '@/lib/referrals'
import {
  cancelAtFromSubscription,
  couponIdFromSubscription,
  linkStripeSubscription,
  planTypeForPriceId,
  type LinkedPlanType,
} from '@/lib/link-stripe-to-profile'
import { commissionFromCents, isFirstPaymentEvent } from '@/lib/commission'
import {
  classifyPaidThrough,
  resolvePaidPeriodEnd,
  type CollectionState,
  type PriorPaidThrough,
  type InvoiceStatus,
  type RefundState,
} from '@/lib/paid-through'
import {
  selectSubscriptionInvoiceLine,
  type InvoiceLineLike,
} from '@/lib/stripe-invoice-line'
import { classifyRefund } from '@/lib/invoice-refund'
import { decideCancellation } from '@/lib/cancellation-decision'

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
  if (priceId === MONTHLY_PRICE_ID)  return 'Rooted+ Monthly ($9.99/mo)'
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

/**
 * The billed line end for THIS subscription on one invoice, or null when the
 * right line cannot be identified. A truncated line list counts as unreadable,
 * because it could hide a second candidate and make an ambiguous invoice look
 * unambiguous.
 */
function billedLineEndOf(
  sub: Stripe.Subscription,
  invoice: Stripe.Invoice | null,
): Date | null {
  if (!invoice) return null
  const selection = selectSubscriptionInvoiceLine({
    subscriptionId: sub.id,
    subscriptionItemIds: (sub.items?.data ?? []).map((item) => item.id),
    lines:
      invoice.lines?.has_more === true
        ? null
        : ((invoice.lines?.data ?? null) as InvoiceLineLike[] | null),
  })
  return selection.kind === 'found' ? selection.periodEnd : null
}

/**
 * What this subscription is PROVEN paid through, or null.
 *
 * A date is only ever taken from an invoice whose status is "paid". An unpaid
 * invoice's period boundaries are never used: they describe when an UNPAID
 * period begins, which is not the same as when a paid one ended, and they
 * diverge outright on a first-ever open invoice, on a proration, and on any gap
 * from a pause or a billing-anchor change.
 *
 * The fast path costs nothing: when the latest invoice is already paid and its
 * line is unambiguous, that is the answer. The extra lookup only happens when
 * the latest invoice is not paid, which in healthy operation is never.
 */
async function resolveProvenPaidThrough(sub: Stripe.Subscription): Promise<PriorPaidThrough> {
  const latest =
    sub.latest_invoice && typeof sub.latest_invoice === 'object'
      ? (sub.latest_invoice as Stripe.Invoice)
      : null

  if (latest?.status === 'paid') {
    const end = billedLineEndOf(sub, latest)
    if (end) {
      const through = resolvePaidPeriodEnd([{ invoiceStatus: 'paid', billedLineEnd: end }])
      if (through) return { kind: 'proven', through }
    }
  }

  // Latest invoice is unpaid, or its line could not be identified. Ask Stripe
  // for invoices that WERE paid and take the furthest proven end.
  try {
    const paid = await stripe.invoices.list({
      subscription: sub.id,
      status: 'paid',
      limit: 3,
    })
    const through = resolvePaidPeriodEnd(
      paid.data.map((inv) => ({
        invoiceStatus: (inv.status ?? null) as InvoiceStatus | null,
        billedLineEnd: billedLineEndOf(sub, inv),
      })),
    )
    if (through) return { kind: 'proven', through }
    // The lookup SUCCEEDED. Zero paid invoices is evidence that nothing was
    // ever paid; a paid invoice whose line we cannot read is not.
    return paid.data.length === 0 ? { kind: 'none' } : { kind: 'unknown' }
  } catch (e) {
    console.error(
      '[webhook] could not look up paid invoices for', sub.id,
      '— treating prior payment as unknown rather than guessing:', e,
    )
    return { kind: 'unknown' }
  }
}

/** The grant paths only want a date to store; anything unproven is no date. */
function provenDateOrNull(prior: PriorPaidThrough): Date | null {
  return prior.kind === 'proven' ? prior.through : null
}

/**
 * Invoice-scoped refund evidence for the period in question.
 *
 * Deliberately narrow. The version this replaces listed up to 100 charges
 * across the customer's ENTIRE history and treated any refunded charge,
 * including a partial one on an older subscription, as proof the current term
 * was void. One live Rooted+ subscriber carries a $5.85 partial refund from an
 * earlier term and would have lost their remaining paid access the moment they
 * cancelled.
 *
 * Every failure path returns 'unknown' rather than 'none'. The difference is
 * the whole point: a lookup that succeeded and found nothing refunded is
 * evidence, a lookup that failed is not, and classifyPaidThrough turns
 * 'unknown' into "write nothing" rather than into "not refunded".
 */
async function resolveInvoiceRefundState(invoiceId: string | null): Promise<RefundState> {
  if (!invoiceId) return classifyRefund({ lookupSucceeded: false, charge: null })
  try {
    const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 })
    const paid = payments.data.find((p) => p.status === 'paid')
    // Lookup worked and nothing was ever collected: the ordinary open-invoice
    // case. Nothing to refund is a fact, not an unknown.
    if (!paid) return classifyRefund({ lookupSucceeded: true, charge: null })

    const piRef = paid.payment?.payment_intent
    const piId = typeof piRef === 'string' ? piRef : piRef?.id ?? null
    if (!piId) return classifyRefund({ lookupSucceeded: false, charge: null })

    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] })
    const charge =
      pi.latest_charge && typeof pi.latest_charge === 'object'
        ? (pi.latest_charge as Stripe.Charge)
        : null
    if (!charge) return classifyRefund({ lookupSucceeded: false, charge: null })

    return classifyRefund({
      lookupSucceeded: true,
      charge: { amount: charge.amount, amountRefunded: charge.amount_refunded },
    })
  } catch (e) {
    console.error('[webhook] refund lookup failed for invoice', invoiceId, '- treating as unknown:', e)
    return classifyRefund({ lookupSucceeded: false, charge: null })
  }
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

        // This +365 is UNCHANGED and must stay that way. It is not a guess:
        // somebody bought a year, so a year is the thing being granted. The
        // fallback that was removed elsewhere invented a year for a period
        // nobody could read, which is the opposite. Same number, opposite
        // epistemics.
        //
        // A null current_period_end already behaves correctly here: currentEnd
        // becomes now, and max(now, now) + 365 is exactly right for gifting
        // someone with no existing paid term.
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
        const sub = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['latest_invoice'],
        })
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
          periodEnd: provenDateOrNull(await resolveProvenPaidThrough(sub)),
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
    const isActive = sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
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
      // ── Stale-event guard ──────────────────────────────────────────────
      // Stripe does NOT guarantee event ordering, and it retries failed
      // deliveries for up to three days. That means a customer.subscription
      // .updated event describing a live subscription can land AFTER the
      // customer.subscription.deleted event for the same subscription.
      // linkStripeSubscription() below writes is_pro/subscription_status/
      // plan_type unconditionally, so a late event silently re-promotes a
      // profile that was correctly cancelled moments earlier. That is how
      // real cancelled customers kept full Rooted+ access for months.
      //
      // event.data.object is a snapshot from when the event was CREATED.
      // Re-reading the subscription asks Stripe for current truth, which is
      // order-independent by construction. If the subscription is no longer
      // live we skip the promotion entirely and let the deleted handler's
      // result stand.
      //
      // On a transient Stripe failure we deliberately fall through and
      // promote: a brief over-grant is far better than dropping a real
      // renewal and locking a paying family out of their own memories.
      let stillLive = true
      let fresh: Stripe.Subscription | null = null
      try {
        fresh = await stripe.subscriptions.retrieve(sub.id, { expand: ['latest_invoice'] })
        stillLive =
          fresh.status === 'active' ||
          fresh.status === 'trialing' ||
          fresh.status === 'past_due'
        if (!stillLive) {
          console.warn(
            '[webhook]', event.type,
            '— stale event ignored, Stripe now reports status:', fresh.status,
            'subId:', sub.id, 'userId:', userId,
          )
        }
      } catch (e) {
        console.error(
          '[webhook]', event.type,
          '— could not re-verify subscription, promoting anyway. subId:',
          sub.id, e,
        )
      }

      if (!stillLive) {
        return NextResponse.json({ received: true, skipped: 'stale_event' })
      }

      // Stripe's current truth when the re-read succeeded, the event snapshot
      // only as a fallback. Same reasoning as the guard above: event.data.object
      // is a snapshot from when the event was CREATED, so a delayed or retried
      // delivery describes the past. Deriving period end and cancellation state
      // from `fresh` makes both order-independent by construction. When the
      // retrieve failed we still promote (see above) and fall back to the
      // snapshot, which is the best information available.
      const authoritative = fresh ?? sub

      // Resolve the coupon code either from the subscription's coupon or the
      // profile's stored referred_by (URL ?ref= on signup).
      let couponCode = storedReferredBy ?? (await storedReferralCode(userId))
      if (!couponCode) {
        const couponId = couponIdFromSubscription(sub)
        if (couponId) couponCode = await affiliateCodeForStripeCoupon(supabase, couponId)
      }

      // First payment only: compute commission on subscription.created, never
      // on customer.subscription.updated (monthly/annual renewals arrive as
      // updates). attributeReferral's null-guard is the hard lock; skipping the
      // compute here also avoids a redundant invoice fetch on every renewal.
      const commissionAmount = isFirstPaymentEvent(event.type)
        ? await commissionFromSubscription(sub)
        : null

      await linkStripeSubscription({
        userId,
        customerId,
        subscriptionId: sub.id,
        // Proven-paid only. During dunning this stores the last invoice that
        // actually cleared, never the period Stripe advanced without payment.
        periodEnd: provenDateOrNull(await resolveProvenPaidThrough(authoritative)),
        cancelAt: cancelAtFromSubscription(authoritative),
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

    // ── Honour the term they already paid for ──────────────────────────────
    // A family who paid for a year and cancels in month three has still paid
    // for the year, so access runs to the end of the purchased term and the
    // nightly sweep downgrades them when it actually expires.
    //
    // THE SAFETY INVARIANT for everything below: Rooted may revoke Rooted+ only
    // on positive evidence that the paid entitlement has ended. Absence of
    // evidence is never evidence of nonpayment. Every guard that cannot prove
    // what happened writes NOTHING AT ALL and leaves the row for
    // /api/cron/expire-subscriptions to retry, which keeps the situation
    // visible instead of silently frozen.
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, display_name, stripe_subscription_id')
      .eq('stripe_customer_id', sub.customer as string)
      .maybeSingle()

    if (!profile) {
      console.warn('[webhook] subscription.deleted — no profile for customer:', sub.customer)
      return NextResponse.json({ received: true, skipped: 'no_profile' })
    }

    // ── GUARD A: subscription identity ─────────────────────────────────────
    // Match on the subscription, not just the customer. Stripe retries
    // deliveries for three days, so a deleted event for an OLD subscription can
    // land after the family has already resubscribed. Without this, that event
    // stamps a paying family as cancelled.
    if (profile.stripe_subscription_id !== sub.id) {
      console.warn(
        '[webhook] subscription.deleted — ignored, profile holds',
        profile.stripe_subscription_id ?? '(none)', 'not', sub.id,
      )
      return NextResponse.json({ received: true, skipped: 'subscription_mismatch' })
    }

    // ── GUARD B: stale event ───────────────────────────────────────────────
    // event.data.object is a snapshot from when the event was CREATED. Ask
    // Stripe what is true NOW, which is order-independent by construction.
    let fresh: Stripe.Subscription | null = null
    try {
      fresh = await stripe.subscriptions.retrieve(sub.id, { expand: ['latest_invoice'] })
    } catch (e) {
      console.error('[webhook] subscription.deleted — could not re-read subscription, writing nothing:', sub.id, e)
      return NextResponse.json({ received: true, skipped: 'stripe_unreadable' })
    }

    const collectionState: CollectionState =
      fresh.status === 'canceled' || fresh.status === 'incomplete_expired'
        ? 'terminated'
        : 'live'
    if (collectionState !== 'terminated') {
      console.warn(
        '[webhook] subscription.deleted — stale event, Stripe now reports',
        fresh.status, 'for', sub.id, '— writing nothing',
      )
      return NextResponse.json({ received: true, skipped: 'not_terminal' })
    }

    // ── Evidence: the billed line for THIS subscription ────────────────────
    const invoice =
      fresh.latest_invoice && typeof fresh.latest_invoice === 'object'
        ? (fresh.latest_invoice as Stripe.Invoice)
        : null
    // A truncated line list could hide a second candidate and make an ambiguous
    // invoice look unambiguous.
    const linesTruncated = invoice?.lines?.has_more === true
    const selection = selectSubscriptionInvoiceLine({
      subscriptionId: fresh.id,
      subscriptionItemIds: (fresh.items?.data ?? []).map((item) => item.id),
      lines: linesTruncated
        ? null
        : ((invoice?.lines?.data ?? null) as InvoiceLineLike[] | null),
    })

    // ── Evidence: invoice-scoped refund state ─────────────────────────────
    const refundState = await resolveInvoiceRefundState(invoice?.id ?? null)

    // One clock for both decisions: two calls to new Date() could straddle a
    // millisecond and classify against a different instant than they decide on.
    const now = new Date()

    // Prior payment evidence, asked for only on this path. The fast path costs
    // nothing when the latest invoice is paid; the lookup happens only when it
    // is not, which is exactly the dunning case this exists for.
    const priorPaidThrough = await resolveProvenPaidThrough(fresh)

    const classification = classifyPaidThrough({
      latestInvoiceStatus: (invoice?.status ?? null) as InvoiceStatus | null,
      latestInvoiceLinePeriodStart: selection.kind === 'found' ? selection.periodStart : null,
      latestInvoiceLinePeriodEnd: selection.kind === 'found' ? selection.periodEnd : null,
      latestInvoiceNextPaymentAttempt:
        typeof invoice?.next_payment_attempt === 'number' && invoice.next_payment_attempt > 0
          ? new Date(invoice.next_payment_attempt * 1000)
          : null,
      collectionState,
      priorPaidThrough,
      subscriptionStartedAt:
        typeof fresh.start_date === 'number' && fresh.start_date > 0
          ? new Date(fresh.start_date * 1000)
          : null,
      refundState,
      now,
    })

    const decision = decideCancellation({ classification, now })

    console.log(
      '[webhook] subscription.deleted — classified', sub.id,
      'as', classification.kind,
      'invoice:', invoice?.status ?? 'unreadable',
      'refund:', refundState,
      'prior:', priorPaidThrough.kind,
      'line:', selection.kind,
    )

    if (decision.action === 'skip') {
      console.warn(
        '[webhook] subscription.deleted — writing nothing for profile', profile.id,
        '(', classification.kind, ':', decision.reason, ') — left for the nightly sweep',
      )
      return NextResponse.json({ received: true, skipped: `classification_${classification.kind}` })
    }

    const priceId = fresh.items.data[0]?.price.id
    const termRemaining = decision.termRemaining

    // ── GUARD C: re-assert the subscription in the write itself ────────────
    // The read above and this write are not atomic. Re-asserting the
    // subscription id means a family who resubscribed in between is never
    // stamped on the strength of a stale read.
    const { data: updatedRows, error: updateErr } = await supabase
      .from('profiles')
      .update(decision.patch)
      .eq('id', profile.id)
      .eq('stripe_subscription_id', sub.id)
      .select('id')

    if (updateErr) {
      console.error('[webhook] subscription.deleted — update failed:', profile.id, updateErr.message)
      return NextResponse.json({ error: 'update_failed' }, { status: 500 })
    }
    if (!updatedRows || updatedRows.length === 0) {
      console.warn(
        '[webhook] subscription.deleted — wrote nothing for profile', profile.id,
        ': the row no longer holds', sub.id, '(resubscribed or changed underneath us)',
      )
      return NextResponse.json({ received: true, skipped: 'row_changed' })
    }

    console.log(
      '[webhook] subscription.deleted — cancelled profile:', profile.id,
      'family:', profile.display_name,
      'refund:', refundState,
      termRemaining
        ? `access retained until ${decision.patch.subscription_end_date}`
        : `access revoked, paid through ${decision.patch.subscription_end_date}`,
    )

    {
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

    if (customerEmail && customerEmail !== '—') {
      const firstName = profile?.display_name?.split(' ')[0] ?? 'friend'
      await sendEmail(
        customerEmail,
        'Heads up: your Rooted payment didn\'t go through',
        `Hi ${firstName},\n\nWe weren't able to process your Rooted+ payment. Stripe will retry automatically, but to make sure you don't lose access, please update your payment method at:\n\nhttps://rootedhomeschoolapp.com/dashboard/settings\n\nIf you have any trouble, just reply to this email and I'll help you sort it out.\n\nCheering you on,\nBrittany`,
      ).catch((err) => console.error('[webhook] payment_failed user email error:', err))
    }
  }

  return NextResponse.json({ received: true })
}
