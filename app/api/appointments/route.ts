import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user
}

// ─── Recurrence expansion ────────────────────────────────────────────────────

type RecurrenceRule = {
  frequency: 'weekly' | 'biweekly' | 'monthly'
  days: number[]       // 0=Sun … 6=Sat
  end_date?: string    // YYYY-MM-DD
}

type AppointmentRow = {
  id: string
  user_id: string
  title: string
  emoji: string
  date: string
  time: string | null
  duration_minutes: number
  location: string | null
  notes: string | null
  child_ids: string[]
  is_recurring: boolean
  recurrence_rule: RecurrenceRule | null
  completed: boolean
  created_at: string
}

type ExpandedAppointment = AppointmentRow & { instance_date: string }

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function expandRecurring(
  appt: AppointmentRow,
  rangeStart: string,
  rangeEnd: string,
): ExpandedAppointment[] {
  const rule = appt.recurrence_rule

  // No rule or no days: just return the appointment on its own date if in range
  if (!rule || !rule.days || rule.days.length === 0) {
    if (appt.date >= rangeStart && appt.date <= rangeEnd) {
      return [{ ...appt, instance_date: appt.date }]
    }
    return []
  }

  const results: ExpandedAppointment[] = []
  const addedDates = new Set<string>()
  const start = new Date(rangeStart + 'T00:00:00')
  const end = new Date(rangeEnd + 'T00:00:00')
  const ruleEnd = rule.end_date ? new Date(rule.end_date + 'T00:00:00') : null
  const apptStart = new Date(appt.date + 'T00:00:00')

  // Always include the appointment's own start date if it falls within the range
  if (appt.date >= rangeStart && appt.date <= rangeEnd && (!ruleEnd || apptStart <= ruleEnd)) {
    results.push({ ...appt, instance_date: appt.date })
    addedDates.add(appt.date)
  }

  // For biweekly: determine the reference week from the appointment's start date
  const biweeklyRef = Math.floor(apptStart.getTime() / (7 * 86400000))

  const cursor = new Date(start)
  while (cursor <= end) {
    if (ruleEnd && cursor > ruleEnd) break
    if (cursor < apptStart) { cursor.setDate(cursor.getDate() + 1); continue }

    const dow = cursor.getDay()
    if (rule.days.includes(dow)) {
      let include = true

      if (rule.frequency === 'biweekly') {
        const cursorWeek = Math.floor(cursor.getTime() / (7 * 86400000))
        include = (cursorWeek - biweeklyRef) % 2 === 0
      } else if (rule.frequency === 'monthly') {
        const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
        let count = 0
        for (let d = new Date(firstOfMonth); d <= cursor; d.setDate(d.getDate() + 1)) {
          if (d.getDay() === dow) count++
        }
        const origFirstOfMonth = new Date(apptStart.getFullYear(), apptStart.getMonth(), 1)
        let origCount = 0
        for (let d = new Date(origFirstOfMonth); d <= apptStart; d.setDate(d.getDate() + 1)) {
          if (d.getDay() === apptStart.getDay()) origCount++
        }
        include = count === origCount
      }

      if (include) {
        const ds = fmtDate(cursor)
        if (!addedDates.has(ds)) {
          results.push({ ...appt, instance_date: ds })
          addedDates.add(ds)
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return results
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dateParam = req.nextUrl.searchParams.get('date')

  // Determine query range
  const today = new Date()
  const rangeStart = dateParam ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  let rangeEnd: string
  if (dateParam) {
    rangeEnd = dateParam
  } else {
    const end = new Date(today)
    end.setDate(end.getDate() + 30)
    rangeEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
  }

  // Fetch one-off appointments in the range
  const { data: oneOff, error: e1 } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_recurring', false)
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
    .order('date', { ascending: true })
    .order('time', { ascending: true, nullsFirst: true })

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // Fetch recurring appointments that started on or before rangeEnd
  const { data: recurring, error: e2 } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_recurring', true)
    .lte('date', rangeEnd)

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  // Expand recurring into instances
  const expanded: ExpandedAppointment[] = []
  for (const appt of (oneOff ?? []) as AppointmentRow[]) {
    expanded.push({ ...appt, instance_date: appt.date })
  }
  for (const appt of (recurring ?? []) as AppointmentRow[]) {
    expanded.push(...expandRecurring(appt, rangeStart, rangeEnd))
  }

  // Sort: date asc, time asc (nulls first = all-day at top)
  expanded.sort((a, b) => {
    const dateCmp = a.instance_date.localeCompare(b.instance_date)
    if (dateCmp !== 0) return dateCmp
    if (a.time === null && b.time === null) return 0
    if (a.time === null) return -1
    if (b.time === null) return 1
    return a.time.localeCompare(b.time)
  })

  return NextResponse.json(expanded)
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, date } = body
  if (!title || !date) return NextResponse.json({ error: 'title and date are required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      user_id: user.id,
      title,
      emoji: body.emoji ?? '📅',
      date,
      time: body.time ?? null,
      duration_minutes: body.duration_minutes ?? 60,
      location: body.location ?? null,
      notes: body.notes ?? null,
      child_ids: body.child_ids ?? [],
      is_recurring: body.is_recurring ?? false,
      recurrence_rule: body.recurrence_rule ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ─── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const allowed = [
    'title', 'emoji', 'date', 'time', 'duration_minutes',
    'location', 'notes', 'child_ids', 'is_recurring', 'recurrence_rule', 'completed',
  ] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) patch[key] = fields[key]
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
