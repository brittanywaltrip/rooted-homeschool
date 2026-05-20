// One-off backfill: align the cached lessons.scheduled_date with the queue
// projector's truth for every active curriculum goal.
//
// Why: scheduled_date is a Path A cache (see CURRICULUM-SCHEDULING.md). The
// projector decides which calendar date a queue slot owns; the cache mirrors
// that. For users whose pages haven't loaded the May 19 fix yet, the cache
// can still point at wizard-assigned future dates from row creation time.
// On 2026-05-19 we found ksausten@gmail.com whose lesson 14 was cached at
// 2026-06-30 even though the projector says today (Tue May 19) or Thursday
// May 21. This script catches up everyone's cache in one pass; after that,
// the in-app syncProjectedScheduledDates helper keeps it aligned on load.
//
// Per CURRICULUM-SCHEDULING.md Anti-pattern H, this is NOT a migration —
// it's an engineer-run script with dry-run support. Every write is tagged
// scheduled_source = 'queue_resync' (Invariant 10) and the writes are
// grouped by target date for efficiency.
//
// Run:
//   node --env-file=.env.local scripts/sync-stale-scheduled-dates.ts --dry-run
//   node --env-file=.env.local scripts/sync-stale-scheduled-dates.ts
//   node --env-file=.env.local scripts/sync-stale-scheduled-dates.ts --user=<user_id>

import { createClient, SupabaseClient } from '@supabase/supabase-js'

import {
  computeNextLessonsForGoal,
  type CurriculumGoalConfig,
  type VacationBlock,
} from '../app/lib/scheduler.ts'
import { todayInTz } from '../app/lib/timezone.ts'

const DRY_RUN = process.argv.includes('--dry-run')
const USER_ARG = process.argv.find((a) => a.startsWith('--user='))?.split('=')[1] ?? null

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Build a Date that represents 12:00 noon of the user's local YMD using the
// script-runtime's local timezone view. The projector's internal
// setHours(0,0,0,0) is local-relative; constructing with the local-TZ
// constructor and noon keeps the YMD stable regardless of where the script
// runs (UTC server, dev machine in PT, etc.). Honors Invariant 9 (TZ-aware
// today) — the in-app code uses new Date() which is browser-local; this
// mirrors that for server-side execution.
function userLocalNoonDate(timezone: string | null | undefined): Date {
  const ymd = todayInTz(timezone)
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

type GoalRow = {
  id: string
  user_id: string
  curriculum_name: string | null
  child_id: string | null
  total_lessons: number | null
  lessons_per_day: number | null
  school_days: string[] | null
  current_lesson: number | null
  start_at_lesson: number | null
  start_date: string | null
  archived: boolean
}

type LessonRow = {
  id: string
  curriculum_goal_id: string | null
  lesson_number: number | null
  queue_position: number | null
  scheduled_date: string | null
  completed: boolean
  is_backfill: boolean | null
  notes: string | null
}

type VacBlock = { user_id: string; start_date: string; end_date: string }

// Projection horizon. 90 days is enough to cover any realistic visible window
// (week + month + a couple of months out) and small enough that the script
// finishes quickly. Per-goal projections stop early once total_lessons is hit.
const PROJECTION_DAYS_AHEAD = 90

async function loadActiveGoals(): Promise<GoalRow[]> {
  const pageSize = 1000
  let from = 0
  const out: GoalRow[] = []
  while (true) {
    let q = supabase
      .from('curriculum_goals')
      .select('id, user_id, curriculum_name, child_id, total_lessons, lessons_per_day, school_days, current_lesson, start_at_lesson, start_date, archived')
      .eq('archived', false)
      .range(from, from + pageSize - 1)
    if (USER_ARG) q = q.eq('user_id', USER_ARG)
    const { data, error } = await q
    if (error) throw error
    const rows = (data ?? []) as GoalRow[]
    out.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }
  // Filter out goals with no remaining work; the projector would emit nothing.
  return out.filter((g) =>
    g.total_lessons != null
    && g.total_lessons > 0
    && (g.current_lesson ?? 0) < g.total_lessons,
  )
}

async function loadVacationBlocksByUser(userIds: string[]): Promise<Map<string, VacationBlock[]>> {
  const out = new Map<string, VacationBlock[]>()
  if (userIds.length === 0) return out
  const chunk = 200
  for (let i = 0; i < userIds.length; i += chunk) {
    const slice = userIds.slice(i, i + chunk)
    const { data, error } = await supabase
      .from('vacation_blocks')
      .select('user_id, start_date, end_date')
      .in('user_id', slice)
    if (error) throw error
    for (const v of (data ?? []) as VacBlock[]) {
      const list = out.get(v.user_id) ?? []
      list.push({ start_date: v.start_date, end_date: v.end_date })
      out.set(v.user_id, list)
    }
  }
  return out
}

async function loadTimezonesByUser(userIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (userIds.length === 0) return out
  const chunk = 200
  for (let i = 0; i < userIds.length; i += chunk) {
    const slice = userIds.slice(i, i + chunk)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, timezone')
      .in('id', slice)
    if (error) throw error
    for (const row of (data ?? []) as { id: string; timezone: string | null }[]) {
      out.set(row.id, row.timezone)
    }
  }
  return out
}

async function loadLessonRowsForGoal(goalId: string): Promise<LessonRow[]> {
  // Pull every row for the goal. Sets are small (typically < 200 rows per
  // goal), so paginating per goal is fine.
  const { data, error } = await supabase
    .from('lessons')
    .select('id, curriculum_goal_id, lesson_number, queue_position, scheduled_date, completed, is_backfill, notes')
    .eq('curriculum_goal_id', goalId)
  if (error) throw error
  return (data ?? []) as LessonRow[]
}

async function loadCompletedTodayCount(goalId: string, userMid: Date): Promise<number> {
  // Mirrors the in-app projection: anchor today's slot to (current_lesson -
  // completedToday + 1) so a same-day completion doesn't shift tomorrow's
  // lesson forward. Bounds expressed in the user's local-midnight window.
  const startOfToday = new Date(userMid)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
  const { count, error } = await supabase
    .from('lessons')
    .select('id', { count: 'exact', head: true })
    .eq('curriculum_goal_id', goalId)
    .eq('completed', true)
    .gte('completed_at', startOfToday.toISOString())
    .lt('completed_at', startOfTomorrow.toISOString())
  if (error) throw error
  return count ?? 0
}

type DriftedRow = { id: string; oldDate: string | null; newDate: string }

function findDriftedRows(
  rows: LessonRow[],
  projDateByKey: Map<number, string>,
): DriftedRow[] {
  const out: DriftedRow[] = []
  for (const r of rows) {
    if (r.completed) continue
    if (r.is_backfill) continue
    if (r.notes && r.notes.trim() !== '') continue
    if (r.lesson_number == null) continue
    const projDate = projDateByKey.get(r.lesson_number)
    if (!projDate) continue
    if (r.scheduled_date === projDate) continue
    out.push({ id: r.id, oldDate: r.scheduled_date, newDate: projDate })
  }
  return out
}

async function writeAligned(drifted: DriftedRow[]): Promise<void> {
  // Group by target date so we issue at most one UPDATE per distinct date.
  const byDate = new Map<string, string[]>()
  for (const d of drifted) {
    const list = byDate.get(d.newDate) ?? []
    list.push(d.id)
    byDate.set(d.newDate, list)
  }
  for (const [date, ids] of byDate.entries()) {
    if (DRY_RUN) continue
    // Chunk the IN list at 500 to keep payloads reasonable.
    const chunk = 500
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk)
      const { error } = await supabase
        .from('lessons')
        .update({
          scheduled_date: date,
          date,
          scheduled_source: 'queue_resync',
        })
        .in('id', slice)
      if (error) throw error
    }
  }
}

