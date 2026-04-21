import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { nativeToApptDayIdx } from '@/app/lib/day-of-week'

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

type AppointmentException = {
  id: string
  appointment_id: string
  exception_date: string
  override_fields: Partial<AppointmentRow> | null
  skipped: boolean
}

// Expanded-instance shape. `exception_id` is set when this instance has an
// override row applied; the client uses it to know edits/deletes are
// targeting an existing exception vs. creating a new one.
type ExpandedAppointment = AppointmentRow & {
  instance_date: string
  exception_id?: string | null
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return fmtDate(d)
}

/** Fields callers are allowed to update directly on the base appointment
 * row (scope="series" path). Also the set of fields copied/overlaid when
 * splitting or building exception overrides. */
const ALLOWED_FIELDS = [
  'title', 'emoji', 'date', 'time', 'duration_minutes',
  'location', 'notes', 'child_ids', 'is_recurring', 'recurrence_rule', 'completed',
] as const

type EditableKey = (typeof ALLOWED_FIELDS)[number]

function pickAllowed(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of ALLOWED_FIELDS) {
    if (k in body) out[k] = body[k]
  }
  return out
}

/** Merge exception.override_fields over the base appointment row. Only keys
 * present in override_fields win; everything else keeps base values. */
function applyOverride(
  base: AppointmentRow,
  override: Partial<AppointmentRow> | null,
): AppointmentRow {
  if (!override) return base
  const merged: AppointmentRow = { ...base }
  for (const k of Object.keys(override) as EditableKey[]) {
    // We only allow editable keys through — ignore anything else the client
    // may have shoved into override_fields.
    if ((ALLOWED_FIELDS as readonly string[]).includes(k)) {
      // Cast through unknown so TS doesn't fight the Partial<Row>→Row narrowing.
      (merged as unknown as Record<string, unknown>)[k] =
        (override as unknown as Record<string, unknown>)[k]
    }
  }
  return merged
}

