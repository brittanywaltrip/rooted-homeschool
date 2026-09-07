// Give back the lessons a database trigger said a family had done.
//
// THE DAMAGE. `curriculum_goals_cleanup_orphans_trg` completed every incomplete
// row at or below a goal's pointer whenever `current_lesson` advanced. It was
// written to stop orphan rows ghosting on the calendar (migration
// 20260519180000) and it did that by asserting the work had happened, which is
// not something a trigger can know. 289 rows across 161 goals and 34 families
// carry that assertion as of 2026-09-07, the newest written that same morning.
//
// The trigger is fixed by 20260907000000_no_server_side_lesson_completion.sql.
// That migration stops new damage and heals none of the existing rows. This
// script is the healing half.
//
// THE FINGERPRINT, and why it is safe to key on:
//
//   completed = true
//   scheduled_date IS NULL                 (the trigger cleared it)
//   updated_at - completed_at = EXACTLY 24 hours, to the microsecond
//
// The last one is the signature. The trigger set `completed_at = NOW() -
// interval '1 day'` and the `lessons_set_updated_at` trigger set `updated_at =
// NOW()` in the same statement, so the two differ by exactly one day at
// microsecond resolution. All 289 matching rows in production match EXACTLY,
// not approximately: querying with a one-second tolerance returns the same 289
// as querying for equality. A human completion would have to land its
// `completed_at` within a microsecond of exactly 24 hours before its last
// update, having also left `scheduled_date` NULL. The comparison here is
// therefore exact, and the tolerance version is not offered.
//
// The trigger also never wrote `scheduled_source`, which is why these rows
// still carry the label of whatever wrote them last: 167 `queue_resync`, 99
// `wizard_create`, 23 `plan_move`.
//
// THREE CLASSES.
//
//   REVERT  (134 rows, 21 families, 88 goals)
//           Has a queue slot, no notes, no recorded minutes, on a live goal.
//           Set completed = false, completed_at = NULL, and give the row its
//           calendar day back from the projector.
//
//   SKIP: no queue slot  (125 rows, 19 families, 63 goals)
//           Swept before 20260824000000, which nulled `queue_position` on the
//           way past. Reverting one of these produces a goal-linked incomplete
//           row with no slot — drift E, the shape that renders on the Plan
//           calendar and then never appears on Today. It would swap a lesson
//           wrongly marked done for a lesson that has silently vanished, which
//           is worse. These rows need their slot back first:
//           `scripts/repair-queue-gaps.ts --apply --restores-only` is the tool
//           for that, and this script can be re-run afterwards to pick them up.
//
//   REVIEW  (30 rows, 11 families)
//           The fingerprint is a strong signal, not a confession. Five shapes
//           get held back for a human, and each one is printed in full:
//             * notes present            — a parent wrote something on the row.
//                                          The trigger skipped notes-bearing
//                                          rows, so this can only mean the note
//                                          arrived afterwards. 0 in production.
//             * minutes / hours recorded — the trigger writes neither. Time on
//                                          the row is evidence a person logged
//                                          it. 3 rows.
//             * is_backfill              — the row is somebody's record of past
//                                          work. 2 rows.
//             * goal finished            — reverting re-opens a curriculum the
//                                          family has closed out. 6 rows.
//             * goal archived            — same, for "Mark as finished". 19
//                                          rows.
//           None of these are reverted, with or without --apply. Approving them
//           is a per-row decision somebody has to make with the family's
//           account in front of them.
//
// WHAT --apply DOES, per goal, in order:
//
//   1. Snapshots every row it is about to touch to a timestamped JSON file
//      BEFORE writing anything, including the columns needed to put it back:
//      completed, completed_at, scheduled_date, date, scheduled_source.
//   2. Reverts the goal's REVERT rows: completed = false, completed_at = NULL,
//      scheduled_source = 'cleanup_sql' (Invariant 10 — this is a manual
//      cleanup and says so).
//      Un-completing fires `trg_lessons_recompute_current_lesson`, which lowers
//      `current_lesson` to MAX(queue_position) over the rows that are still
//      completed. That is the point: the pointer was standing on work nobody
//      did, and it is being put back where the family actually is.
//   3. Re-reads the goal and its rows, projects the tail with
//      `computeNextLessonsForGoal` (the app's own projector, full tail per
//      Invariant 11, pin-aware per Invariant 12, no day-walk loop here per
//      Invariant 8) and writes `scheduled_date` / `date` for the reverted rows
//      from the slot each one holds.
//
// It never deletes, never inserts, and never touches a row outside the
// fingerprint.
//
// ORDER OF OPERATIONS. Run these three in this order, checking each:
//
//   1. Apply 20260907000000_no_server_side_lesson_completion.sql. Until it is
//      live, the next pointer advance re-sweeps whatever this script reverts,
//      and step 2 below is itself a pointer advance. Verify:
//        select pg_get_functiondef('public.curriculum_goals_cleanup_orphans_trg'::regproc)
//               not like '%completed = true%';
//   2. scripts/repair-queue-gaps.ts --apply --restores-only, to hand slots back
//      to the SKIP class.
//   3. This script.
//
// Because step 1 is not something this script can verify for itself over
// PostgREST, --apply refuses to run without --migration-is-live, which is a
// human saying they checked.
//
// Per docs/CURRICULUM-SCHEDULING.md Anti-pattern H this is NOT a migration: a
// migration would run against every environment at deploy time and rewrite real
// families' records with nobody watching.
//
// Run:
//   npx tsx scripts/repair-phantom-completions.ts                    (DRY RUN)
//   npx tsx scripts/repair-phantom-completions.ts --user <uuid>      (one family)
//   npx tsx scripts/repair-phantom-completions.ts --apply --migration-is-live

