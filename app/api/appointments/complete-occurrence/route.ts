import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user
}

// Mark a single recurring-appointment occurrence as completed.
//
// Why a focused endpoint instead of the main PATCH scope="this" flow?
// scope="this" upserts override_fields + skipped. Sending `completed`
// through that path would either (a) bury it inside override_fields (the
// column is more discoverable) or (b) make the upsert overwrite an
// existing override the user already saved (e.g. they edited the title
// for one occurrence and now want to mark it done — that override must
// survive). This endpoint writes ONLY the completed column, so existing
// override_fields/skipped on the same (appointment_id, exception_date)
// row are preserved on conflict.
//
// Body: { id: string, instance_date: "YYYY-MM-DD" }
export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>
  const id = body.id as string | undefined
  const instanceDate = body.instance_date as string | undefined
  if (!id || !instanceDate) {
    return NextResponse.json({ error: 'id and instance_date are required' }, { status: 400 })
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
        completed: true,
      },
      { onConflict: 'appointment_id,exception_date' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
