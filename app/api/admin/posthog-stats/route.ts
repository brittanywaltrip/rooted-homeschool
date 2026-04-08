import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAILS = ['garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com']

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  // Auth check
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user || !ADMIN_EMAILS.includes(user.email ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY
  const projectId = process.env.POSTHOG_PROJECT_ID

  if (!apiKey || !projectId) {
    return NextResponse.json({
      memory_captured: 0,
      lesson_completed: 0,
      yearbook_opened: 0,
      upgrade_page_viewed: 0,
      upgrade_clicked: 0,
      _status: 'not_configured',
    })
  }

  try {
    const res = await fetch(`https://us.posthog.com/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `select event, count() as total from events where timestamp > now() - interval 7 day and event in ('memory_captured', 'lesson_completed', 'yearbook_opened', 'upgrade_page_viewed', 'upgrade_clicked') group by event`,
        },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[posthog-stats] API error:', res.status, err)
      return NextResponse.json({ error: 'PostHog API error' }, { status: 502 })
    }

    const data = await res.json()
    const rows: [string, number][] = data.results ?? []

    const counts: Record<string, number> = {
      memory_captured: 0,
      lesson_completed: 0,
      yearbook_opened: 0,
      upgrade_page_viewed: 0,
      upgrade_clicked: 0,
    }

    for (const [event, total] of rows) {
      if (event in counts) counts[event] = total
    }

    // Active user counts
    const activeRes = await fetch(`https://us.posthog.com/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `SELECT
            countIf(DISTINCT person_id, timestamp >= today()) as active_today,
            countIf(DISTINCT person_id, timestamp >= today() - interval 7 day) as active_week,
            countIf(DISTINCT person_id, timestamp >= today() - interval 30 day) as active_month
          FROM events
          WHERE event = '$pageview'`,
        },
      }),
    })

    let activeToday = 0, activeWeek = 0, activeMonth = 0
    if (activeRes.ok) {
      const activeData = await activeRes.json()
      const row = activeData.results?.[0]
      if (row) {
        activeToday = row[0] ?? 0
        activeWeek = row[1] ?? 0
        activeMonth = row[2] ?? 0
      }
    }

    return NextResponse.json({ ...counts, activeToday, activeWeek, activeMonth })
  } catch (err) {
    console.error('[posthog-stats] fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