import { readFileSync, writeFileSync } from 'node:fs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

import {
  computeNextLessonsForGoal,
  pinsFromRows,
  toGoalConfig,
  type GoalConfigRow,
  type PinnableRow,
  type VacationBlock,
} from '../app/lib/scheduler.ts'

// Dry run is the DEFAULT. Writing requires saying so out loud, twice.
const APPLY = process.argv.includes('--apply')
const MIGRATION_IS_LIVE = process.argv.includes('--migration-is-live')
const USER_FILTER = (() => {
  const i = process.argv.indexOf('--user')
  return i >= 0 ? process.argv[i + 1] : null
})()

// Known test account. Its goals are deliberately in odd states and must never
// be repaired alongside real families'. Same exclusion repair-queue-gaps and
// repair-empty-goals use.
const EXCLUDED_EMAIL = 'garfieldbrittany+test1@gmail.com'

// The projector's safety bound, matching the Schedule Builder's create path.
// Invariant 11: never a small fixed window.
const DAYS_AHEAD = 3650

// PostgREST returns at most 1000 rows per request and does not say it
// truncated. Every read below pages, ordered by a unique column. This is the
// same cap that made Today's confirm prompt fire on rows that existed; a
// skipped row here would read as "no damage" and leave a family's record wrong.
const PAGE = 1000

function loadEnvLocal(): void {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return
  let raw: string
  try {
    raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadEnvLocal()

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[repair-phantom-completions] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Put them in .env.local or pass --env-file.',
  )
  process.exit(1)
}

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

/* ── The fingerprint ─────────────────────────────────────────────────────── */

/**
 * Are these two timestamps exactly 24 hours apart, to the microsecond?
 *
 * Postgres stores microseconds; JavaScript's Date holds milliseconds and would
 * silently round the last three digits away, which is most of the precision
 * that makes this fingerprint a fingerprint. So the comparison is done in two
 * halves: the millisecond-truncated instants through Date, and the remaining
 * sub-millisecond digits as text.
 */
export function isExactly24hApart(completedAt: string, updatedAt: string): boolean {
  const split = (ts: string): { ms: number; micros: string } | null => {
    const m = ts.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/)
    if (!m) return null
    const [, day, time, frac = '', zone] = m
    const fracPadded = (frac + '000000').slice(0, 6)
    const millis = fracPadded.slice(0, 3)
    const micros = fracPadded.slice(3, 6)
    // Normalise the zone. PostgREST hands back '+00:00'; psql and a few
    // client paths hand back '+00', which Date.parse rejects outright — and a
    // rejected parse here would report "no damage found" rather than an error,
    // which is the worst possible failure for this script. A zone-less stamp
    // is UTC.
    const zoneRaw = zone?.trim() ?? ''
    const zoneNorm =
      zoneRaw.length === 0
        ? 'Z'
        : /^[+-]\d{2}$/.test(zoneRaw)
          ? `${zoneRaw}:00`
          : zoneRaw
    const ms = Date.parse(`${day}T${time}.${millis}${zoneNorm}`)
    if (Number.isNaN(ms)) return null
    return { ms, micros }
  }
  const a = split(completedAt)
  const b = split(updatedAt)
  if (!a || !b) return false
  return b.ms - a.ms === 86_400_000 && a.micros === b.micros
}

