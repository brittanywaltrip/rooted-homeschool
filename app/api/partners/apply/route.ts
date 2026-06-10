import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { emailFooterHtml, emailFooterText } from '@/lib/email-footer'
import { buildPartnerAppRow } from '@/lib/partner-apply'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function sendEmail(to: string, subject: string, text: string, html?: string, from = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>') {
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const payload: { from: string; to: string; subject: string; text: string; html?: string } = {
    from,
    to, subject,
    text: text + emailFooterText(),
  }
  if (html) payload.html = html + emailFooterHtml()
  await resend.emails.send(payload)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    firstName, lastName, email,
    hasRootedAccount, rootedAccountEmail,
    // paymentMethod is the channel (PayPal / Venmo / Zelle / Mercury (ACH) / Other).
    // paymentAccount is the destination address; it lands in paypal_email
    // regardless of channel since renaming the column would be more churn
    // than it's worth. paypalEmail is accepted as a back-compat alias.
    paymentMethod, paymentAccount,
    paypalEmail, socialHandle, audienceSize, whyRooted,
    // Legacy fields from old form, still accepted.
    platforms, platformLinks, platformSizes, story, whatToShare, usedRooted, postFrequency,
  } = body
  const destinationAddress: string = paymentAccount || paypalEmail || ''
  const channel: string = paymentMethod || 'PayPal'

  if (!firstName || !lastName || !email) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    // Save to database. buildPartnerAppRow lives in lib/partner-apply.ts so
    // the body-to-row mapping (notably the multi-channel payment_method
    // logic) is unit-testable without booting Supabase or Resend.
    const { error: insertErr } = await supabase.from('partner_apps').insert(
      buildPartnerAppRow(body),
    )
    if (insertErr) {
      console.error('[partners/apply] insert failed:', insertErr)
      return NextResponse.json({ error: 'Failed to save application' }, { status: 500 })
    }

    // Confirmation email to applicant
    const confirmHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; color: #2d2926;">
  <div style="text-align: center; padding: 24px 0;">
    <img src="https://www.rootedhomeschoolapp.com/logo-white-bg.png" alt="Rooted" width="120" style="margin: 0 auto;" />
  </div>
  <h2 style="font-size: 20px; margin-bottom: 8px;">We got your application!</h2>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Hi ${firstName},
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    Thank you so much for applying to the Rooted Partner Program! I personally review every single application and will be in touch within 48 hours.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7;">
    In the meantime, if you haven't already, sign up for a free Rooted account at
    <a href="https://rootedhomeschoolapp.com/signup" style="color: #5c7f63; font-weight: 600;">rootedhomeschoolapp.com</a>
    — it'll make your onboarding even faster once you're approved.
  </p>
  <p style="font-size: 14px; color: #5c5248; line-height: 1.7; margin-top: 24px;">
    Sincerely,<br />Brittany
  </p>
</div>`

    await sendEmail(
      email,
      'We got your Rooted Partner application! \uD83C\uDF3F',
      `Hi ${firstName},\n\nThank you so much for applying to the Rooted Partner Program! I personally review every application and will be in touch within 48 hours.\n\nIn the meantime, if you haven't already, sign up for a free Rooted account at rootedhomeschoolapp.com.\n\nSincerely,\nBrittany`,
      confirmHtml,
    )

    // Admin notification
    const adminEmailBody = `
New partner application received

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name:               ${firstName} ${lastName}
Email:              ${email}
Already on Rooted:  ${hasRootedAccount ? 'Yes' : 'No'}${rootedAccountEmail ? ` (${rootedAccountEmail})` : ''}
${channel}:${' '.repeat(Math.max(1, 20 - channel.length - 1))}${destinationAddress || 'not provided'}
Has used Rooted:    ${usedRooted || 'not specified'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOCIAL REACH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Handle:             ${socialHandle || 'not provided'}
Overall audience:   ${audienceSize || 'not specified'}
Platforms:          ${Array.isArray(platforms) && platforms.length > 0 ? platforms.join(', ') : 'not specified'}
${platformSizes && Object.keys(platformSizes).length > 0
  ? 'Per-platform:\n' + Object.entries(platformSizes).map(([k, v]) => `  • ${k}: ${v}`).join('\n')
  : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THEIR STORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Why Rooted:
${whyRooted || story || 'not provided'}

About their homeschool journey:
${story || 'not provided'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Review this application: https://www.rootedhomeschoolapp.com/admin/partners
`

    await sendEmail(
      'hello@rootedhomeschoolapp.com',
      `\uD83C\uDF31 New partner application \u2014 ${firstName} ${lastName}`,
      adminEmailBody,
      undefined,
      'Rooted Notifications <notifications@rootedhomeschoolapp.com>',
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[partners/apply]', err)
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 })
  }
}
