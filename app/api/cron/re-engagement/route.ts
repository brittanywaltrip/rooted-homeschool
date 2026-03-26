import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

// ALTER TABLE profiles ADD COLUMN IF NOT EXISTS re_engagement_sent boolean DEFAULT false;

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'

function emailHtml(firstName: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px;border:1px solid #ebe7e1;">
<tr><td>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">Hey ${firstName},</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">I noticed you signed up for Rooted a few days ago but haven&rsquo;t had a chance to try it yet. Life gets busy &mdash; I totally get it.</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">I built Rooted for moms like me who want to hold onto the homeschool years without it feeling like another chore. You don&rsquo;t need a curriculum set up to start. Just open the app and tap &ldquo;Capture a photo&rdquo; &mdash; one tap and your first memory is saved forever.</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">That&rsquo;s it. That&rsquo;s all it takes to start.</p>
<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#5c7f63;border-radius:10px;padding:13px 28px;">
<a href="https://rootedhomeschoolapp.com/dashboard" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">Open Rooted &rarr;</a>
</td></tr></table>
<p style="font-size:14px;line-height:1.5;color:#2d2926;margin:24px 0 0;font-weight:600;">&mdash; Brittany</p>
<p style="font-size:12px;line-height:1.4;color:#b5aca4;margin:2px 0 0;">Founder, Rooted</p>
</td></tr></table>
</td></tr></table>
</body></html>`
}

function emailText(firstName: string): string {
  return `Hey ${firstName},

I noticed you signed up for Rooted a few days ago but haven't had a chance to try it yet. Life gets busy — I totally get it.

I built Rooted for moms like me who want to hold onto the homeschool years without it feeling like another chore. You don't need a curriculum set up to start. Just open the app and tap "Capture a photo" — one tap and your first memory is saved forever.

That's it. That's all it takes to start.

Open Rooted → https://rootedhomeschoolapp.com/dashboard

— Brittany
Founder, Rooted`
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  let sent = 0
  let skipped = 0
  let errors = 0

  // Find users who: signed up 3+ days ago, onboarded, never re-engaged,
  // have 0 memories AND 0 lessons logged
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: users, error: queryError } = await supabase
    .from('profiles')
    .select('id, first_name, display_name')
    .eq('onboarded', true)
    .or('re_engagement_sent.eq.false,re_engagement_sent.is.null')
    .lt('created_at', threeDaysAgo)

  if (queryError) {
    console.error('re-engagement query error:', queryError)
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  for (const user of users ?? []) {
    // Check 0 memories
    const { count: memoryCount } = await supabase
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if ((memoryCount ?? 0) > 0) { skipped++; continue }

    // Check 0 lessons via app_events
    const { count: lessonCount } = await supabase
      .from('app_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .like('type', 'lesson%')

    if ((lessonCount ?? 0) > 0) { skipped++; continue }

    // Get email from auth
    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = user.first_name || user.display_name || 'there'

    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Hey ${firstName} — did Rooted get lost in the shuffle? 🌿`,
      text: emailText(firstName),
      html: emailHtml(firstName),
    })

    if (result.error) {
      console.error(`re-engagement error for ${email}:`, result.error)
      errors++
    } else {
      await supabase
        .from('profiles')
        .update({ re_engagement_sent: true })
        .eq('id', user.id)
      sent++
    }
  }

  return NextResponse.json({ sent, skipped, errors })
}
