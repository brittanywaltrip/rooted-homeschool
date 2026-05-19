// One-off cleanup: backfill queue_position = lesson_number on any
// curriculum-bound lesson rows that were inserted with queue_position = NULL.
//
// Why: migration 20260518064205_lesson_queue_position added the column and
// backfilled rows that existed at deploy time, but the Schedule Builder
// (app/dashboard/plan/schedule/page.tsx) and the Plan-page "Add Lesson from
// Group" path were not updated to set queue_position on new inserts. The
// Today page filters by queue_position, so NULL rows are invisible to users.
// Reported by Blair Torres on 2026-05-18.
//
// This script is the data-side counterpart to the code fix in the same PR.
// The code fix prevents new NULL rows; this script fixes the rows already
// in production.
//
// Per CURRICULUM-SCHEDULING.md Anti-pattern H, this is NOT a migration —
// it's a one-off script with dry-run support that an engineer runs by hand.
//
// Run:
//   node --env-file=.env.local scripts/fix-null-queue-positions.ts --dry-run
//   node --env-file=.env.local scripts/fix-null-queue-positions.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const DRY_RUN = process.argv.includes('--dry-run')

type AffectedRow = {
  id: string
  user_id: string
  curriculum_goal_id: string
  lesson_number: number
}

async function countNullRows(): Promise<{ rows: number; users: number; goals: number }> {
  // Count rows.
  const { count: rowCount, error: rowErr } = await supabase
    .from('lessons')
    .select('id', { count: 'exact', head: true })
    .not('curriculum_goal_id', 'is', null)
    .not('lesson_number', 'is', null)
    .is('queue_position', null)
  if (rowErr) throw rowErr

  // Count distinct users and goals — Supabase JS lacks DISTINCT, so paginate.
  const userSet = new Set<string>()
  const goalSet = new Set<string>()
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('lessons')
      .select('user_id, curriculum_goal_id')
      .not('curriculum_goal_id', 'is', null)
      .not('lesson_number', 'is', null)
      .is('queue_position', null)
      .range(from, from + pageSize - 1)
    if (error) throw error
    const rows = (data ?? []) as { user_id: string; curriculum_goal_id: string }[]
    if (rows.length === 0) break
    for (const r of rows) {
      userSet.add(r.user_id)
      goalSet.add(r.curriculum_goal_id)
    }
    if (rows.length < pageSize) break
    from += pageSize
  }
  return { rows: rowCount ?? 0, users: userSet.size, goals: goalSet.size }
}

async function loadAffectedRows(): Promise<AffectedRow[]> {
  const out: AffectedRow[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('lessons')
      .select('id, user_id, curriculum_goal_id, lesson_number')
      .not('curriculum_goal_id', 'is', null)
      .not('lesson_number', 'is', null)
      .is('queue_position', null)
      .order('curriculum_goal_id', { ascending: true })
      .order('lesson_number', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const rows = (data ?? []) as AffectedRow[]
    if (rows.length === 0) break
    out.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return out
}

async function main() {
  console.log(`[fix-null-queue-positions] mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`)

  const before = await countNullRows()
  console.log(
    `[fix-null-queue-positions] before: ${before.rows} rows across ${before.users} users / ${before.goals} goals`,
  )

  if (before.rows === 0) {
    console.log(`[fix-null-queue-positions] nothing to do.`)
    return
  }

  const rows = await loadAffectedRows()
  if (rows.length !== before.rows) {
    // Drift between count() and the paginated read shouldn't be fatal — it
    // just means new NULL rows landed mid-run. Log and continue with what
    // we have.
    console.warn(
      `[fix-null-queue-positions] count drift: counted ${before.rows} but loaded ${rows.length}`,
    )
  }

  // Sample preview so the dry-run output is useful.
  console.log(`[fix-null-queue-positions] sample (first 5):`)
  for (const r of rows.slice(0, 5)) {
    console.log(`  goal ${r.curriculum_goal_id} lesson_number=${r.lesson_number} id=${r.id}`)
  }

  if (DRY_RUN) {
    console.log(`[fix-null-queue-positions] dry-run: would update ${rows.length} rows.`)
    return
  }

  // Batch UPDATEs by id. We update one row at a time inside each batch
  // because PostgREST cannot express "set queue_position = lesson_number"
  // (a column-to-column assignment) without an RPC; the per-id update is
  // simple and correct. Throughput is fine for ~5k rows.
  let updated = 0
  let failed = 0
  const batchSize = 50
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map((r) =>
        supabase
          .from('lessons')
          .update({ queue_position: r.lesson_number })
          .eq('id', r.id)
          .is('queue_position', null) // belt + suspenders against concurrent writes
          .then((res) => ({ id: r.id, error: res.error })),
      ),
    )
    for (const res of results) {
      if (res.error) {
        failed++
        console.error(`[fix-null-queue-positions] update failed for ${res.id}: ${res.error.message}`)
      } else {
        updated++
      }
    }
    if ((i + batch.length) % 500 === 0 || i + batch.length === rows.length) {
      console.log(`[fix-null-queue-positions] progress: ${updated} updated, ${failed} failed`)
    }
  }

  const after = await countNullRows()
  console.log(
    `[fix-null-queue-positions] after: ${after.rows} rows across ${after.users} users / ${after.goals} goals`,
  )
  console.log(
    `[fix-null-queue-positions] done. updated=${updated} failed=${failed} delta=${before.rows - after.rows}`,
  )
}

main().catch((err) => {
  console.error('[fix-null-queue-positions] fatal error:', err)
  process.exit(1)
})
