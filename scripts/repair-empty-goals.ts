// Repair curricula that have settings but no lessons.
//
// THE BUG: the Schedule Builder saves in two phases. Phase 1 writes the
// curriculum_goals row; phase 2 generates the lessons. When phase 2 failed
// after phase 1 committed, the goal survived with zero lesson rows and the
// family got an empty Today page with a notice almost nobody saw. 26 goals
// across 22 accounts reached that state between March and August 2026.
//
// This is the general version of scripts/generate-missing-future-lessons.ts,
// which did the same repair for two hard-coded goal ids. Same structure, same
// dry-run-first discipline, same `cleanup_sql` stamp per Invariant 10.
//
// THE PLANNER IS THE APP'S. `computeNextLessonsForGoal` projects the dates and
// `planPhase2LessonInserts` pairs lesson numbers to queue slots, which is
// exactly how applyPhase2ForGoal does it in
// app/dashboard/plan/schedule/page.tsx. Nothing here re-implements a day walk
// (Invariant 8) or a slot assignment ("number taken" and "slot taken" are
// different questions; conflating them destroyed a lesson per drifted pin in
// commit 6905c4f).
//
// Per CURRICULUM-SCHEDULING.md Anti-pattern H this is NOT a migration: it is a
// one-off script with a dry run that an engineer runs by hand.
//
// Run:
//   node --env-file=.env.local scripts/repair-empty-goals.ts            (dry run)
//   node --env-file=.env.local scripts/repair-empty-goals.ts --apply    (writes)

import { createClient, SupabaseClient } from '@supabase/supabase-js'

import {
  computeNextLessonsForGoal,
  planPhase2LessonInserts,
  schoolDayLabelsToIso,
  toGoalConfig,
  type GoalConfigRow,
  type VacationBlock,
} from '../app/lib/scheduler.ts'
import { isoDowFromYmd } from '../app/lib/timezone.ts'

// Dry run is the DEFAULT. Writing requires saying so out loud.
const APPLY = process.argv.includes('--apply')

// Known test account. Its goals are deliberately in odd states and must never
// be repaired alongside real families'.
const EXCLUDED_EMAIL = 'garfieldbrittany+test1@gmail.com'

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type GoalRow = GoalConfigRow & {
  user_id: string
  child_id: string | null
  curriculum_name: string | null
  subject_label: string | null
  created_at: string | null
}

// The projector's safety bound, matching the Schedule Builder's create path.
// Invariant 11: never a small fixed window.
const DAYS_AHEAD = 3650

function label(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim()
  return v.length > 0 ? v : fallback
}

/** Local midnight, the same anchor applyPhase2ForGoal passes as `todayMid`. */
function todayMidnight(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** id -> email for every auth user. Paginated, same shape as backfill-missing-profiles. */
async function loadUserEmails(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    if (users.length === 0) break
    for (const u of users) out.set(u.id, u.email ?? '(no email)')
    if (users.length < perPage) break
    page++
  }
  return out
}

/** Every curriculum_goal_id that already owns at least one lessons row. */
async function loadGoalIdsWithLessons(): Promise<Set<string>> {
  const out = new Set<string>()
  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('lessons')
      .select('curriculum_goal_id')
      .not('curriculum_goal_id', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) throw error
    const rows = (data ?? []) as { curriculum_goal_id: string }[]
    if (rows.length === 0) break
    for (const r of rows) out.add(r.curriculum_goal_id)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return out
}

async function loadVacations(userId: string): Promise<VacationBlock[]> {
  const { data, error } = await supabase
    .from('vacation_blocks')
    .select('start_date, end_date')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as VacationBlock[]
}

/**
 * Plan the rows for one empty goal, using the app's own planner.
 *
 * NULL start_date needs no special handling here and must not get any: the
 * projector already treats it as "no future gate" and begins at `fromDate`,
 * which is what applyPhase2ForGoal relies on when a family leaves the field
 * blank. `toGoalConfig` is the one place a DB row becomes a projector config,
 * so it is what normalizes the nulls (GOAL_CONFIG_COLUMNS exists because
 * lessons_per_day_overrides kept getting dropped on the way in).
 */
