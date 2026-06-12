import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { emailFooterHtml, emailFooterText } from '@/lib/email-footer'

// As of the May 1 2026 affiliate-program relaunch, partner approval no
// longer comps the partner's Rooted+ subscription. New affiliates pay
// for Rooted+ like any other customer; only the existing 9 founding
// partners are grandfathered with a comped membership (untouched).
// `compPartnerProfile` from lib/comp-partner.ts is intentionally left in
// place for any future one-off manual comping but is no longer called
// from the approval flow.

const ADMIN_EMAILS = ['garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com', 'hello@rootedhomeschoolapp.com']

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function verifyAdmin(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user || !ADMIN_EMAILS.includes(user.email ?? '')) return null
  return user
}

async function sendEmail(to: string, subject: string, text: string, html?: string) {
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const payload: { from: string; to: string; subject: string; text: string; html?: string } = {
    from: 'Brittany from Rooted <hello@rootedhomeschoolapp.com>',
    to, subject,
    text: text + emailFooterText(),
  }
  if (html) payload.html = html + emailFooterHtml()
  await resend.emails.send(payload)
}

// Returns a human-readable reason if an affiliate row already exists for the
// given user, contact email, or code. Used by every approval path so we
// never silently create a duplicate affiliates record.
async function findDuplicateAffiliate(opts: {
  profileId: string | null
  contactEmail: string | null
  code: string
}): Promise<string | null> {
  const { profileId, contactEmail, code } = opts

  // Code uniqueness is non-negotiable — it's the URL ref handle.
  const { data: byCode } = await supabaseAdmin
    .from('affiliates').select('id').eq('code', code.toUpperCase()).maybeSingle()
  if (byCode) return `Referral code "${code.toUpperCase()}" is already in use.`

  if (profileId) {
    const { data: byUser } = await supabaseAdmin
      .from('affiliates').select('id').eq('user_id', profileId).maybeSingle()
    if (byUser) return 'This Rooted account already has an affiliate row.'
  }

  if (contactEmail) {
    const { data: byEmail } = await supabaseAdmin
      .from('affiliates').select('id').ilike('contact_email', contactEmail).maybeSingle()
    if (byEmail) return `An affiliate already exists with contact email "${contactEmail}".`
  }

  return null
}

// ── APPROVE ──────────────────────────────────────────────────────────────────

async function handleApprove(body: Record<string, unknown>) {
  const {
    applicationId, name, contactEmail, rootedAccountEmail,
    paypalEmail, code, stripeCouponId, stripeApiId, commissionRate,
  } = body as {
    applicationId: string; name: string; contactEmail: string; rootedAccountEmail: string;
    paypalEmail: string; code: string; stripeCouponId: string; stripeApiId: string; commissionRate: number;
  }

  if (!applicationId || !name || !contactEmail || !code || !stripeCouponId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const rate = commissionRate ?? 20

  // Find the user to comp — prefer rooted account email, fall back to contact email
  const lookupEmail = (rootedAccountEmail || contactEmail).toLowerCase()
  let matchedUserId: string | null = null
  let page = 1
  while (true) {
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !users?.length) break
    const match = users.find(u => u.email?.toLowerCase() === lookupEmail)
    if (match) { matchedUserId = match.id; break }
    if (users.length < 200) break
    page++
  }

  // Duplicate guard \u2014 never create a second affiliates row for the same
  // user, contact email, or code.
  const dupReason = await findDuplicateAffiliate({
    profileId: matchedUserId,
    contactEmail,
    code,
  })
  if (dupReason) return NextResponse.json({ error: dupReason }, { status: 409 })

  // Create affiliate row
  const { error: affErr } = await supabaseAdmin.from('affiliates').insert({
    user_id: matchedUserId,
    name,
    code: code.toUpperCase(),
    stripe_coupon_id: stripeCouponId,
    stripe_api_id: stripeApiId || null,
    contact_email: contactEmail,
    paypal_email: paypalEmail || null,
    commission_rate: rate,
    is_active: true,
  })
  if (affErr) return NextResponse.json({ error: affErr.message }, { status: 500 })

  // We intentionally do NOT modify the partner's profiles row. New
  // affiliates pay for Rooted+ like any other customer; their plan_type,
  // is_pro, subscription_status, and stripe_* fields are owned by the
  // Stripe webhook and must not be touched here.

  // Update application status \u2014 capture the error so a silent failure
  // can't leave partner_apps stuck on "pending" after the affiliate row
  // is already created.
  const { error: statusErr } = await supabaseAdmin.from('partner_apps').update({
    status: 'approved',
    reviewed_at: new Date().toISOString(),
  }).eq('id', applicationId)
  if (statusErr) {
    return NextResponse.json({
      error: `Affiliate created but partner_apps status update failed: ${statusErr.message}`,
    }, { status: 500 })
  }

  // Approval is intentionally silent \u2014 Brittany emails new partners
  // personally so the welcome lands in a real conversation, not an
  // automated send.
  const refLink = `rootedhomeschoolapp.com/?ref=${code.toUpperCase()}`
  return NextResponse.json({ ok: true, matchedUserId, refLink: `https://${refLink}` })
}

