// Unit tests for app/lib/recalibrate.ts — the "I'm actually on lesson X"
// recalibration utility. The forward projector + queue-resync helper used
// inside phase 5 are exercised by scheduler.test.ts; here we pin the gap
// distribution math: how `gapLessons.length` and the available calendar
// window map onto per-row scheduled_date / completed_at writes.
//
// Mock pattern mirrors scheduler.test.ts (makeFakeSupabase / makeResyncSupabase):
// chainable record-of-callbacks with a thenable terminal so `await chain`
// works for queries that don't end in .maybeSingle / .limit. Every UPDATE
// is captured into a writes array so tests can assert payload shape +
// targeted ids without spinning up a real Supabase.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  recalibrateCurriculumGoal,
  estimateKeepsSlot,
  planRecalibrateGap,
  formatLessonList,
  formatAddedTime,
  ESTIMATE_REPORT_MINUTES,
  RecalibrateListChangedError,
  sameLessonIds,
} from './recalibrate.ts'
import { recomputeCurrentLesson, computeNextLessonsForGoal, queueHoldsFromRows } from './scheduler.ts'
import { makeMemorySupabase } from './test-helpers/memory-supabase.ts'
import { bookOrderView } from './move-keep-slot.ts'

// ── Date helpers ─────────────────────────────────────────────────────────
// The utility reads `new Date()` directly, so tests anchor against the
// real "today" and walk backward in local-day increments. The function's
// own toDateStr also uses local midnight, so calendars stay aligned even
// if the test runs across midnight UTC.

function midnight(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  return m
}

function todayMid(): Date {
  return midnight(new Date())
}