async function main() {
  console.log(`sync-stale-scheduled-dates — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${USER_ARG ? ` — scoped to user ${USER_ARG}` : ''}`)
  console.log()

  const goals = await loadActiveGoals()
  console.log(`loaded ${goals.length} active goals`)
  const userIds = Array.from(new Set(goals.map((g) => g.user_id)))
  const [vacByUser, tzByUser] = await Promise.all([
    loadVacationBlocksByUser(userIds),
    loadTimezonesByUser(userIds),
  ])
  console.log(`loaded vacation blocks for ${vacByUser.size} users`)
  console.log(`loaded timezones for ${tzByUser.size} users`)
  console.log()

  let totalDrifted = 0
  let totalGoalsTouched = 0
  let totalUsersTouched = 0
  const touchedUserIds = new Set<string>()
  // For dry-run reporting: keep the first few examples per user
  const examples: { user_id: string; goal: string; lesson: number; old: string | null; new: string }[] = []

  for (const g of goals) {
    if (!g.total_lessons || g.total_lessons <= 0) continue
    if (!g.school_days || g.school_days.length === 0) continue

    const userMid = userLocalNoonDate(tzByUser.get(g.user_id))
    const completedToday = await loadCompletedTodayCount(g.id, userMid)
    const cfg: CurriculumGoalConfig = {
      id: g.id,
      total_lessons: g.total_lessons,
      lessons_per_day: g.lessons_per_day ?? 1,
      school_days: g.school_days,
      current_lesson: g.current_lesson ?? 0,
      start_date: g.start_date,
    }
    const vacations = vacByUser.get(g.user_id) ?? []
    const projected = computeNextLessonsForGoal(cfg, userMid, PROJECTION_DAYS_AHEAD, vacations, completedToday)
    if (projected.length === 0) continue

    const projDateByKey = new Map<number, string>(projected.map((p) => [p.lesson_number, p.date]))

    const rows = await loadLessonRowsForGoal(g.id)
    const drifted = findDriftedRows(rows, projDateByKey)
    if (drifted.length === 0) continue

    totalDrifted += drifted.length
    totalGoalsTouched++
    if (!touchedUserIds.has(g.user_id)) {
      touchedUserIds.add(g.user_id)
      totalUsersTouched++
    }
    if (examples.length < 25) {
      for (const d of drifted.slice(0, 3)) {
        const row = rows.find((r) => r.id === d.id)
        examples.push({
          user_id: g.user_id,
          goal: g.curriculum_name ?? g.id,
          lesson: row?.lesson_number ?? -1,
          old: d.oldDate,
          new: d.newDate,
        })
        if (examples.length >= 25) break
      }
    }

    await writeAligned(drifted)
  }

  console.log(`drifted rows: ${totalDrifted}`)
  console.log(`affected goals: ${totalGoalsTouched}`)
  console.log(`affected users: ${totalUsersTouched}`)
  console.log()
  console.log('sample drift (first 25):')
  for (const e of examples) {
    console.log(`  user ${e.user_id.slice(0, 8)} | ${e.goal} | L${e.lesson} | ${e.old ?? '(null)'} -> ${e.new}`)
  }
  console.log()
  console.log(DRY_RUN ? 'DRY RUN complete. Re-run without --dry-run to apply.' : 'Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
