// Cleanup script for the 21 goals flagged by the 2026-05-03 audit. Mirrors
// the live app's planRescheduleLessons / pickNextAvailableDate so post-cleanup
// state matches what the new scheduler would compute on the next user action,
// no re-bunching.
//
// Run:
//   node --env-file=.env.local scripts/cleanup-bunched-lessons.ts --dry-run
//   node --env-file=.env.local scripts/cleanup-bunched-lessons.ts
//   node --env-file=.env.local scripts/cleanup-bunched-lessons.ts --detect-duplicates
//
// Modes:
//   (default)            audit + plan a re-spread for every bunched goal
//   --dry-run            print proposed UPDATEs, write nothing
//   --detect-duplicates  list duplicate goals (same name within 24h),
//                        emit DELETE statements for hand review

import { createClient, SupabaseClient } from '@supabase/supabase-js'

import {
  planRescheduleLessons,
  schoolDayLabelsToIso,
  type VacationRange,
} from '../app/lib/scheduler.ts'
import { todayInTz, addDays, isoDowFromYmd } from '../app/lib/timezone.ts'

const DRY_RUN = process.argv.includes('--dry-run')
const DETECT_DUPLICATES = process.argv.includes('--detect-duplicates')
const BACKUP_TABLE = 'lessons_cleanup_backup_20260503'
const SCHEDULED_SOURCE = 'cleanup_sql'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[cleanup-bunched-lessons] missing env vars. Need NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
  )
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type AffectedGoal = {
  goal_id: string
}

type GoalRow = {
  id: string
  user_id: string
  curriculum_name: string | null
  school_days: string[] | null
  lessons_per_day: number | null
  start_date: string | null
  total_lessons: number | null
  current_lesson: number | null
}

type LessonRow = {
  id: string
  curriculum_goal_id: string
  lesson_number: number | null
  date: string | null
  scheduled_date: string | null
  completed: boolean
  is_backfill: boolean | null
}

type ProfileRow = {
  id: string
  timezone: string | null
}

type AuthUserRow = {
  id: string
  email: string | null
}

type VacationBlockRow = {
  start_date: string
  end_date: string
}

type DuplicateCluster = {
  user_id: string
  curriculum_name: string
  goal_ids: string[]
  created_ats: string[]
}

// ──────────────────────────────────────────────────────────────────────────
// Audit query: list every goal with at least one date holding more
// incomplete lessons than its lessons_per_day. Backfilled rows are
// excluded (Invariant 3).
// ──────────────────────────────────────────────────────────────────────────
const AFFECTED_GOALS_SQL = `
  WITH per_date_counts AS (
    SELECT
      g.id AS goal_id,
      l.scheduled_date,
      count(*) AS n,
      coalesce(g.lessons_per_day, 1) AS lpd
    FROM curriculum_goals g
    JOIN lessons l ON l.curriculum_goal_id = g.id
    WHERE l.completed = false
      AND l.scheduled_date IS NOT NULL
      AND coalesce(l.is_backfill, false) = false
    GROUP BY g.id, l.scheduled_date, g.lessons_per_day
  )
  SELECT DISTINCT goal_id
  FROM per_date_counts
  WHERE n > lpd;
`

const DUPLICATE_GOALS_SQL = `
  SELECT user_id, curriculum_name,
         array_agg(id::text ORDER BY created_at) AS goal_ids,
         array_agg(created_at::text ORDER BY created_at) AS created_ats
    FROM curriculum_goals
   WHERE curriculum_name IS NOT NULL
   GROUP BY user_id, curriculum_name
  HAVING count(*) > 1
     AND max(created_at) - min(created_at) < interval '24 hours';
`

async function rpcSql<T = unknown>(sql: string): Promise<T[]> {
  // Supabase doesn't expose a generic raw-SQL RPC by default; we expect a
  // helper named `exec_sql` that returns json, or a fallback to pg-meta.
  // Fall back to building queries via .from() when possible. This one just
  // tries to execute via REST; if missing we surface a clear error so the
  // caller can paste the SQL manually.
  const { data, error } = await supabase.rpc('exec_sql', { sql }) as { data: T[] | null; error: unknown }
  if (error) {
    throw new Error(
      `[cleanup-bunched-lessons] rpc exec_sql failed: ${(error as Error).message ?? String(error)}\n\n` +
        `Run this SQL by hand instead:\n\n${sql}`,
    )
  }
  return data ?? []
}