type LessonRow = {
  id: string
  user_id: string
  curriculum_goal_id: string | null
  lesson_number: number | null
  queue_position: number | null
  queue_pinned: boolean | null
  completed: boolean
  completed_at: string | null
  scheduled_date: string | null
  date: string | null
  scheduled_source: string | null
  is_backfill: boolean | null
  notes: string | null
  minutes_spent: number | null
  hours: number | null
  title: string | null
  updated_at: string
}

type GoalRow = GoalConfigRow & {
  user_id: string
  curriculum_name: string | null
  archived: boolean | null
  completed_at: string | null
}

type Klass = 'REVERT' | 'SKIP_NO_SLOT' | 'REVIEW'

type Candidate = {
  row: LessonRow
  goal: GoalRow
  klass: Klass
  reason: string
}

/** The one place the classes are decided. */
function classify(row: LessonRow, goal: GoalRow): { klass: Klass; reason: string } {
  if (row.notes != null && row.notes.trim() !== '') {
    return { klass: 'REVIEW', reason: 'notes present — a person wrote on this row' }
  }
  if ((row.minutes_spent ?? 0) > 0 || (row.hours ?? 0) > 0) {
    return { klass: 'REVIEW', reason: 'minutes recorded — the trigger never writes time' }
  }
  if (row.is_backfill) {
    return { klass: 'REVIEW', reason: 'is_backfill — the row is somebody’s record of past work' }
  }
  if (goal.completed_at != null) {
    return { klass: 'REVIEW', reason: 'goal finished — reverting re-opens a closed curriculum' }
  }
  if (goal.archived) {
    return { klass: 'REVIEW', reason: 'goal archived — same, via "Mark as finished"' }
  }
  if (row.queue_position == null) {
    return {
      klass: 'SKIP_NO_SLOT',
      reason: 'no queue slot — run repair-queue-gaps --restores-only first, or this becomes drift E',
    }
  }
  return { klass: 'REVERT', reason: '' }
}

/* ── Reads ───────────────────────────────────────────────────────────────── */

async function pagedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(JSON.stringify(error))
    const batch = (data ?? []) as T[]
    out.push(...batch)
    if (batch.length < PAGE) return out
  }
}

async function loadCandidates(): Promise<Candidate[]> {
  // The email lives on auth.users, not on profiles — `profiles` has no email
  // column at all, so a lookup there returns nothing and silently stops
  // excluding the test account. Same admin listing repair-empty-goals uses.
  let excludedUserId: string | null = null
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = data?.users ?? []
    const hit = users.find((u) => u.email === EXCLUDED_EMAIL)
    if (hit) {
      excludedUserId = hit.id
      break
    }
    if (users.length < 200) break
  }

  // The narrow part of the fingerprint runs in the database; the exact
  // 24-hour test runs here, where the microseconds survive.
  const rows = await pagedSelect<LessonRow>((from, to) => {
    let q = supabase
      .from('lessons')
      .select(
        'id, user_id, curriculum_goal_id, lesson_number, queue_position, queue_pinned, completed, completed_at, scheduled_date, date, scheduled_source, is_backfill, notes, minutes_spent, hours, title, updated_at',
      )
      .eq('completed', true)
      .is('scheduled_date', null)
      .not('completed_at', 'is', null)
      .not('curriculum_goal_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
    if (USER_FILTER) q = q.eq('user_id', USER_FILTER)
    return q
  })

  const fingerprinted = rows.filter(
    (r) => r.completed_at != null && isExactly24hApart(r.completed_at, r.updated_at),
  )
  if (fingerprinted.length === 0) return []

  const goalIds = Array.from(
    new Set(fingerprinted.map((r) => r.curriculum_goal_id).filter((g): g is string => !!g)),
  )
  const goals = new Map<string, GoalRow>()
  for (let i = 0; i < goalIds.length; i += 100) {
    const { data, error } = await supabase
      .from('curriculum_goals')
      .select(
        'id, total_lessons, current_lesson, lessons_per_day, lessons_per_day_overrides, school_days, start_date, user_id, curriculum_name, archived, completed_at',
      )
      .in('id', goalIds.slice(i, i + 100))
    if (error) throw new Error(JSON.stringify(error))
    for (const g of (data ?? []) as GoalRow[]) goals.set(g.id, g)
  }

  const out: Candidate[] = []
  for (const row of fingerprinted) {
    const goal = row.curriculum_goal_id ? goals.get(row.curriculum_goal_id) : undefined
    if (!goal) continue
    if (excludedUserId && goal.user_id === excludedUserId) continue
    const { klass, reason } = classify(row, goal)
    out.push({ row, goal, klass, reason })
  }
  return out
}

