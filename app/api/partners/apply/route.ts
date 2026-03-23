import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { firstName, lastName, email, platform, profileLink, audienceSize, story, usedRooted } = body

  if (!firstName || !lastName || !email || !platform || !profileLink || !story) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    // Email to Brittany
    await resend.emails.send({
      from: 'Rooted Partners <hello@rootedhomeschoolapp.com>',
      to: 'garfieldbrittany@gmail.com',
      subject: `🤝 New Partner Application — ${firstName} ${lastName}`,
      text: `New partner application!\n\nName: ${firstName} ${lastName}\nEmail: ${email}\nPlatform: ${platform}\nProfile: ${profileLink}\nAudience: ${audienceSize}\nUsed Rooted: ${usedRooted}\n\nTheir story:\n${story}`
    })

    // Confirmation email to applicant
    await resend.emails.send({
      from: 'Brittany at Rooted <hello@rootedhomeschoolapp.com>',
      to: email,
      subject: 'We received your Rooted Partner application 🌱',
      text: `Hi ${firstName},\n\nThank you so much for applying to become a Rooted Partner — it genuinely means a lot that you're interested.\n\nI review every application personally and will be in touch within 3–5 business days.\n\nIn the meantime, if you haven't already, feel free to explore the app at rootedhomeschoolapp.com.\n\n— Brittany\nFounder, Rooted Homeschool`
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[partners/apply]', err)
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 })
  }
}
