// One-off heal: generate the missing forward lessons for two Math curriculum
// goals on user d2e9cba1-e372-4109-adea-11ba41971fae. Both goals had backfill
// rows but zero forward incomplete rows, so Today/Plan had nothing to render.
//
// Forward placement uses `pickNextAvailableDate` from app/lib/scheduler.ts so
// this matches the live planner exactly (Invariant 8, no second day-walker).
// Every inserted row is stamped `scheduled_source = 'cleanup_sql'` per
// Invariant 10. Completed and backfill rows are NOT touched.
//
// Run:
//   node --env-file=.env.local scripts/generate-missing-future-lessons.ts --dry-run
//   node --env-file=.env.local scripts/generate-missing-future-lessons.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js'

import { pickNextAvailableDate, schoolDayLabelsToIso, type VacationRange } from '../app/lib/scheduler.ts'
import { todayInTz, addDays, isoDowFromYmd } from '../app/lib/timezone.ts'

const DRY_RUN = process.argv.includes('--dry-run')

const TARGET_GOAL_IDS = [
  'f313e183-f05f-4561-a008-7a90a5035e26',
  '44ae4668-dbb5-461e-85aa-724e038e3451',
]

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type GoalRow = {
  id: string
  user_id: string
  child_id: string | null
  curriculum_name: string | null
  subject_label: string | null
  school_days: string[] | null
  lessons_per_day: number | null
  total_lessons: number | null
  current_lesson: number | null
  start_at_lesson: number | null
  start_date: string | null
  school_year_id: string | null
}

type SeedRow = {
  user_id: string
  child_id: string | null
  subject_id: string | null
  school_year_id: string | null
  title: string
  notes: string | null
}

