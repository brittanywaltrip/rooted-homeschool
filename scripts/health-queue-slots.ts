// The queue-slot health check. READ ONLY: it opens no write path at all.
//
// Every blank subject card on Today is the same shape underneath. The projector
// emits queue slots current_lesson+1 .. total_lessons and hydrates each one by
// (curriculum_goal_id, queue_position); a slot with no row renders blank. So
// "how healthy is the queue" has one honest answer: for each live goal, how
// many slots the family gets through before they hit one.
//
// Written for the definition of done of the 2026-09-08 queue-slot brief, which
// asks for zero goals with slots_until_blank <= 2. It is cheap enough to run
// against production whenever, and it is what the weekly Supabase health task
// asks in SQL.
//
// Per CURRICULUM-SCHEDULING.md Anti-pattern H this is NOT a migration.
//
// Run:
//   node --env-file=.env.local scripts/health-queue-slots.ts
//   node --env-file=.env.local scripts/health-queue-slots.ts --verbose

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const VERBOSE = process.argv.includes('--verbose')

// How soon a gap has to arrive before it is an emergency rather than a
// backlog item. 0 means the family is looking at a blank card right now.
const URGENT_WITHIN = 2

// Below PostgREST's default 1,000 row cap, so a full page always means "there
// may be more" and a short one always means "that was the end".
const PAGE = 500

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type GoalRow = {
  id: string
  curriculum_name: string | null
  current_lesson: number | null
  total_lessons: number | null
}

async function main() {
  // PAGED, and not because the table is large. The unpaged version of this
  // read returned exactly 1000 rows on the first run of this script, which is
  // PostgREST's default cap and not the number of goals -- it silently reported
  // 2 gapped goals where the same question in SQL finds 17. Every read in this
  // file is paged for that reason. Short page ends the loop, never an empty
  // one, so a truncated response cannot read as the end of the table.
  const goals: GoalRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('curriculum_goals')
      .select('id, curriculum_name, current_lesson, total_lessons')
      .eq('archived', false)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`goals page at ${from} failed: ${error.message}`)
    const page = (data ?? []) as GoalRow[]
    goals.push(...page)
    if (page.length < PAGE) break
  }

  // ── Assertion 1 (item 3): no live goal has zero lesson rows ──────────────
  // A goal with settings and no rows is every slot blank at once. The
  // Schedule Builder saves goal and lessons in two round trips with nothing
  // making them atomic, so a dropped connection between them lands here.
  // app/lib/healEmptyGoal.ts fills one in on the next load of Today or Plan;
  // this counts the ones nobody has opened yet.
  const empties: GoalRow[] = []
  // ── Assertion 2: no live goal blanks within URGENT_WITHIN slots ──────────
  const gaps: { goal: GoalRow; slotsUntilBlank: number; missing: number }[] = []

  // One paged sweep of the slot columns rather than two queries per goal.
  // The per-goal version was N+1 against ~1,700 live goals and took long
  // enough that nobody would run it, which defeats the point of a cheap check.
  //
  // The page size is deliberately below PostgREST's default 1,000 row cap, and
  // the loop stops on a SHORT page rather than on an empty one, so a truncated
  // response can never be mistaken for the end of the table. Ordered by id so
  // the ranges are stable across pages.
  const rowsByGoal = new Map<string, { slots: Set<number>; count: number }>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('lessons')
      .select('curriculum_goal_id, queue_position')
      .not('curriculum_goal_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`lessons page at ${from} failed: ${error.message}`)
    const page = (data ?? []) as { curriculum_goal_id: string; queue_position: number | null }[]
    for (const r of page) {
      let entry = rowsByGoal.get(r.curriculum_goal_id)
      if (!entry) {
        entry = { slots: new Set<number>(), count: 0 }
        rowsByGoal.set(r.curriculum_goal_id, entry)
      }
      entry.count += 1
      if (r.queue_position != null) entry.slots.add(r.queue_position)
    }
    if (page.length < PAGE) break
  }

  for (const g of goals) {
    const entry = rowsByGoal.get(g.id)
    if (!entry || entry.count === 0) {
      empties.push(g)
      continue
    }

    const cur = g.current_lesson ?? 0
    const total = g.total_lessons ?? 0
    if (total <= 0 || cur >= total) continue  // nothing left to project

    let firstBlank: number | null = null
    let missing = 0
    for (let s = cur + 1; s <= total; s++) {
      if (entry.slots.has(s)) continue
      missing += 1
      if (firstBlank === null) firstBlank = s
    }
    if (firstBlank !== null) {
      gaps.push({ goal: g, slotsUntilBlank: firstBlank - (cur + 1), missing })
    }
  }

  const urgent = gaps.filter((x) => x.slotsUntilBlank <= URGENT_WITHIN)
  urgent.sort((a, b) => a.slotsUntilBlank - b.slotsUntilBlank)

  console.log(`live goals                       ${goals.length}`)
  console.log(`goals with zero lesson rows      ${empties.length}   (want 0)`)
  console.log(`goals with any gap ahead         ${gaps.length}`)
  console.log(`goals blank within ${URGENT_WITHIN} slots       ${urgent.length}   (want 0)`)
  console.log(`goals blank RIGHT NOW            ${gaps.filter((x) => x.slotsUntilBlank === 0).length}`)

  if (VERBOSE) {
    for (const g of empties) console.log(`  EMPTY  ${g.id}  ${g.curriculum_name}`)
    for (const x of urgent) {
      console.log(
        `  GAP    ${x.goal.id}  ${x.goal.curriculum_name}  ` +
        `blank in ${x.slotsUntilBlank}, ${x.missing} slots missing`,
      )
    }
  }

  // Repairs live in scripts/repair-empty-goals.ts and
  // scripts/repair-queue-gaps.ts. This script never writes.
  const failed = empties.length > 0 || urgent.length > 0
  if (failed) {
    console.log('\nFAIL. Repair with scripts/repair-empty-goals.ts (dry run first)')
    console.log('and scripts/repair-queue-gaps.ts, then re-run this check.')
  } else {
    console.log('\nPASS')
  }
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
