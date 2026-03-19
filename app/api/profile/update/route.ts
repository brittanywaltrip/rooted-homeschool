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
  console.log('[profile/update] incoming body:', JSON.stringify(body))
  console.log('[profile/update] user.id:', user.id)

  // Accept any subset of updatable profile fields
  const allowed = ['family_photo_url', 'state', 'onboarded', 'display_name', 'partner_email', 'family_name', 'avatar_url', 'first_name', 'last_name'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  console.log('[profile/update] patch being applied:', JSON.stringify(patch))

  if (Object.keys(patch).length === 0) {
    console.log('[profile/update] ERROR: no valid fields in body')
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  // upsert: creates row if missing, updates if exists (fixes silent no-op for new accounts)
  const { data: upsertData, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, onboarded: true, ...patch }, { onConflict: 'id' })
    .select()

  console.log('[profile/update] supabase upsert result — data:', JSON.stringify(upsertData), 'error:', error ? error.message : null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
