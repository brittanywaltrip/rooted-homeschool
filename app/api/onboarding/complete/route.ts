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

  const { familyPhotoUrl, children } = await req.json()

  // Mark profile as onboarded (and save family photo if provided)
  const profileUpdate: Record<string, unknown> = { onboarded: true }
  if (familyPhotoUrl) profileUpdate.family_photo_url = familyPhotoUrl

  await supabase.from('profiles').update(profileUpdate).eq('id', user.id)

  // Insert children
  if (Array.isArray(children) && children.length > 0) {
    const rows = children
      .filter((c: { name: string }) => c.name?.trim())
      .map((c: { name: string; color: string; avatar_url?: string }, i: number) => {
        const row: Record<string, unknown> = {
          user_id:    user.id,
          name:       c.name.trim(),
          color:      c.color,
          sort_order: i + 1,
          archived:   false,
          name_key:   c.name.trim().toLowerCase().replace(/\s+/g, '_'),
        }
        if (c.avatar_url) row.avatar_url = c.avatar_url
        return row
      })

    if (rows.length > 0) await supabase.from('children').insert(rows)
  }

  return NextResponse.json({ ok: true })
}
