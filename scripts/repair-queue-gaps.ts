// Repair unoccupied queue slots inside a goal's live queue range.
//
// THE BUG (Sentry ROOTED-HOMESCHOOL-R and -13): the Today projector emits one
// entry per queue slot and the page hydrates it by (curriculum_goal_id,
// queue_position). When a slot in the live range has no row behind it, the
// projection has nothing to render and the family sees a blank subject. The
// Today page already reports that shape once per goal per session ("Today
// projection missing lesson rows" in app/dashboard/page.tsx); this script is the
// data-side counterpart that closes the gap the report describes.
//
// A HOLE is a queue position with no row, between current_lesson + 1 and
// max(queue_position) for the goal. Positions past max(queue_position) are not
// holes: the queue simply ends there, which is a different (and already
// handled) problem — see scripts/repair-empty-goals.ts.
//
// THREE CLASSES, and the difference matters:
//
//   RESTORE  A completed row in the same goal carries lesson_number = the hole
//            and queue_position = NULL. The lesson exists and the family did
//            it; only its slot was stripped. Fix: write queue_position =
//            lesson_number back onto that row. This is the shape a manual fix
//            run healed on 2026-08-24 (4 Easy Peasy goals, 7 rows).
//
//            Rows whose scheduled_source is 'extra_log', 'continuation' or
//            'recalibrate_estimate' are NEVER reassigned. Those are off-queue
//            by design (see resolveCustomLessonGoalLink and Invariant 10 in
//            docs/CURRICULUM-SCHEDULING.md); giving one a slot would make an
//            extra advance current_lesson.
//
//   CREATE   No row anywhere in the goal carries that lesson_number. The lesson
//            was never generated. Fix: insert one incomplete row in the wizard's
//            shape.
//
//   SKIP     Anything else, with the reason printed. The common one is a row
//            that holds the hole's lesson_number but sits in a DIFFERENT queue
//            slot, which happens after a plan_move or a catch-up reschedule.
//            "lesson_number N exists" and "slot N is taken" are different
//            questions and must not share a branch — conflating them is what
//            destroyed a lesson per drifted pin in commit 6905c4f (see
//            planPhase2LessonInserts). Neither fix is right there: restoring
//            would empty the slot the row currently holds, and creating would
//            collide with lessons_goal_lesson_number_unique.
//
// NO DAY WALK LIVES HERE (Invariant 8). Dates for created rows come from
// `computeNextLessonsForGoal`, the app's own projector, fed the same pin set
// every projecting surface reads (`pinsFromRows`) and projected across the full
// remaining tail (daysAhead = 3650, Invariant 11 — never a fixed window).
//
// TWO DEVIATIONS FROM THE BRIEF, both forced by the schema, both deliberate:
//
//   1. `lessons.date` is NOT NULL with no default, so a created row cannot be
//      left undated entirely. It gets the projector's date for its own slot —
//      the same value reconcileGoalScheduleCache would write anyway, so the
//      row is correct on the Plan calendar immediately instead of after the
//      next load. `scheduled_date` IS left NULL as briefed, which is what makes
//      the reconciler adopt the row (syncProjectedScheduledDates skips a row
//      whose cache already matches, and NULL never matches).
//   2. Titles use the em dash, matching `${name} — Lesson ${n}` as written by
//      the Schedule Builder (app/dashboard/plan/schedule/page.tsx). A created
//      row sits in a list beside wizard-created siblings; a different dash
//      would be the one visibly odd line.
//
// RESTORE HAS A TRIGGER CASCADE, and the dry run prints it. Writing
// queue_position onto a completed row fires trg_lessons_recompute_current_lesson,
// which raises the goal's current_lesson to max(queue_position) over completed
// rows. That raise fires trg_curriculum_goals_cleanup_orphans, which completes
// every incomplete row at or below the new current_lesson (with empty notes).
// That is how one restore can heal a whole goal at once.
//
// The cleanup used to NULL those rows' queue_position too, which opened a fresh
// hole for every row it swept and dragged current_lesson back below the restore
// — the loop this whole class of damage comes from. Migration
// 20260824000000_orphan_cleanup_preserve_queue_position closed it: a swept row
// at or below the new pointer now keeps its slot. Restores are only safe to
// apply on a database carrying that migration. Confirm it is live before
// --apply:
//
//   select pg_get_functiondef('public.curriculum_goals_cleanup_orphans_trg'::regproc)
//          like '%queue_position <= NEW.current_lesson%';
//
// The apply phase measures the cascade against the database rather than
// trusting this note — see CASCADE MEASUREMENT below.
//
// Per docs/CURRICULUM-SCHEDULING.md Anti-pattern H this is NOT a migration: a
// migration would run against every environment at deploy time. It is a one-off
// script, dry run by default, that a human runs and reads first.
//
// Run:
//   npx tsx scripts/repair-queue-gaps.ts                          (DRY RUN)
//   npx tsx scripts/repair-queue-gaps.ts --apply                  (updates + inserts)
//   npx tsx scripts/repair-queue-gaps.ts --apply --restores-only  (updates only)
//
// --apply never deletes. It writes queue_position onto existing rows and
// inserts new ones, nothing else.
//
// --restores-only narrows --apply to the RESTORE class: it writes
// queue_position back onto rows that already exist, and issues no INSERT at
// all. The two classes carry very different risk — a restore hands a slot back
// to a lesson the family already did, while a create writes a lesson row that
// has never existed — so they are separately approvable. The plan printed is
// identical either way; only the write phase narrows.
//
// CASCADE MEASUREMENT. A restore fires two triggers (see the migration
// 20260824000000 header), so --apply snapshots each goal immediately before its
// restores and re-reads it immediately after, then prints what actually
// happened: where current_lesson landed against the prediction, which rows the
// orphan cleanup auto-completed as collateral, whether any of them lost a queue
// slot, and whether the goal ended with holes. Predicting a cascade in a dry run
// and never checking it against the database is how the original bug survived.

