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

import { recalibrateCurriculumGoal, estimateKeepsSlot } from './recalibrate.ts'
import { recomputeCurrentLesson } from './scheduler.ts'
import { makeMemorySupabase } from './test-helpers/memory-supabase.ts'

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
        if (projection === 'id, lesson_number, queue_position') {
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
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [] })
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
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 19, vacationBlocks: [] })
  for (const r of tables.lessons) if (r.scheduled_source === 'recalibrate_estimate') r.queue_position = null
  tables.curriculum_goals[0].start_at_lesson = 10
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await recomputeCurrentLesson(client as any, goalId), 10)
})

test('a moved lesson in a slot above the new pointer gives the slot up, so the pointer never overshoots', async () => {
  // Found by the local code review. Lesson 5 moved three weeks out on Plan:
  // move_lesson_to_date put it in slot 20 and shifted lessons 6 to 20 down to
  // slots 5 to 19. "I'm actually on lesson 12" selects lesson 5 by number, and
  // a completed row holding slot 20 would drive both recomputes to 20.
  const goalId = 'drifted'
  const lessons: Record<string, unknown>[] = []
  const slotFor = (n: number) => (n === 5 ? 20 : n >= 6 && n <= 20 ? n - 1 : n)
  for (let n = 1; n <= 30; n++) {
    lessons.push({
      id: `L${n}`, curriculum_goal_id: goalId, lesson_number: n, queue_position: slotFor(n),
      completed: n <= 4, completed_at: n <= 4 ? `${ymd(daysAgo(30 - n))}T15:00:00Z` : null,
      scheduled_date: null, date: null, scheduled_source: 'wizard_create',
      is_backfill: false, queue_pinned: n === 5, skipped: false,
    })
  }
  const { client, tables } = makeMemorySupabase({
    curriculum_goals: [{
      id: goalId, total_lessons: 30, lessons_per_day: 1, school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      start_date: ymd(daysAgo(40)), lessons_per_day_overrides: null, created_at: '2026-08-01T00:00:00Z',
      current_lesson: 4, start_at_lesson: 1,
    }],
    lessons,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 12, vacationBlocks: [] })

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
