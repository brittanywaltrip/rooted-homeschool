import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'garfieldbrittany@gmail.com'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  // Verify caller is the admin
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Pull all auth users for email + created_at
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  const allUsers = authData?.users ?? []

  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const todaySignups = allUsers.filter(u => new Date(u.created_at) >= todayStart).length
  const weekSignups  = allUsers.filter(u => new Date(u.created_at) >= weekAgo).length
  const totalUsers   = allUsers.length

  // Pull profiles for plan/pro status
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, is_pro, plan_type')

  const proUsers        = profiles?.filter(p => p.is_pro).length ?? 0
  const freeUsers       = (profiles?.length ?? 0) - proUsers
  const foundingFamilies = profiles?.filter(p => p.plan_type === 'founding_family').length ?? 0
  const standardSubs    = profiles?.filter(p => p.plan_type === 'standard').length ?? 0

  // App usage counts
  const [
    { count: totalLessons },
    { count: totalMemories },
    { count: totalReports },
  ] = await Promise.all([
    supabaseAdmin.from('lessons').select('*', { count: 'exact', head: true }).eq('completed', true),
    supabaseAdmin.from('app_events').select('*', { count: 'exact', head: true })
      .in('type', ['memory_photo', 'memory_project', 'memory_book']),
    supabaseAdmin.from('app_events').select('*', { count: 'exact', head: true })
      .eq('type', 'report_generated'),
  ])

  // Recent 10 signups — join auth user email with profile plan
  const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
  const recentSignups = [...allUsers]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
    .map(u => ({
      email:      u.email ?? '—',
      created_at: u.created_at,
      plan_type:  profileMap.get(u.id)?.plan_type ?? null,
      is_pro:     profileMap.get(u.id)?.is_pro ?? false,
    }))

  return NextResponse.json({
    totalUsers,
    freeUsers,
    proUsers,
    todaySignups,
    weekSignups,
    foundingFamilies,
    standardSubs,
    totalLessons:  totalLessons  ?? 0,
    totalMemories: totalMemories ?? 0,
    totalReports:  totalReports  ?? 0,
    recentSignups,
  })
}
