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
    const queryUrl = `https://us.posthog.com/api/projects/${projectId}/query`
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // Run event counts + active user queries in parallel
    const [eventsRes, activeRes] = await Promise.all([
      fetch(queryUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: {
            kind: 'HogQLQuery',
            query: `select event, count() as total from events where timestamp > now() - interval 7 day and event in ('memory_captured', 'lesson_completed', 'yearbook_opened', 'upgrade_page_viewed', 'upgrade_clicked') group by event`,
          },
        }),
      }),
      fetch(queryUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: {
            kind: 'HogQLQuery',
            query: `select
              countIf(DISTINCT person_id, timestamp >= toStartOfDay(now())) as active_today,
              countIf(DISTINCT person_id, timestamp >= now() - interval 7 day) as active_week,
              countIf(DISTINCT person_id, timestamp >= now() - interval 30 day) as active_month
            from events
            where event = '$pageview'
              and timestamp >= now() - interval 30 day`,
          },
        }),
      }),
    ])

    if (!eventsRes.ok) {
      const err = await eventsRes.text()
      console.error('[posthog-stats] API error:', eventsRes.status, err)
      return NextResponse.json({ error: 'PostHog API error' }, { status: 502 })
    }

    const eventsData = await eventsRes.json()
    const rows: [string, number][] = eventsData.results ?? []

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

    // Parse active user counts
    let activeToday = 0, activeWeek = 0, activeMonth = 0
    if (activeRes.ok) {
      const activeData = await activeRes.json()
      const activeRow = activeData.results?.[0]
      if (activeRow) {
        activeToday = activeRow[0] ?? 0
        activeWeek = activeRow[1] ?? 0
        activeMonth = activeRow[2] ?? 0
      }
    }

    return NextResponse.json({ ...counts, activeToday, activeWeek, activeMonth })
  } catch (err) {
    console.error('[posthog-stats] fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
