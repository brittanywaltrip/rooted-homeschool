import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    // Email to Brittany (admin notification — keep as plain text via fetch)
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Rooted Partners <hello@rootedhomeschoolapp.com>',
        to: 'hello@rootedhomeschoolapp.com',
        subject: `🌱 New partner application — ${firstName} ${lastName}`,
        text: `Name: ${firstName} ${lastName}\nEmail: ${email}\nPlatforms: ${(platforms as string[]).join(', ')}\nUsed Rooted: ${usedRooted || 'not specified'}\nAbout their journey: ${story}\nWhat they'd share: ${whatToShare || 'not specified'}\nPost frequency: ${postFrequency || 'not specified'}\nPayPal: ${paypalEmail || 'not provided'}\n\nPlatform details:\n${platformSummary}\n\nReview it here: https://www.rootedhomeschoolapp.com/admin`,
      }),
    })

    // Confirmation email to applicant
    await sendResendTemplate(email, TEMPLATES.partnerApplication, {
      firstName,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[partners/apply]', err)
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 })
  }
}