async function planForGoal(goal: GoalRow, todayMid: Date) {
  const config = toGoalConfig(goal)
  const vacations = await loadVacations(goal.user_id)
  const upcoming = computeNextLessonsForGoal(config, todayMid, DAYS_AHEAD, vacations, 0, [])
  // The goal holds zero lesson rows by definition, so nothing is taken. Passing
  // empty sets makes every projected slot free and every lesson number missing,
  // which is the planner's identity case: queue_position === lesson_number.
  return planPhase2LessonInserts({
    upcoming,
    existingLessonNumbers: [],
    existingQueuePositions: [],
  })
}

/** Invariant 4: nothing may land on a day the goal does not school on. */
function assertSchoolDaysOnly(goal: GoalRow, rows: { lesson_number: number; date: string }[]): void {
  const allowed = new Set(schoolDayLabelsToIso(goal.school_days))
  const offenders = rows.filter((r) => !allowed.has(isoDowFromYmd(r.date)))
  if (offenders.length > 0) {
    console.error(`  !! goal ${goal.id} produced ${offenders.length} non-school-day rows`)
    for (const o of offenders.slice(0, 5)) {
      console.error(`     lesson ${o.lesson_number} on ${o.date} (iso dow ${isoDowFromYmd(o.date)})`)
    }
    throw new Error(`School-days violation for goal ${goal.id}; aborting.`)
  }
}

