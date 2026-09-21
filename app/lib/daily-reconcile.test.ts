// The once-a-day reconciliation, against a controlled clock.
//
// With the page-load reconciler off, nothing re-dated stored lessons when a
// school day simply passed, so Plan (stored dates) drifted from Today (the
// projector): a curriculum one day behind had every unfinished lesson a day
// early in Plan, and the error compounded daily. These tests drive the real
// browser side (reconcileForDay and the per-tab runner) against an in-memory
// database and a model of apply_daily_reconcile that makes the same decisions
// as the SQL (supabase/tests/daily-reconcile rehearses the SQL itself on a real
// Postgres).
//
// Covered: missed days, ahead of schedule, weekends, day rollover in an open
// tab, concurrent tabs, a parent acting between calculation and write,
// interrupted writes and lost responses, and switching the job off while a tab
// stays open.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'

import {
  computeNextLessonsForGoal,
  recomputeCurrentLesson,
  type CurriculumGoalConfig,
  type VacationBlock,
} from './scheduler.ts'
import { reconcileForDay, createDailyReconcileRunner, type DailyReconcileRun } from './daily-reconcile.ts'
import { makeMemorySupabase } from './test-helpers/memory-supabase.ts'

const USER = 'u1'
const GOAL = 'g1'
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

type Row = Record<string, unknown>

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** 2026-09-21 is a Monday. `at(n)` is n days later, 8am local. */
function at(n: number, hour = 8): Date {
  return new Date(2026, 8, 21 + n, hour, 0, 0, 0)
}
const MON = 0, TUE = 1, WED = 2, FRI = 4, SAT = 5, NEXT_MON = 7

/** A Mon-Fri, one-a-day curriculum of 20 lessons; 1-2 done the week before,
 *  3-20 stored exactly where Today projected them on Monday morning. */
function seed(opts: { vac?: VacationBlock[]; pin?: { n: number; day: number }; skip?: number } = {}) {
  const goalRow: Row = {
    id: GOAL, user_id: USER, total_lessons: 20, current_lesson: 2, lessons_per_day: 1,
    lessons_per_day_overrides: null, school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: '2026-09-14', archived: false,
  }
  const proj = new Map(
    computeNextLessonsForGoal(goalRow as unknown as CurriculumGoalConfig, at(MON), 3650, opts.vac ?? [], 0, [])
      .map((p) => [p.lesson_number, p.date]),
  )
  const lessons: Row[] = []
  for (let n = 1; n <= 20; n++) {
    const done = n <= 2
    const day = done ? ymd(at(-7 + n)) : (proj.get(n) as string)
    lessons.push({
      id: `L${n}`, user_id: USER, curriculum_goal_id: GOAL, lesson_number: n, queue_position: n,
      completed: done, completed_at: done ? at(-7 + n, 12).toISOString() : null,
      scheduled_date: day, date: day, scheduled_source: done ? 'completion_today' : 'schedule_builder',
      is_backfill: false, queue_pinned: false, skipped: false,
    })
  }
  if (opts.pin) {
    const day = ymd(at(opts.pin.day))
    Object.assign(lessons.find((r) => r.lesson_number === opts.pin!.n)!, {
      queue_pinned: true, scheduled_date: day, date: day, scheduled_source: 'plan_move',
    })
  }
  if (opts.skip) {
    Object.assign(lessons.find((r) => r.lesson_number === opts.skip)!, {
      skipped: true, scheduled_date: null, date: null, scheduled_source: 'skip',
    })
  }
  return { curriculum_goals: [goalRow], lessons, vacation_blocks: (opts.vac ?? []).map((v) => ({ user_id: USER, ...v })) }
}

/**
 * A model of public.apply_daily_reconcile: the same checks in the same order,
 * all-or-nothing, and an audit trail standing in for lessons_audit_date_change.
 */
