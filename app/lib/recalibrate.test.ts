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

import { recalibrateCurriculumGoal } from './recalibrate.ts'

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

type GapLessonRow = { id: string; lesson_number: number }

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
        if (projection === 'id, lesson_number') {
          data = opts.gapLessons
        } else if (
          projection === 'id, scheduled_date, completed, is_backfill, lesson_number'
        ) {
          data = opts.forwardIncompleteRows ?? []
        } else {
          throw new Error(`unexpected lessons thenable for projection: ${projection}`)
        }
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
      },
      update: (payload: Record<string, unknown>) => ({
        in: async (_col: string, ids: string[]) => {
          writes.push({ table: 'lessons', payload, ids: [...ids] })
          return { error: null }
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

test('recalibrateCurriculumGoal: every distribution write stamps scheduled_source = recalibrate_estimate + queue_position = null', async () => {
  // Invariant 10 + the "estimate" flag: the lesson card surfaces the
  // hint by reading scheduled_source, and the queue projector ignores
  // these rows by nulling queue_position. Both must be set on every
  // write, regardless of how the lessons cluster onto dates.
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
    assert.equal(p.queue_position, null)
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