function daysAgo(n: number): Date {
  const d = todayMid()
  d.setDate(d.getDate() - n)
  return d
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Mock supabase ────────────────────────────────────────────────────────
// recalibrateCurriculumGoal's call surface, in order:
//   1. from('curriculum_goals').select(...).eq(...).maybeSingle()  →  goal
//   2. Promise.all of:
//        from('lessons').select('id, lesson_number')...order(...)  →  gap
//        from('lessons').select('completed_at')...maybeSingle()    →  anchor
//   3. from('curriculum_goals').update({...}).eq('id', goalId)
//   4. Promise.all of:
//        from('lessons').update({...}).in('id', ids)  ×N (gap distribution)
//   5. from('lessons').select('id, scheduled_date, completed, is_backfill, lesson_number').eq().eq()
//      → forward-incomplete (default [] in these tests so the resync no-ops)
//
// SELECT chains dispatch on the projection string so the same lessons
// chain serves all three reads. UPDATEs branch on whether the terminal is
// .eq() (curriculum_goals UPDATE) or .in() (lessons UPDATE).

type GoalRow = {
  total_lessons: number | null
  lessons_per_day: number | null
  school_days: string[] | null
  start_date: string | null
  lessons_per_day_overrides: Record<string, number> | null
  created_at: string | null
}

type GapLessonRow = { id: string; lesson_number: number; queue_position?: number | null }

type ForwardIncompleteRow = {
  id: string
  scheduled_date: string | null
  completed: boolean
  is_backfill: boolean
  lesson_number: number | null
}

type CapturedWrite = {
  table: string
  payload: Record<string, unknown>
  ids?: string[]
  goalId?: string
}

function makeRecalibrateSupabase(opts: {
  goal: GoalRow | null
  gapLessons: GapLessonRow[]
  anchorRow: { completed_at: string | null } | null
  /** Forward-incomplete rows fetched by phase 5. Default [] so the queue
   *  resync writes nothing — these tests target the distribution step, not
   *  the resync path (covered by scheduler.test.ts). */
  forwardIncompleteRows?: ForwardIncompleteRow[]
}) {
  const writes: CapturedWrite[] = []

  function lessonsTable() {
    let projection: string | null = null
    const chain: Record<string, unknown> = {
      select: (cols: string) => {
        projection = cols
        return chain
      },
      eq: () => chain,
      not: () => chain,
      lt: () => chain,
      gt: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (projection === 'completed_at') {
          return { data: opts.anchorRow, error: null }
        }
        throw new Error(`unexpected lessons.maybeSingle for projection: ${projection}`)
      },
      // Thenable so `await chain` works for queries that don't end in a
      // terminal helper (the gap select and the phase-5 forward select).
      then: (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => {
        let data: unknown
        if (projection === 'lesson_number, queue_position') {
          // Phase 0's book-order check: these fixtures are in order.
          data = opts.gapLessons.map((g) => ({ lesson_number: g.lesson_number, queue_position: g.queue_position ?? g.lesson_number }))
        } else if (projection === 'id') {
          // The pinned-lesson-X read: none pinned in these fixtures.
          data = []
        } else if (projection === 'id, lesson_number, queue_position, queue_pinned, skipped, scheduled_date') {
          // A gap row with no slot given holds the healthy one, lesson_number.
          data = opts.gapLessons.map((g) => ({ queue_position: g.lesson_number, ...g }))
        } else if (
          // Phase-5 forward select. queue_position + queue_pinned were added
          // when pins landed (July 2026): recalibration reads the pin state so
          // it projects around manually-placed rows instead of re-dating them.
          // skipped joined them in September 2026 (Invariant 22).
          projection ===
            'id, scheduled_date, date, completed, is_backfill, lesson_number, queue_position, queue_pinned, skipped'
        ) {
          data = opts.forwardIncompleteRows ?? []
        } else {
          throw new Error(`unexpected lessons thenable for projection: ${projection}`)
        }
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
      },
      update: (payload: Record<string, unknown>) => ({
        // Awaitable directly, or with .select('id') for a confirmed write,
        // which reports every targeted row as changed.
        in: (_col: string, ids: string[]) => {
          writes.push({ table: 'lessons', payload, ids: [...ids] })
          const res = { error: null }
          return {
            select: async () => ({ data: ids.map((id) => ({ id })), error: null }),
            then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
              Promise.resolve(res).then(ok, bad),
          }
        },
      }),
    }
    return chain
  }

  function goalsTable() {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.goal, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_col: string, val: string) => {
          writes.push({ table: 'curriculum_goals', payload, goalId: val })
          return { error: null }
        },
      }),
    }
  }

  const supabase = {
    from(table: string) {
      if (table === 'lessons') return lessonsTable()
      if (table === 'curriculum_goals') return goalsTable()
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return { supabase, writes }
}

// Default goal: pacing fields aren't load-bearing for the distribution
// step. total_lessons sized so clamped newCurrentLesson never overflows.
function defaultGoal(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    total_lessons: 100,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: null,
    lessons_per_day_overrides: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// Pulls out the lesson UPDATEs the distribution step issued (the
// curriculum_goals UPDATE + any phase-5 queue_resync writes are filtered
// out so tests can assert on the gap step in isolation).
function distributionWrites(writes: CapturedWrite[]) {
  return writes.filter(
    (w) =>
      w.table === 'lessons' &&
      (w.payload as { scheduled_source?: string }).scheduled_source === 'recalibrate_estimate',
  )
}

// Lesson_numbers, in order, that a given write targets — derived from the
// id-encoded lesson_number we set in test inputs (id = `L${n}`).
function lessonNumbersIn(write: CapturedWrite, gap: GapLessonRow[]): number[] {
  const byId = new Map(gap.map((g) => [g.id, g.lesson_number]))
  return (write.ids ?? []).map((id) => byId.get(id)!).filter((n): n is number => n != null)
}


/**
 * What the form shows before a Yes: planRecalibrateGap over a fresh read of the
 * goal's unfinished lessons. A Yes must carry exactly this list.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function confirmedFor(client: any, goalId: string, lesson: number, opts: { bookOrder?: boolean } = {}): Promise<string[]> {
  // The form's read (RecalibrateForm): every numbered row plus the goal, seen
  // in book order when the queue has drifted, because the write restores the
  // order before it reads. `bookOrder: false` is a database without
  // restore_queue_book_order, where the write reads the drifted queue as is.
  const { data: goal } = await client.from('curriculum_goals').select('current_lesson').eq('id', goalId).maybeSingle()
  const { data: all } = await client
    .from('lessons')
    .select('id, lesson_number, queue_position, queue_pinned, skipped, completed')
    .eq('curriculum_goal_id', goalId)
    .not('lesson_number', 'is', null)
  const view = bookOrderView(all ?? [], goal ?? { start_at_lesson: 1, total_lessons: null })
  const useView = view.drifted && opts.bookOrder !== false
  const countDone = useView ? view.currentLesson : goal?.current_lesson ?? 0
  const rows = (useView ? view.rows : all ?? []).filter((r: { completed?: boolean; lesson_number: number | null }) => !r.completed && (r.lesson_number ?? 0) > countDone)
  return planRecalibrateGap(rows, countDone, lesson).toComplete.map((r: { id: string }) => r.id)
}

// ── Tests ────────────────────────────────────────────────────────────────

test('recalibrateCurriculumGoal: even distribution — 3 lessons across 10 days spreads with gaps', async () => {
  // 10 available days = anchor + 1..yesterday inclusive when anchor is 11
  // days ago (anchor itself excluded; today excluded). The formula
  // floor(i * (D-1) / (N-1)) with N=3, D=10 places lessons at indices
  // 0, 4, 9 — first, middle-ish, last day of the window.
  const anchor = daysAgo(11)
  const gap: GapLessonRow[] = [
    { id: 'L1', lesson_number: 1 },
    { id: 'L2', lesson_number: 2 },
    { id: 'L3', lesson_number: 3 },
  ]
  const { supabase, writes } = makeRecalibrateSupabase({
    goal: defaultGoal(),
    gapLessons: gap,
    anchorRow: { completed_at: anchor.toISOString() },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await recalibrateCurriculumGoal({
    supabase: supabase as any,
    goalId: 'g1',
    newCurrentLesson: 4,
    vacationBlocks: [],
    recordHistory: true,
    confirmedLessonIds: gap.map((g) => g.id),
  })
  assert.equal(result.gapCount, 3)

  const dist = distributionWrites(writes)
  assert.equal(dist.length, 3, 'three lessons spread → three distinct distribution UPDATEs')

  // Each lesson lands on a different date — no two share a write.
  const dates = dist.map((w) => (w.payload as { scheduled_date: string }).scheduled_date)
  assert.equal(new Set(dates).size, 3, 'every gap lesson gets a distinct date')

  // Earliest lesson_number on the earliest date, latest on yesterday.
  const sortedByDate = dist
    .slice()
    .sort((a, b) =>
      (a.payload as { scheduled_date: string }).scheduled_date.localeCompare(
        (b.payload as { scheduled_date: string }).scheduled_date,
      ),
    )
  assert.deepEqual(lessonNumbersIn(sortedByDate[0], gap), [1])
  assert.deepEqual(lessonNumbersIn(sortedByDate[1], gap), [2])
  assert.deepEqual(lessonNumbersIn(sortedByDate[2], gap), [3])
  assert.equal(sortedByDate[0].payload.scheduled_date, ymd(daysAgo(10)), 'first lesson on anchor+1')
  assert.equal(sortedByDate[1].payload.scheduled_date, ymd(daysAgo(6)), 'middle lesson on day index 4 of 10')
  assert.equal(sortedByDate[2].payload.scheduled_date, ymd(daysAgo(1)), 'last lesson on yesterday')
})

test('recalibrateCurriculumGoal: even distribution — 10 lessons across 3 days shares dates in lesson-number order', async () => {
  // 3 days available = anchor 4 days ago. floor(i * 2 / 9) places lessons
  // 0..4 on dates[0], 5..8 on dates[1], 9 on dates[2]. Multiple lessons
  // collapse onto the same date when N > D; the spec only guarantees
  // monotonic mapping (earlier lesson → earlier-or-equal date).
  const anchor = daysAgo(4)
  const gap: GapLessonRow[] = Array.from({ length: 10 }, (_, i) => ({
    id: `L${i + 1}`,
    lesson_number: i + 1,
  }))
  const { supabase, writes } = makeRecalibrateSupabase({
    goal: defaultGoal(),
    gapLessons: gap,
    anchorRow: { completed_at: anchor.toISOString() },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({
    supabase: supabase as any,
    goalId: 'g1',
    newCurrentLesson: 11,
    vacationBlocks: [],
    recordHistory: true,
    confirmedLessonIds: gap.map((g) => g.id),
  })

  const dist = distributionWrites(writes)
  // Every gap lesson appears in exactly one write.
  const allWrittenIds = dist.flatMap((w) => w.ids ?? [])
  assert.equal(allWrittenIds.length, 10, 'every gap lesson is written exactly once')
  assert.deepEqual(
    allWrittenIds.slice().sort(),
    gap.map((g) => g.id).sort(),
    'every gap lesson id is covered',
  )

  // Dates fall strictly inside [anchor+1, yesterday].
  const earliest = ymd(daysAgo(3))
  const latest = ymd(daysAgo(1))
  for (const w of dist) {
    const d = (w.payload as { scheduled_date: string }).scheduled_date
    assert.ok(d >= earliest, `${d} on or after anchor+1`)
    assert.ok(d <= latest, `${d} on or before yesterday`)
  }

  // Monotonic mapping: every lesson on date D1 has lesson_number <= every
  // lesson on a later date D2.
  const byDate = dist
    .slice()
    .sort((a, b) =>
      (a.payload as { scheduled_date: string }).scheduled_date.localeCompare(
        (b.payload as { scheduled_date: string }).scheduled_date,
      ),
    )
  let prevMax = 0
  for (const w of byDate) {
    const nums = lessonNumbersIn(w, gap)
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    assert.ok(min > prevMax, `lesson ${min} sits after every lesson on the prior date (<= ${prevMax})`)
    prevMax = max
  }
})

test('recalibrateCurriculumGoal: even distribution — 5 lessons across 5 days lands one per day', async () => {
  // N=D: floor(i * 4 / 4) = i. Every lesson gets its own date.
  const anchor = daysAgo(6)
  const gap: GapLessonRow[] = Array.from({ length: 5 }, (_, i) => ({
    id: `L${i + 1}`,
    lesson_number: i + 1,
  }))
  const { supabase, writes } = makeRecalibrateSupabase({
    goal: defaultGoal(),
    gapLessons: gap,
    anchorRow: { completed_at: anchor.toISOString() },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({
    supabase: supabase as any,
    goalId: 'g1',
    newCurrentLesson: 6,
    vacationBlocks: [],
    recordHistory: true,
    confirmedLessonIds: gap.map((g) => g.id),
  })

  const dist = distributionWrites(writes)
  assert.equal(dist.length, 5, 'one UPDATE per lesson when N === D')
  for (const w of dist) {
    assert.equal(w.ids?.length, 1, 'every distribution write targets a single lesson')
  }
  const dates = dist.map((w) => (w.payload as { scheduled_date: string }).scheduled_date)
  assert.equal(new Set(dates).size, 5, 'no two lessons share a date')
  // Sanity-check the endpoints: lesson 1 on anchor+1, lesson 5 on yesterday.
  const sortedByDate = dist
    .slice()
    .sort((a, b) =>
      (a.payload as { scheduled_date: string }).scheduled_date.localeCompare(
        (b.payload as { scheduled_date: string }).scheduled_date,
      ),
    )
  assert.deepEqual(lessonNumbersIn(sortedByDate[0], gap), [1])
  assert.deepEqual(lessonNumbersIn(sortedByDate[4], gap), [5])
  assert.equal(sortedByDate[0].payload.scheduled_date, ymd(daysAgo(5)))
  assert.equal(sortedByDate[4].payload.scheduled_date, ymd(daysAgo(1)))
})

test('recalibrateCurriculumGoal: anchor on yesterday collapses every gap lesson to yesterday', async () => {
  // daysAvailable = floor((yesterday - today) / day) + 1 = -1 + 1 = 0
  // → fallback: dates = [yesterday]. All N lessons land on that one date
  // rather than being scheduled into today or the future.
  const anchor = daysAgo(1)
  const gap: GapLessonRow[] = [
    { id: 'L1', lesson_number: 1 },
    { id: 'L2', lesson_number: 2 },
    { id: 'L3', lesson_number: 3 },
    { id: 'L4', lesson_number: 4 },
  ]
  const { supabase, writes } = makeRecalibrateSupabase({
    goal: defaultGoal(),
    gapLessons: gap,
    anchorRow: { completed_at: anchor.toISOString() },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({
    supabase: supabase as any,
    goalId: 'g1',
    newCurrentLesson: 5,
    vacationBlocks: [],
    recordHistory: true,
    confirmedLessonIds: gap.map((g) => g.id),
  })

  const dist = distributionWrites(writes)
  assert.equal(dist.length, 1, 'a single-day window batches all gap lessons into one UPDATE')
  assert.equal(dist[0].payload.scheduled_date, ymd(daysAgo(1)))
  assert.deepEqual(
    (dist[0].ids ?? []).slice().sort(),
    ['L1', 'L2', 'L3', 'L4'],
    'every gap lesson collapses onto yesterday',
  )
})

test('recalibrateCurriculumGoal: completed lessons are not part of the gap snapshot — only ids the gap query returned get written', async () => {
  // The DB-side filter `completed = false` lives in the SELECT; here the
  // mock honors that by returning ONLY the incomplete rows in gapLessons.
  // The completed history sits outside the snapshot, so distribution
  // writes can't possibly touch it. We pin the contract: the function
  // emits writes for exactly the gap ids the snapshot returned and
  // nothing else.
  const anchor = daysAgo(8)
  const gap: GapLessonRow[] = [
    { id: 'L4', lesson_number: 4 },
    { id: 'L5', lesson_number: 5 },
  ]
  const { supabase, writes } = makeRecalibrateSupabase({
    goal: defaultGoal(),
    gapLessons: gap,
    anchorRow: { completed_at: anchor.toISOString() },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({
    supabase: supabase as any,
    goalId: 'g1',
    newCurrentLesson: 6,
    vacationBlocks: [],
    recordHistory: true,
    confirmedLessonIds: gap.map((g) => g.id),
  })

  const dist = distributionWrites(writes)
  const writtenIds = new Set(dist.flatMap((w) => w.ids ?? []))
  assert.deepEqual(
    [...writtenIds].sort(),
    ['L4', 'L5'],
    'distribution targets exactly the incomplete gap ids the snapshot returned',
  )
  // Spot-check: a previously-completed id ('L1') was deliberately not in
  // the snapshot, so no UPDATE in the captured writes mentions it.
  assert.ok(!writtenIds.has('L1'), 'completed history (L1) is not touched')
})

test('recalibrateCurriculumGoal: no gap lessons → no distribution writes', async () => {
  // gapLessons=[] means the user said "I'm on lesson 1" with nothing
  // pending behind it. The goal pointer still moves (one curriculum_goals
  // UPDATE), but the distribution step is a complete no-op.
  const { supabase, writes } = makeRecalibrateSupabase({
    goal: defaultGoal(),
    gapLessons: [],
    anchorRow: { completed_at: null },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await recalibrateCurriculumGoal({
    supabase: supabase as any,
    goalId: 'g1',
    newCurrentLesson: 1,
    vacationBlocks: [],
    recordHistory: true,
    confirmedLessonIds: [],
  })
  assert.equal(result.gapCount, 0)

  assert.equal(distributionWrites(writes).length, 0, 'no recalibrate_estimate writes when nothing to distribute')
  // The goal pointer write is still recorded; the only DB mutation on
  // the happy "nothing to distribute" path.
  const goalWrites = writes.filter((w) => w.table === 'curriculum_goals')
  assert.equal(goalWrites.length, 1, 'goal pointer still pivots')
  assert.deepEqual(goalWrites[0].payload, { current_lesson: 0, start_at_lesson: 1 })
})

test('recalibrateCurriculumGoal: every distribution write stamps scheduled_source = recalibrate_estimate and leaves queue_position alone', async () => {
  // Invariant 10 + the "estimate" flag: the lesson card surfaces the
  // hint by reading scheduled_source. queue_position is NOT in the payload:
  // the row keeps its slot so both pointer recomputes count it like a real
  // completion (see the d1e76670 tests at the bottom of this file).
  const anchor = daysAgo(7)
  const gap: GapLessonRow[] = [
    { id: 'L1', lesson_number: 1 },
    { id: 'L2', lesson_number: 2 },
    { id: 'L3', lesson_number: 3 },
    { id: 'L4', lesson_number: 4 },
  ]
  const { supabase, writes } = makeRecalibrateSupabase({
    goal: defaultGoal(),
    gapLessons: gap,
    anchorRow: { completed_at: anchor.toISOString() },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({
    supabase: supabase as any,
    goalId: 'g1',
    newCurrentLesson: 5,
    vacationBlocks: [],
    recordHistory: true,
    confirmedLessonIds: gap.map((g) => g.id),
  })

  const dist = distributionWrites(writes)
  assert.ok(dist.length > 0, 'sanity: distribution did run')
  for (const w of dist) {
    const p = w.payload as Record<string, unknown>
    assert.equal(p.scheduled_source, 'recalibrate_estimate')
    assert.ok(!('queue_position' in p), 'the slot is never nulled')
    assert.equal(p.completed, true)
    // completed_at + scheduled_date + date should all line up to the
    // same calendar day — the Plan calendar reads scheduled_date and
    // Today's filter reads completed_at::date.
    assert.equal(p.date, p.scheduled_date)
    assert.equal(p.completed_at, `${p.scheduled_date}T12:00:00Z`)
  }
})

test('recalibrateCurriculumGoal: forward lessons (lesson_number >= clamped) are not stamped as estimates', async () => {
  // The gap query filters lesson_number < clamped at the DB layer. The
  // mock honors that by leaving forward rows out of the gap snapshot —
  // they only appear in the phase-5 forward-incomplete fetch (the queue
  // resync helper), which uses scheduled_source = 'queue_resync', never
  // 'recalibrate_estimate'. We pin the boundary: no distribution write
  // mentions a forward row's id.
  const anchor = daysAgo(6)
  const gap: GapLessonRow[] = [
    { id: 'L1', lesson_number: 1 },
    { id: 'L2', lesson_number: 2 },
  ]
  // Forward rows live separately; clamped will be 3, so lessons 3-5 are
  // strictly past the pointer.
  const forward: ForwardIncompleteRow[] = [
    { id: 'F3', lesson_number: 3, scheduled_date: ymd(daysAgo(0)), completed: false, is_backfill: false },
    { id: 'F4', lesson_number: 4, scheduled_date: ymd(daysAgo(0)), completed: false, is_backfill: false },
    { id: 'F5', lesson_number: 5, scheduled_date: ymd(daysAgo(0)), completed: false, is_backfill: false },
  ]
  const { supabase, writes } = makeRecalibrateSupabase({
    goal: defaultGoal(),
    gapLessons: gap,
    anchorRow: { completed_at: anchor.toISOString() },
    forwardIncompleteRows: forward,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({
    supabase: supabase as any,
    goalId: 'g1',
    newCurrentLesson: 3,
    vacationBlocks: [],
    recordHistory: true,
    confirmedLessonIds: gap.map((g) => g.id),
  })

  const dist = distributionWrites(writes)
  const distIds = new Set(dist.flatMap((w) => w.ids ?? []))
  for (const f of forward) {
    assert.ok(!distIds.has(f.id), `forward lesson ${f.id} (lesson_number ${f.lesson_number}) is not stamped as an estimate`)
  }
  // And the gap rows ARE in the distribution.
  assert.ok(distIds.has('L1'))
  assert.ok(distIds.has('L2'))
})

// ── "I'm actually on lesson X" survives the next recompute ─────────────────
//
// Goal d1e76670 (Phonics), Sept 14 to 15, 2026: recalibrated to lesson 19, so
// recalibrate wrote current_lesson 18 and stamped lessons 11 to 18 as
// estimates with queue_position NULL. The next day a Schedule Builder save
// wrote start_at_lesson back to 10 and called recomputeCurrentLesson, which
// reads MAX(queue_position) over completed rows. The estimates had no slot, so
// it answered 10, and the builder renumbered lesson 19 into slot 11
// (ROOTED-HOMESCHOOL-1J, "leaves 8 projected slot(s) unfilled").
//
// Contract: after recalibrating to X, recomputeCurrentLesson answers X - 1 on
// every later call, whatever the builder does in between. Run against an
// in-memory client that applies the filters, so the answer comes from the rows.

function phonicsGoal() {
  const goalId = 'd1e76670'
  const lessons: Record<string, unknown>[] = []
  for (let n = 1; n <= 30; n++) {
    const done = n <= 10
    const d = done ? daysAgo(40 - n) : daysAgo(-(n - 10))
    lessons.push({
      id: `L${n}`,
      curriculum_goal_id: goalId,
      lesson_number: n,
      queue_position: n,
      completed: done,
      completed_at: done ? `${ymd(d)}T15:00:00Z` : null,
      scheduled_date: ymd(d),
      date: ymd(d),
      scheduled_source: done ? 'completion_today' : 'wizard_create',
      is_backfill: false,
      queue_pinned: false,
      skipped: false,
    })
  }
  const goal = {
    id: goalId,
    total_lessons: 30,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed'],
    start_date: ymd(daysAgo(45)),
    lessons_per_day_overrides: null,
    created_at: '2026-08-31T19:16:58Z',
    current_lesson: 10,
    start_at_lesson: 1,
  }
  return { goalId, ...makeMemorySupabase({ curriculum_goals: [goal], lessons }) }
}

test('recalibrate to 19, then recompute: 18, and still 18 after a builder save renumbers the queue', async () => {
  const { goalId, client, tables } = phonicsGoal()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 19) })
  assert.equal(res.newCountDone, 18)

  const estimates = tables.lessons.filter((r) => r.scheduled_source === 'recalibrate_estimate')
  assert.deepEqual(estimates.map((r) => r.lesson_number), [11, 12, 13, 14, 15, 16, 17, 18])
  for (const r of estimates) {
    assert.equal(r.completed, true)
    assert.equal(r.queue_position, r.lesson_number, `lesson ${r.lesson_number} keeps its slot`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 18)

  // The builder save that broke it: phase 1 writes start_at_lesson back to 10,
  // so the floor no longer holds the pointer. Only the rows can.
  const goal = tables.curriculum_goals[0]
  goal.start_at_lesson = 10
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builderPointer = await recomputeCurrentLesson(client as any, goalId)
  assert.equal(builderPointer, 18, 'the builder reads 18, not the last real completion (10)')

  // Phase 2: drop the incomplete rows above the completed floor and renumber the
  // queue from the pointer the builder just read.
  const floor = Math.max(...tables.lessons.filter((r) => r.completed).map((r) => r.lesson_number as number))
  tables.lessons = tables.lessons.filter((r) => r.completed || (r.lesson_number as number) <= floor)
  for (let n = builderPointer! + 1; n <= 30; n++) {
    tables.lessons.push({
      id: `B${n}`, curriculum_goal_id: goalId, lesson_number: n, queue_position: n,
      completed: false, completed_at: null, scheduled_source: 'wizard_create',
      is_backfill: false, queue_pinned: false, skipped: false,
    })
  }
  const lesson19 = tables.lessons.find((r) => r.lesson_number === 19)
  assert.equal(lesson19?.queue_position, 19, 'lesson 19 sits in slot 19, not slot 11')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 18, 'and every later recompute agrees')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 18)
})

test('the old null slot is what broke it: the same builder save with slotless estimates reads 10', async () => {
  // Pins the cause, so a future "hide the estimates from the queue" change fails
  // here instead of in a family's progress count.
  const { goalId, client, tables } = phonicsGoal()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 19) })
  for (const r of tables.lessons) if (r.scheduled_source === 'recalibrate_estimate') r.queue_position = null
  tables.curriculum_goals[0].start_at_lesson = 10
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 10)
})

function driftedGoal(lesson5Pinned: boolean, opts: { withoutRestoreFunction?: boolean } = {}) {
  // Lesson 5 sits in slot 20 and lessons 6 to 20 in slots 5 to 19: what
  // move_lesson_to_date leaves when lesson 5 is moved three weeks out.
  const goalId = 'drifted'
  const lessons: Record<string, unknown>[] = []
  const slotFor = (n: number) => (n === 5 ? 20 : n >= 6 && n <= 20 ? n - 1 : n)
  for (let n = 1; n <= 30; n++) {
    lessons.push({
      id: `L${n}`, curriculum_goal_id: goalId, lesson_number: n, queue_position: slotFor(n),
      completed: n <= 4, completed_at: n <= 4 ? `${ymd(daysAgo(30 - n))}T15:00:00Z` : null,
      scheduled_date: null, date: null, scheduled_source: 'wizard_create',
      is_backfill: false, queue_pinned: n === 5 && lesson5Pinned, skipped: false,
    })
  }
  return { goalId, ...makeMemorySupabase({
    curriculum_goals: [{
      id: goalId, total_lessons: 30, lessons_per_day: 1, school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      start_date: ymd(daysAgo(40)), lessons_per_day_overrides: null, created_at: '2026-08-01T00:00:00Z',
      current_lesson: 4, start_at_lesson: 1,
    }],
    lessons,
  }, { noRpc: opts.withoutRestoreFunction }) }
}

test('a drifted queue is put back in book order first; a moved (pinned) lesson keeps its day on Yes', async () => {
  // Lesson 5 was moved three weeks out with move_lesson_to_date (slot 20;
  // lessons 6 to 20 slid into 5 to 19). "I'm on lesson 12" is about the BOOK,
  // so the queue is restored first: lesson n in slot n again.
  const { goalId, client, tables } = driftedGoal(true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 12, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 12) })
  const byNum = (n: number) => tables.lessons.find((r) => r.lesson_number === n)!
  assert.equal(res.bookOrderRestored, true)
  for (let n = 1; n <= 30; n++) assert.equal(byNum(n).queue_position, n, `lesson ${n} back in slot ${n}`)
  assert.equal(byNum(5).completed, false, 'the family moved it; Yes does not turn that into a completion')
  assert.equal(byNum(5).queue_pinned, true, 'it keeps the day they moved it to')
  assert.deepEqual(res.keptPinned, [5])
  for (let n = 6; n <= 11; n++) assert.equal(byNum(n).completed, true, `lesson ${n} marked done on Yes`)
  assert.equal(byNum(12).completed, false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 11, 'lesson 12 is next, not the slot 12 of a drifted queue')
})

test('without restore_queue_book_order (before the migration), an unpinned lesson in a slot above the new pointer still gives the slot up', async () => {
  // Found by the local code review: a completed row holding slot 20 would drive
  // both recomputes to 20.
  const { goalId, client, tables } = driftedGoal(false, { withoutRestoreFunction: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 12, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 12, { bookOrder: false }) })
  const byNum = (n: number) => tables.lessons.find((r) => r.lesson_number === n)!
  assert.equal(byNum(5).completed, true)
  assert.equal(byNum(5).queue_position, null, 'slot 20 is above the pointer and is given up')
  for (let n = 6; n <= 11; n++) assert.equal(byNum(n).queue_position, n - 1, `lesson ${n} keeps slot ${n - 1}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pointer = await recomputeCurrentLesson(client as any, goalId)
  assert.equal(pointer, 11, 'never past the lesson the family typed')
  tables.curriculum_goals[0].start_at_lesson = 10
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterBuilder = await recomputeCurrentLesson(client as any, goalId)
  assert.ok(afterBuilder! <= 11, `a later floor reset cannot push it past 11 either (got ${afterBuilder})`)
})

test('estimateKeepsSlot: a slot at or below the new pointer is kept, anything else is not', () => {
  assert.equal(estimateKeepsSlot(18, 18), true)
  assert.equal(estimateKeepsSlot(11, 18), true)
  assert.equal(estimateKeepsSlot(19, 18), false)
  assert.equal(estimateKeepsSlot(null, 18), false)
})

// ── "I'm actually on lesson X" does not invent completed history ─────────
//
// Saying "I'm on lesson 19" places a family in the book. It never said Rooted
// holds lessons 11 to 18, and reading it as though it did wrote them as DONE
// estimates, which Reports bill at 30 minutes each: hours nobody logged. The
// Schedule Builder's "Already into it" question got the same default in the
// same change, so the two ways of saying "we're here" cannot disagree.
//
// The memory client does not run the orphan-cleanup trigger (it only
// unschedules rows, never completes them), so what these assert is exactly what
// app code writes.

function completedSnapshot(rows: Record<string, unknown>[]) {
  return rows
    .filter((r) => r.completed)
    .map((r) => `${r.lesson_number}|${r.completed_at}|${r.scheduled_source}|${r.minutes_spent ?? ''}`)
    .sort()
}

test('by default, recalibrating forward completes nothing and the pointer still moves', async () => {
  const { goalId, client, tables } = phonicsGoal()
  const before = completedSnapshot(tables.lessons)
  const rowCount = tables.lessons.length

  // No recordHistory argument: what a caller that has not thought about it gets.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [] })

  assert.equal(res.recordedHistory, false)
  assert.equal(res.gapCount, 8, 'the gap is still reported, so the caller can say what it left alone')
  assert.equal(res.estimates.expected, 0, 'and not one estimate write was even asked for')
  assert.deepEqual(completedSnapshot(tables.lessons), before, 'the completed set is exactly what it was')
  assert.equal(tables.lessons.filter((r) => r.scheduled_source === 'recalibrate_estimate').length, 0)
  assert.equal(tables.lessons.length, rowCount, 'no row created, none deleted')
  for (let n = 11; n <= 18; n++) {
    const r = tables.lessons.find((l) => l.lesson_number === n)!
    assert.equal(r.completed, false, `lesson ${n} stays unfinished`)
    assert.equal(r.queue_position, n, `lesson ${n} keeps its slot`)
  }

  // The pointer holds through start_at_lesson, not through invented rows.
  assert.equal(tables.curriculum_goals[0].start_at_lesson, 19)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 18)
})

test('by default, moving back down after a forward move also completes nothing', async () => {
  const { goalId, client, tables } = phonicsGoal()
  const before = completedSnapshot(tables.lessons)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 12, vacationBlocks: [] })
  assert.equal(res.newCountDone, 11)
  assert.deepEqual(completedSnapshot(tables.lessons), before)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 11)
})

test('asking for the history twice writes it once, and never touches real completions', async () => {
  const { goalId, client, tables } = phonicsGoal()
  const realBefore = completedSnapshot(tables.lessons)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 19) })
  assert.equal(first.recordedHistory, true)
  assert.equal(first.estimates.written, 8)
  const afterFirst = completedSnapshot(tables.lessons)

  // The family saves the same answer again, still saying yes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const second = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 19) })
  assert.equal(second.gapCount, 0, 'nothing below 19 is unfinished any more')
  assert.equal(second.estimates.expected, 0, 'so nothing is written a second time')
  assert.deepEqual(completedSnapshot(tables.lessons), afterFirst, 'not duplicated, not re-dated')
  assert.equal(tables.lessons.length, 30, 'still one row per lesson')

  // Lessons 1 to 10 were real completions. They are exactly as they were.
  for (const line of realBefore) assert.ok(afterFirst.includes(line), `real completion kept: ${line}`)

  // Estimates carry no minutes: they are estimated dates, not logged time, and
  // Reports must be able to tell the difference.
  for (const r of tables.lessons.filter((l) => l.scheduled_source === 'recalibrate_estimate')) {
    assert.equal(r.minutes_spent ?? null, null, `lesson ${r.lesson_number} records no minutes`)
  }
})

test('after a No, a later move never sweeps up the lessons it left behind', async () => {
  // No leaves 11 to 18 unfinished behind the pointer, where they cannot be
  // told apart from lessons the family reopened (Invariant 23). The form only
  // asks about lessons AFTER the saved position, so no later answer names
  // them, and no later Yes may complete them. A family who wants them done
  // ticks them on Plan, which dates each one as they say.
  const { goalId, client, tables } = phonicsGoal()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const later = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 22, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 22) })
  const estimates = tables.lessons.filter((r) => r.scheduled_source === 'recalibrate_estimate').map((r) => r.lesson_number)
  assert.deepEqual(estimates.sort((a, b) => (a as number) - (b as number)), [19, 20, 21], 'only the lessons this Yes named')
  assert.equal(later.gapCount, 3)
  for (let n = 11; n <= 18; n++) {
    assert.equal(tables.lessons.find((l) => l.lesson_number === n)!.completed, false, `lesson ${n} stays unfinished`)
  }
  assert.equal(tables.lessons.length, 30)
})

test('every recalibrate caller states the history choice, and none hardcodes yes', () => {
  const callers = ['app/components/PlanV2/index.tsx', 'app/dashboard/plan/schedule/page.tsx']
  for (const f of callers) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
    const call = src.slice(src.indexOf('await recalibrateCurriculumGoal({'))
    const body = call.slice(0, call.indexOf('});'))
    assert.match(body, /recordHistory,?\s/, `${f} passes the family's answer through`)
    assert.match(body, /confirmedLessonIds,?\s/, `${f} passes the list the family was shown`)
    assert.doesNotMatch(body, /recordHistory:\s*true/, `${f} must not decide for the family`)
  }
})

// ── A reopened make-up is the family's, not part of the gap ───────────────
//
// The form asks "Should Rooted mark lessons 11 to 18 as done?", counting from
// current_lesson + 1. The gap query used to take every unfinished row below
// the new lesson, so a lesson the family had REOPENED behind the pointer (a
// make-up, Invariant 23) was stamped done on Yes as well, though the question
// never named it. Yes now completes exactly the lessons it names.

function phonicsWithMakeUp() {
  const g = phonicsGoal()
  const five = g.tables.lessons.find((r) => r.lesson_number === 5)!
  // Reopened: unfinished, pinned on a day from today, slot kept.
  five.completed = false
  five.completed_at = null
  five.queue_pinned = true
  five.scheduled_date = ymd(daysAgo(-1))
  five.date = ymd(daysAgo(-1))
  return g
}

test('Yes completes only the lessons the question named, never a reopened make-up', async () => {
  const { goalId, client, tables } = phonicsWithMakeUp()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 19) })
  const estimates = tables.lessons.filter((r) => r.scheduled_source === 'recalibrate_estimate').map((r) => r.lesson_number)
  assert.deepEqual(estimates.sort((a, b) => (a as number) - (b as number)), [11, 12, 13, 14, 15, 16, 17, 18])
  assert.equal(res.gapCount, 8)
  const five = tables.lessons.find((r) => r.lesson_number === 5)!
  assert.equal(five.completed, false, 'the make-up stays unfinished')
  assert.equal(five.queue_pinned, true, 'and stays on its day')
})

test('No leaves a reopened make-up exactly as it was', async () => {
  const { goalId, client, tables } = phonicsWithMakeUp()
  const before = JSON.stringify(tables.lessons.find((r) => r.lesson_number === 5))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [] })
  assert.equal(JSON.stringify(tables.lessons.find((r) => r.lesson_number === 5)), before)
})

test('No unschedules the passed-over lessons that still hold a date, keeps their notes, and leaves pinned ones alone', async () => {
  const { goalId, client, tables } = phonicsGoal()
  // Lesson plans typed ahead: the orphan cleanup never unschedules these.
  for (const n of [12, 15]) tables.lessons.find((r) => r.lesson_number === n)!.notes = `plan for ${n}`
  // A lesson the family moved by hand.
  const sixteen = tables.lessons.find((r) => r.lesson_number === 16)!
  sixteen.queue_pinned = true
  const pinnedDate = sixteen.scheduled_date

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [] })

  for (const n of [11, 12, 13, 14, 15, 17, 18]) {
    const r = tables.lessons.find((l) => l.lesson_number === n)!
    assert.equal(r.scheduled_date, null, `lesson ${n} holds no date, so no later save can pin it to Today`)
    assert.equal(r.completed, false, `lesson ${n} is not completed`)
    assert.equal(r.scheduled_source, 'recalibrate_respread')
  }
  assert.equal(tables.lessons.find((l) => l.lesson_number === 12)!.notes, 'plan for 12', 'notes survive')
  assert.equal(sixteen.scheduled_date, pinnedDate, 'a pinned lesson keeps the day the family chose')
  assert.equal(res.unscheduled.written, 7)
  assert.equal(res.estimates.expected, 0)
})

test('Yes writes no unschedules: it completes the gap instead', async () => {
  const { goalId, client } = phonicsGoal()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 19) })
  assert.equal(res.unscheduled.expected, 0)
})

test('after a No, the pointer survives a later save that leaves start_at_lesson alone, and falls if one writes the old value back', async () => {
  // The contract the Schedule Builder's startAtLessonTouched guard exists for.
  const { goalId, client, tables } = phonicsGoal()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [] })
  // A builder save that sends no start_at_lesson (the guarded UPDATE):
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 18)
  // What an unguarded stale tab would have done:
  tables.curriculum_goals[0].start_at_lesson = 11
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 10, 'nothing else holds it, which is why the write is guarded')
})

test('an unfinished lesson below the old position with no slot is not part of the gap either', async () => {
  // A reopened row whose slot was stripped long ago: only its number says it is
  // behind the pointer, so only the query's lower bound keeps Yes off it.
  const { goalId, client, tables } = phonicsGoal()
  const seven = tables.lessons.find((r) => r.lesson_number === 7)!
  seven.completed = false
  seven.completed_at = null
  seven.queue_position = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 19) })
  assert.equal(seven.completed, false)
  assert.notEqual(seven.scheduled_source, 'recalibrate_estimate')
})

// ── Yes marks done exactly what the question names ───────────────────────

test('Yes leaves a lesson the family pinned on its day, and never completes a skipped one', async () => {
  const { goalId, client, tables } = phonicsGoal()
  const fifteen = tables.lessons.find((r) => r.lesson_number === 15)!
  fifteen.queue_pinned = true
  fifteen.scheduled_date = ymd(daysAgo(-40))
  fifteen.date = fifteen.scheduled_date
  const twelve = tables.lessons.find((r) => r.lesson_number === 12)!
  twelve.skipped = true
  twelve.scheduled_date = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: await confirmedFor(client, goalId, 19) })
  const estimates = tables.lessons.filter((r) => r.scheduled_source === 'recalibrate_estimate').map((r) => r.lesson_number as number)
  assert.deepEqual(estimates.sort((a, b) => a - b), [11, 13, 14, 16, 17, 18])
  assert.equal(res.estimates.written, 6)
  assert.deepEqual(res.keptPinned, [15])
  assert.equal(fifteen.completed, false, 'the pinned lesson is not turned into a past completion')
  assert.equal(fifteen.queue_pinned, true)
  assert.equal(fifteen.scheduled_date, ymd(daysAgo(-40)), 'it keeps the day the family moved it to')
  assert.equal(twelve.completed, false, 'a skipped lesson is never counted done (Invariant 22)')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 18)
})

test('planRecalibrateGap is the one rule the form and the write share', () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({ id: `L${n}`, lesson_number: n, queue_position: n, ...extra })
  const rows = [
    row(5, { queue_pinned: true }),          // reopened make-up, behind the old position
    row(9, { queue_position: 25 }),         // behind by number, drifted slot: still behind
    row(11), row(12, { skipped: true }), row(13),
    row(14, { completed: true }),           // already done
    row(15, { queue_pinned: true }),        // placed by hand
    row(16, { queue_position: 8 }),         // behind by slot
    row(18), row(19),                       // 19 is the lesson they are on: not in the gap
  ]
  const { gap, toComplete, keptPinned } = planRecalibrateGap(rows, 10, 19)
  assert.deepEqual(gap.map((r) => r.lesson_number), [11, 12, 13, 15, 18])
  assert.deepEqual(toComplete.map((r) => r.lesson_number), [11, 13, 18])
  assert.deepEqual(keptPinned.map((r) => r.lesson_number), [15])
})

test('the question and the hours read as a family would say them', () => {
  assert.equal(formatLessonList([11, 12, 13, 14, 15, 16, 17, 18]), 'lessons 11 to 18')
  assert.equal(formatLessonList([11, 12, 13, 14, 16, 17, 18]), 'lessons 11 to 14 and 16 to 18')
  assert.equal(formatLessonList([11, 13, 14, 16, 17, 18]), 'lessons 11, 13, 14 and 16 to 18')
  assert.equal(formatLessonList([11, 12]), 'lessons 11 and 12')
  assert.equal(formatLessonList([15], true), 'Lesson 15')
  assert.equal(formatLessonList([]), '')
  assert.equal(formatAddedTime(7 * ESTIMATE_REPORT_MINUTES), '3 hours 30 minutes')
  assert.equal(formatAddedTime(60), '1 hour')
  assert.equal(formatAddedTime(30), '30 minutes')
})

test('the form words its question from the same rule the write uses', () => {
  const src = readFileSync(new URL('../components/PlanV2/CurriculumGroupsPanel.tsx', import.meta.url), 'utf8')
  const form = src.slice(src.indexOf('export function RecalibrateForm('))
  assert.match(form, /planRecalibrateGap\(gapRows, oldCountDone, typed\)/)
  assert.match(form, /Should Rooted mark \$\{formatLessonList\(toMarkDone\)\} as done\?/)
  assert.match(form, /formatAddedTime\(toMarkDone\.length \* ESTIMATE_REPORT_MINUTES\)/)
  assert.doesNotMatch(form, /gapFrom|gapTo/, 'no second, hand-rolled range that could disagree with the write')
  // A Yes carries exactly the list on screen; No carries none.
  assert.match(form, /await onSubmit\(n, yes, yes \? \(plan\?\.toComplete \?\? \[\]\)\.map\(\(r\) => r\.id\) : \[\]\)/)
  // Save is closed while reading, when the read failed, and after a refusal.
  assert.match(form, /const saveBlocked = checking \|\| gapReadFailed \|\| listChanged;/)
  assert.match(form, /disabled=\{submitting \|\| saveBlocked\}/)
  assert.match(form, /if \(saveBlocked\) return;/)
  assert.match(form, /We couldn&apos;t check this curriculum&apos;s lessons, so this can&apos;t be saved right now\./)
  assert.match(form, /e\.name === "RecalibrateListChangedError"\) setListChanged\(true\)/)
  // The builder hands the refusal back to the form instead of closing it.
  const builder = readFileSync(new URL('../dashboard/plan/schedule/page.tsx', import.meta.url), 'utf8')
  assert.match(builder, /if \(err instanceof RecalibrateListChangedError\) throw err;/)
})

// ── A Yes is for the list the family saw, or nothing is written ─────────
//
// The form lists the lessons a Yes marks done, and the hours they add, when it
// opens. The save reads the lessons again. If another tab changed one in
// between, writing would complete a different set, or add different hours,
// from the ones she agreed to. The write compares and refuses before its first
// write: no pointer move, no estimate, no unschedule.

type Tables = Record<string, Record<string, unknown>[]>

function snapshot(tables: Tables) {
  return JSON.stringify({ goals: tables.curriculum_goals, lessons: tables.lessons })
}

async function expectRefusedWithNoWrites(
  run: () => Promise<unknown>,
  tables: Tables,
  before: string,
) {
  await assert.rejects(run, (e: unknown) => e instanceof RecalibrateListChangedError)
  assert.equal(snapshot(tables), before, 'nothing was written: pointer, lessons and dates exactly as they were')
}

test('Yes is refused, writing nothing, when another tab completed a listed lesson after the form opened', async () => {
  const { goalId, client, tables } = phonicsGoal()
  const shown = await confirmedFor(client, goalId, 19) // lessons 11 to 18, as the form lists them
  assert.equal(shown.length, 8)
  // Another tab ticks lesson 12 while the form is open.
  Object.assign(tables.lessons.find((r) => r.lesson_number === 12)!, { completed: true, completed_at: `${ymd(daysAgo(0))}T15:00:00Z` })
  const before = snapshot(tables)
  await expectRefusedWithNoWrites(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: shown }),
    tables,
    before,
  )
})

test('Yes is refused when a lesson became eligible after the form opened (it would add hours she never saw)', async () => {
  const { goalId, client, tables } = phonicsGoal()
  const fifteen = tables.lessons.find((r) => r.lesson_number === 15)!
  fifteen.queue_pinned = true
  const shown = await confirmedFor(client, goalId, 19) // 11 to 14 and 16 to 18: seven lessons, 3h 30m
  assert.equal(shown.length, 7)
  fifteen.queue_pinned = false // unpinned in another tab: now an eighth lesson, another 30 minutes
  const before = snapshot(tables)
  await expectRefusedWithNoWrites(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: shown }),
    tables,
    before,
  )
})

test('Yes without the list the family saw is refused, writing nothing', async () => {
  const { goalId, client, tables } = phonicsGoal()
  const before = snapshot(tables)
  await expectRefusedWithNoWrites(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true }),
    tables,
    before,
  )
})

test('the same list in a different order is the same agreement, and No never needs one', async () => {
  const { goalId, client, tables } = phonicsGoal()
  const shown = (await confirmedFor(client, goalId, 19)).reverse()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [], recordHistory: true, confirmedLessonIds: shown })
  assert.equal(res.estimates.written, 8)

  const other = phonicsGoal()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const no = await recalibrateCurriculumGoal({ supabase: other.client as any, goalId: other.goalId, newCurrentLesson: 19, vacationBlocks: [] })
  assert.equal(no.newCountDone, 18)
  assert.equal(tables.lessons.filter((r) => r.scheduled_source === 'recalibrate_estimate').length, 8)
})

test('sameLessonIds compares sets', () => {
  assert.equal(sameLessonIds(['a', 'b'], ['b', 'a']), true)
  assert.equal(sameLessonIds(['a', 'b'], ['a']), false)
  assert.equal(sameLessonIds(['a', 'b'], ['a', 'c']), false)
  assert.equal(sameLessonIds(['a', 'a'], ['a', 'b']), false)
  assert.equal(sameLessonIds([], []), true)
})

// ── "I'm actually on lesson X" after a move (the August 2026 sequence) ─────────
//
// Every-day school week so the tests never depend on the weekday they run on.
// Plan shows each row's stored date; Today shows the projector's answer over
// the same rows. After the recalibration the two must agree and the lesson
// the family named must be due today.

function sequenceGoal(rows: Record<string, unknown>[], goal: Record<string, unknown> = {}) {
  const goalId = 'seq'
  return { goalId, ...makeMemorySupabase({
    curriculum_goals: [{
      id: goalId, total_lessons: 20, lessons_per_day: 1, school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      start_date: ymd(daysAgo(10)), lessons_per_day_overrides: null, created_at: '2026-08-01T00:00:00Z',
      current_lesson: 3, start_at_lesson: 1, ...goal,
    }],
    lessons: rows.map((r) => ({ curriculum_goal_id: goalId, is_backfill: false, skipped: false, date: r.scheduled_date, ...r })),
  }) }
}

function planAndToday(tables: Record<string, Record<string, unknown>[]>) {
  const g = tables.curriculum_goals[0]
  const rows = tables.lessons as Array<{ lesson_number: number; queue_position: number | null; scheduled_date: string | null; completed: boolean; skipped: boolean; queue_pinned: boolean; curriculum_goal_id: string }>
  const proj = computeNextLessonsForGoal(
    { id: g.id as string, total_lessons: g.total_lessons as number, lessons_per_day: 1, school_days: g.school_days as string[], current_lesson: g.current_lesson as number, start_date: g.start_date as string, lessons_per_day_overrides: null },
    todayMid(), 3650, [], 0, queueHoldsFromRows(rows, g.id as string),
  )
  const bySlot = new Map(proj.map((p) => [p.lesson_number, p.date]))
  const today = ymd(todayMid())
  return {
    todayLessons: proj.filter((p) => p.date === today).map((p) => rows.find((r) => r.queue_position === p.lesson_number)!.lesson_number),
    disagreements: rows
      .filter((r) => !r.completed && !r.skipped && r.queue_position != null && r.scheduled_date != null && r.scheduled_date >= today)
      .filter((r) => bySlot.get(r.queue_position!) !== r.scheduled_date)
      .map((r) => r.lesson_number),
  }
}

const inDays = (n: number) => ymd(new Date(todayMid().getTime() + n * 86400000))

test('Move just this lesson 4, then "I\'m actually on lesson 4": lesson 4 is due today on Plan and Today', async () => {
  // The state move_lesson_keep_slot leaves: lesson 4 pinned five days out in
  // its own slot, lessons 5 to 9 held on their days, 10 onward unpinned.
  const rows: Record<string, unknown>[] = []
  for (let n = 1; n <= 20; n++) {
    rows.push({
      id: `S${n}`, lesson_number: n, queue_position: n, completed: n <= 3,
      completed_at: n <= 3 ? `${ymd(daysAgo(4 - n))}T15:00:00Z` : null,
      scheduled_date: n === 4 ? inDays(5) : n <= 3 ? ymd(daysAgo(4 - n)) : inDays(n - 4),
      queue_pinned: n >= 4 && n <= 9,
      scheduled_source: n === 4 ? 'plan_move' : n >= 5 && n <= 9 ? 'plan_hold' : 'wizard_create',
    })
  }
  const { goalId, client, tables } = sequenceGoal(rows)
  const before = planAndToday(tables)
  assert.deepEqual(before.todayLessons, [], 'after the move, nothing of this curriculum is due today')
  assert.deepEqual(before.disagreements, [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 4, vacationBlocks: [] })
  assert.equal(res.releasedPin.writtenIds.length, 1, 'the pin on lesson 4 is released')
  const after = planAndToday(tables)
  assert.deepEqual(after.todayLessons, [4], 'Today shows lesson 4')
  assert.equal(tables.lessons.find((r) => r.lesson_number === 4)!.scheduled_date, ymd(todayMid()), 'Plan shows lesson 4 today')
  assert.deepEqual(after.disagreements, [], 'Plan and Today agree on every lesson')
  for (let n = 5; n <= 9; n++) assert.equal(tables.lessons.find((r) => r.lesson_number === n)!.scheduled_date, inDays(n - 4), `held lesson ${n} kept its day`)
})

test('the stranded-lesson state: lesson 5 done in slot 6 hid lesson 6; "I\'m actually on lesson 6" brings it back to Today', async () => {
  // A production curriculum on 2026-09-24, read-only: lesson 5 completed in slot 6,
  // lesson 6 unfinished in slot 5 behind the pointer (6), pinned to a past day
  // by the 2026-09-08 repair. start_at_lesson 5 from the family's last try.
  const rows: Record<string, unknown>[] = []
  for (let n = 1; n <= 20; n++) {
    const slot = n === 5 ? 6 : n === 6 ? 5 : n
    rows.push({
      id: `R${n}`, lesson_number: n, queue_position: slot, completed: n <= 5,
      completed_at: n <= 5 ? `${ymd(daysAgo(10 - n))}T15:00:00Z` : null,
      scheduled_date: n <= 6 ? ymd(daysAgo(10 - n)) : inDays(n - 7),
      queue_pinned: n === 6, scheduled_source: n === 6 ? 'cleanup_sql' : 'wizard_create',
    })
  }
  const { goalId, client, tables } = sequenceGoal(rows, { current_lesson: 6, start_at_lesson: 5 })
  assert.ok(!planAndToday(tables).todayLessons.includes(6), 'before: lesson 6 is on no screen')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 6, vacationBlocks: [] })
  assert.equal(res.bookOrderRestored, true)
  const byNum = (n: number) => tables.lessons.find((r) => r.lesson_number === n)!
  assert.equal(byNum(5).queue_position, 5)
  assert.equal(byNum(6).queue_position, 6)
  assert.equal(byNum(5).completed, true, 'the completed lesson 5 is untouched')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 5)
  const after = planAndToday(tables)
  assert.deepEqual(after.todayLessons, [6], 'Today shows lesson 6')
  assert.equal(byNum(6).scheduled_date, ymd(todayMid()), 'Plan shows lesson 6 today')
  assert.deepEqual(after.disagreements, [])
})
