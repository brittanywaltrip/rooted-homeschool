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

import { isNonFamilyEmail, classifyGoalSlots } from '../lib/queue-slot-health.ts'

const VERBOSE = process.argv.includes('--verbose')

// How soon an INTERIOR hole has to arrive before it is an emergency rather
// than a backlog item. 0 means the family is looking at a blank card right now.
//
// Interior holes only. An ungenerated tail is not urgent and never was: the
// Schedule Builder writes from the pointer forward and extends on the next
// save, so a tail fills in as the family moves through the year. Counting it
// here is what made the first version of this script report "8 blank within 2
// slots, 1 blank RIGHT NOW" when all eight were tail on a demo account and no
// family was affected at all. See classifyGoalSlots.
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
  user_id: string
  curriculum_name: string | null
  current_lesson: number | null
  total_lessons: number | null
}

/** user_id -> email, for the exclusion test and the per-goal report. Same
 *  admin listing the three repair scripts use; `profiles` has no email column. */
async function loadEmails(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`user listing failed: ${error.message}`)
    const users = data?.users ?? []
    for (const u of users) out.set(u.id, u.email ?? '(no email)')
    if (users.length < 200) break
  }
  return out
}

async function main() {
  const emailByUser = await loadEmails()

  // PAGED, and not because the table is large. The unpaged version of this read
  // returned exactly 1000 rows on the first run of this script, which is
  // PostgREST's default cap and not the number of goals -- it silently reported
  // 2 gapped goals where the same question in SQL finds 17.
  //
  // Keyset paged and count-checked, for the same reason as the lesson sweep
  // below: an offset loop that stops on a short page treats one transient
  // response as the end of the table, and a goal that was never read is a goal
  // that was never checked. Understating is quieter than the invented holes the
  // lesson sweep produced, and just as wrong.
  const { count: expectedGoals, error: goalCountErr } = await supabase
    .from('curriculum_goals')
    .select('id', { count: 'exact', head: true })
    .eq('archived', false)
  if (goalCountErr) throw new Error(`goal count failed: ${goalCountErr.message}`)

  const goals: GoalRow[] = []
  let lastGoalId = ''
  for (;;) {
    let q = supabase
      .from('curriculum_goals')
      .select('id, user_id, curriculum_name, current_lesson, total_lessons')
      .eq('archived', false)
      .order('id', { ascending: true })
      .limit(PAGE)
    if (lastGoalId) q = q.gt('id', lastGoalId)
    const { data, error } = await q
    if (error) throw new Error(`goals page after ${lastGoalId || 'start'} failed: ${error.message}`)
    const page = (data ?? []) as GoalRow[]
    if (page.length === 0) break
    goals.push(...page)
    lastGoalId = page[page.length - 1].id
  }
  if (expectedGoals != null && goals.length !== expectedGoals) {
    throw new Error(
      `read ${goals.length} of ${expectedGoals} live goals; refusing to report ` +
      `against a partial sweep`,
    )
  }

  // ── Assertion 1 (item 3): no live goal has zero lesson rows ──────────────
  // A goal with settings and no rows is every slot blank at once. The
  // Schedule Builder saves goal and lessons in two round trips with nothing
  // making them atomic, so a dropped connection between them lands here.
  // app/lib/healEmptyGoal.ts fills one in on the next load of Today or Plan;
  // this counts the ones nobody has opened yet.
  const emptyProjecting: GoalRow[] = []
  const emptyFinished: GoalRow[] = []
  // ── Assertion 2: no live goal blanks within URGENT_WITHIN slots ──────────
  // An INTERIOR hole only. See URGENT_WITHIN above.
  type Finding = { goal: GoalRow; health: ReturnType<typeof classifyGoalSlots> }
  const holes: Finding[] = []
  const tails: Finding[] = []
  let excludedGoals = 0

  // One paged sweep of the slot columns rather than two queries per goal.
  // The per-goal version was N+1 against ~1,700 live goals and took long
  // enough that nobody would run it, which defeats the point of a cheap check.
  //
  // The page size is deliberately below PostgREST's default 1,000 row cap, and
  // the loop stops on a SHORT page rather than on an empty one, so a truncated
  // response can never be mistaken for the end of the table. Ordered by id so
  // the ranges are stable across pages.
  const rowsByGoal = new Map<string, { slots: Set<number>; count: number }>()

  // KEYSET paged on the primary key, not offset paged, and checked against an
  // exact count afterwards.
  //
  // The offset version of this loop broke on any page shorter than PAGE, which
  // it treated as end-of-table. Over ~380 pages one short response is enough to
  // end the sweep early, and a goal whose rows were never read looks exactly
  // like a goal whose rows do not exist -- so the check INVENTED interior holes.
  // Two consecutive runs on 2026-09-09 disagreed: one reported 0 holes, the
  // other reported 10 across 7 real families, including a "blank RIGHT NOW"
  // that was not real. A health check that answers differently twice is worse
  // than none, which is the same lesson as the 1000-row cap a day earlier.
  //
  // Keyset paging cannot skip or repeat a row, and the count assertion turns
  // any remaining shortfall into a loud failure instead of a wrong number.
  const { count: expectedRows, error: countErr } = await supabase
    .from('lessons')
    .select('id', { count: 'exact', head: true })
    .not('curriculum_goal_id', 'is', null)
  if (countErr) throw new Error(`lesson count failed: ${countErr.message}`)

  let scanned = 0
  let lastId = ''
  for (;;) {
    let q = supabase
      .from('lessons')
      .select('id, curriculum_goal_id, queue_position')
      .not('curriculum_goal_id', 'is', null)
      .order('id', { ascending: true })
      .limit(PAGE)
    if (lastId) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`lessons page after ${lastId || 'start'} failed: ${error.message}`)
    const page = (data ?? []) as {
      id: string
      curriculum_goal_id: string
      queue_position: number | null
    }[]
    if (page.length === 0) break
    for (const r of page) {
      let entry = rowsByGoal.get(r.curriculum_goal_id)
      if (!entry) {
        entry = { slots: new Set<number>(), count: 0 }
        rowsByGoal.set(r.curriculum_goal_id, entry)
      }
      entry.count += 1
      if (r.queue_position != null) entry.slots.add(r.queue_position)
    }
    scanned += page.length
    lastId = page[page.length - 1].id
  }

  if (expectedRows != null && scanned !== expectedRows) {
    throw new Error(
      `read ${scanned} of ${expectedRows} goal-attached lesson rows; refusing to ` +
      `report holes against a partial sweep`,
    )
  }

  for (const g of goals) {
    // Not a family: a demo account, the Playwright account, or one of
    // Brittany's. Their goals are deliberately in odd states. One shared list,
    // in lib/queue-slot-health.ts.
    if (isNonFamilyEmail(emailByUser.get(g.user_id))) {
      excludedGoals += 1
      continue
    }

    const entry = rowsByGoal.get(g.id)
    const cur = g.current_lesson ?? 0
    const total = g.total_lessons ?? 0

    if (!entry || entry.count === 0) {
      // A goal with no rows at all. Only a problem while it still has
      // something left to project: all 7 in the 2026-09-09 sweep sat at
      // current_lesson == total_lessons, and repair-empty-goals planned zero
      // rows for every one of them because there is genuinely nothing to write.
      if (total > 0 && cur < total) emptyProjecting.push(g)
      else emptyFinished.push(g)
      continue
    }

    const health = classifyGoalSlots(cur, total, entry.slots)
    if (health.interiorHoles.length > 0) {
      holes.push({ goal: g, health })
    } else if (health.missingTail > 0) {
      tails.push({ goal: g, health })
    }
  }

  const urgent = holes.filter(
    (x) => x.health.slotsUntilBlank !== null && x.health.slotsUntilBlank <= URGENT_WITHIN,
  )
  urgent.sort((a, b) => (a.health.slotsUntilBlank ?? 0) - (b.health.slotsUntilBlank ?? 0))
  const blankNow = holes.filter((x) => x.health.slotsUntilBlank === 0)

  const email = (g: GoalRow) => emailByUser.get(g.user_id) ?? '(unknown)'

  console.log(`family goals scanned             ${goals.length - excludedGoals}`)
  console.log(`  excluded, not families         ${excludedGoals}`)
  console.log(`empty and still projecting       ${emptyProjecting.length}   (want 0)`)
  console.log(`goals with an interior hole      ${holes.length}`)
  console.log(`  blank within ${URGENT_WITHIN} slots            ${urgent.length}   (want 0)`)
  console.log(`  blank RIGHT NOW                ${blankNow.length}   (want 0)`)
  console.log('')
  console.log(`empty but finished               ${emptyFinished.length}   (informational)`)
  console.log(`ungenerated tail, no hole        ${tails.length}   (informational)`)

  if (VERBOSE) {
    for (const g of emptyProjecting) {
      console.log(`  EMPTY  ${email(g)}  ${g.curriculum_name}  ${g.current_lesson}/${g.total_lessons}  ${g.id}`)
    }
    for (const x of urgent) {
      console.log(
        `  HOLE   ${email(x.goal)}  ${x.goal.curriculum_name}  ` +
        `blank in ${x.health.slotsUntilBlank}, slots [${x.health.interiorHoles.slice(0, 8).join(', ')}]  ${x.goal.id}`,
      )
    }
    for (const g of emptyFinished) {
      console.log(`  done   ${email(g)}  ${g.curriculum_name}  ${g.current_lesson}/${g.total_lessons}`)
    }
    for (const x of tails) {
      console.log(`  tail   ${email(x.goal)}  ${x.goal.curriculum_name}  ${x.health.missingTail} slot(s) not written yet`)
    }
  }

  // Repairs live in scripts/repair-empty-goals.ts and
  // scripts/repair-queue-gaps.ts. This script never writes.
  //
  // Only the two counts above that say "want 0" can fail the run. A finished
  // empty goal and an ungenerated tail are reported and do not.
  const failed = emptyProjecting.length > 0 || urgent.length > 0
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
