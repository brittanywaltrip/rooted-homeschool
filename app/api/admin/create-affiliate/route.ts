import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'garfieldbrittany@gmail.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function affiliateWelcomeHtml(name: string, code: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f7f4;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f4;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td align="center" style="padding:0 0 32px;">
    <div style="background:linear-gradient(135deg,#4338ca,#818cf8);border-radius:16px;padding:24px 32px;text-align:center;">
      <div style="font-size:40px;margin-bottom:8px;">🤝</div>
      <div style="color:#fff;font-size:24px;font-weight:bold;">Rooted Partner</div>
      <div style="color:#c7d2fe;font-size:14px;margin-top:4px;">Official Ambassador</div>
    </div>
  </td></tr>

  <tr><td style="background:#fefcf9;border-radius:16px;padding:40px;border:1px solid #e8e2d9;">
    <p style="margin:0 0 8px;font-size:13px;color:#7a6f65;text-transform:uppercase;letter-spacing:1px;">Welcome to the team</p>
    <h1 style="margin:0 0 24px;font-size:28px;color:#2d2926;line-height:1.3;">You're officially a Rooted Partner, ${name}. 🌿</h1>

    <p style="margin:0 0 16px;font-size:16px;color:#3d3530;line-height:1.7;">I'm so excited to have you. You're one of the very first people to partner with Rooted — and that means everything as we grow.</p>
    <p style="margin:0 0 32px;font-size:16px;color:#3d3530;line-height:1.7;">I'm not asking you to sell anything. Just share your honest experience. Your followers trust you — that's what matters most.</p>

    <div style="background:#eef0ff;border:2px solid #c7d2fe;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">
      <p style="margin:0 0 6px;font-size:13px;color:#4338ca;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">Your discount code</p>
      <p style="margin:0 0 12px;font-size:38px;font-weight:bold;color:#4338ca;letter-spacing:4px;font-family:monospace;">${code}</p>
      <p style="margin:0;font-size:14px;color:#6366f1;">15% off for every follower who uses it · works forever</p>
    </div>

    <div style="background:#eef0ff;border:2px solid #c7d2fe;border-radius:12px;padding:20px;margin-bottom:32px;">
      <p style="margin:0 0 6px;font-size:13px;color:#4338ca;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">Your referral link</p>
      <p style="margin:0;font-size:14px;color:#4338ca;word-break:break-all;font-family:monospace;">rootedhomeschoolapp.com/upgrade?ref=${code}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#6366f1;">Share this link — the discount applies automatically, no code needed</p>
    </div>

    <div style="background:#f0f7f0;border:1px solid #c8dfc9;border-radius:12px;padding:24px;margin-bottom:32px;">
      <p style="margin:0 0 16px;font-size:13px;color:#5c7f63;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">✨ Your partner perks</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:5px 0;font-size:15px;color:#2d2926;">⭐ &nbsp;Founding Member subscription — free, forever</td></tr>
        <tr><td style="padding:5px 0;font-size:15px;color:#2d2926;">🤝 &nbsp;Exclusive Rooted Partner badge in your Garden</td></tr>
        <tr><td style="padding:5px 0;font-size:15px;color:#2d2926;">📊 &nbsp;Live stats dashboard — see your impact in the app</td></tr>
        <tr><td style="padding:5px 0;font-size:15px;color:#2d2926;">🔗 &nbsp;Personal referral link + discount code</td></tr>
      </table>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td align="center">
        <a href="https://rootedhomeschoolapp.com/dashboard/settings" style="display:inline-block;background:#4338ca;color:#fff;font-size:16px;font-weight:bold;padding:16px 40px;border-radius:12px;text-decoration:none;">
          View your Partner dashboard →
        </a>
      </td></tr>
    </table>

    <div style="border-top:1px solid #e8e2d9;padding-top:24px;">
      <p style="margin:0 0 8px;font-size:15px;color:#3d3530;line-height:1.7;">Hit reply anytime — I genuinely love hearing from our partners.</p>
      <p style="margin:0;font-size:15px;color:#5c7f63;font-weight:bold;">— Brittany, founder of Rooted 🌱</p>
    </div>
  </td></tr>

  <tr><td align="center" style="padding:24px 0 0;">
    <p style="margin:0;font-size:13px;color:#7a6f65;">Rooted Homeschool · rootedhomeschoolapp.com</p>
    <p style="margin:4px 0 0;font-size:13px;color:#7a6f65;">Questions? Reply to this email anytime.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  // Auth check — admin only
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email, name, code, stripe_coupon_id } = await req.json()
  if (!email || !name || !code || !stripe_coupon_id) {
    return NextResponse.json({ error: 'Missing required fields: email, name, code, stripe_coupon_id' }, { status: 400 })
  }

  // 1. Find user by email
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) return NextResponse.json({ error: 'Failed to list users' }, { status: 500 })

  const matchedUser = users?.find(u => u.email?.toLowerCase() === email.toLowerCase())
  if (!matchedUser) {
    return NextResponse.json({ error: `No user found with email: ${email}` }, { status: 404 })
  }

  // 2. Insert affiliate row
  const { error: insertError } = await supabase.from('affiliates').insert({
    user_id: matchedUser.id,
    name,
    code: code.toUpperCase(),
    stripe_coupon_id,
  })
  if (insertError) {
    return NextResponse.json({ error: `Failed to create affiliate: ${insertError.message}` }, { status: 500 })
  }

  // 3. Update profile to founding member
  await supabase.from('profiles').update({
    is_pro: true,
    subscription_status: 'founding',
    plan_type: 'founding_family',
  }).eq('id', matchedUser.id)

  // 4. Send welcome email
  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'Brittany at Rooted <hello@rootedhomeschoolapp.com>',
      to: email,
      subject: `You're officially a Rooted Partner, ${name}! 🤝`,
      text: `Hi ${name}, you're now a Rooted Partner! Your code is ${code.toUpperCase()} (15% off for your followers). Your referral link: rootedhomeschoolapp.com/upgrade?ref=${code.toUpperCase()} — Brittany`,
      html: affiliateWelcomeHtml(name, code.toUpperCase()),
    })
  } catch (emailErr) {
    console.error('[create-affiliate] Welcome email failed:', emailErr)
  }

  return NextResponse.json({
    success: true,
    userId: matchedUser.id,
    code: code.toUpperCase(),
  })
}