function makeServer(tables: Record<string, Row[]>) {
  const state = {
    enabled: true,
    log: new Map<string, number>(), // `${goal}|${day}` -> rows_written
    audit: [] as Array<{ id: string; from: unknown; to: string; source: string }>,
    calls: 0,
    /** Runs inside the call, before any check: a parent acting "at the same time". */
    beforeNext: null as null | (() => void | Promise<void>),
    /** Fail the next call part-way: nothing commits. */
    failNext: false,
    /** Commit the next call, then lose the response on the way back. */
    loseNextResponse: false,
  }
  async function apply(args: { p_goal_id: string; p_local_day: string; p_expected: Row; p_writes: Array<{ id: string; from: string | null; to: string }> }) {
    state.calls++
    if (state.beforeNext) { const f = state.beforeNext; state.beforeNext = null; await f() }
    if (!state.enabled) return { status: 'disabled' }
    const goal = tables.curriculum_goals.find((g) => g.id === args.p_goal_id && g.user_id === USER)
    if (!goal) return { status: 'invalid', reason: 'not_owner' }
    const key = `${args.p_goal_id}|${args.p_local_day}`
    if (state.log.has(key)) return { status: 'already' }
    const e = args.p_expected
    const have = {
      total_lessons: goal.total_lessons, current_lesson: goal.current_lesson, lessons_per_day: goal.lessons_per_day,
      lessons_per_day_overrides: goal.lessons_per_day_overrides ?? null, school_days: goal.school_days ?? null,
      start_date: goal.start_date ?? null,
    }
    if (!isDeepStrictEqual(have, e.goal)) return { status: 'stale', reason: 'goal' }
    const vac = tables.vacation_blocks.filter((v) => v.user_id === USER)
      .map((v) => [v.start_date, v.end_date]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])))
    if (!isDeepStrictEqual(vac, e.vacations)) return { status: 'stale', reason: 'breaks' }
    const mine = tables.lessons.filter((l) => l.curriculum_goal_id === args.p_goal_id)
    const pins = mine.filter((l) => !l.completed && l.queue_pinned && !l.skipped && l.queue_position != null && l.scheduled_date != null)
      .map((l) => [l.queue_position, l.scheduled_date]).sort((a, b) => (a[0] as number) - (b[0] as number))
    if (!isDeepStrictEqual(pins, e.pins)) return { status: 'stale', reason: 'pins' }
    const skips = mine.filter((l) => !l.completed && l.skipped && l.queue_position != null)
      .map((l) => l.queue_position as number).sort((a, b) => a - b)
    if (!isDeepStrictEqual(skips, e.skipped)) return { status: 'stale', reason: 'skips' }
    const done = mine.filter((l) => l.completed && (l.completed_at as string) >= (e.day_start as string) && (l.completed_at as string) < (e.day_end as string)).length
    if (done !== e.done_today) return { status: 'stale', reason: 'done_today' }
    for (const w of args.p_writes) {
      const l = mine.find((r) => r.id === w.id)
      if (!l || l.completed || l.queue_pinned || l.skipped || l.is_backfill) return { status: 'stale', reason: 'rows' }
      if ((l.scheduled_date ?? null) !== w.from || w.to < args.p_local_day) return { status: 'stale', reason: 'rows' }
    }
    if (state.failNext) { state.failNext = false; throw new Error('connection reset mid-write') }
    for (const w of args.p_writes) {
      const l = mine.find((r) => r.id === w.id)!
      state.audit.push({ id: w.id, from: l.scheduled_date, to: w.to, source: 'daily_reconcile' })
      Object.assign(l, { scheduled_date: w.to, date: w.to, scheduled_source: 'daily_reconcile' })
    }
    state.log.set(key, args.p_writes.length)
    if (state.loseNextResponse) { state.loseNextResponse = false; throw new Error('response lost') }
    return { status: 'applied', written: args.p_writes.length }
  }
  return { state, apply }
}

/** A browser tab: its own client object over the SAME database and server. */
function tab(db: ReturnType<typeof makeMemorySupabase>, server: ReturnType<typeof makeServer>) {
  const client = db.client as unknown as Record<string, unknown>
  return {
    ...client,
    from: db.client.from,
    rpc: async (name: string, args: never) => {
      assert.equal(name, 'apply_daily_reconcile')
      try {
        return { data: await server.apply(args), error: null }
      } catch (err) {
        return { data: null, error: { message: (err as Error).message } }
      }
    },
  }
}