async function main() {
  console.log(`[repair-empty-goals] mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  const todayMid = todayMidnight()
  console.log(`[repair-empty-goals] projecting from ${ymd(todayMid)} (this machine's local day)`)

  const emails = await loadUserEmails()
  console.log(`[repair-empty-goals] loaded ${emails.size} auth users`)

  // Active goals only. An archived or finished curriculum with no lessons is
  // not a family staring at an empty Today page, and re-generating lessons onto
  // one would resurrect a curriculum they retired. Same filter the Schedule
  // Builder loads with.
  const { data: goalsData, error: goalsErr } = await supabase
    .from('curriculum_goals')
    .select(
      'id, user_id, child_id, curriculum_name, subject_label, total_lessons, current_lesson, lessons_per_day, lessons_per_day_overrides, school_days, start_date, created_at',
    )
    .eq('archived', false)
    .is('completed_at', null)
    .gt('total_lessons', 0)
  if (goalsErr) throw goalsErr
  const allGoals = (goalsData ?? []) as GoalRow[]

  const goalsWithLessons = await loadGoalIdsWithLessons()
  const empty = allGoals.filter((g) => !goalsWithLessons.has(g.id))

  console.log(
    `[repair-empty-goals] ${allGoals.length} active goals with total_lessons > 0, ${empty.length} of them hold zero lesson rows`,
  )

  // Test account never gets repaired.
  const excluded = empty.filter((g) => emails.get(g.user_id) === EXCLUDED_EMAIL)
  const candidates = empty.filter((g) => emails.get(g.user_id) !== EXCLUDED_EMAIL)
  if (excluded.length > 0) {
    console.log(
      `[repair-empty-goals] excluded ${excluded.length} goal(s) belonging to ${EXCLUDED_EMAIL}`,
    )
  }

  // Child names, for output only.
  const childIds = Array.from(new Set(candidates.map((g) => g.child_id).filter((c): c is string => !!c)))
  const childNames = new Map<string, string>()
  if (childIds.length > 0) {
    const { data: kids, error: kidsErr } = await supabase
      .from('children')
      .select('id, name')
      .in('id', childIds)
    if (kidsErr) throw kidsErr
    for (const k of (kids ?? []) as { id: string; name: string }[]) childNames.set(k.id, k.name)
  }

  // DUPLICATE GUARD. One account has two identical empty goals (same child,
  // same subject, same total, created the same day). Repairing both would give
  // that family two copies of every lesson. Repair the OLDER one and print the
  // newer as SKIPPED-DUPLICATE for a human to look at. Nothing is deleted.
  const byIdentity = new Map<string, GoalRow[]>()
  for (const g of candidates) {
    const key = `${g.user_id}|${g.child_id ?? 'null'}|${label(g.subject_label, '(no subject)').toLowerCase()}`
    const list = byIdentity.get(key) ?? []
    list.push(g)
    byIdentity.set(key, list)
  }
  const toRepair: GoalRow[] = []
  const skippedDuplicates: GoalRow[] = []
  for (const list of byIdentity.values()) {
    if (list.length === 1) {
      toRepair.push(list[0])
      continue
    }
    const sorted = list
      .slice()
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    toRepair.push(sorted[0])
    skippedDuplicates.push(...sorted.slice(1))
  }

  console.log(
    `[repair-empty-goals] ${toRepair.length} goal(s) to repair, ${skippedDuplicates.length} skipped as duplicates\n`,
  )

  for (const g of skippedDuplicates) {
    console.log(
      `SKIPPED-DUPLICATE  ${emails.get(g.user_id) ?? g.user_id}  subject=${label(g.subject_label, '(no subject)')}  child=${label(childNames.get(g.child_id ?? ''), '(no child)')}  goal=${g.id}  created=${g.created_at ?? '(unknown)'}  total=${g.total_lessons}`,
    )
  }
  if (skippedDuplicates.length > 0) console.log('')

  let totalPlanned = 0
  let passCount = 0
  let failCount = 0

  for (const goal of toRepair) {
    const email = emails.get(goal.user_id) ?? goal.user_id
    const subject = label(goal.subject_label, '(no subject)')
    const name = label(goal.curriculum_name, 'Curriculum')
    const child = label(childNames.get(goal.child_id ?? ''), '(no child)')

    const planned = await planForGoal(goal, todayMid)
    totalPlanned += planned.length

    if (planned.length === 0) {
      console.log(
        `NOTHING-TO-PLAN  ${email}  subject=${subject}  child=${child}  total=${goal.total_lessons}  current=${goal.current_lesson}  goal=${goal.id}`,
      )
      continue
    }
    assertSchoolDaysOnly(goal, planned)

    const first = planned[0]
    const last = planned[planned.length - 1]
    console.log(
      `PLAN  ${email}  subject=${subject}  child=${child}  name="${name}"  total=${goal.total_lessons}  current=${goal.current_lesson}  rows=${planned.length}  dates=${first.date}..${last.date}  goal=${goal.id}`,
    )

    if (!APPLY) continue

    const inserts = planned.map((p) => ({
      user_id: goal.user_id,
      child_id: goal.child_id,
      curriculum_goal_id: goal.id,
      lesson_number: p.lesson_number,
      queue_position: p.queue_position,
      title: `${name} - Lesson ${p.lesson_number}`,
      scheduled_date: p.date,
      date: p.date,
      // Invariant 10. `cleanup_sql` is the source for a hand-run repair.
      scheduled_source: 'cleanup_sql',
      completed: false,
      hours: 0,
      is_backfill: false,
    }))

    let insertedOk = true
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100)
      const { error: insErr } = await supabase.from('lessons').insert(batch)
      if (insErr) {
        console.error(`  insert batch ${i}-${i + batch.length} failed: ${insErr.message}`)
        insertedOk = false
        break
      }
    }

    // Re-verify from the database rather than trusting the loop.
    const { count: afterCount, error: cntErr } = await supabase
      .from('lessons')
      .select('id', { count: 'exact', head: true })
      .eq('curriculum_goal_id', goal.id)
    const ok = insertedOk && !cntErr && (afterCount ?? 0) === planned.length
    if (ok) passCount++
    else failCount++
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  goal=${goal.id}  expected=${planned.length}  actual=${afterCount ?? 'read failed'}`,
    )
  }

  console.log(
    `\n[repair-empty-goals] done. goals=${toRepair.length} plannedRows=${totalPlanned}` +
      (APPLY ? `  PASS=${passCount} FAIL=${failCount}` : '  (dry run, nothing written)'),
  )
  if (!APPLY) {
    console.log('[repair-empty-goals] re-run with --apply to write these rows.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
