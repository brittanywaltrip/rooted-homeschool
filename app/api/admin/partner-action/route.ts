import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { emailFooterHtml, emailFooterText } from '@/lib/email-footer'

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

  // Comp the user's account if found
  if (matchedUserId) {
    await supabaseAdmin.from('profiles').update({ plan_type: 'founding_family' }).eq('id', matchedUserId)
  }

  // Update application status
  await supabaseAdmin.from('partner_apps').update({
    status: 'approved',
    reviewed_at: new Date().toISOString(),
  }).eq('id', applicationId)

  // Send welcome email (Part 4)
  const firstName = name.split(' ')[0]
  const refLink = `rootedhomeschoolapp.com/upgrade?ref=${code.toUpperCase()}`

  const welcomeHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto; color: #2d2926;">
  <div style="text-align: center; padding: 24px 0 16px;">
    <img src="https://www.rootedhomeschoolapp.com/logo-white-bg.png" alt="Rooted" width="120" />
  </div>
  <h2 style="font-size: 22px; margin-bottom: 8px;">Welcome to the Rooted Partner Program!</h2>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">Hi ${firstName},</p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    I'm so excited to welcome you as a Rooted Partner! Here's everything you need to get started:
  </p>

  <div style="background: #f0f7f1; border: 1px solid #d4ead6; border-radius: 12px; padding: 16px; margin: 20px 0;">
    <p style="font-size: 13px; color: #3d5c42; margin: 0 0 8px;"><strong>Your referral code:</strong> <span style="font-family: monospace; font-size: 16px; font-weight: bold; color: #2d5a3d;">${code.toUpperCase()}</span></p>
    <p style="font-size: 13px; color: #3d5c42; margin: 0;"><strong>Your referral link:</strong> <a href="https://${refLink}" style="color: #5c7f63;">${refLink}</a></p>
  </div>

  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Anyone who signs up using your link gets <strong>${rate}% off</strong> their first year.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    You earn <strong>20% commission</strong> on every family that upgrades \u2014 paid to your PayPal (${paypalEmail || 'on file'}) on the 1st of each month.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Your Rooted subscription is now <strong>complimentary</strong> \u2014 our gift to you for being part of this.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    You can track your clicks, signups, and earnings anytime in your Rooted app under <strong>Settings \u2192 Partner Dashboard</strong>.
  </p>
  <div style="background: #fefcf9; border: 1px solid #e8e2d9; border-radius: 12px; padding: 16px; margin: 24px 0;">
    <p style="font-size: 13px; font-weight: 600; color: #2d2926; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">FTC Disclosure</p>
    <p style="font-size: 13px; color: #5c5248; line-height: 1.7; margin: 0 0 10px;">
      Because you\u2019ll be earning commission through your referrals, the FTC requires a clear disclosure anytime you share your link or code. This applies across all platforms \u2014 Instagram, TikTok, YouTube, blogs, Facebook groups, and more.
    </p>
    <p style="font-size: 13px; color: #5c5248; line-height: 1.7; margin: 0 0 6px;">You can use simple language like:</p>
    <ul style="font-size: 13px; color: #5c5248; line-height: 1.7; margin: 0 0 10px; padding-left: 20px;">
      <li>\u201cAd: I partner with Rooted and earn a commission if you sign up using my link.\u201d</li>
      <li>\u201cPaid partnership with Rooted.\u201d</li>
      <li>\u201cThis is an affiliate link \u2014 I earn a small commission at no extra cost to you.\u201d</li>
    </ul>
    <p style="font-size: 13px; color: #5c5248; line-height: 1.7; margin: 0;">
      The key is that it\u2019s clear, upfront, and easy to see \u2014 this protects both of us.
    </p>
  </div>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Reply to this email anytime with questions \u2014 I read every one.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7; margin-top: 24px;">
    With love,<br/>Brittany
  </p>
</div>`

  await sendEmail(
    contactEmail,
    'Welcome to the Rooted Partner Program \uD83C\uDF3F',
    `Hi ${firstName},\n\nWelcome to the Rooted Partner Program!\n\nYour referral code: ${code.toUpperCase()}\nYour referral link: https://${refLink}\n\nAnyone who signs up using your link gets ${rate}% off their first year.\n\nYou earn 20% commission on every family that upgrades \u2014 paid to your PayPal (${paypalEmail || 'on file'}) on the 1st of each month.\n\nYour Rooted subscription is now complimentary \u2014 our gift to you.\n\nTrack your stats in Settings \u2192 Partner Dashboard.\n\nFTC DISCLOSURE\n\nBecause you\u2019ll be earning commission through your referrals, the FTC requires a clear disclosure anytime you share your link or code. This applies across all platforms \u2014 Instagram, TikTok, YouTube, blogs, Facebook groups, and more.\n\nYou can use simple language like:\n- \u201cAd: I partner with Rooted and earn a commission if you sign up using my link.\u201d\n- \u201cPaid partnership with Rooted.\u201d\n- \u201cThis is an affiliate link \u2014 I earn a small commission at no extra cost to you.\u201d\n\nThe key is that it\u2019s clear, upfront, and easy to see \u2014 this protects both of us.\n\nReply anytime!\n\nWith love,\nBrittany`,
    welcomeHtml,
  )

  return NextResponse.json({ ok: true, matchedUserId })
}

