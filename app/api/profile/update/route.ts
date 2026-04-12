import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Accept any subset of updatable profile fields
  const allowed = ['family_photo_url', 'state', 'onboarded', 'display_name', 'partner_email', 'family_name', 'avatar_url', 'first_name', 'last_name', 'referred_by', 'onboarded_at', 'school_days'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  // upsert: creates row if missing, updates if exists (fixes silent no-op for new accounts)
  const { data: upsertData, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...patch }, { onConflict: 'id' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sync first_name / last_name to auth user_metadata so it's available everywhere
  if (patch.first_name !== undefined || patch.last_name !== undefined) {
    const metaUpdate: Record<string, unknown> = {}
    if (patch.first_name !== undefined) metaUpdate.first_name = patch.first_name
    if (patch.last_name !== undefined) metaUpdate.last_name = patch.last_name
    await supabase.auth.admin.updateUserById(user.id, { user_metadata: metaUpdate })
  }

  return NextResponse.json({ ok: true })
}
