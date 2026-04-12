import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { emailFooterHtml } from '@/lib/email-footer'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'

function buildHtml(firstName: string): string {
  return `<div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #2d2926; background: #fefcf9;">
  <div style="text-align:center;margin-bottom:24px;"><img src="https://rootedhomeschoolapp.com/rooted-logo-nav.png" alt="Rooted" width="130" style="display:inline-block;" /></div>
  <p>Hi ${firstName},</p>
  <p>You started setting up Rooted yesterday but didn't quite finish — your garden is ready and waiting for you.</p>
  <p>It only takes about 2 minutes to complete your setup and see your family's space come to life.</p>
  <p style="margin: 32px 0;">
    <a href="https://www.rootedhomeschoolapp.com/onboarding" style="background: #2D5A3D; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 16px;">Finish setting up →</a>
  </p>
  <p>Can't wait to show you what's inside,</p>
  <p>Brittany<br/>Founder, Rooted</p>
  ${emailFooterHtml()}
</div>`
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const ago49h = new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString()
    const ago23h = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString()

    // Find users who started onboarding 23-49h ago but didn't finish
    const { data: profiles, error: profileErr } = await supabase
      .from('profiles')
      .select('id, first_name, email_unsubscribed')
      .eq('onboarded', false)
      .not('first_name', 'is', null)
      .gte('created_at', ago49h)
      .lte('created_at', ago23h)

    if (profileErr) {
      console.error('[onboarding-reminder] Failed to fetch profiles:', profileErr.message)
      return NextResponse.json({ error: profileErr.message }, { status: 500 })
    }

    const eligible = (profiles ?? []).filter(p => !p.email_unsubscribed)
    if (eligible.length === 0) {
      return NextResponse.json({ sent: 0, total: 0 })
    }

    // Get emails from auth
    const emailMap = new Map<string, string>()
    let page = 1
    const perPage = 200
    while (true) {
      const { data: { users }, error } = await supabase.auth.admin.listUsers({ page, perPage })
      if (error || !users || users.length === 0) break
      for (const u of users) { if (u.email) emailMap.set(u.id, u.email) }
      if (users.length < perPage) break
      page++
    }

    let sent = 0
    for (const profile of eligible) {
      const email = emailMap.get(profile.id)
      if (!email) continue

      // Skip if already sent
      const { data: alreadySent } = await supabase
        .from('email_log')
        .select('id')
        .eq('user_id', profile.id)
        .eq('email_type', 'onboarding_reminder')
        .limit(1)
      if (alreadySent && alreadySent.length > 0) continue

      const firstName = profile.first_name || 'there'

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM,
            to: email,
            subject: 'Your Rooted garden is waiting 🌱',
            html: buildHtml(firstName),
          }),
        })

        if (res.ok) {
          sent++
          try { await supabase.from('email_log').insert({ user_id: profile.id, email_type: 'onboarding_reminder' }) } catch {}
        } else {
          console.error(`[onboarding-reminder] Failed to send to ${email}:`, await res.text())
        }
      } catch (e) {
        console.error(`[onboarding-reminder] Error sending to ${email}:`, e)
      }
    }

    console.log(`[onboarding-reminder] Sent ${sent}/${eligible.length}`)
    return NextResponse.json({ sent, total: eligible.length })
  } catch (err) {
    console.error('[onboarding-reminder] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