import { readFileSync } from 'node:fs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

import {
  computeNextLessonsForGoal,
  pinsFromRows,
  schoolDayLabelsToIso,
  toGoalConfig,
  type GoalConfigRow,
  type PinnableRow,
  type VacationBlock,
} from '../app/lib/scheduler.ts'
import { isoDowFromYmd } from '../app/lib/timezone.ts'

// Dry run is the DEFAULT. Writing requires saying so out loud.
const APPLY = process.argv.includes('--apply')
// Narrows --apply to the RESTORE class. No INSERT is issued at all.
const RESTORES_ONLY = process.argv.includes('--restores-only')

// Known test account. Its goals are deliberately in odd states and must never
// be repaired alongside real families'. Same exclusion repair-empty-goals uses.
const EXCLUDED_EMAIL = 'garfieldbrittany+test1@gmail.com'

// Sources that mean "this row is off the queue on purpose". A row carrying one
// of these must never be handed a queue slot:
//   extra_log            — "log an extra lesson"; a completion that must NOT
//                          advance current_lesson.
//   continuation         — goal-linked, slotless by design; Today hydrates it
//                          through its own dedicated query.
//   recalibrate_estimate — synthesized completion dates from "I'm actually on
//                          lesson X".
const OFF_QUEUE_SOURCES = new Set(['extra_log', 'continuation', 'recalibrate_estimate'])

// The projector's safety bound, matching the Schedule Builder's create path and
// repair-empty-goals. Invariant 11: never a small fixed window.
const DAYS_AHEAD = 3650

// PostgREST returns at most 1000 rows per request and does not say it truncated.
// Every read below pages, ordered by a unique column. An unordered paginated
// scan may repeat one row and skip another, and a skipped lessons row here reads
// as an empty slot — which would make this script plan an insert on top of a row
// that already exists.
const PAGE = 1000

/**
 * Load .env.local into process.env when the two keys we need are absent, so
 * `npx tsx scripts/repair-queue-gaps.ts` works with no extra flags. A caller
 * who prefers `node --env-file=.env.local` still gets exactly what they set:
 * nothing here overwrites a variable that is already present.
 */
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
    '[repair-queue-gaps] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Put them in .env.local or pass --env-file.',
  )
  process.exit(1)
}

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

type GoalRow = GoalConfigRow & {
  user_id: string
  child_id: string | null
  curriculum_name: string | null
  subject_label: string | null
  start_at_lesson: number | null
}

type LessonRow = {
  id: string
  curriculum_goal_id: string
  lesson_number: number | null
  queue_position: number | null
  completed: boolean
  scheduled_source: string | null
  is_backfill: boolean | null
  queue_pinned: boolean | null
  scheduled_date: string | null
  date: string | null
  notes: string | null
}

type Restore = {
  hole: number
  rowId: string
  lessonNumber: number
  source: string | null
  completedRow: LessonRow
}

type Create = {
  hole: number
  lessonNumber: number
  date: string
}

type Skip = { hole: number; reason: string }

type GoalPlan = {
  goal: GoalRow
  maxq: number
  holes: number[]
  restores: Restore[]
  creates: Create[]
  skips: Skip[]
  /** Predicted current_lesson after the restores land, via the DB triggers. */
  cascadeNewCurrent: number | null
  /** Incomplete rows the orphan-cleanup trigger would sweep as collateral. */
  cascadeSwept: LessonRow[]
}

function label(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim()
  return v.length > 0 ? v : fallback
}

