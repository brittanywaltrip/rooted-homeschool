import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"]

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  // Verify caller is the admin
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Pull all auth users for email + created_at
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  const allUsers = authData?.users ?? []

  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

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

  // App usage counts + lessons per user
  const [
    { count: totalLessons },
    { count: totalMemories },
    { count: totalReports },
    lessonsResult,
    childrenResult,
    weekLessonsResult,
    lastWeekLessonsResult,
    memoriesResult,
  ] = await Promise.all([
    supabaseAdmin.from('lessons').select('*', { count: 'exact', head: true }).eq('completed', true),
    supabaseAdmin.from('app_events').select('*', { count: 'exact', head: true })
      .in('type', ['memory_photo', 'memory_project', 'memory_book']),
    supabaseAdmin.from('app_events').select('*', { count: 'exact', head: true })
      .eq('type', 'report_generated'),
    // All completed lessons with user_id + completed_at
    supabaseAdmin.from('lessons').select('user_id, completed_at').eq('completed', true),
    // All children for children insights
    supabaseAdmin.from('children').select('user_id, created_at'),
    // Lessons this week
    supabaseAdmin.from('lessons').select('user_id, completed_at')
      .eq('completed', true)
      .gte('completed_at', weekAgo.toISOString()),
    // Lessons last week (week before)
    supabaseAdmin.from('lessons').select('user_id')
      .eq('completed', true)
      .gte('completed_at', twoWeeksAgo.toISOString())
      .lt('completed_at', weekAgo.toISOString()),
    // Memory events per user
    supabaseAdmin.from('app_events').select('user_id, created_at')
      .in('type', ['memory_photo', 'memory_project', 'memory_book']),
  ])

  // ── Children insights ──────────────────────────────────────────────────────
  const allChildren = childrenResult.data ?? []
  const totalChildren = allChildren.length
  const childrenByUser = new Map<string, number>()
  const childrenCreatedAtByUser = new Map<string, string>()
  for (const c of allChildren) {
    childrenByUser.set(c.user_id, (childrenByUser.get(c.user_id) ?? 0) + 1)
    // Track most recent child creation per user
    const prev = childrenCreatedAtByUser.get(c.user_id)
    if (!prev || c.created_at > prev) childrenCreatedAtByUser.set(c.user_id, c.created_at)
  }
  const usersWith1Child  = [...childrenByUser.values()].filter(n => n === 1).length
  const usersWith2Plus   = [...childrenByUser.values()].filter(n => n >= 2).length
  const avgChildrenPerUser = totalUsers > 0
    ? (totalChildren / totalUsers).toFixed(1)
    : '0.0'
  const childCountFreq = new Map<number, number>()
  for (const n of childrenByUser.values()) {
    childCountFreq.set(n, (childCountFreq.get(n) ?? 0) + 1)
  }
  let mostCommonChildCount = 0
  let mostCommonChildFreq  = 0
  for (const [count, freq] of childCountFreq) {
    if (freq > mostCommonChildFreq) { mostCommonChildCount = count; mostCommonChildFreq = freq }
  }

  // ── Engagement ────────────────────────────────────────────────────────────
  const allLessons = lessonsResult.data ?? []
  const usersWithLessons = new Set(allLessons.map(l => l.user_id))
  const activeUsers = usersWithLessons.size
  const deadAccounts = totalUsers - activeUsers
  const avgLessonsPerActiveUser = activeUsers > 0
    ? (allLessons.length / activeUsers).toFixed(1)
    : '0.0'
  const lessonsThisWeek  = weekLessonsResult.data?.length ?? 0
  const lessonsLastWeek  = lastWeekLessonsResult.data?.length ?? 0

  // ── Per-user lesson counts + last lesson date ─────────────────────────────
  const lessonsByUser = new Map<string, number>()
  const lastLessonByUser = new Map<string, string>()
  for (const l of allLessons) {
    lessonsByUser.set(l.user_id, (lessonsByUser.get(l.user_id) ?? 0) + 1)
    const prev = lastLessonByUser.get(l.user_id)
    if (l.completed_at && (!prev || l.completed_at > prev)) {
      lastLessonByUser.set(l.user_id, l.completed_at)
    }
  }

  // ── Per-user memory counts + last memory date ─────────────────────────────
  const memoriesByUser = new Map<string, number>()
  const lastMemoryByUser = new Map<string, string>()
  for (const m of (memoriesResult.data ?? [])) {
    memoriesByUser.set(m.user_id, (memoriesByUser.get(m.user_id) ?? 0) + 1)
    const prev = lastMemoryByUser.get(m.user_id)
    if (m.created_at && (!prev || m.created_at > prev)) {
      lastMemoryByUser.set(m.user_id, m.created_at)
    }
  }

  // ── Retention ─────────────────────────────────────────────────────────────
  const thisWeekSignupIds = new Set(
    allUsers.filter(u => new Date(u.created_at) >= weekAgo).map(u => u.id)
  )
  const newUsersWithLesson = [...thisWeekSignupIds].filter(id => usersWithLessons.has(id)).length

  const oldUsers = allUsers.filter(u => new Date(u.created_at) < weekAgo)
  const churnedUsers = oldUsers.filter(u => !usersWithLessons.has(u.id)).length

  // ── Daily activity (last 7 days) ──────────────────────────────────────────
  const dailyActivity: { date: string; signups: number; lessons: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    dayStart.setDate(dayStart.getDate() - i)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const signups = allUsers.filter(u => {
      const d = new Date(u.created_at)
      return d >= dayStart && d < dayEnd
    }).length

    const lessons = (weekLessonsResult.data ?? []).filter(l => {
      if (!l.completed_at) return false
      const d = new Date(l.completed_at)
      return d >= dayStart && d < dayEnd
    }).length

    dailyActivity.push({
      date: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      signups,
      lessons,
    })
  }

  // ── Upgrade candidates ────────────────────────────────────────────────────
  const freeProfileIds = new Set(
    profiles?.filter(p => !p.is_pro).map(p => p.id) ?? []
  )
  const authUserMap = new Map(allUsers.map(u => [u.id, u.email ?? '—']))

  const freeWith2PlusChildren = [...childrenByUser.entries()]
    .filter(([uid, count]) => count >= 2 && freeProfileIds.has(uid))
    .map(([uid]) => authUserMap.get(uid) ?? '—')

  const freeWith10PlusLessons = [...lessonsByUser.entries()]
    .filter(([uid, count]) => count >= 10 && freeProfileIds.has(uid))
    .map(([uid]) => authUserMap.get(uid) ?? '—')

  // ── Full user activity table ──────────────────────────────────────────────
  const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])

  const TEST_EMAILS = ['test@', 'example.com', 'garfieldbrittany@gmail.com']

  const userActivity = allUsers
    .filter(u => !TEST_EMAILS.some(t => (u.email ?? '').includes(t)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(u => {
      const childCount   = childrenByUser.get(u.id) ?? 0
      const lessonCount  = lessonsByUser.get(u.id) ?? 0
      const memoryCount  = memoriesByUser.get(u.id) ?? 0
      const plan         = profileMap.get(u.id)?.plan_type ?? null

      // last_active = most recent of: lesson, child added, memory
      const dates = [
        lastLessonByUser.get(u.id),
        childrenCreatedAtByUser.get(u.id),
        lastMemoryByUser.get(u.id),
      ].filter(Boolean) as string[]
      const lastActive = dates.length > 0 ? dates.sort().at(-1)! : null

      const signedUpOld = new Date(u.created_at) < weekAgo
      const isDead = signedUpOld && lessonCount === 0 && childCount === 0

      return {
        id:              u.id,
        email:           u.email ?? '—',
        signed_up:       u.created_at,
        plan:            plan === 'founding_family' ? 'founding' : plan === 'standard' ? 'standard' : 'free',
        children_added:  childCount,
        lessons_logged:  lessonCount,
        memories_created: memoryCount,
        last_active:     lastActive,
        is_dead:         isDead,
        is_new:          !signedUpOld,
      }
    })

  // Recent 10 signups (kept for backwards compat, now derived from userActivity)
  const recentSignups = userActivity.slice(0, 10).map(u => ({
    email:      u.email,
    created_at: u.signed_up,
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
    // Children insights
    totalChildren,
    avgChildrenPerUser,
    usersWith1Child,
    usersWith2Plus,
    mostCommonChildCount,
    // Engagement
    activeUsers,
    deadAccounts,
    avgLessonsPerActiveUser,
    lessonsThisWeek,
    lessonsLastWeek,
    // Retention
    newUsersWithLesson,
    churnedUsers,
    // Daily activity
    dailyActivity,
    // Upgrade candidates
    freeWith2PlusChildren,
    freeWith10PlusLessons,
    // Full user activity
    userActivity,
  })
}