async function fetchAffectedGoalIds(): Promise<string[]> {
  // Try RPC first. If unavailable, fall back to in-memory aggregation by
  // pulling all incomplete lessons + goals and computing the audit here.
  try {
    const rows = await rpcSql<AffectedGoal>(AFFECTED_GOALS_SQL)
    return rows.map((r) => r.goal_id)
  } catch (e) {
    console.warn('[cleanup-bunched-lessons] exec_sql RPC unavailable, falling back to client-side audit')
    return fetchAffectedGoalIdsFallback()
  }
}

async function fetchAffectedGoalIdsFallback(): Promise<string[]> {
  // Paginate curriculum_goals — there are >1000 in production and PostgREST's
  // default cap silently drops the tail, leaving lpdByGoal.get(id) undefined
  // and falling back to lpd=1, which falsely flagged every lpd>=2 goal as
  // bunched on the 2026-05-04 cleanup run.
  const lpdByGoal = new Map<string, number>()
  const GPAGE = 1000
  let gFrom = 0
  for (;;) {
    const { data: goals, error: gErr } = await supabase
      .from('curriculum_goals')
      .select('id, lessons_per_day')
      .order('id', { ascending: true })
      .range(gFrom, gFrom + GPAGE - 1)
    if (gErr) throw gErr
    const grows = (goals ?? []) as { id: string; lessons_per_day: number | null }[]
    if (grows.length === 0) break
    for (const g of grows) lpdByGoal.set(g.id, g.lessons_per_day ?? 1)
    if (grows.length < GPAGE) break
    gFrom += GPAGE
  }

  // Page through lessons in chunks to avoid the 1000-row default cap.
  // ORDER BY id is REQUIRED for deterministic pagination -- without it,
  // Postgres can return overlapping or skipped rows between pages, which
  // double-counts lessons-per-date and produces false-positive bunching.
  // (Hit 2026-05-04: post-cleanup audit reported 10 dirty goals where SQL
  // truth said 0, all of them lpd>=2 with max_n exactly equal to lpd.)
  const PAGE = 1000
  let from = 0
  const counts = new Map<string, Map<string, number>>() // goal_id -> date -> n
  for (;;) {
    const { data: lessons, error: lErr } = await supabase
      .from('lessons')
      .select('curriculum_goal_id, scheduled_date, completed, is_backfill')
      .eq('completed', false)
      .not('scheduled_date', 'is', null)
      .not('curriculum_goal_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (lErr) throw lErr
    const rows = (lessons ?? []) as Pick<LessonRow, 'curriculum_goal_id' | 'scheduled_date' | 'completed' | 'is_backfill'>[]
    if (rows.length === 0) break
    for (const r of rows) {
      if (r.is_backfill === true) continue
      if (!r.curriculum_goal_id || !r.scheduled_date) continue
      const byDate = counts.get(r.curriculum_goal_id) ?? new Map<string, number>()
      byDate.set(r.scheduled_date, (byDate.get(r.scheduled_date) ?? 0) + 1)
      counts.set(r.curriculum_goal_id, byDate)
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  const out: string[] = []
  for (const [goalId, byDate] of counts) {
    const lpd = lpdByGoal.get(goalId) ?? 1
    let bunched = false
    for (const n of byDate.values()) {
      if (n > lpd) { bunched = true; break }
    }
    if (bunched) out.push(goalId)
  }
  return out
}

async function fetchGoal(goalId: string): Promise<GoalRow | null> {
  const { data, error } = await supabase
    .from('curriculum_goals')
    .select('id, user_id, curriculum_name, school_days, lessons_per_day, start_date, total_lessons, current_lesson')
    .eq('id', goalId)
    .maybeSingle()
  if (error) throw error
  return (data as GoalRow | null) ?? null
}

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, timezone')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as ProfileRow | null) ?? null
}

async function fetchEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error) return null
  return data?.user?.email ?? null
}

async function fetchVacations(userId: string): Promise<VacationRange[]> {
  const { data, error } = await supabase
    .from('vacation_blocks')
    .select('start_date, end_date')
    .eq('user_id', userId)
  if (error) throw error
  const rows = (data ?? []) as VacationBlockRow[]
  return rows.map((r) => ({ start: r.start_date, end: r.end_date }))
}

async function fetchIncompleteLessons(goalId: string): Promise<LessonRow[]> {
  const { data, error } = await supabase
    .from('lessons')
    .select('id, curriculum_goal_id, lesson_number, date, scheduled_date, completed, is_backfill')
    .eq('curriculum_goal_id', goalId)
    .eq('completed', false)
    .order('lesson_number', { ascending: true, nullsFirst: false })
  if (error) throw error
  // Invariant 3: never reschedule backfilled rows.
  return ((data ?? []) as LessonRow[]).filter((l) => l.is_backfill !== true)
}

