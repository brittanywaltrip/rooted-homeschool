// One-time heal: delete orphan `lessons` rows whose lesson_number is past
// their goal's total_lessons. These were left behind by a prior version of
// CurriculumWizard.saveEdit that updated curriculum_goals.total_lessons on
// shrink without trimming the lessons table. The orphans pushed the Plan
// list "On track to finish" date out by months or years.
//
// Run:
//   node --env-file=.env.local scripts/heal-curriculum-lessons.ts --dry-run
//   node --env-file=.env.local scripts/heal-curriculum-lessons.ts
//
// --dry-run prints what would be deleted without writing.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const DRY_RUN = process.argv.includes('--dry-run')

type Goal = {
  id: string
  user_id: string
  curriculum_name: string | null
  total_lessons: number | null
}

type OrphanRow = {
  id: string
  lesson_number: number | null
  scheduled_date: string | null
}

async function main() {
  console.log(`[heal-curriculum-lessons] mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`)

  const { data: goals, error: goalsErr } = await supabase
    .from('curriculum_goals')
    .select('id, user_id, curriculum_name, total_lessons')
  if (goalsErr) throw goalsErr

  const goalList = (goals ?? []) as Goal[]
  console.log(`[heal-curriculum-lessons] scanning ${goalList.length} goals`)

  let goalsAffected = 0
  let totalOrphans = 0

  for (const goal of goalList) {
    if (goal.total_lessons == null) continue

    const { data: orphans, error: orphErr } = await supabase
      .from('lessons')
      .select('id, lesson_number, scheduled_date')
      .eq('curriculum_goal_id', goal.id)
      .eq('completed', false)
      .gt('lesson_number', goal.total_lessons)
    if (orphErr) {
      console.error(`[heal-curriculum-lessons] read failed for goal ${goal.id}:`, orphErr)
      continue
    }

    const rows = (orphans ?? []) as OrphanRow[]
    if (rows.length === 0) continue

    goalsAffected++
    totalOrphans += rows.length

    const dates = rows
      .map((r) => r.scheduled_date)
      .filter((d): d is string => !!d)
      .sort()
    const earliest = dates[0] ?? '?'
    const latest = dates[dates.length - 1] ?? '?'
    const numbers = rows
      .map((r) => r.lesson_number)
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b)
    const minNum = numbers[0] ?? '?'
    const maxNum = numbers[numbers.length - 1] ?? '?'

    console.log(
      `  goal ${goal.id} (${goal.curriculum_name ?? 'unnamed'}, total=${goal.total_lessons}): ${rows.length} orphan rows, lesson_number ${minNum}..${maxNum}, scheduled ${earliest}..${latest}`,
    )

    if (!DRY_RUN) {
      const ids = rows.map((r) => r.id)
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100)
        const { error: delErr } = await supabase.from('lessons').delete().in('id', batch)
        if (delErr) {
          console.error(`[heal-curriculum-lessons] delete failed for goal ${goal.id}:`, delErr)
          break
        }
      }
    }
  }

  console.log()
  console.log(`[heal-curriculum-lessons] goals scanned:  ${goalList.length}`)
  console.log(`[heal-curriculum-lessons] goals affected: ${goalsAffected}`)
  console.log(`[heal-curriculum-lessons] orphan rows ${DRY_RUN ? 'would delete' : 'deleted'}: ${totalOrphans}`)
}

main().catch((err) => {
  console.error('[heal-curriculum-lessons] fatal error:', err)
  process.exit(1)
})
