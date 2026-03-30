import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { emailFooterHtml } from '@/lib/email-footer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function confirmationHtml(firstName: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f7f4;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f4;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr><td align="center" style="padding:0 0 32px;">
    <div style="background:#3d5c42;border-radius:16px;padding:24px 32px;text-align:center;">
      <div style="font-size:40px;margin-bottom:8px;">🌱</div>
      <div style="color:#fff;font-size:22px;font-weight:bold;">Application Received</div>
      <div style="color:#a8c5ad;font-size:14px;margin-top:4px;">Rooted Partner Program</div>
    </div>
  </td></tr>

  <!-- Main card -->
  <tr><td style="background:#fefcf9;border-radius:16px;padding:40px;border:1px solid #e8e2d9;">

    <p style="margin:0 0 8px;font-size:13px;color:#7a6f65;text-transform:uppercase;letter-spacing:1px;">We got it!</p>
    <h1 style="margin:0 0 24px;font-size:26px;color:#2d2926;line-height:1.3;">
      Thank you for applying, ${firstName}. 🌿
    </h1>

    <p style="margin:0 0 16px;font-size:16px;color:#3d3530;line-height:1.7;">
      I review every application personally — so it may take me a few days to get back to you, but I promise I will.
    </p>

    <p style="margin:0 0 32px;font-size:16px;color:#3d3530;line-height:1.7;">
      In the meantime, if you haven't already spent time in the app, now is a great time to explore. The more you use it, the more you'll have to share — and that's what makes the best content.
    </p>

    <!-- What happens next -->
    <div style="background:#f0f7f0;border:1px solid #c8dfc9;border-radius:12px;padding:24px;margin-bottom:32px;">
      <p style="margin:0 0 16px;font-size:13px;color:#5c7f63;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">What happens next</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:8px 0;font-size:15px;color:#2d2926;border-bottom:1px solid #e8e2d9;">
          📬 &nbsp;I'll review your application within 3–5 business days
        </td></tr>
        <tr><td style="padding:8px 0;font-size:15px;color:#2d2926;border-bottom:1px solid #e8e2d9;">
          🤝 &nbsp;If it's a great fit, I'll reach out personally to get you set up
        </td></tr>
        <tr><td style="padding:8px 0;font-size:15px;color:#2d2926;">
          🌱 &nbsp;Your code, referral link, and ambassador dashboard go live in the app
        </td></tr>
      </table>
    </div>

    <!-- CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td align="center">
        <a href="https://rootedhomeschoolapp.com/dashboard"
           style="display:inline-block;background:#3d5c42;color:#fff;font-size:16px;font-weight:bold;padding:16px 40px;border-radius:12px;text-decoration:none;">
          Open Rooted →
        </a>
      </td></tr>
    </table>

    <div style="border-top:1px solid #e8e2d9;padding-top:24px;">
      <p style="margin:0 0 8px;font-size:15px;color:#3d3530;line-height:1.7;">
        Questions? Just reply to this email — I read every one.
      </p>
      <p style="margin:0;font-size:15px;color:#5c7f63;font-weight:bold;">
        — Brittany, founder of Rooted 🌱
      </p>
    </div>

  </td></tr>

  <!-- Footer -->
  <tr><td align="center" style="padding:24px 0 0;">
    ${emailFooterHtml()}
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { firstName, lastName, email, platforms, platformLinks, platformSizes, story, whatToShare, usedRooted, postFrequency, paypalEmail } = body

  if (!firstName || !lastName || !email || !platforms?.length || !story) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const links = platformLinks as Record<string, string> | undefined
  const sizes = platformSizes as Record<string, string> | undefined
  const platformSummary = (platforms as string[]).map((p: string) => {
    const link = links?.[p] || 'no link provided'
    const size = sizes?.[p] || 'not specified'
    const sizeLabel = p === 'facebook' ? 'members' : 'followers'
    return `  ${p}: ${link} (${size} ${sizeLabel})`
  }).join('\n')

  try {
    // Save to database
    const { error: insertErr } = await supabase.from('partner_apps').insert({
      first_name: firstName,
      last_name: lastName,
      email,
      platforms,
      platform_sizes: platformSizes ?? {},
      about_journey: story,
      used_rooted: usedRooted ?? '',
    })
    if (insertErr) {
      console.error('[partners/apply] insert failed:', insertErr)
      return NextResponse.json({ error: 'Failed to save application' }, { status: 500 })
    }

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    // Email to Brittany
    await resend.emails.send({
      from: 'Rooted Partners <hello@rootedhomeschoolapp.com>',
      to: 'hello@rootedhomeschoolapp.com',
      subject: `🌱 New partner application — ${firstName} ${lastName}`,
      text: `Name: ${firstName} ${lastName}\nEmail: ${email}\nPlatforms: ${(platforms as string[]).join(', ')}\nUsed Rooted: ${usedRooted || 'not specified'}\nAbout their journey: ${story}\nWhat they'd share: ${whatToShare || 'not specified'}\nPost frequency: ${postFrequency || 'not specified'}\nPayPal: ${paypalEmail || 'not provided'}\n\nPlatform details:\n${platformSummary}\n\nReview it here: https://www.rootedhomeschoolapp.com/admin`,
    })

    // Confirmation email to applicant
    await resend.emails.send({
      from: 'Brittany at Rooted <hello@rootedhomeschoolapp.com>',
      to: email,
      subject: 'We received your Rooted Partner application 🌱',
      text: `Hi ${firstName}, thank you for applying to become a Rooted Partner! I review every application personally and will be in touch within 3–5 business days. In the meantime, explore the app at rootedhomeschoolapp.com. — Brittany, Founder of Rooted`,
      html: confirmationHtml(firstName),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[partners/apply]', err)
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 })
  }
}