function world(opts: Parameters<typeof seed>[0] = {}) {
  const db = makeMemorySupabase(seed(opts))
  const server = makeServer(db.tables)
  return { db, server, tables: db.tables, client: tab(db, server) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (client: unknown, now: Date) => reconcileForDay(client as any, USER, { timezone: TZ, now })

/** What Today shows at `now`: the shared projector with pins, skips and
 *  lessons completed today counted. */
function todayView(tables: Record<string, Row[]>, now: Date, vac: VacationBlock[] = []) {
  const g = tables.curriculum_goals[0] as unknown as CurriculumGoalConfig
  const rows = tables.lessons
  const doneToday = rows.filter((r) => r.completed && ymd(new Date(r.completed_at as string)) === ymd(now)).length
  const holds = rows.filter((r) => !r.completed && (r.queue_pinned || r.skipped))
    .map((r) => (r.skipped ? { slot: r.queue_position as number, skipped: true as const } : { slot: r.queue_position as number, date: r.scheduled_date as string }))
  return new Map(computeNextLessonsForGoal(g, now, 3650, vac, doneToday, holds as never).map((p) => [p.lesson_number, p.date]))
}
function disagreements(tables: Record<string, Row[]>, now: Date, vac: VacationBlock[] = []) {
  const view = todayView(tables, now, vac)
  return tables.lessons
    .filter((r) => !r.completed && !r.skipped && !r.queue_pinned)
    .filter((r) => view.get(r.queue_position as number) !== r.scheduled_date)
    .map((r) => `L${r.lesson_number} plan ${r.scheduled_date} today ${view.get(r.queue_position as number)}`)
}
async function complete(client: unknown, tables: Record<string, Row[]>, n: number, when: Date) {
  Object.assign(tables.lessons.find((r) => r.lesson_number === n)!, {
    completed: true, completed_at: when.toISOString(), scheduled_date: ymd(when), date: ymd(when), scheduled_source: 'completion_today',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await recomputeCurrentLesson(client as any, GOAL)
}
const history = (tables: Record<string, Row[]>) =>
  JSON.stringify(tables.lessons.filter((r) => r.completed).map((r) => [r.id, r.scheduled_date, r.completed_at]))

test('on plan: nothing differs, so no call is made and nothing is written', async () => {
  const w = world()
  await complete(w.client, w.tables, 3, at(MON, 10))
  const r = await run(w.client, at(TUE))
  assert.deepEqual(r.results.map((x) => x.status), ['nothing'])
  assert.equal(w.server.state.calls, 0)
  assert.deepEqual(disagreements(w.tables, at(TUE)), [])
})

test('missed days: behind one day, then two, every unfinished lesson follows Today', async () => {
  const w = world()
  // Nothing done Monday. Tuesday morning Plan is a day early for all 18.
  assert.equal(disagreements(w.tables, at(TUE)).length, 18)
  const tue = await run(w.client, at(TUE))
  assert.equal(tue.results[0].status, 'applied')
  assert.equal(tue.written, 18)
  assert.deepEqual(disagreements(w.tables, at(TUE)), [])
  assert.equal(w.tables.lessons.find((r) => r.id === 'L3')!.scheduled_date, ymd(at(TUE)))
  // Nothing Tuesday either. Wednesday it no longer compounds.
  const wed = await run(w.client, at(WED))
  assert.equal(wed.results[0].status, 'applied')
  assert.deepEqual(disagreements(w.tables, at(WED)), [])
  assert.equal(w.tables.lessons.find((r) => r.id === 'L3')!.scheduled_date, ymd(at(WED)))
  // Every move is audited under its own source, and never into the past.
  assert.ok(w.server.state.audit.every((a) => a.source === 'daily_reconcile'))
  assert.equal(w.server.state.log.get(`${GOAL}|${ymd(at(TUE))}`), 18)
})

test('ahead of schedule: two done Monday, Tuesday lines up (completed history untouched)', async () => {
  const w = world()
  await complete(w.client, w.tables, 3, at(MON, 10))
  await complete(w.client, w.tables, 4, at(MON, 11))
  const before = history(w.tables)
  assert.ok(disagreements(w.tables, at(TUE)).length > 0)
  const r = await run(w.client, at(TUE))
  assert.equal(r.results[0].status, 'applied')
  assert.deepEqual(disagreements(w.tables, at(TUE)), [])
  assert.equal(w.tables.lessons.find((x) => x.id === 'L5')!.scheduled_date, ymd(at(TUE)))
  assert.equal(history(w.tables), before)
})

test('weekend: Friday missed, a Saturday or Monday run puts it on Monday, not the weekend', async () => {
  const w = world()
  // Keep up Monday to Thursday, miss Friday.
  for (const [n, d] of [[3, MON], [4, TUE], [5, WED], [6, 3]] as const) await complete(w.client, w.tables, n, at(d, 10))
  const sat = await run(w.client, at(SAT))
  assert.equal(sat.results[0].status, 'applied')
  assert.equal(w.tables.lessons.find((x) => x.id === 'L7')!.scheduled_date, ymd(at(NEXT_MON)))
  assert.deepEqual(disagreements(w.tables, at(NEXT_MON)), [])
  const mon = await run(w.client, at(NEXT_MON))
  assert.deepEqual(mon.results.map((x) => x.status), ['nothing'])
  assert.ok(!w.tables.lessons.some((r) => !r.completed && [0, 6].includes(new Date(`${r.scheduled_date}T12:00:00`).getDay())))
})

test('pins, skips and breaks hold; only unfinished, unpinned, unskipped rows move', async () => {
  const vac = [{ start_date: ymd(at(WED)), end_date: ymd(at(FRI)) }]
  const w = world({ vac, pin: { n: 10, day: 14 }, skip: 6 })
  const pinned = { ...w.tables.lessons.find((r) => r.id === 'L10')! }
  const skipped = { ...w.tables.lessons.find((r) => r.id === 'L6')! }
  const r = await run(w.client, at(TUE))
  assert.equal(r.results[0].status, 'applied')
  assert.deepEqual(w.tables.lessons.find((x) => x.id === 'L10'), pinned)
  assert.deepEqual(w.tables.lessons.find((x) => x.id === 'L6'), skipped)
  assert.deepEqual(disagreements(w.tables, at(TUE), vac), [])
  for (const a of w.server.state.audit) {
    const d = new Date(`${a.to}T12:00:00`)
    assert.ok(d < at(WED) || d > at(FRI, 20), `${a.id} moved into the break (${a.to})`)
  }
})

test('open tab across midnight: the runner reconciles on its first trigger of the new day', async () => {
  const w = world()
  let clock = at(MON, 21)
  const redated: DailyReconcileRun[] = []
  const runner = createDailyReconcileRunner({
    run: (now) => run(w.client, now), now: () => clock, dayOf: ymd, onRedated: (x) => redated.push(x),
  })
  assert.equal((await runner.trigger())!.results[0].status, 'nothing') // Monday: in step
  assert.equal(await runner.trigger(), null) // same day: settled, no work
  clock = at(TUE, 0) // midnight passes with the tab still open
  clock = new Date(clock.getTime() + 60_000)
  const tue = await runner.trigger()
  assert.equal(tue!.results[0].status, 'applied')
  assert.equal(redated.length, 1, 'the page is told to reload')
  assert.equal(runner.settledDay, ymd(at(TUE)))
  assert.deepEqual(disagreements(w.tables, clock), [])
})

test('concurrent tabs and devices: one writes, the other gets already, the day is logged once', async () => {
  const w = world()
  const phone = tab(w.db, w.server)
  // Both tabs compute from the same stale state before either reaches the server.
  const [a, b] = await Promise.all([run(w.client, at(TUE)), run(phone, at(TUE, 9))])
  const statuses = [a.results[0].status, b.results[0].status].sort()
  assert.deepEqual(statuses, ['already', 'applied'])
  assert.equal(w.server.state.audit.length, 18, 'each row moved once')
  assert.equal(w.server.state.log.size, 1)
  assert.deepEqual(disagreements(w.tables, at(TUE)), [])
})

test('a parent pin between calculation and write: stale, recomputed, the pin wins', async () => {
  const w = world()
  const pinDay = ymd(at(14))
  w.server.state.beforeNext = () => {
    Object.assign(w.tables.lessons.find((r) => r.id === 'L8')!, {
      queue_pinned: true, scheduled_date: pinDay, date: pinDay, scheduled_source: 'plan_move',
    })
  }
  const r = await run(w.client, at(TUE))
  assert.equal(r.results[0].status, 'applied')
  assert.equal(w.server.state.calls, 2, 'first call refused as stale, second from fresh state')
  assert.equal(w.tables.lessons.find((x) => x.id === 'L8')!.scheduled_date, pinDay)
  assert.ok(!w.server.state.audit.some((a) => a.id === 'L8'))
  assert.deepEqual(disagreements(w.tables, at(TUE)), [])
})

test('a parent completion between calculation and write: stale, recomputed around it', async () => {
  const w = world()
  w.server.state.beforeNext = () => complete(w.client, w.tables, 3, at(TUE, 8))
  const r = await run(w.client, at(TUE, 8))
  assert.equal(r.results[0].status, 'applied')
  assert.equal(w.server.state.calls, 2)
  assert.deepEqual(disagreements(w.tables, at(TUE, 9)), [])
  assert.equal(w.tables.lessons.find((x) => x.id === 'L3')!.completed, true)
})

test('a parent moving a lesson twice while it computes: stale twice, left for later, not marked', async () => {
  const w = world()
  let n = 0
  const move = () => {
    const d = ymd(at(20 + n++))
    Object.assign(w.tables.lessons.find((r) => r.id === 'L9')!, { queue_pinned: true, scheduled_date: d, date: d })
    w.server.state.beforeNext = n < 2 ? move : null
  }
  w.server.state.beforeNext = move
  const r = await run(w.client, at(TUE))
  assert.equal(r.results[0].status, 'stale')
  assert.equal(r.retry, true)
  assert.equal(w.server.state.log.size, 0)
  assert.equal(w.server.state.audit.length, 0)
})

test('interrupted write: nothing commits, the day is not marked, the next trigger retries', async () => {
  const w = world()
  w.server.state.failNext = true
  let clock = at(TUE)
  const failures: unknown[] = []
  let note: string | null = null
  const runner = createDailyReconcileRunner({
    run: (now) => run(w.client, now), now: () => clock, dayOf: ymd, retryAfterMs: 5 * 60_000,
    onFailure: (x) => { failures.push(x); note = 'failed' },
    onSettled: () => { note = null },
  })
  const first = await runner.trigger()
  assert.equal(first!.results[0].status, 'error')
  assert.equal(w.server.state.audit.length, 0)
  assert.equal(w.server.state.log.size, 0)
  assert.equal(runner.settledDay, null)
  assert.equal(failures.length, 1)
  assert.equal(note, 'failed', 'the family is told, and it stays up')
  clock = new Date(clock.getTime() + 60_000)
  assert.equal(await runner.trigger(), null, 'backs off instead of hammering')
  clock = new Date(clock.getTime() + 5 * 60_000)
  const retry = await runner.trigger()
  assert.equal(retry!.results[0].status, 'applied')
  assert.equal(runner.settledDay, ymd(at(TUE)))
  assert.equal(failures.length, 1, 'one notice per day')
  assert.equal(note, null, 'the note clears once a later run settles')
  assert.deepEqual(disagreements(w.tables, clock), [])
})

test('response lost after commit: the retry writes nothing twice', async () => {
  const w = world()
  w.server.state.loseNextResponse = true
  const first = await run(w.client, at(TUE))
  assert.equal(first.results[0].status, 'error')
  assert.equal(w.server.state.audit.length, 18)
  const again = await run(w.client, at(TUE, 9))
  assert.ok(['nothing', 'already'].includes(again.results[0].status))
  assert.equal(w.server.state.audit.length, 18)
})

test('switched off while a tab stays open: the next call writes nothing', async () => {
  const w = world()
  let clock = at(MON, 20)
  const runner = createDailyReconcileRunner({ run: (now) => run(w.client, now), now: () => clock, dayOf: ymd })
  await runner.trigger()
  w.server.state.enabled = false // turned off on the server; the tab keeps its old build
  clock = at(TUE, 7)
  const r = await runner.trigger()
  assert.equal(r!.disabled, true)
  assert.equal(r!.results[0].status, 'disabled')
  assert.equal(w.server.state.audit.length, 0)
  assert.equal(w.tables.lessons.find((x) => x.id === 'L3')!.scheduled_date, ymd(at(MON)))
  assert.equal(disagreements(w.tables, clock).length, 18, 'left exactly as it was')
})

test('the runner never overlaps itself within a tab', async () => {
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const runner = createDailyReconcileRunner({
    run: async (now) => { calls++; await gate; return { day: ymd(now), results: [], written: 0, disabled: false, retry: false } },
    now: () => at(TUE), dayOf: ymd,
  })
  const a = runner.trigger()
  const b = runner.trigger()
  release()
  await Promise.all([a, b])
  assert.equal(calls, 1)
})