// ── LOOKUP PROFILE ───────────────────────────────────────────────────────────

async function handleLookupProfile(body: Record<string, unknown>) {
  const { firstName, lastName, rootedAccountEmail } = body as {
    firstName?: string; lastName?: string; rootedAccountEmail?: string;
  }

  // Try auth.users by email first (most precise). We page through the
  // admin listUsers API until we hit a truly empty page; the previous
  // implementation early-exited when a page returned fewer rows than
  // perPage, but GoTrue silently caps perPage server-side on some
  // projects, so a "short" first page made the loop terminate after
  // checking only the most-recent batch — older partners (e.g. Emily
  // Mahler / thewellnesscommunitysoco@gmail.com) were silently missed.
  // perPage:1000 matches the summary route's proven pattern; the page
  // cap below is a safety net against an infinite loop if GoTrue ever
  // returns the same page twice.
  let matchedUserId: string | null = null
  let matchedEmail: string | null = null
  if (rootedAccountEmail) {
    const target = rootedAccountEmail.trim().toLowerCase()
    const MAX_PAGES = 100
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) break
      const users = data?.users ?? []
      if (users.length === 0) break
      const match = users.find(u => u.email?.trim().toLowerCase() === target)
      if (match) { matchedUserId = match.id; matchedEmail = match.email ?? null; break }
    }
  }

  // Fall back to profiles.first_name + last_name match
  if (!matchedUserId && firstName && lastName) {
    const { data: nameMatches } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('first_name', firstName.trim())
      .ilike('last_name', lastName.trim())
      .limit(2)
    if (nameMatches && nameMatches.length === 1) {
      matchedUserId = nameMatches[0].id
    }
  }

  if (!matchedUserId) {
    return NextResponse.json({ found: false })
  }

  // Fetch full profile info
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, display_name, is_pro, subscription_status, plan_type')
    .eq('id', matchedUserId)
    .maybeSingle()

  if (!matchedEmail) {
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(matchedUserId)
    matchedEmail = user?.email ?? null
  }

  return NextResponse.json({
    found: true,
    profile: {
      id: matchedUserId,
      email: matchedEmail,
      display_name: profile?.display_name ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      is_pro: profile?.is_pro ?? false,
      subscription_status: profile?.subscription_status ?? 'free',
      plan_type: profile?.plan_type ?? null,
    },
  })
}

// ── COMPLETE SETUP ───────────────────────────────────────────────────────────

