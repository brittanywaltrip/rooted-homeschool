import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user
}

export async function GET(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const showArchived = req.nextUrl.searchParams.get('archived') === 'true'

  // Auto-purge: permanently delete lists archived > 30 days ago
  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const { data: stale } = await supabaseAdmin
      .from('lists')
      .select('id')
      .eq('user_id', user.id)
      .eq('archived', true)
      .lt('archived_at', cutoff.toISOString())
    if (stale && stale.length > 0) {
      const staleIds = stale.map((r: { id: string }) => r.id)
      await supabaseAdmin.from('list_items').delete().in('list_id', staleIds)
      await supabaseAdmin.from('lists').delete().in('id', staleIds)
    }
  } catch { /* non-critical */ }

  if (showArchived) {
    // Return archived lists for the "recently deleted" section
    const { data, error } = await supabaseAdmin
      .from('lists')
      .select('*')
      .eq('user_id', user.id)
      .eq('archived', true)
      .order('archived_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
  }

  // Fetch non-archived lists ordered by sort_order
  const { data: lists, error } = await supabaseAdmin
    .from('lists')
    .select('*')
    .eq('user_id', user.id)
    .eq('archived', false)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-create default list if user has zero active lists
  if (!lists || lists.length === 0) {
    const { data: newList, error: insertErr } = await supabaseAdmin
      .from('lists')
      .insert({ user_id: user.id, name: "To-Do's", emoji: '✅', sort_order: 0 })
      .select()
      .single()
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
    return NextResponse.json([newList])
  }

  return NextResponse.json(lists)
}

export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, emoji, sort_order } = await req.json()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('lists')
    .insert({ user_id: user.id, name, emoji: emoji ?? '📝', sort_order: sort_order ?? 0 })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const allowed = ['name', 'emoji', 'sort_order', 'archived'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) patch[key] = fields[key]
  }

  // Auto-set archived_at when archiving/unarchiving
  if ('archived' in fields) {
    patch.archived_at = fields.archived ? new Date().toISOString() : null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('lists')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, permanent } = await req.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (permanent) {
    // Hard delete: remove list_items then the list
    await supabaseAdmin.from('list_items').delete().eq('list_id', id)
    const { error } = await supabaseAdmin
      .from('lists')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Soft delete: archive
    const { error } = await supabaseAdmin
      .from('lists')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
