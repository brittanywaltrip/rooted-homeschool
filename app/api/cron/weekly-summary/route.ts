import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'
import { emailFooterHtml, emailFooterText } from '@/lib/email-footer'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'
const TEST_EMAIL = 'garfieldbrittany@gmail.com'

// ── Email template ──────────────────────────────────────────────────────────

function emailHtml(name: string, summaryLine: string, memCount: number): string {
  const greeting = name ? `Hi ${name},` : 'Hi there,'
  const memLabel = memCount === 1 ? 'memory' : 'memories'

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px;border:1px solid #ebe7e1;">
<tr><td>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">${greeting}</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">${summaryLine}</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">You captured <strong>${memCount} ${memLabel}</strong> this week. Every one is a page in your family's story. 🌿</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">Keep going — you're building something your kids will treasure.</p>
<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#5c7f63;border-radius:10px;padding:13px 28px;">
<a href="https://www.rootedhomeschoolapp.com/dashboard/memories" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">See your memories &rarr;</a>
</td></tr></table>
<p style="font-size:14px;line-height:1.5;color:#7a6f65;margin:0 0 4px;">If you run into anything or just want to share how homeschooling is going &mdash; reply to this email. I read every single one.</p>
<p style="font-size:14px;line-height:1.5;color:#2d2926;margin:24px 0 0;font-weight:600;">&mdash; Brittany</p>
<p style="font-size:12px;line-height:1.4;color:#b5aca4;margin:2px 0 0;">Founder, Rooted</p>
${emailFooterHtml()}
</td></tr></table>
</td></tr></table>
</body></html>`
}

// ── Build a friendly summary sentence from lessons + memories ────────────

function buildSummary(
  lessons: { title: string; child_name: string | null }[],
  memories: { type: string }[],
): string {
  // Pick up to 2 notable highlights from lessons
  const highlights: string[] = []
  const childLessons = new Map<string, string[]>()
  for (const l of lessons) {
    const child = l.child_name ?? 'Your family'
    const list = childLessons.get(child) ?? []
    list.push(l.title)
    childLessons.set(child, list)
  }

  for (const [child, titles] of childLessons) {
    if (highlights.length >= 2) break
    const title = titles[0]
    if (title) {
      highlights.push(`${child} finished ${title}`)
    }
  }

  // Count memory types for color
  const bookCount = memories.filter(m => m.type === 'book').length
  const winCount = memories.filter(m => m.type === 'win' || m.type === 'moment').length
  const photoCount = memories.filter(m => m.type === 'photo').length
  const drawingCount = memories.filter(m => m.type === 'drawing').length

  if (highlights.length < 2 && bookCount > 0) {
    highlights.push(`${bookCount} book${bookCount !== 1 ? 's' : ''} logged`)
  }
  if (highlights.length < 2 && winCount > 0) {
    highlights.push(`${winCount} win${winCount !== 1 ? 's' : ''} captured`)
  }
  if (highlights.length < 2 && photoCount > 0) {
    highlights.push(`${photoCount} photo${photoCount !== 1 ? 's' : ''} saved`)
  }
  if (highlights.length < 2 && drawingCount > 0) {
    highlights.push(`${drawingCount} drawing${drawingCount !== 1 ? 's' : ''} added`)
  }

  if (highlights.length === 0) {
    return `Last week was a great week of homeschooling.`
  }

  return `Last week: ${highlights.join(' and ')}.`
}

// ── Core logic (shared by GET cron + POST test) ─────────────────────────

async function sendWeeklySummaries(testOnly: boolean): Promise<{ sent: number; totalUsers: number }> {
  const resend = new Resend(process.env.RESEND_API_KEY)

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const since7 = sevenDaysAgo.toISOString().split('T')[0]

  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
  const since14 = fourteenDaysAgo.toISOString().split('T')[0]

  // Find active users: logged a memory or completed a lesson in the last 14 days
  const [{ data: recentMemories }, { data: recentLessons }] = await Promise.all([
    supabase.from('memories').select('user_id, type').gte('date', since14),
    supabase.from('lessons').select('user_id').eq('completed', true).gte('scheduled_date', since14),
  ])

  const activeUserIds = new Set<string>()
  for (const m of recentMemories ?? []) activeUserIds.add(m.user_id)
  for (const l of recentLessons ?? []) activeUserIds.add(l.user_id)

  if (activeUserIds.size === 0) return { sent: 0, totalUsers: 0 }

  // Fetch this week's data (last 7 days) for the email content
  const [{ data: weekMemories }, { data: weekLessons }] = await Promise.all([
    supabase.from('memories').select('user_id, type').gte('date', since7),
    supabase.from('lessons').select('user_id, title, child_id')
      .eq('completed', true).gte('scheduled_date', since7),
  ])

  // Fetch children for name mapping
  const allChildIds = new Set<string>()
  for (const l of weekLessons ?? []) {
    if (l.child_id) allChildIds.add(l.child_id)
  }
  const childNameMap = new Map<string, string>()
  if (allChildIds.size > 0) {
    const { data: children } = await supabase
      .from('children')
      .select('id, name')
      .in('id', [...allChildIds])
    for (const c of children ?? []) {
      childNameMap.set(c.id, c.name)
    }
  }

  // Group data by user
  const userMemories = new Map<string, { type: string }[]>()
  for (const m of weekMemories ?? []) {
    const list = userMemories.get(m.user_id) ?? []
    list.push({ type: m.type })
    userMemories.set(m.user_id, list)
  }

  const userLessons = new Map<string, { title: string; child_name: string | null }[]>()
  for (const l of weekLessons ?? []) {
    const list = userLessons.get(l.user_id) ?? []
    list.push({ title: l.title, child_name: l.child_id ? (childNameMap.get(l.child_id) ?? null) : null })
    userLessons.set(l.user_id, list)
  }

  // Fetch profiles + emails
  const userIds = [...activeUserIds]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, first_name')
    .in('id', userIds)

  const { data: listData } = await supabase.auth.admin.listUsers()
  const users = listData?.users ?? []
  const emailMap = new Map<string, string>()
  for (const u of users) {
    if (u.email) emailMap.set(u.id, u.email)
  }

  // In test mode, only send to the test email
  let targetUsers = userIds
  if (testOnly) {
    const testUserId = [...emailMap.entries()].find(([, email]) => email === TEST_EMAIL)?.[0]
    if (!testUserId) {
      // If test user has no activity, still send a sample email
      const sampleProfile = (profiles ?? [])[0]
      const sampleName = sampleProfile?.first_name ?? 'Brittany'
      await resend.emails.send({
        from: FROM,
        to: TEST_EMAIL,
        subject: 'Your week with Rooted 🌿',
        text: `Hi ${sampleName}, Last week was a great week of homeschooling. You captured 0 memories this week.\n\n— Brittany\nFounder, Rooted${emailFooterText()}`,
        html: emailHtml(sampleName, 'Last week was a great week of homeschooling.', 0),
      })
      return { sent: 1, totalUsers: 1 }
    }
    targetUsers = [testUserId]
  }

  let sent = 0
  for (const userId of targetUsers) {
    const email = emailMap.get(userId)
    if (!email) continue
    if (testOnly && email !== TEST_EMAIL) continue

    const profile = (profiles ?? []).find(p => p.id === userId) as { first_name?: string } | undefined
    const name = profile?.first_name ?? ''
    const mems = userMemories.get(userId) ?? []
    const lessons = userLessons.get(userId) ?? []
    const summaryLine = buildSummary(lessons, mems)

    try {
      const result = await sendResendTemplate(email, TEMPLATES.weeklySummary, {
        firstName: name || 'there',
        weeklySummary: `${summaryLine} You captured ${mems.length} ${mems.length === 1 ? 'memory' : 'memories'} this week.`,
        memoriesUrl: 'https://www.rootedhomeschoolapp.com/dashboard/memories',
      })
      if (result.ok) sent++
      else console.error(`[weekly-summary] Failed to send to ${email}:`, result.error)
    } catch (e) {
      console.error(`[weekly-summary] Failed to send to ${email}:`, e)
    }
  }

  return { sent, totalUsers: activeUserIds.size }
}

// ── GET: Vercel cron trigger ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sendWeeklySummaries(false)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[weekly-summary] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ── POST: Admin manual trigger (test=true sends only to test email) ─────

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const testOnly = url.searchParams.get('test') === 'true'
    const result = await sendWeeklySummaries(testOnly)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[weekly-summary] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