// ── LOOKUP PROFILE ───────────────────────────────────────────────────────────

async function handleLookupProfile(body: Record<string, unknown>) {
  const { firstName, lastName, rootedAccountEmail } = body as {
    firstName?: string; lastName?: string; rootedAccountEmail?: string;
  }

  // Try auth.users by email first (most precise)
  let matchedUserId: string | null = null
  let matchedEmail: string | null = null
  if (rootedAccountEmail) {
    const target = rootedAccountEmail.toLowerCase()
    let page = 1
    while (true) {
      const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
      if (error || !users?.length) break
      const match = users.find(u => u.email?.toLowerCase() === target)
      if (match) { matchedUserId = match.id; matchedEmail = match.email ?? null; break }
      if (users.length < 200) break
      page++
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

// ── COMP ACCOUNT ─────────────────────────────────────────────────────────────

async function handleCompAccount(body: Record<string, unknown>) {
  const { profileId } = body as { profileId: string }
  if (!profileId) return NextResponse.json({ error: 'Missing profileId' }, { status: 400 })

  const { error } = await supabaseAdmin.from('profiles').update({
    is_pro: true,
    subscription_status: 'active',
    plan_type: 'partner_comp',
  }).eq('id', profileId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
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

  await supabaseAdmin.from('partner_apps').update({
    status: 'approved',
    reviewed_at: new Date().toISOString(),
  }).eq('id', applicationId)

  // Send welcome email (same template as the legacy approve action)
  const firstName = name.split(' ')[0]
  const refLink = `rootedhomeschoolapp.com/?ref=${code.toUpperCase()}`
  const welcomeHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto; color: #2d2926;">
  <div style="text-align: center; padding: 24px 0 16px;">
    <img src="https://www.rootedhomeschoolapp.com/logo-white-bg.png" alt="Rooted" width="120" />
  </div>
  <h2 style="font-size: 22px; margin-bottom: 8px;">Welcome to the Rooted Partner Program!</h2>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">Hi ${firstName},</p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    I'm so excited to welcome you as a Rooted Partner! Here's everything you need to get started:
  </p>
  <div style="background: #f0f7f1; border: 1px solid #d4ead6; border-radius: 12px; padding: 16px; margin: 20px 0;">
    <p style="font-size: 13px; color: #3d5c42; margin: 0 0 8px;"><strong>Your referral code:</strong> <span style="font-family: monospace; font-size: 16px; font-weight: bold; color: #2d5a3d;">${code.toUpperCase()}</span></p>
    <p style="font-size: 13px; color: #3d5c42; margin: 0;"><strong>Your referral link:</strong> <a href="https://${refLink}" style="color: #5c7f63;">${refLink}</a></p>
  </div>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Anyone who signs up using your link gets <strong>15% off</strong> Rooted+.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    You earn <strong>${rate}% commission</strong> on every family that upgrades \u2014 paid to your PayPal (${paypalEmail || 'on file'}) on the 1st of each month.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Your Rooted subscription is now <strong>complimentary</strong> \u2014 our gift to you for being part of this.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7; margin-top: 24px;">
    With love,<br/>Brittany
  </p>
</div>`

  await sendEmail(
    contactEmail,
    'Welcome to the Rooted Partner Program \uD83C\uDF3F',
    `Hi ${firstName},\n\nWelcome to the Rooted Partner Program!\n\nYour referral code: ${code.toUpperCase()}\nYour referral link: https://${refLink}\n\nAnyone who signs up using your link gets 15% off Rooted+.\n\nYou earn ${rate}% commission on every family that upgrades \u2014 paid to your PayPal (${paypalEmail || 'on file'}) on the 1st of each month.\n\nYour Rooted subscription is now complimentary \u2014 our gift to you.\n\nWith love,\nBrittany`,
    welcomeHtml,
  )

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
    With love,<br/>Brittany
  </p>
</div>`

  await sendEmail(
    contactEmail,
    'Your Rooted Partner Application',
    `Hi ${firstName},\n\nThank you so much for your interest in the Rooted Partner Program. At this time we aren't able to move forward with your application, but we'd love for you to keep using Rooted and maybe apply again in the future!\n\nWith love,\nBrittany`,
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
    With love,<br/>Brittany
  </p>
</div>`

  await sendEmail(
    contactEmail,
    `Your Rooted Commission for ${month} has been sent! \uD83C\uDF3F`,
    `Hi ${firstName}!\n\nYour commission for ${month} is on its way to your PayPal (${paypalEmail || 'on file'}).\n\nFamilies referred: ${payingCount ?? 1}\nTotal sent: $${Number(amount).toFixed(2)}\nAll-time earnings: $${Number(lifetimeTotal).toFixed(2)}\n\nYou are literally helping homeschool families find a place to preserve their story. Keep sharing!\n\nWith love,\nBrittany`,
    paymentHtml,
  )

  return NextResponse.json({ ok: true })
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
  if (action === 'comp_account') return handleCompAccount(body)
  if (action === 'complete_setup') return handleCompleteSetup(body)

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