// ──────────────────────────────────────────────────────────────────────────
// Backup. The table lessons_cleanup_backup_20260503 is a full schema mirror
// of `lessons` (23 columns) and was created out-of-band before this script
// ran. We INSERT each touched lesson's full row before its UPDATE, preserving
// the original `id` so recovery is one statement:
//   UPDATE lessons l SET scheduled_date = b.scheduled_date,
//                        date           = b.date,
//                        scheduled_source = b.scheduled_source
//     FROM lessons_cleanup_backup_20260503 b
//    WHERE l.id = b.id;
// ──────────────────────────────────────────────────────────────────────────

async function backupLessonsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  // Fetch full rows. Page in chunks so we don't trip the URL/IN-list limit.
  const PAGE = 100
  for (let i = 0; i < ids.length; i += PAGE) {
    const slice = ids.slice(i, i + PAGE)
    const { data, error: readErr } = await supabase
      .from('lessons')
      .select('*')
      .in('id', slice)
    if (readErr) {
      throw new Error(
        `[cleanup-bunched-lessons] backup READ failed: ${readErr.message}. Aborting before any UPDATE writes.`,
      )
    }
    const rows = data ?? []
    if (rows.length === 0) continue
    const { error: insErr } = await supabase.from(BACKUP_TABLE).insert(rows)
    if (insErr) {
      throw new Error(
        `[cleanup-bunched-lessons] backup INSERT failed: ${insErr.message}. Aborting before any UPDATE writes.`,
      )
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-goal cleanup planner
// ──────────────────────────────────────────────────────────────────────────

type ProposedUpdate = {
  email: string | null
  curriculum_name: string | null
  goal_id: string
  lesson_id: string
  lesson_number: number | null
  old_date: string | null
  new_date: string
  day_delta: number | null
}

function diffDays(a: string | null, b: string): number | null {
  if (!a) return null
  // Use UTC midnight so DST doesn't bite.
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  const ua = Date.UTC(pa[0], pa[1] - 1, pa[2])
  const ub = Date.UTC(pb[0], pb[1] - 1, pb[2])
  return Math.round((ub - ua) / 86_400_000)
}

async function planCleanupForGoal(goal: GoalRow): Promise<ProposedUpdate[]> {
  const profile = await fetchProfile(goal.user_id)
  const email = await fetchEmail(goal.user_id)
  const vacations = await fetchVacations(goal.user_id)
  const lessons = await fetchIncompleteLessons(goal.id)
  if (lessons.length === 0) return []

  const today = todayInTz(profile?.timezone ?? null)
  const tomorrow = addDays(today, 1)
  // Honor a future start_date the way forwardScheduleStart does: lessons
  // begin on max(tomorrow, start_date), never on or before today.
  const seed = goal.start_date && goal.start_date > tomorrow ? goal.start_date : tomorrow
  const startAfterDate = addDays(seed, -1)

  const goalConfig = {
    school_days: goal.school_days,
    lessons_per_day: Math.max(1, goal.lessons_per_day ?? 1),
  }
  const goalConfigs = new Map([[goal.id, goalConfig]])

  // toReshuffle: every incomplete non-backfill lesson, lesson_number ASC.
  // staying: empty — we are rebuilding the schedule from seed forward.
  const { updates } = planRescheduleLessons({
    toReshuffle: lessons.map((l) => ({
      id: l.id,
      curriculum_goal_id: goal.id,
      lesson_number: l.lesson_number,
    })),
    staying: [],
    goalConfigs,
    startAfterDate,
    vacations,
  })

  const lessonById = new Map(lessons.map((l) => [l.id, l]))
  return updates.map((u) => {
    const orig = lessonById.get(u.id)!
    return {
      email,
      curriculum_name: goal.curriculum_name,
      goal_id: goal.id,
      lesson_id: u.id,
      lesson_number: orig.lesson_number,
      old_date: orig.scheduled_date ?? orig.date ?? null,
      new_date: u.newDate,
      day_delta: diffDays(orig.scheduled_date ?? orig.date ?? null, u.newDate),
    }
  })
}

async function applyUpdates(updates: ProposedUpdate[]): Promise<void> {
  if (updates.length === 0) return
  // Backup all touched lessons FIRST (full row, original id preserved).
  // PostgREST has no "begin/commit" exposed, so we treat the backup write
  // as the rollback source if any UPDATE fails.
  const ids = updates.map((u) => u.lesson_id)
  await backupLessonsByIds(ids)
  for (const u of updates) {
    const { error } = await supabase
      .from('lessons')
      .update({
        date: u.new_date,
        scheduled_date: u.new_date,
        scheduled_source: SCHEDULED_SOURCE,
      })
      .eq('id', u.lesson_id)
    if (error) {
      throw new Error(
        `[cleanup-bunched-lessons] UPDATE failed for lesson ${u.lesson_id}: ${error.message}. Backup rows are in ${BACKUP_TABLE}; recover with:\n  UPDATE lessons l SET date = b.date, scheduled_date = b.scheduled_date, scheduled_source = b.scheduled_source FROM ${BACKUP_TABLE} b WHERE l.id = b.id;`,
      )
    }
  }
}

function fmtTable(rows: ProposedUpdate[]): string {
  if (rows.length === 0) return '  (no updates)\n'
  const header = ['email', 'curriculum_name', 'lesson#', 'old_date', 'new_date', 'Δdays']
  const widths = header.map((h) => h.length)
  const data = rows.map((r) => [
    r.email ?? '?',
    (r.curriculum_name ?? '?').slice(0, 40),
    String(r.lesson_number ?? '?'),
    r.old_date ?? '?',
    r.new_date,
    r.day_delta == null ? '?' : (r.day_delta > 0 ? `+${r.day_delta}` : String(r.day_delta)),
  ])
  for (const row of data) row.forEach((cell, i) => { widths[i] = Math.max(widths[i], cell.length) })
  const sep = widths.map((w) => '-'.repeat(w)).join('  ')
  const fmtRow = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join('  ')
  return [fmtRow(header), sep, ...data.map(fmtRow)].join('\n') + '\n'
}

// ──────────────────────────────────────────────────────────────────────────
// Duplicate-goal detection (--detect-duplicates)
// ──────────────────────────────────────────────────────────────────────────

async function detectDuplicates(): Promise<void> {
  let clusters: DuplicateCluster[] = []
  try {
    const rows = await rpcSql<DuplicateCluster>(DUPLICATE_GOALS_SQL)
    clusters = rows
  } catch (e) {
    console.warn('[cleanup-bunched-lessons] exec_sql RPC unavailable, falling back to client-side dedupe')
    clusters = await detectDuplicatesFallback()
  }

  if (clusters.length === 0) {
    console.log('[cleanup-bunched-lessons] no duplicate goals found.')
    return
  }

  console.log(`[cleanup-bunched-lessons] found ${clusters.length} duplicate cluster(s).`)
  console.log('NOTE: groups by (user_id, curriculum_name) only. Same-name goals')
  console.log('assigned to DIFFERENT children show up as duplicates here too --')
  console.log('compare child_id before running any DELETE.')
  console.log('')

  // Pull child names per user up front so we don't query per-row.
  const userIds = Array.from(new Set(clusters.map((c) => c.user_id)))
  const childByUser = new Map<string, Map<string, string>>()
  for (const uid of userIds) {
    const { data } = await supabase
      .from('children')
      .select('id, name')
      .eq('user_id', uid)
    const map = new Map<string, string>()
    for (const c of (data ?? []) as { id: string; name: string | null }[]) {
      map.set(c.id, c.name ?? '?')
    }
    childByUser.set(uid, map)
  }

  for (const c of clusters) {
    const email = await fetchEmail(c.user_id)
    const childMap = childByUser.get(c.user_id) ?? new Map<string, string>()
    console.log(`# ${c.curriculum_name} -- ${email ?? c.user_id} (${c.goal_ids.length} copies)`)
    for (let i = 0; i < c.goal_ids.length; i++) {
      const id = c.goal_ids[i]
      const created = c.created_ats[i]
      const { count } = await supabase
        .from('lessons')
        .select('id', { count: 'exact', head: true })
        .eq('curriculum_goal_id', id)
      const { data: g } = await supabase
        .from('curriculum_goals')
        .select('child_id')
        .eq('id', id)
        .maybeSingle()
      const childId = (g as { child_id: string | null } | null)?.child_id ?? null
      const childName = childId ? (childMap.get(childId) ?? '?') : '(no child)'
      const note = i === 0 ? '  KEEP (earliest)' : '  DELETE (later duplicate)'
      console.log(`  ${id}  created ${created}  child=${childName}  lessons=${count ?? '?'}${note}`)
    }
    console.log('')
    console.log('-- Suggested deletion (review before running). The lessons FK is')
    console.log("-- ON DELETE SET NULL, so lessons must be deleted explicitly first.")
    console.log("-- SKIP this block if the child= names above differ across copies.")
    for (let i = 1; i < c.goal_ids.length; i++) {
      const id = c.goal_ids[i]
      console.log(`DELETE FROM lessons WHERE curriculum_goal_id = '${id}';`)
      console.log(`DELETE FROM curriculum_goals WHERE id = '${id}';`)
    }
    console.log('')
  }
}

async function detectDuplicatesFallback(): Promise<DuplicateCluster[]> {
  const { data, error } = await supabase
    .from('curriculum_goals')
    .select('id, user_id, curriculum_name, created_at')
  if (error) throw error
  type Row = { id: string; user_id: string; curriculum_name: string | null; created_at: string }
  const rows = (data ?? []) as Row[]
  const grouped = new Map<string, Row[]>()
  for (const r of rows) {
    if (!r.curriculum_name) continue
    const k = `${r.user_id}::${r.curriculum_name}`
    const list = grouped.get(k) ?? []
    list.push(r)
    grouped.set(k, list)
  }
  const out: DuplicateCluster[] = []
  for (const list of grouped.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    const first = new Date(list[0].created_at).getTime()
    const last = new Date(list[list.length - 1].created_at).getTime()
    if (last - first >= 24 * 3600 * 1000) continue
    out.push({
      user_id: list[0].user_id,
      curriculum_name: list[0].curriculum_name as string,
      goal_ids: list.map((l) => l.id),
      created_ats: list.map((l) => l.created_at),
    })
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (DETECT_DUPLICATES) {
    await detectDuplicates()
    return
  }

  console.log(`[cleanup-bunched-lessons] mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`)
  console.log('[cleanup-bunched-lessons] running audit query…')
  const goalIds = await fetchAffectedGoalIds()
  console.log(`[cleanup-bunched-lessons] ${goalIds.length} affected goal(s)`)
  if (goalIds.length === 0) {
    console.log('[cleanup-bunched-lessons] audit clean: 0 affected goals')
    return
  }

  let totalUpdates = 0
  let totalGoalsWritten = 0

  for (const goalId of goalIds) {
    const goal = await fetchGoal(goalId)
    if (!goal) {
      console.warn(`[cleanup-bunched-lessons] goal ${goalId} disappeared between audit and fetch, skipping`)
      continue
    }
    const proposed = await planCleanupForGoal(goal)
    if (proposed.length === 0) continue

    // Verification per Invariant 2 + Invariant 4 before reporting.
    const dateCounts = new Map<string, number>()
    const lpd = Math.max(1, goal.lessons_per_day ?? 1)
    const isoDays = new Set(schoolDayLabelsToIso(goal.school_days))
    for (const u of proposed) {
      dateCounts.set(u.new_date, (dateCounts.get(u.new_date) ?? 0) + 1)
      const dow = isoDowFromYmd(u.new_date)
      if (!isoDays.has(dow)) {
        console.error(
          `[cleanup-bunched-lessons] BUG: planner placed lesson on non-school day. goal=${goal.id} date=${u.new_date} dow=${dow}; aborting before any write.`,
        )
        process.exit(2)
      }
    }
    for (const [date, n] of dateCounts) {
      if (n > lpd) {
        console.error(
          `[cleanup-bunched-lessons] BUG: planner placed ${n} lessons on ${date} (lpd=${lpd}). goal=${goal.id}; aborting before any write.`,
        )
        process.exit(2)
      }
    }

    console.log(`\n## ${goal.curriculum_name ?? '(unnamed)'} -- ${proposed[0].email ?? goal.user_id}`)
    console.log(`   goal_id=${goal.id}  lessons=${proposed.length}  lpd=${lpd}  start_date=${goal.start_date ?? '(null)'}`)
    console.log(fmtTable(proposed))

    if (!DRY_RUN) {
      await applyUpdates(proposed)
      totalGoalsWritten++
    }
    totalUpdates += proposed.length
  }

  console.log(`\n[cleanup-bunched-lessons] proposed ${totalUpdates} UPDATE(s) across ${goalIds.length} goal(s)`)
  if (!DRY_RUN) {
    console.log(`[cleanup-bunched-lessons] WROTE ${totalGoalsWritten} goal(s); backups in ${BACKUP_TABLE}`)
    console.log('[cleanup-bunched-lessons] re-running audit query for confirmation…')
    const after = await fetchAffectedGoalIds()
    if (after.length === 0) {
      console.log('[cleanup-bunched-lessons] audit clean: 0 affected goals')
    } else {
      console.error(`[cleanup-bunched-lessons] AUDIT STILL DIRTY: ${after.length} affected goals: ${after.join(', ')}`)
      process.exit(3)
    }
  } else {
    console.log('[cleanup-bunched-lessons] DRY RUN -- no writes performed.')
  }
}

main().catch((err) => {
  console.error('[cleanup-bunched-lessons] fatal error:', err)
  process.exit(1)
})