async function loadVacations(userId: string): Promise<VacationBlock[]> {
  const { data } = await supabase
    .from('vacation_blocks')
    .select('start_date, end_date')
    .eq('user_id', userId)
  return ((data ?? []) as { start_date: string; end_date: string }[]).map((v) => ({
    start_date: v.start_date,
    end_date: v.end_date,
  }))
}

/* ── Report ──────────────────────────────────────────────────────────────── */

function report(candidates: Candidate[]): void {
  const byClass = new Map<Klass, Candidate[]>()
  for (const c of candidates) {
    const list = byClass.get(c.klass) ?? []
    list.push(c)
    byClass.set(c.klass, list)
  }

  console.log('\n═══ PHANTOM COMPLETIONS ═══════════════════════════════════════════')
  console.log(`matched by fingerprint: ${candidates.length} rows`)
  for (const klass of ['REVERT', 'SKIP_NO_SLOT', 'REVIEW'] as Klass[]) {
    const list = byClass.get(klass) ?? []
    const users = new Set(list.map((c) => c.goal.user_id)).size
    const goals = new Set(list.map((c) => c.goal.id)).size
    console.log(`  ${klass.padEnd(13)} ${String(list.length).padStart(4)} rows  ${String(users).padStart(3)} families  ${String(goals).padStart(3)} goals`)
  }

  console.log('\n── per family ────────────────────────────────────────────────────')
  const byUser = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const list = byUser.get(c.goal.user_id) ?? []
    list.push(c)
    byUser.set(c.goal.user_id, list)
  }
  const userRows = Array.from(byUser.entries())
    .map(([userId, list]) => ({
      userId,
      total: list.length,
      revert: list.filter((c) => c.klass === 'REVERT').length,
      skip: list.filter((c) => c.klass === 'SKIP_NO_SLOT').length,
      review: list.filter((c) => c.klass === 'REVIEW').length,
      goals: new Set(list.map((c) => c.goal.id)).size,
    }))
    .sort((a, b) => b.total - a.total)
  console.log('user_id                               total revert skip review goals')
  for (const u of userRows) {
    console.log(
      `${u.userId}  ${String(u.total).padStart(4)} ${String(u.revert).padStart(6)} ${String(u.skip).padStart(4)} ${String(u.review).padStart(6)} ${String(u.goals).padStart(5)}`,
    )
  }

  console.log('\n── 20 sample rows ────────────────────────────────────────────────')
  const samples = candidates
    .slice()
    .sort((a, b) => b.row.updated_at.localeCompare(a.row.updated_at))
    .slice(0, 20)
  for (const c of samples) {
    const dow = c.row.date
      ? new Date(`${c.row.date}T12:00:00Z`).toUTCString().slice(0, 3)
      : '---'
    console.log(
      [
        c.klass.padEnd(13),
        (c.goal.curriculum_name ?? 'Curriculum').slice(0, 26).padEnd(26),
        `L${String(c.row.lesson_number ?? '?').padStart(3)}`,
        `slot ${String(c.row.queue_position ?? 'null').padStart(4)}`,
        `stamped ${c.row.date ?? '----------'} (${dow})`,
        `school_days ${(c.goal.school_days ?? ['(default Mon-Fri)']).join('/')}`,
        `src ${c.row.scheduled_source ?? '(null)'}`,
        `swept ${c.row.updated_at.slice(0, 16).replace('T', ' ')}`,
      ].join('  '),
    )
  }

  const review = byClass.get('REVIEW') ?? []
  if (review.length > 0) {
    console.log('\n── HELD BACK FOR A HUMAN (never reverted, with or without --apply) ─')
    for (const c of review) {
      console.log(
        `  ${c.row.id}  ${(c.goal.curriculum_name ?? '').slice(0, 30).padEnd(30)} L${c.row.lesson_number ?? '?'}  ${c.reason}`,
      )
    }
  }

  const skipped = byClass.get('SKIP_NO_SLOT') ?? []
  if (skipped.length > 0) {
    console.log(
      `\n  ${skipped.length} rows need their queue slot back first:\n` +
        '    npx tsx scripts/repair-queue-gaps.ts --apply --restores-only\n' +
        '  then re-run this script to pick them up.',
    )
  }
}

/* ── Write ───────────────────────────────────────────────────────────────── */