/** Local midnight, the same anchor the Schedule Builder passes as `todayMid`. */
function todayMidnight(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "5, 7-9, 14" — holes are almost always one contiguous run per goal. */
function formatRuns(nums: number[]): string {
  if (nums.length === 0) return '(none)'
  const sorted = nums.slice().sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = n
    prev = n
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`)
  return parts.join(', ')
}

/** id -> email for every auth user. Paginated. */
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

/** Every non-archived curriculum goal. Ordered by id so pages cannot skip one. */
async function loadActiveGoals(): Promise<GoalRow[]> {
  const out: GoalRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('curriculum_goals')
      .select(
        'id, user_id, child_id, curriculum_name, subject_label, total_lessons, current_lesson, lessons_per_day, lessons_per_day_overrides, school_days, start_date, start_at_lesson',
      )
      .eq('archived', false)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as GoalRow[]
    if (rows.length === 0) break
    out.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return out
}

/**
 * Every lessons row attached to a goal, grouped by goal id.
 *
 * The whole table is read rather than a per-goal query because the classifier
 * needs, for one hole, three different questions answered across the goal's
 * ENTIRE row set: is the slot occupied, does any row hold that lesson_number,
 * and where does that row actually sit. A partial read answers all three wrong
 * in the dangerous direction — it invents holes and it hides collisions.
 */
async function loadLessonsByGoal(): Promise<Map<string, LessonRow[]>> {
  const out = new Map<string, LessonRow[]>()
  let from = 0
  let scanned = 0
  for (;;) {
    const { data, error } = await supabase
      .from('lessons')
      .select(
        'id, curriculum_goal_id, lesson_number, queue_position, completed, scheduled_source, is_backfill, queue_pinned, scheduled_date, date, notes',
      )
      .not('curriculum_goal_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as LessonRow[]
    if (rows.length === 0) break
    for (const r of rows) {
      const list = out.get(r.curriculum_goal_id)
      if (list) list.push(r)
      else out.set(r.curriculum_goal_id, [r])
    }
    scanned += rows.length
    if (scanned % 25_000 === 0) console.log(`[repair-queue-gaps] ...scanned ${scanned} lesson rows`)
    if (rows.length < PAGE) break
    from += PAGE
  }
  console.log(`[repair-queue-gaps] scanned ${scanned} goal-attached lesson rows`)
  return out
}

/** Vacation blocks per user, loaded once and cached across that user's goals. */
const vacationCache = new Map<string, VacationBlock[]>()
async function loadVacations(userId: string): Promise<VacationBlock[]> {
  const cached = vacationCache.get(userId)
  if (cached) return cached
  const { data, error } = await supabase
    .from('vacation_blocks')
    .select('start_date, end_date')
    .eq('user_id', userId)
  if (error) throw error
  const blocks = (data ?? []) as VacationBlock[]
  vacationCache.set(userId, blocks)
  return blocks
}

/**
 * What current_lesson becomes once the restores land, mirroring
 * `recompute_curriculum_current_lesson`: max(queue_position) over COMPLETED
 * rows, floored at start_at_lesson - 1 and capped at total_lessons.
 */
function predictCurrentLesson(goal: GoalRow, rows: LessonRow[], restores: Restore[]): number {
  const restored = new Set(restores.map((r) => r.rowId))
  let maxCompleted = 0
  for (const r of rows) {
    if (!r.completed) continue
    const slot = restored.has(r.id) ? r.lesson_number : r.queue_position
    if (slot != null && slot > maxCompleted) maxCompleted = slot
  }
  const floor = Math.max(0, (goal.start_at_lesson ?? 1) - 1)
  let value = Math.max(floor, maxCompleted)
  const total = goal.total_lessons ?? 0
  if (total > 0) value = Math.min(value, total)
  return value
}

/**
 * Rows `curriculum_goals_cleanup_orphans_trg` would auto-complete when
 * current_lesson rises to `newCurrent`: incomplete, numbered at or below it,
 * and carrying no notes.
 *
 * Since migration 20260824000000 a swept row at or below the new pointer KEEPS
 * its queue_position, so these no longer open holes — they simply become
 * completed rows still sitting in their own slots. Before that migration each
 * one lost its slot and stranded it. The apply phase reports the slots actually
 * lost, which is the number that must stay at zero.
 */
function predictCascade(rows: LessonRow[], newCurrent: number): LessonRow[] {
  return rows.filter(
    (r) =>
      !r.completed &&
      r.lesson_number != null &&
      r.lesson_number <= newCurrent &&
      (r.notes == null || r.notes === ''),
  )
}

/** Invariant 4: nothing may land on a day the goal does not school on. */
function schoolDayViolations(goal: GoalRow, creates: Create[]): Create[] {
  const allowed = new Set(schoolDayLabelsToIso(goal.school_days))
  return creates.filter((c) => !allowed.has(isoDowFromYmd(c.date)))
}

async function planGoal(
  goal: GoalRow,
  rows: LessonRow[],
  todayMid: Date,
): Promise<GoalPlan | null> {
  const slots = new Map<number, LessonRow>()
  const byLessonNumber = new Map<number, LessonRow[]>()
  for (const r of rows) {
    if (r.queue_position != null) slots.set(r.queue_position, r)
    if (r.lesson_number != null) {
      const list = byLessonNumber.get(r.lesson_number)
      if (list) list.push(r)
      else byLessonNumber.set(r.lesson_number, [r])
    }
  }
  if (slots.size === 0) return null // no queue at all — repair-empty-goals' job

  let maxq = 0
  for (const s of slots.keys()) if (s > maxq) maxq = s
  const current = goal.current_lesson ?? 0
  if (maxq <= current) return null

  const holes: number[] = []
  for (let n = current + 1; n <= maxq; n++) if (!slots.has(n)) holes.push(n)
  if (holes.length === 0) return null

  const restores: Restore[] = []
  const creates: Create[] = []
  const skips: Skip[] = []

  // Projected dates, computed once per goal from the app's own projector and
  // the same pin set every projecting surface derives (Invariant 8 / 12).
  const vacations = await loadVacations(goal.user_id)
  const pins = pinsFromRows(rows as PinnableRow[], goal.id)
  const projected = computeNextLessonsForGoal(
    toGoalConfig(goal),
    todayMid,
    DAYS_AHEAD,
    vacations,
    0,
    pins,
  )
  const dateBySlot = new Map(projected.map((p) => [p.lesson_number, p.date]))

  for (const hole of holes) {
    const holders = byLessonNumber.get(hole) ?? []

    // ── RESTORE ────────────────────────────────────────────────────────────
    // A completed, slotless row already carrying this lesson number. The slot
    // itself is free by the definition of a hole, so the write cannot collide
    // with lessons_goal_queue_position_uniq.
    const candidates = holders.filter(
      (r) => r.queue_position == null && r.completed && !OFF_QUEUE_SOURCES.has(r.scheduled_source ?? ''),
    )
    if (candidates.length === 1) {
      restores.push({
        hole,
        rowId: candidates[0].id,
        lessonNumber: hole,
        source: candidates[0].scheduled_source,
        completedRow: candidates[0],
      })
      continue
    }
    if (candidates.length > 1) {
      // lessons_goal_lesson_number_unique should make this impossible. If it
      // ever happens, a human picks.
      skips.push({
        hole,
        reason: `${candidates.length} completed slotless rows share lesson_number ${hole} (${candidates
          .map((r) => r.id)
          .join(', ')}); ambiguous, needs a human`,
      })
      continue
    }

    // ── CREATE ─────────────────────────────────────────────────────────────
    if (holders.length === 0) {
      const date = dateBySlot.get(hole)
      if (!date) {
        skips.push({
          hole,
          reason:
            `the projector emitted no date for slot ${hole} ` +
            `(current_lesson=${current}, total_lessons=${goal.total_lessons ?? 0}, ` +
            `projected ${projected.length} slots); nothing to date an insert with`,
        })
        continue
      }
      // lesson_number = the hole is collision-free by construction: this branch
      // is only reached when no row in the goal holds that number. Asserted
      // rather than assumed, because a collision here is a unique-index failure
      // on a batch insert, which takes every other row in the batch with it.
      if (byLessonNumber.has(hole)) {
        skips.push({ hole, reason: `internal: lesson_number ${hole} is taken after all` })
        continue
      }
      creates.push({ hole, lessonNumber: hole, date })
      continue
    }

    // ── SKIP, with the reason ──────────────────────────────────────────────
    const r = holders[0]
    if (r.queue_position != null) {
      skips.push({
        hole,
        reason:
          `row ${r.id} holds lesson_number ${hole} but sits in queue slot ${r.queue_position} ` +
          `(source=${r.scheduled_source ?? 'null'}, completed=${r.completed}); ` +
          `moving it would empty slot ${r.queue_position}, and an insert would collide with ` +
          `lessons_goal_lesson_number_unique`,
      })
      continue
    }
    if (OFF_QUEUE_SOURCES.has(r.scheduled_source ?? '')) {
      skips.push({
        hole,
        reason:
          `row ${r.id} has lesson_number ${hole} and no slot, but scheduled_source ` +
          `'${r.scheduled_source}' is off-queue by design; never give it a queue position`,
      })
      continue
    }
    skips.push({
      hole,
      reason:
        `row ${r.id} has lesson_number ${hole} and no slot but is not completed ` +
        `(source=${r.scheduled_source ?? 'null'}, is_backfill=${r.is_backfill ?? false}); ` +
        `restoring is only defined for completed rows`,
    })
  }

  // Invariant 4. A projector date on a non-school day means the config and the
  // projection disagree; drop this goal's inserts rather than write them.
  const violations = schoolDayViolations(goal, creates)
  if (violations.length > 0) {
    console.error(
      `  !! goal ${goal.id} projected ${violations.length} non-school-day date(s); ` +
        `dropping all ${creates.length} insert(s) for it`,
    )
    for (const v of violations.slice(0, 5)) {
      console.error(`     slot ${v.hole} on ${v.date} (iso dow ${isoDowFromYmd(v.date)})`)
    }
    for (const c of creates) {
      skips.push({ hole: c.hole, reason: `goal dropped: projector produced a non-school-day date` })
    }
    creates.length = 0
  }

  let cascadeNewCurrent: number | null = null
  let cascadeSwept: LessonRow[] = []
  if (restores.length > 0) {
    const predicted = predictCurrentLesson(goal, rows, restores)
    if (predicted > current) {
      cascadeNewCurrent = predicted
      cascadeSwept = predictCascade(rows, predicted)
    }
  }

  return {
    goal,
    maxq,
    holes,
    restores,
    creates,
    skips,
    cascadeNewCurrent,
    cascadeSwept,
  }
}

/** The constant columns every created row shares, printed once per goal. */
function createTemplate(goal: GoalRow, name: string): string {
  return (
    `{user_id: ${goal.user_id}, child_id: ${goal.child_id ?? 'null'}, ` +
    `curriculum_goal_id: ${goal.id}, completed: false, is_backfill: false, hours: 0, ` +
    `queue_pinned: false, scheduled_source: 'cleanup_sql', scheduled_date: null, ` +
    `title: "${name} — Lesson <n>"}`
  )
}

function buildInsertRows(goal: GoalRow, name: string, creates: Create[]) {
  return creates.map((c) => ({
    user_id: goal.user_id,
    child_id: goal.child_id,
    curriculum_goal_id: goal.id,
    lesson_number: c.lessonNumber,
    queue_position: c.hole,
    title: `${name} — Lesson ${c.lessonNumber}`,
    // `date` is NOT NULL, so it takes the projector's date for this slot — the
    // same value the reconciler would write. `scheduled_date` stays NULL so
    // reconcileGoalScheduleCache adopts the row on the family's next load.
    date: c.date,
    scheduled_date: null,
    // Invariant 10. `cleanup_sql` is the source for a hand-run repair.
    scheduled_source: 'cleanup_sql',
    completed: false,
    is_backfill: false,
    hours: 0,
  }))
}

async function main() {
  const mode = APPLY
    ? (RESTORES_ONLY ? 'APPLY --restores-only (updates only, no inserts)' : 'APPLY (writes)')
    : 'DRY RUN (no writes)'
  console.log(`[repair-queue-gaps] mode: ${mode}`)
  const todayMid = todayMidnight()
  console.log(`[repair-queue-gaps] projecting from ${ymd(todayMid)} (this machine's local day)\n`)

  const emails = await loadUserEmails()
  console.log(`[repair-queue-gaps] loaded ${emails.size} auth users`)

  const goals = await loadActiveGoals()
  console.log(`[repair-queue-gaps] loaded ${goals.length} non-archived goals`)

  const lessonsByGoal = await loadLessonsByGoal()

  const excluded = goals.filter((g) => emails.get(g.user_id) === EXCLUDED_EMAIL)
  const candidates = goals.filter((g) => emails.get(g.user_id) !== EXCLUDED_EMAIL)
  if (excluded.length > 0) {
    console.log(
      `[repair-queue-gaps] excluded ${excluded.length} goal(s) belonging to ${EXCLUDED_EMAIL}`,
    )
  }

  const plans: GoalPlan[] = []
  for (const goal of candidates) {
    const rows = lessonsByGoal.get(goal.id) ?? []
    const plan = await planGoal(goal, rows, todayMid)
    if (plan) plans.push(plan)
  }

  // Child names, for output only. Chunked: an `.in()` list is still one
  // response and still capped at 1000 rows.
  const childIds = Array.from(
    new Set(plans.map((p) => p.goal.child_id).filter((c): c is string => !!c)),
  )
  const childNames = new Map<string, string>()
  for (let i = 0; i < childIds.length; i += 500) {
    const { data, error } = await supabase
      .from('children')
      .select('id, name')
      .in('id', childIds.slice(i, i + 500))
    if (error) throw error
    for (const k of (data ?? []) as { id: string; name: string }[]) childNames.set(k.id, k.name)
  }

  plans.sort((a, b) => {
    const ea = emails.get(a.goal.user_id) ?? a.goal.user_id
    const eb = emails.get(b.goal.user_id) ?? b.goal.user_id
    return ea.localeCompare(eb) || a.goal.id.localeCompare(b.goal.id)
  })

  let totalHoles = 0
  let totalRestores = 0
  let totalCreates = 0
  let totalSkips = 0
  let totalCascadeSwept = 0
  let goalsWithCascade = 0
  const families = new Set<string>()

  console.log(`\n${'='.repeat(78)}\nPLAN\n${'='.repeat(78)}\n`)

  for (const plan of plans) {
    const g = plan.goal
    const email = emails.get(g.user_id) ?? g.user_id
    const name = label(g.curriculum_name, 'Curriculum')
    const child = label(childNames.get(g.child_id ?? ''), '(no child)')
    families.add(g.user_id)
    totalHoles += plan.holes.length
    totalRestores += plan.restores.length
    totalCreates += plan.creates.length
    totalSkips += plan.skips.length

    console.log(
      `GOAL ${g.id}  ${email}  child=${child}  name="${name}"  ` +
        `subject=${label(g.subject_label, '(no subject)')}`,
    )
    console.log(
      `  current_lesson=${g.current_lesson ?? 0}  total_lessons=${g.total_lessons ?? 0}  ` +
        `max(queue_position)=${plan.maxq}  holes=${plan.holes.length} [${formatRuns(plan.holes)}]`,
    )

    for (const r of plan.restores) {
      console.log(
        `  RESTORE  slot=${r.hole}  row=${r.rowId}  set queue_position=${r.lessonNumber}  ` +
          `(completed, source=${r.source ?? 'null'}, is_backfill=${r.completedRow.is_backfill ?? false})`,
      )
    }

    if (plan.creates.length > 0) {
      console.log(`  CREATE   ${plan.creates.length} row(s), each ${createTemplate(g, name)}`)
      for (const c of plan.creates) {
        console.log(`    insert  slot=${c.hole}  lesson_number=${c.lessonNumber}  date=${c.date}`)
      }
    }

    for (const s of plan.skips) {
      console.log(`  SKIP     slot=${s.hole}  reason: ${s.reason}`)
    }

    if (plan.cascadeNewCurrent != null) {
      goalsWithCascade++
      totalCascadeSwept += plan.cascadeSwept.length
      console.log(
        `  CASCADE  restoring raises current_lesson ${g.current_lesson ?? 0} -> ` +
          `${plan.cascadeNewCurrent} via trg_lessons_recompute_current_lesson`,
      )
      if (plan.cascadeSwept.length > 0) {
        const opened = plan.cascadeSwept.filter((r) => r.queue_position != null)
        console.log(
          `  CASCADE  trg_curriculum_goals_cleanup_orphans will then auto-complete ` +
            `${plan.cascadeSwept.length} incomplete row(s) at or below ${plan.cascadeNewCurrent} ` +
            `` +
            (opened.length > 0
              ? `; ${opened.length} of them hold slot(s) ${formatRuns(
                  opened.map((r) => r.queue_position as number),
                )} and keep them under migration 20260824000000 (they stranded before it)`
              : ''),
        )
        for (const r of plan.cascadeSwept.slice(0, 10)) {
          console.log(
            `    swept  row=${r.id}  lesson_number=${r.lesson_number}  ` +
              `queue_position=${r.queue_position ?? 'null'}  source=${r.scheduled_source ?? 'null'}`,
          )
        }
        if (plan.cascadeSwept.length > 10) {
          console.log(`    swept  ...and ${plan.cascadeSwept.length - 10} more`)
        }
      }
    }
    console.log('')
  }

  console.log(`${'='.repeat(78)}\nTOTALS\n${'='.repeat(78)}`)
  console.log(`goals scanned .................. ${candidates.length}`)
  console.log(`goals with at least one hole ... ${plans.length}`)
  console.log(`families affected .............. ${families.size}`)
  console.log(`holes found ................... ${totalHoles}`)
  console.log(`  RESTORE (rows to update) .... ${totalRestores}`)
  console.log(`  CREATE  (rows to insert) .... ${totalCreates}`)
  console.log(`  SKIP    (needs a human) ..... ${totalSkips}`)
  console.log(`goals whose current_lesson moves ${goalsWithCascade}`)
  console.log(`rows the orphan trigger sweeps . ${totalCascadeSwept}`)

  if (!APPLY) {
    console.log(
      `\n[repair-queue-gaps] DRY RUN — nothing was written. ` +
        `Re-run with --apply to update ${totalRestores} row(s) and insert ${totalCreates} row(s), ` +
        `or with --apply --restores-only to update the ${totalRestores} row(s) and insert nothing.`,
    )
    return
  }

  // ── APPLY ────────────────────────────────────────────────────────────────
  // Restores first, goal by goal, each one measured against a fresh snapshot.
  // Then (unless --restores-only) a re-read and the inserts. A restore moves
  // current_lesson and fires the orphan-cleanup trigger, which can occupy or
  // vacate the very slots an insert plan was built against. Writing a stale
  // plan on top of that is how a repair becomes a second bug.
  console.log(`\n${'='.repeat(78)}\nAPPLY\n${'='.repeat(78)}\n`)
  if (RESTORES_ONLY) {
    console.log(
      `--restores-only: ${totalCreates} planned insert(s) and ${totalSkips} skip(s) will NOT be touched.\n`,
    )
  }

  /** One goal's state, for before/after comparison around a restore. */
  type GoalSnapshot = {
    currentLesson: number
    rows: Map<string, { lesson_number: number | null; queue_position: number | null; completed: boolean }>
  }

  async function snapshotGoal(goalId: string): Promise<GoalSnapshot | null> {
    const [{ data: g, error: gErr }, { data: rs, error: rErr }] = await Promise.all([
      supabase.from('curriculum_goals').select('current_lesson').eq('id', goalId).maybeSingle(),
      supabase
        .from('lessons')
        .select('id, lesson_number, queue_position, completed')
        .eq('curriculum_goal_id', goalId),
    ])
    if (gErr || rErr || !g) return null
    const rows = new Map<string, { lesson_number: number | null; queue_position: number | null; completed: boolean }>()
    for (const r of (rs ?? []) as { id: string; lesson_number: number | null; queue_position: number | null; completed: boolean }[]) {
      rows.set(r.id, { lesson_number: r.lesson_number, queue_position: r.queue_position, completed: r.completed })
    }
    return { currentLesson: (g as { current_lesson: number | null }).current_lesson ?? 0, rows }
  }

  /** Slots the projector will emit that no row occupies. */
  function holesOf(snap: GoalSnapshot): number[] {
    const slots = new Set<number>()
    for (const r of snap.rows.values()) if (r.queue_position != null) slots.add(r.queue_position)
    let maxq = 0
    for (const sl of slots) if (sl > maxq) maxq = sl
    const out: number[] = []
    for (let n = snap.currentLesson + 1; n <= maxq; n++) if (!slots.has(n)) out.push(n)
    return out
  }

  let restored = 0
  let restoreFailed = 0
  let restoreStale = 0
  let cascadeGoals = 0
  let cascadeAutoCompleted = 0
  let cascadeSlotsLost = 0
  let cascadeMatchedPrediction = 0
  let goalsHealed = 0
  let goalsStillHoleyAfterRestore = 0
  const touchedGoalIds = new Set<string>()

  for (const plan of plans) {
    if (plan.restores.length === 0) continue
    const g = plan.goal
    const before = await snapshotGoal(g.id)
    if (!before) {
      console.error(`RESTORE-SKIP  goal=${g.id}  snapshot read failed; leaving it alone`)
      restoreFailed += plan.restores.length
      continue
    }

    // Re-check each restore against the snapshot taken moments ago, not the
    // scan from the top of the run. A slot filled or a row completed in the
    // meantime makes the planned write wrong, not merely redundant.
    const slotsHeld = new Set<number>()
    for (const r of before.rows.values()) if (r.queue_position != null) slotsHeld.add(r.queue_position)

    let goalRestored = 0
    for (const r of plan.restores) {
      const row = before.rows.get(r.rowId)
      if (!row) {
        console.log(`  stale slot=${r.hole} goal=${g.id}: row ${r.rowId} is gone`)
        restoreStale++
        continue
      }
      if (row.queue_position != null) {
        console.log(`  stale slot=${r.hole} goal=${g.id}: row already holds slot ${row.queue_position}`)
        restoreStale++
        continue
      }
      if (!row.completed) {
        console.log(`  stale slot=${r.hole} goal=${g.id}: row is no longer completed`)
        restoreStale++
        continue
      }
      if (slotsHeld.has(r.hole)) {
        console.log(`  stale slot=${r.hole} goal=${g.id}: slot is occupied now`)
        restoreStale++
        continue
      }
      const { error } = await supabase
        .from('lessons')
        .update({ queue_position: r.lessonNumber })
        .eq('id', r.rowId)
        // Belt and suspenders against a concurrent write claiming the row.
        .is('queue_position', null)
      if (error) {
        restoreFailed++
        console.error(`RESTORE-FAIL  goal=${g.id}  row=${r.rowId}  ${error.message}`)
        continue
      }
      restored++
      goalRestored++
      slotsHeld.add(r.hole)
      touchedGoalIds.add(g.id)
      console.log(`RESTORE-OK  goal=${g.id}  row=${r.rowId}  queue_position=${r.lessonNumber}`)
    }

    if (goalRestored === 0) continue

    // ── What the triggers actually did ────────────────────────────────────
    const after = await snapshotGoal(g.id)
    if (!after) {
      console.error(`  CASCADE  goal=${g.id}  post-read failed; cannot report the outcome`)
      continue
    }
    cascadeGoals++

    const restoredIds = new Set(plan.restores.map((r) => r.rowId))
    const autoCompleted: string[] = []
    const slotsLost: string[] = []
    for (const [id, aft] of after.rows) {
      const bef = before.rows.get(id)
      if (!bef) continue
      if (!bef.completed && aft.completed && !restoredIds.has(id)) autoCompleted.push(id)
      if (bef.queue_position != null && aft.queue_position == null && !restoredIds.has(id)) slotsLost.push(id)
    }
    cascadeAutoCompleted += autoCompleted.length
    cascadeSlotsLost += slotsLost.length

    const predicted = plan.cascadeNewCurrent
    const matched = predicted == null ? after.currentLesson === before.currentLesson : after.currentLesson === predicted
    if (matched) cascadeMatchedPrediction++

    console.log(
      `  CASCADE  goal=${g.id}  current_lesson ${before.currentLesson} -> ${after.currentLesson}` +
        `  (predicted ${predicted ?? before.currentLesson})` +
        `  ${matched ? 'as predicted' : 'DIVERGED'}`,
    )
    if (autoCompleted.length > 0) {
      console.log(
        `  CASCADE  goal=${g.id}  orphan cleanup auto-completed ${autoCompleted.length} row(s): ` +
          autoCompleted.slice(0, 8).join(', ') +
          (autoCompleted.length > 8 ? `, +${autoCompleted.length - 8} more` : ''),
      )
    }
    // Under the pre-20260824 trigger this was the damaging half: a swept row
    // lost its slot and opened a fresh hole. With the fix live it must be zero.
    console.log(
      `  CASCADE  goal=${g.id}  slots lost to the cleanup: ${slotsLost.length}` +
        (slotsLost.length > 0 ? `  !! ${slotsLost.slice(0, 8).join(', ')}` : '  (trigger fix holding)'),
    )
    const holesBefore = holesOf(before)
    const holesAfter = holesOf(after)
    if (holesAfter.length === 0) goalsHealed++
    else goalsStillHoleyAfterRestore++
    console.log(
      `  CASCADE  goal=${g.id}  holes ${holesBefore.length} [${formatRuns(holesBefore)}]` +
        ` -> ${holesAfter.length} [${formatRuns(holesAfter)}]`,
    )
  }

  console.log(`\n[repair-queue-gaps] restores: ${restored} ok, ${restoreFailed} failed, ${restoreStale} stale\n`)

  let inserted = 0
  let insertFailed = 0
  let dropped = 0
  let passCount = 0
  let failCount = 0

  if (RESTORES_ONLY) {
    console.log(`[repair-queue-gaps] --restores-only: skipped ${totalCreates} insert(s) across ` +
      `${plans.filter((p) => p.creates.length > 0).length} goal(s). Nothing was created.\n`)
  } else {
  for (const plan of plans) {
    if (plan.creates.length === 0) continue
    const g = plan.goal
    const name = label(g.curriculum_name, 'Curriculum')

    // Re-read this goal and its rows. Cheap per goal, and the only way to know
    // the plan is still true after the restores and their trigger cascade.
    const [{ data: freshGoal, error: goalErr }, { data: freshRows, error: rowsErr }] =
      await Promise.all([
        supabase
          .from('curriculum_goals')
          .select('id, current_lesson, archived')
          .eq('id', g.id)
          .maybeSingle(),
        supabase
          .from('lessons')
          .select('id, lesson_number, queue_position')
          .eq('curriculum_goal_id', g.id),
      ])
    if (goalErr || rowsErr || !freshGoal) {
      console.error(`INSERT-SKIP  goal=${g.id}  re-read failed; leaving its ${plan.creates.length} row(s) alone`)
      dropped += plan.creates.length
      failCount++
      continue
    }
    if ((freshGoal as { archived: boolean }).archived) {
      console.log(`INSERT-SKIP  goal=${g.id}  archived since the plan was built`)
      dropped += plan.creates.length
      continue
    }

    const freshCurrent = (freshGoal as { current_lesson: number | null }).current_lesson ?? 0
    const freshSlots = new Set<number>()
    const freshNumbers = new Set<number>()
    for (const r of (freshRows ?? []) as { lesson_number: number | null; queue_position: number | null }[]) {
      if (r.queue_position != null) freshSlots.add(r.queue_position)
      if (r.lesson_number != null) freshNumbers.add(r.lesson_number)
    }

    const stillValid = plan.creates.filter((c) => {
      if (c.hole <= freshCurrent) {
        console.log(`  drop slot=${c.hole} on goal=${g.id}: now at or below current_lesson ${freshCurrent}`)
        return false
      }
      if (freshSlots.has(c.hole)) {
        console.log(`  drop slot=${c.hole} on goal=${g.id}: slot is occupied now`)
        return false
      }
      if (freshNumbers.has(c.lessonNumber)) {
        console.log(`  drop slot=${c.hole} on goal=${g.id}: lesson_number ${c.lessonNumber} is taken now`)
        return false
      }
      return true
    })
    dropped += plan.creates.length - stillValid.length
    if (stillValid.length === 0) continue

    const rowsToInsert = buildInsertRows(g, name, stillValid)
    let ok = true
    for (let i = 0; i < rowsToInsert.length; i += 100) {
      const batch = rowsToInsert.slice(i, i + 100)
      const { error } = await supabase.from('lessons').insert(batch)
      if (error) {
        ok = false
        insertFailed += batch.length
        console.error(`INSERT-FAIL  goal=${g.id}  batch ${i}-${i + batch.length}: ${error.message}`)
        break
      }
      inserted += batch.length
    }
    touchedGoalIds.add(g.id)
    if (ok) passCount++
    else failCount++
    console.log(
      `INSERT-${ok ? 'OK' : 'FAIL'}  goal=${g.id}  rows=${stillValid.length}  ` +
        `slots=[${formatRuns(stillValid.map((c) => c.hole))}]`,
    )
  }
  }

  // Verify from the database rather than trusting the loops above.
  console.log(`\n${'='.repeat(78)}\nVERIFY\n${'='.repeat(78)}\n`)
  let clean = 0
  let stillHoley = 0
  for (const goalId of touchedGoalIds) {
    const [{ data: gAfter }, { data: rAfter }] = await Promise.all([
      supabase.from('curriculum_goals').select('current_lesson').eq('id', goalId).maybeSingle(),
      supabase.from('lessons').select('queue_position').eq('curriculum_goal_id', goalId),
    ])
    const current = (gAfter as { current_lesson: number | null } | null)?.current_lesson ?? 0
    const slots = new Set<number>()
    for (const r of (rAfter ?? []) as { queue_position: number | null }[]) {
      if (r.queue_position != null) slots.add(r.queue_position)
    }
    let maxq = 0
    for (const sl of slots) if (sl > maxq) maxq = sl
    const remaining: number[] = []
    for (let n = current + 1; n <= maxq; n++) if (!slots.has(n)) remaining.push(n)
    if (remaining.length === 0) {
      clean++
      console.log(`CLEAN  goal=${goalId}  current_lesson=${current}  max slot=${maxq}`)
    } else {
      stillHoley++
      console.log(
        `HOLES  goal=${goalId}  current_lesson=${current}  max slot=${maxq}  ` +
          `remaining=${remaining.length} [${formatRuns(remaining)}]`,
      )
    }
  }

  console.log(
    `\n[repair-queue-gaps] cascade: ${cascadeGoals} goal(s) measured, ` +
      `${cascadeMatchedPrediction} matched the predicted current_lesson, ` +
      `${cascadeAutoCompleted} row(s) auto-completed by the orphan cleanup, ` +
      `${cascadeSlotsLost} slot(s) lost to it, ` +
      `${goalsHealed} goal(s) left hole-free, ${goalsStillHoleyAfterRestore} not.`,
  )

  console.log(
    `\n[repair-queue-gaps] done. restored=${restored} restoreFailed=${restoreFailed} ` +
      `restoreStale=${restoreStale} inserted=${inserted} insertFailed=${insertFailed} ` +
      `droppedAsStale=${dropped} goalsInsertPass=${passCount} goalsInsertFail=${failCount} ` +
      `goalsClean=${clean} goalsStillHoley=${stillHoley}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
