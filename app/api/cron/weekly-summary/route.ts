import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'

function emailHtml(name: string, memCount: number, bookCount: number, winCount: number): string {
  const greeting = name ? `Hi ${name},` : 'Hi there,'
  const memLine = `You captured <strong>${memCount} memor${memCount === 1 ? 'y' : 'ies'}</strong> this week.`
  const extras: string[] = []
  if (bookCount > 0) extras.push(`📖 ${bookCount} book${bookCount !== 1 ? 's' : ''} logged`)
  if (winCount > 0) extras.push(`🏆 ${winCount} win${winCount !== 1 ? 's' : ''} captured`)
  const extraHtml = extras.length > 0
    ? `<p style="font-size:14px;line-height:1.6;color:#5c7f63;margin:0 0 14px;">${extras.join(' &nbsp;·&nbsp; ')}</p>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px;border:1px solid #ebe7e1;">
<tr><td>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">${greeting}</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">${memLine}</p>
${extraHtml}
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">Every memory you save is a page in your family's story. Keep going — you're doing something your kids will treasure.</p>
<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#5c7f63;border-radius:10px;padding:13px 28px;">
<a href="https://www.rootedhomeschoolapp.com/dashboard" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">Open your dashboard &rarr;</a>
</td></tr></table>
<p style="font-size:14px;line-height:1.5;color:#2d2926;margin:24px 0 0;font-weight:600;">&mdash; Brittany</p>
<p style="font-size:12px;line-height:1.4;color:#b5aca4;margin:2px 0 0;">Founder, Rooted</p>
</td></tr></table>
</td></tr></table>
</body></html>`
}

export async function GET() {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)

    // Find users who logged at least one memory in the last 7 days
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const since = sevenDaysAgo.toISOString().split('T')[0]

    const { data: recentMemories } = await supabase
      .from('memories')
      .select('user_id, type')
      .gte('date', since)

    if (!recentMemories || recentMemories.length === 0) {
      return NextResponse.json({ sent: 0 })
    }

    // Group by user
    const userStats = new Map<string, { total: number; books: number; wins: number }>()
    for (const m of recentMemories) {
      const s = userStats.get(m.user_id) ?? { total: 0, books: 0, wins: 0 }
      s.total++
      if (m.type === 'book') s.books++
      if (m.type === 'win') s.wins++
      userStats.set(m.user_id, s)
    }

    // Fetch user emails + names
    const userIds = [...userStats.keys()]
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, first_name, display_name')
      .in('id', userIds)

    const { data: { users } } = await supabase.auth.admin.listUsers()
    const emailMap = new Map<string, string>()
    for (const u of users ?? []) {
      if (u.email) emailMap.set(u.id, u.email)
    }

    let sent = 0
    for (const [userId, stats] of userStats) {
      const email = emailMap.get(userId)
      if (!email) continue

      const profile = (profiles ?? []).find(p => p.id === userId) as { first_name?: string; display_name?: string } | undefined
      const name = profile?.first_name ?? ''

      try {
        await resend.emails.send({
          from: FROM,
          to: email,
          subject: 'Your week in Rooted 🌿',
          text: `${name ? `Hi ${name}` : 'Hi'}, you captured ${stats.total} memories this week. Keep going!\n\n— Brittany\nFounder, Rooted`,
          html: emailHtml(name, stats.total, stats.books, stats.wins),
        })
        sent++
      } catch (e) {
        console.error(`[weekly-summary] Failed to send to ${email}:`, e)
      }
    }

    return NextResponse.json({ sent, totalUsers: userStats.size })
  } catch (err) {
    console.error('[weekly-summary] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