async function apply(candidates: Candidate[]): Promise<void> {
  const targets = candidates.filter((c) => c.klass === 'REVERT')
  if (targets.length === 0) {
    console.log('\nnothing to revert.')
    return
  }

  // Backup FIRST, to a file, with everything needed to put each row back.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `scripts/repair-phantom-completions-backup-${stamp}.json`
  writeFileSync(
    backupPath,
    JSON.stringify(
      targets.map((c) => ({
        id: c.row.id,
        completed: c.row.completed,
        completed_at: c.row.completed_at,
        scheduled_date: c.row.scheduled_date,
        date: c.row.date,
        scheduled_source: c.row.scheduled_source,
        queue_position: c.row.queue_position,
        curriculum_goal_id: c.row.curriculum_goal_id,
        goal_current_lesson_before: c.goal.current_lesson,
      })),
      null,
      2,
    ),
    'utf8',
  )
  console.log(`\nbackup written: ${backupPath} (${targets.length} rows)`)

  const byGoal = new Map<string, Candidate[]>()
  for (const c of targets) {
    const list = byGoal.get(c.goal.id) ?? []
    list.push(c)
    byGoal.set(c.goal.id, list)
  }

  for (const [goalId, list] of byGoal) {
    const goal = list[0].goal
    const name = goal.curriculum_name ?? goalId

    // 1. Revert. Un-completing lowers current_lesson through the recompute
    //    trigger, which is the correction, not a side effect.
    const ids = list.map((c) => c.row.id)
    const { error: revertErr } = await supabase
      .from('lessons')
      .update({
        completed: false,
        completed_at: null,
        // Invariant 10: this is a manual cleanup and says so.
        scheduled_source: 'cleanup_sql',
      })
      .in('id', ids)
    if (revertErr) {
      console.log(`  ${name}: revert FAILED (${JSON.stringify(revertErr)}) — goal left alone`)
      continue
    }

    // 2. Re-read the goal (current_lesson has moved) and its rows.
    const { data: goalAfter } = await supabase
      .from('curriculum_goals')
      .select(
        'id, total_lessons, current_lesson, lessons_per_day, lessons_per_day_overrides, school_days, start_date',
      )
      .eq('id', goalId)
      .maybeSingle()
    if (!goalAfter) {
      console.log(`  ${name}: reverted ${ids.length}, but the goal could not be re-read for dating`)
      continue
    }
    const { data: rowsAfter } = await supabase
      .from('lessons')
      .select('queue_position, scheduled_date, date, completed, queue_pinned, curriculum_goal_id')
      .eq('curriculum_goal_id', goalId)
      .eq('completed', false)

    // 3. Date the reverted rows from the projector. No day-walk here
    //    (Invariant 8), full tail (Invariant 11), pin-aware (Invariant 12).
    const cfg = toGoalConfig(goalAfter as unknown as GoalConfigRow)
    const projected = computeNextLessonsForGoal(
      cfg,
      new Date(),
      DAYS_AHEAD,
      await loadVacations(goal.user_id),
      0,
      pinsFromRows((rowsAfter ?? []) as PinnableRow[], goalId),
    )
    const dateBySlot = new Map(projected.map((p) => [p.lesson_number, p.date]))

    let dated = 0
    let undated = 0
    for (const c of list) {
      const slot = c.row.queue_position
      const date = slot != null ? dateBySlot.get(slot) : undefined
      if (!date) {
        undated++
        continue
      }
      const { error } = await supabase
        .from('lessons')
        .update({ scheduled_date: date, date, scheduled_source: 'cleanup_sql' })
        .eq('id', c.row.id)
      if (error) undated++
      else dated++
    }
    console.log(
      `  ${name}: reverted ${ids.length}, re-dated ${dated}` +
        (undated > 0
          ? `, ${undated} left for the next Today load to reconcile (no projected slot)`
          : ''),
    )
  }
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (APPLY && !MIGRATION_IS_LIVE) {
    console.error(
      'Refusing to write. Apply 20260907000000_no_server_side_lesson_completion.sql first,\n' +
        'confirm it with:\n' +
        "  select pg_get_functiondef('public.curriculum_goals_cleanup_orphans_trg'::regproc)\n" +
        "         not like '%completed = true%';\n" +
        'then re-run with --apply --migration-is-live.\n' +
        'Without it, the next pointer advance re-sweeps everything this script reverts.',
    )
    process.exit(1)
  }

  const candidates = await loadCandidates()
  report(candidates)

  if (!APPLY) {
    console.log('\nDRY RUN. Nothing was written. Add --apply --migration-is-live to write.\n')
    return
  }
  await apply(candidates)
  console.log('\ndone.\n')
}

main().catch((err) => {
  console.error('[repair-phantom-completions] failed:', err)
  process.exit(1)
})