async function handleCompleteSetup(body: Record<string, unknown>) {
  const {
    applicationId, name, contactEmail, paypalEmail, code, stripeCouponId, stripeApiId,
    commissionRate, profileId, socialHandle, audienceSize, appCreatedAt,
  } = body as {
    applicationId: string; name: string; contactEmail: string; paypalEmail: string;
    code: string; stripeCouponId: string; stripeApiId: string; commissionRate: number;
    profileId: string | null; socialHandle?: string; audienceSize?: string; appCreatedAt?: string;
  }

  if (!applicationId || !name || !contactEmail || !code || !stripeCouponId || !stripeApiId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const rate = commissionRate ?? 20
  const appliedDate = appCreatedAt ? new Date(appCreatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const notesStr = [
    socialHandle ? `Social: ${socialHandle}` : null,
    audienceSize ? `${audienceSize} audience` : null,
    appliedDate ? `Applied ${appliedDate}` : null,
  ].filter(Boolean).join('. ')

  // Duplicate guard — never create a second affiliates row for the same
  // user, contact email, or code.
  const dupReason = await findDuplicateAffiliate({
    profileId,
    contactEmail,
    code,
  })
  if (dupReason) return NextResponse.json({ error: dupReason }, { status: 409 })

  const { error: affErr } = await supabaseAdmin.from('affiliates').insert({
    user_id: profileId,
    name,
    code: code.toUpperCase(),
    stripe_coupon_id: stripeCouponId,
    stripe_api_id: stripeApiId,
    contact_email: contactEmail,
    paypal_email: paypalEmail || null,
    commission_rate: rate,
    is_active: true,
    clicks: 0,
    notes: notesStr || null,
  })
  if (affErr) return NextResponse.json({ error: affErr.message }, { status: 500 })

  // We intentionally do NOT modify the partner's profiles row. New
  // affiliates pay for Rooted+ like any other customer; their plan_type
  // and Stripe linkage are owned by the webhook and must not be touched.

  // Capture the status-update error so a silent failure can't leave
  // partner_apps stuck on "pending" after the affiliate row already exists.
  const { error: statusErr } = await supabaseAdmin.from('partner_apps').update({
    status: 'approved',
    reviewed_at: new Date().toISOString(),
  }).eq('id', applicationId)
  if (statusErr) {
    return NextResponse.json({
      error: `Affiliate created but partner_apps status update failed: ${statusErr.message}`,
    }, { status: 500 })
  }

  const refLink = `rootedhomeschoolapp.com/?ref=${code.toUpperCase()}`

  return NextResponse.json({ ok: true, refLink: `https://${refLink}` })
}

// ── REJECT ───────────────────────────────────────────────────────────────────

async function handleReject(body: Record<string, unknown>) {
  const { applicationId, name, contactEmail, notes } = body as {
    applicationId: string; name: string; contactEmail: string; notes: string;
  }

  if (!applicationId || !contactEmail) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  await supabaseAdmin.from('partner_apps').update({
    status: 'declined',
    reviewed_at: new Date().toISOString(),
    notes: notes || null,
  }).eq('id', applicationId)

  const firstName = (name || '').split(' ')[0] || 'friend'

  const rejectHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; color: #2d2926;">
  <div style="text-align: center; padding: 24px 0;">
    <img src="https://www.rootedhomeschoolapp.com/logo-white-bg.png" alt="Rooted" width="120" />
  </div>
  <h2 style="font-size: 20px; margin-bottom: 8px;">Your Rooted Partner Application</h2>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">Hi ${firstName},</p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Thank you so much for your interest in the Rooted Partner Program. At this time we aren't able to move forward with your application, but we'd love for you to keep using Rooted and maybe apply again in the future!
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    We're rooting for you and your family. \uD83C\uDF3F
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7; margin-top: 24px;">
    Sincerely,<br/>Brittany
  </p>
</div>`

  await sendEmail(
    contactEmail,
    'Your Rooted Partner Application',
    `Hi ${firstName},\n\nThank you so much for your interest in the Rooted Partner Program. At this time we aren't able to move forward with your application, but we'd love for you to keep using Rooted and maybe apply again in the future!\n\nSincerely,\nBrittany`,
    rejectHtml,
  )

  return NextResponse.json({ ok: true })
}

// ── PAYMENT EMAIL (Part 5) ──────────────────────────────────────────────────

async function handlePaymentEmail(body: Record<string, unknown>) {
  const { contactEmail, name, affiliateCode, amount, month, paypalEmail, payingCount, lifetimeTotal } = body as {
    contactEmail: string; name: string; affiliateCode: string; amount: number;
    month: string; paypalEmail: string; payingCount: number; lifetimeTotal: number;
  }

  if (!contactEmail || !amount) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const firstName = (name || '').split(' ')[0] || 'friend'

  const paymentHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto; color: #2d2926;">
  <div style="text-align: center; padding: 24px 0 16px;">
    <img src="https://www.rootedhomeschoolapp.com/logo-white-bg.png" alt="Rooted" width="120" />
  </div>
  <h2 style="font-size: 22px; margin-bottom: 8px;">Your commission for ${month} has been sent!</h2>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">Hi ${firstName}!</p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Your commission for ${month} is on its way to your PayPal (<strong>${paypalEmail || 'on file'}</strong>).
  </p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
    <tr style="background: #f0f7f1;">
      <th style="text-align: left; padding: 10px 12px; border: 1px solid #d4ead6; color: #3d5c42;">Families referred</th>
      <th style="text-align: left; padding: 10px 12px; border: 1px solid #d4ead6; color: #3d5c42;">Commission per family</th>
      <th style="text-align: left; padding: 10px 12px; border: 1px solid #d4ead6; color: #3d5c42;">Total</th>
    </tr>
    <tr>
      <td style="padding: 10px 12px; border: 1px solid #e8e2d9;">${payingCount ?? 1}</td>
      <td style="padding: 10px 12px; border: 1px solid #e8e2d9;">$7.80</td>
      <td style="padding: 10px 12px; border: 1px solid #e8e2d9; font-weight: bold;">$${Number(amount).toFixed(2)}</td>
    </tr>
  </table>

  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    <strong>Total sent: $${Number(amount).toFixed(2)}</strong>
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    <strong>All-time earnings with Rooted: $${Number(lifetimeTotal).toFixed(2)}</strong>
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7; margin-top: 16px;">
    You are literally helping homeschool families find a place to preserve their story. That matters more than you know. Keep sharing! \uD83C\uDF3F
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Questions? Reply to this email.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7; margin-top: 24px;">
    Sincerely,<br/>Brittany
  </p>
</div>`

  await sendEmail(
    contactEmail,
    `Your Rooted Commission for ${month} has been sent! \uD83C\uDF3F`,
    `Hi ${firstName}!\n\nYour commission for ${month} is on its way to your PayPal (${paypalEmail || 'on file'}).\n\nFamilies referred: ${payingCount ?? 1}\nTotal sent: $${Number(amount).toFixed(2)}\nAll-time earnings: $${Number(lifetimeTotal).toFixed(2)}\n\nYou are literally helping homeschool families find a place to preserve their story. Keep sharing!\n\nSincerely,\nBrittany`,
    paymentHtml,
  )

  return NextResponse.json({ ok: true })
}

// ── TOGGLE ACTIVE ────────────────────────────────────────────────────────────

// Flip an affiliate's is_active flag. affiliates has SELECT-only RLS, so the
// admin partners page can't write this from the browser, so the write belongs
// here on the service-role client.
async function handleToggleActive(body: Record<string, unknown>) {
  const { affiliateId, isActive } = body as { affiliateId?: string; isActive?: boolean }

  if (!affiliateId || typeof isActive !== 'boolean') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('affiliates')
    .update({ is_active: isActive })
    .eq('id', affiliateId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, is_active: isActive })
}

// ── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!await verifyAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const action = body.action as string

  if (action === 'approve') return handleApprove(body)
  if (action === 'reject') return handleReject(body)
  if (action === 'payment_email') return handlePaymentEmail(body)
  if (action === 'lookup_profile') return handleLookupProfile(body)
  if (action === 'complete_setup') return handleCompleteSetup(body)
  if (action === 'toggle_active') return handleToggleActive(body)

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
