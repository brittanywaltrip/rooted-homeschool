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

  const listId = req.nextUrl.searchParams.get('list_id')
  if (!listId) return NextResponse.json({ error: 'list_id is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('list_items')
    .select('*')
    .eq('list_id', listId)
    .eq('user_id', user.id)
    .order('done', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { list_id, text, child_id } = await req.json()
  if (!list_id || !text) {
    return NextResponse.json({ error: 'list_id and text are required' }, { status: 400 })
  }

  // Auto-set sort_order to max + 1 for this list
  const { data: maxRow } = await supabaseAdmin
    .from('list_items')
    .select('sort_order')
    .eq('list_id', list_id)
    .eq('user_id', user.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const nextSort = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabaseAdmin
    .from('list_items')
    .insert({
      list_id,
      user_id: user.id,
      text,
      sort_order: nextSort,
      child_id: child_id ?? null,
    })
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

  const allowed = ['text', 'done', 'sort_order', 'child_id'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) patch[key] = fields[key]
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('list_items')
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

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('list_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