async function loadSeedRow(goalId: string): Promise<SeedRow | null> {
  const { data, error } = await supabase
    .from('lessons')
    .select('user_id, child_id, subject_id, school_year_id, title, notes')
    .eq('curriculum_goal_id', goalId)
    .order('lesson_number', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as SeedRow | null
}

async function loadVacations(userId: string): Promise<VacationRange[]> {
  const { data, error } = await supabase
    .from('vacation_blocks')
    .select('start_date, end_date')
    .eq('user_id', userId)
  if (error) throw error
  return ((data ?? []) as { start_date: string; end_date: string }[]).map((v) => ({
    start: v.start_date,
    end: v.end_date,
  }))
}

function deriveTitlePrefix(seedTitle: string): string {
  // Existing rows use "<curriculum_name> — Lesson N". Strip the trailing
  // " — Lesson N" so we can rebuild new titles with the same name.
  const m = /^(.*?)\s+—\s+Lesson\s+\d+\s*$/.exec(seedTitle)
  return m ? m[1] : seedTitle
}

async function planForGoal(goal: GoalRow): Promise<{ lesson_number: number; date: string }[]> {
  const total = goal.total_lessons ?? 0
  const current = goal.current_lesson ?? 0
  if (total <= 0 || current >= total) return []

  const isoSchoolDays = schoolDayLabelsToIso(goal.school_days)
  const lpd = Math.max(1, goal.lessons_per_day ?? 1)
  const vacations = await loadVacations(goal.user_id)

  // Forward start: max(start_date, tomorrow) — strictly after today, matching
  // forwardScheduleStart in scheduler.ts. We use today in America/New_York
  // since profiles.timezone isn't available; the script is run by an
  // engineer who can verify the resulting first date.
  const todayYmd = todayInTz('America/New_York')
  const tomorrowYmd = addDays(todayYmd, 1)
  const startYmd =
    goal.start_date && goal.start_date > tomorrowYmd ? goal.start_date : tomorrowYmd

  // pickNextAvailableDate is exclusive on its `fromDate`, so step back one
  // day so the first placement can land on `startYmd` itself.
  let cursor = addDays(startYmd, -1)
  const occupancy = new Map<string, number>()
  const out: { lesson_number: number; date: string }[] = []
  for (let n = current + 1; n <= total; n++) {
    const date = pickNextAvailableDate({
      fromDate: cursor,
      schoolDays: isoSchoolDays,
      lessonsPerDay: lpd,
      vacations,
      occupancy,
    })
    out.push({ lesson_number: n, date })
    // Allow stacking up to lessons_per_day on the same date by re-passing
    // newDate-1 as the next cursor. occupancy decides reuse.
    cursor = addDays(date, -1)
  }
  return out
}

function assertSchoolDaysOnly(
  goal: GoalRow,
  rows: { lesson_number: number; date: string }[],
): void {
  const allowed = new Set(schoolDayLabelsToIso(goal.school_days))
  const offenders = rows.filter((r) => !allowed.has(isoDowFromYmd(r.date)))
  if (offenders.length > 0) {
    console.error(`[generate-missing] goal ${goal.id} produced ${offenders.length} non-school-day rows`)
    for (const o of offenders.slice(0, 5)) {
      console.error(`  lesson ${o.lesson_number} on ${o.date} (iso dow ${isoDowFromYmd(o.date)})`)
    }
    throw new Error(`School-days violation for goal ${goal.id}; aborting.`)
  }
}

async function main() {
  console.log(`[generate-missing] mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`)

  const { data: goals, error: goalsErr } = await supabase
    .from('curriculum_goals')
    .select('id, user_id, child_id, curriculum_name, subject_label, school_days, lessons_per_day, total_lessons, current_lesson, start_at_lesson, start_date, school_year_id')
    .in('id', TARGET_GOAL_IDS)
  if (goalsErr) throw goalsErr

  const goalRows = (goals ?? []) as GoalRow[]
  if (goalRows.length !== TARGET_GOAL_IDS.length) {
    throw new Error(
      `Expected ${TARGET_GOAL_IDS.length} goals, found ${goalRows.length}. IDs: ${goalRows.map(g => g.id).join(', ')}`,
    )
  }

  for (const goal of goalRows) {
    console.log(
      `\n[generate-missing] goal ${goal.id} "${goal.curriculum_name}" school_days=${JSON.stringify(goal.school_days)} lpd=${goal.lessons_per_day} current=${goal.current_lesson}/${goal.total_lessons}`,
    )

    // Refuse to overwrite any pre-existing incomplete forward rows. The
    // user explicitly said "do NOT regenerate or delete any existing
    // lessons." If even one incomplete row exists, bail loudly.
    const { count: existingIncomplete, error: cntErr } = await supabase
      .from('lessons')
      .select('id', { count: 'exact', head: true })
      .eq('curriculum_goal_id', goal.id)
      .eq('completed', false)
    if (cntErr) throw cntErr
    if ((existingIncomplete ?? 0) > 0) {
      throw new Error(
        `goal ${goal.id} already has ${existingIncomplete} incomplete rows; aborting per "no overwrite" instruction.`,
      )
    }

    const seed = await loadSeedRow(goal.id)
    if (!seed) {
      throw new Error(`goal ${goal.id} has no existing rows to seed from; aborting.`)
    }
    const titlePrefix = deriveTitlePrefix(seed.title)

    const plan = await planForGoal(goal)
    if (plan.length === 0) {
      console.log(`  nothing to do (current_lesson >= total_lessons).`)
      continue
    }
    assertSchoolDaysOnly(goal, plan)

    console.log(
      `  planned ${plan.length} rows: lessons ${plan[0].lesson_number}..${plan[plan.length - 1].lesson_number}, dates ${plan[0].date}..${plan[plan.length - 1].date}`,
    )
    console.log(`  first 5: ${plan.slice(0, 5).map(p => `L${p.lesson_number}@${p.date}`).join(', ')}`)
    console.log(`  last 3:  ${plan.slice(-3).map(p => `L${p.lesson_number}@${p.date}`).join(', ')}`)

    if (DRY_RUN) continue

    const inserts = plan.map(({ lesson_number, date }) => ({
      user_id: seed.user_id,
      child_id: seed.child_id,
      subject_id: seed.subject_id,
      school_year_id: seed.school_year_id,
      curriculum_goal_id: goal.id,
      title: `${titlePrefix} — Lesson ${lesson_number}`,
      notes: seed.notes,
      lesson_number,
      date,
      scheduled_date: date,
      scheduled_source: 'cleanup_sql',
      completed: false,
      hours: 0,
      is_backfill: false,
    }))

    let inserted = 0
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100)
      const { error: insErr } = await supabase.from('lessons').insert(batch)
      if (insErr) {
        console.error(`  insert batch ${i}-${i + batch.length} failed:`, insErr)
        throw insErr
      }
      inserted += batch.length
    }
    console.log(`  inserted ${inserted} rows.`)
  }

  console.log(`\n[generate-missing] done.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
