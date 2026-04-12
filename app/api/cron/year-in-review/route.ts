import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BASE_URL = 'https://www.rootedhomeschoolapp.com'

// ── Core logic ──────────────────────────────────────────────────────────

async function sendYearInReview(): Promise<{ sent: number; errors: number; total: number }> {
  // 1. Fetch paying users who haven't unsubscribed
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select('id, first_name, email_unsubscribed, plan_type, subscription_status')

  if (profileErr) {
    console.error('[year-in-review] Failed to fetch profiles:', profileErr.message)
    return { sent: 0, errors: 0, total: 0 }
  }

  const eligible = (profiles ?? []).filter(p =>
    (p.plan_type === 'founding_family' || p.subscription_status === 'active') &&
    !p.email_unsubscribed
  )

  if (eligible.length === 0) return { sent: 0, errors: 0, total: 0 }

  // 2. Fetch auth user emails (paginated)
  const emailMap = new Map<string, string>()
  let page = 1
  const perPage = 200
  while (true) {
    const { data: { users }, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) { console.error('[year-in-review] listUsers error page', page, ':', error.message); break }
    if (!users || users.length === 0) break
    for (const u of users) { if (u.email) emailMap.set(u.id, u.email) }
    if (users.length < perPage) break
    page++
  }

  // 3. Fetch all memories from the past 12 months for eligible users
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const sinceDate = oneYearAgo.toISOString().split('T')[0]

  const userIds = eligible.map(p => p.id)
  const { data: memories, error: memErr } = await supabase
    .from('memories')
    .select('user_id, type')
    .in('user_id', userIds)
    .gte('date', sinceDate)

  if (memErr) {
    console.error('[year-in-review] Failed to fetch memories:', memErr.message)
    return { sent: 0, errors: 0, total: eligible.length }
  }

  // Group memories by user
  const userMemories = new Map<string, { type: string }[]>()
  for (const m of memories ?? []) {
    const list = userMemories.get(m.user_id) ?? []
    list.push({ type: m.type })
    userMemories.set(m.user_id, list)
  }

  // 4. Send emails
  let sent = 0
  let errors = 0

  for (const profile of eligible) {
    const email = emailMap.get(profile.id)
    if (!email) continue

    const mems = userMemories.get(profile.id) ?? []
    const firstName = profile.first_name || 'there'
    const photosCount = mems.filter(m => m.type === 'photo').length
    const booksCount = mems.filter(m => m.type === 'book').length
    const winsCount = mems.filter(m => m.type === 'win' || m.type === 'moment').length
    const fieldTripsCount = mems.filter(m => m.type === 'field_trip').length
    const drawingsCount = mems.filter(m => m.type === 'drawing' || m.type === 'art').length

    const unsubscribeUrl = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}`

    try {
      const result = await sendResendTemplate(
        email,
        TEMPLATES.yearInReview,
        {
          firstName,
          totalMemories: String(mems.length),
          photosCount: String(photosCount),
          booksCount: String(booksCount),
          winsCount: String(winsCount),
          fieldTripsCount: String(fieldTripsCount),
          drawingsCount: String(drawingsCount),
          dashboardUrl: `${BASE_URL}/dashboard`,
          unsubscribeUrl,
        },
        undefined,
        `${firstName === 'there' ? 'Your' : firstName + ','} your year with Rooted 🌿`,
      )

      if (result.ok) {
        sent++
        try { await supabase.from('email_log').insert({ user_id: profile.id, email_type: 'year_in_review' }) } catch {}
      } else {
        console.error(`[year-in-review] Failed to send to ${email}:`, result.error)
        errors++
      }
    } catch (e) {
      console.error(`[year-in-review] Error sending to ${email}:`, e)
      errors++
    }
  }

  console.log(`[year-in-review] Sent ${sent}/${eligible.length}, errors: ${errors}`)
  return { sent, errors, total: eligible.length }
}

// ── GET: Vercel cron trigger ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sendYearInReview()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[year-in-review] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