function expandRecurring(
  appt: AppointmentRow,
  rangeStart: string,
  rangeEnd: string,
  exceptionsForAppt: Map<string, AppointmentException>,
): ExpandedAppointment[] {
  const rule = appt.recurrence_rule

  const emitInstance = (ds: string): ExpandedAppointment | null => {
    const exc = exceptionsForAppt.get(ds)
    if (exc?.skipped) return null
    const base: AppointmentRow = exc?.override_fields
      ? applyOverride(appt, exc.override_fields)
      : appt
    return { ...base, id: appt.id, instance_date: ds, exception_id: exc?.id ?? null }
  }

  // No rule or no days: just return the appointment on its own date if in range
  if (!rule || !rule.days || rule.days.length === 0) {
    if (appt.date >= rangeStart && appt.date <= rangeEnd) {
      const inst = emitInstance(appt.date)
      return inst ? [inst] : []
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
    const inst = emitInstance(appt.date)
    if (inst) {
      results.push(inst)
      addedDates.add(appt.date)
    } else {
      // Still reserve the slot so duplicate-prevention catches recurrence hits.
      addedDates.add(appt.date)
    }
  }

  // For biweekly: determine the reference week from the appointment's start date
  const biweeklyRef = Math.floor(apptStart.getTime() / (7 * 86400000))

  const cursor = new Date(start)
  while (cursor <= end) {
    if (ruleEnd && cursor > ruleEnd) break
    if (cursor < apptStart) { cursor.setDate(cursor.getDate() + 1); continue }

    const dow = nativeToApptDayIdx(cursor.getDay())
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
          const inst = emitInstance(ds)
          if (inst) results.push(inst)
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
  const endParam = req.nextUrl.searchParams.get('end')

  // Determine query range
  const today = new Date()
  const rangeStart = dateParam ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  let rangeEnd: string
  if (endParam) {
    rangeEnd = endParam
  } else if (dateParam) {
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

  // Batch-load exceptions for the recurring appointments in this range. We
  // fetch exceptions for the full visible window, not just by appointment id,
  // so a single roundtrip covers the whole grid.
  const recurringIds = (recurring ?? []).map((a) => (a as AppointmentRow).id)
  const exceptionsByAppt = new Map<string, Map<string, AppointmentException>>()
  if (recurringIds.length > 0) {
    const { data: exceptions, error: e3 } = await supabaseAdmin
      .from('appointment_exceptions')
      .select('id, appointment_id, exception_date, override_fields, skipped')
      .in('appointment_id', recurringIds)
      .gte('exception_date', rangeStart)
      .lte('exception_date', rangeEnd)
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 })
    for (const row of (exceptions ?? []) as AppointmentException[]) {
      let bucket = exceptionsByAppt.get(row.appointment_id)
      if (!bucket) {
        bucket = new Map()
        exceptionsByAppt.set(row.appointment_id, bucket)
      }
      bucket.set(row.exception_date, row)
    }
  }

  // Expand recurring into instances
  const expanded: ExpandedAppointment[] = []
  for (const appt of (oneOff ?? []) as AppointmentRow[]) {
    expanded.push({ ...appt, instance_date: appt.date, exception_id: null })
  }
  for (const appt of (recurring ?? []) as AppointmentRow[]) {
    const bucket = exceptionsByAppt.get(appt.id) ?? new Map<string, AppointmentException>()
    expanded.push(...expandRecurring(appt, rangeStart, rangeEnd, bucket))
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
//
// Scope handling for recurring appointments:
//   - "series"  (default / omitted)  → update the base appointment row
//   - "this"                         → upsert appointment_exceptions with
//                                      override_fields set (single occurrence
//                                      only; base row unchanged)
//   - "future"                       → cap the base row's recurrence_rule.end_date
//                                      at the day before instance_date, then
//                                      INSERT a new appointment starting on
//                                      instance_date carrying the edited fields
//                                      + original rule days/frequency.
//
// Non-recurring PATCH calls (scope absent or "series") keep their existing
// behavior — this is safety rule 4 in the phase spec.
export async function PATCH(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>
  const id = body.id as string | undefined
  const scope = body.scope as ('this' | 'future' | 'series' | undefined)
  const instanceDate = body.instance_date as string | undefined
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch = pickAllowed(body)
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  // scope="this" — create or update an exception row. The base row is left
  // alone so other occurrences continue to render from the series.
  if (scope === 'this') {
    if (!instanceDate) {
      return NextResponse.json({ error: 'instance_date is required for scope=this' }, { status: 400 })
    }
    // Ownership check — only the appointment owner can attach exceptions.
    const { data: baseOwn } = await supabaseAdmin
      .from('appointments')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle()
    if (!baseOwn || (baseOwn as { user_id: string }).user_id !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const { data, error } = await supabaseAdmin
      .from('appointment_exceptions')
      .upsert(
        {
          appointment_id: id,
          exception_date: instanceDate,
          override_fields: patch,
          skipped: false,
        },
        { onConflict: 'appointment_id,exception_date' },
      )
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, exception: data })
  }

  // scope="future" — split the series. Cap the base row and insert a new
  // appointment for instance_date onward with the edited fields + carry the
  // base's recurrence rule.
  if (scope === 'future') {
    if (!instanceDate) {
      return NextResponse.json({ error: 'instance_date is required for scope=future' }, { status: 400 })
    }
    const { data: base } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!base) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const baseRow = base as AppointmentRow

    // Cap old series' end_date. Keep existing rule days/frequency.
    const oldRule = baseRow.recurrence_rule
    const capped: RecurrenceRule | null = oldRule
      ? { ...oldRule, end_date: dayBefore(instanceDate) }
      : null
    const { error: capErr } = await supabaseAdmin
      .from('appointments')
      .update({ recurrence_rule: capped })
      .eq('id', id)
      .eq('user_id', user.id)
    if (capErr) return NextResponse.json({ error: capErr.message }, { status: 500 })

    // Any exceptions on dates >= instance_date now belong to a series window
    // that no longer emits — clear them so they don't resurrect if the user
    // later extends the old series.
    await supabaseAdmin
      .from('appointment_exceptions')
      .delete()
      .eq('appointment_id', id)
      .gte('exception_date', instanceDate)

    // Build the new row: base values + edited overrides, starting at
    // instance_date, same rule (minus any end_date change the user didn't ask
    // for — we preserve the user's original end_date if it was set).
    const newRow: Partial<AppointmentRow> = {
      ...baseRow,
      ...patch,
      id: undefined as unknown as string,
      created_at: undefined as unknown as string,
      date: instanceDate,
      user_id: user.id,
      is_recurring: true,
      recurrence_rule: oldRule ? { ...oldRule } : null,
    }
    // Strip fields we shouldn't reinsert.
    delete newRow.id
    delete newRow.created_at

    const { data: created, error: insErr } = await supabaseAdmin
      .from('appointments')
      .insert(newRow)
      .select()
      .single()
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, appointment: created })
  }

  // scope="series" (default): existing behaviour.
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
//
// Scope handling mirrors PATCH:
//   - "series" (default / omitted) → delete the appointment row (cascades to
//                                    exceptions via FK ON DELETE CASCADE)
//   - "this"                        → upsert a skipped exception for that date
//   - "future"                      → cap the base row's recurrence_rule.end_date
export async function DELETE(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>
  const id = body.id as string | undefined
  const scope = body.scope as ('this' | 'future' | 'series' | undefined)
  const instanceDate = body.instance_date as string | undefined
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (scope === 'this') {
    if (!instanceDate) {
      return NextResponse.json({ error: 'instance_date is required for scope=this' }, { status: 400 })
    }
    const { data: baseOwn } = await supabaseAdmin
      .from('appointments')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle()
    if (!baseOwn || (baseOwn as { user_id: string }).user_id !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const { error } = await supabaseAdmin
      .from('appointment_exceptions')
      .upsert(
        {
          appointment_id: id,
          exception_date: instanceDate,
          override_fields: null,
          skipped: true,
        },
        { onConflict: 'appointment_id,exception_date' },
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (scope === 'future') {
    if (!instanceDate) {
      return NextResponse.json({ error: 'instance_date is required for scope=future' }, { status: 400 })
    }
    const { data: base } = await supabaseAdmin
      .from('appointments')
      .select('recurrence_rule')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!base) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const oldRule = (base as { recurrence_rule: RecurrenceRule | null }).recurrence_rule
    const capped: RecurrenceRule | null = oldRule
      ? { ...oldRule, end_date: dayBefore(instanceDate) }
      : null
    const { error } = await supabaseAdmin
      .from('appointments')
      .update({ recurrence_rule: capped })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Clear exceptions beyond the cap.
    await supabaseAdmin
      .from('appointment_exceptions')
      .delete()
      .eq('appointment_id', id)
      .gte('exception_date', instanceDate)
    return NextResponse.json({ ok: true })
  }

  // scope="series" (default): existing behaviour — cascade handles exceptions.
  const { error } = await supabaseAdmin
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
