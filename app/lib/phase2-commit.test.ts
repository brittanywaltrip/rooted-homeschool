// Regression tests for the Schedule Builder phase 2 rebuild after Sentry
// ROOTED-HOMESCHOOL-1Q (2026-09-21), and for Invariant 23 (a lesson reopened
// behind the pointer is a make-up). Synthetic data only.
//
//   node --test app/lib/phase2-commit.test.ts
//
// `resave` mirrors applyPhase2ForGoal in app/dashboard/plan/schedule/page.tsx
// step for step, using the same exported planners it calls; the page's own
// wiring is pinned by the source-shape tests in scheduler.test.ts.

import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

import {
  computeNextLessonsForGoal,
  isPhase2NoOp,
  planPhase2LessonInserts,
  planPhase2Rows,
  pinsFromRows,
  toDateStr,
  type Phase2PlanRow,
} from './scheduler.ts'
import {
  applyPhase2Commit,
  holdsParentWork,
  countDoneToday,
  phase2Expected,
  planPhase2Commit,
  simulatePhase2End,
  validatePhase2End,
  type Phase2CommitPlan,
  type Phase2CommitRow,
} from './phase2-commit.ts'
import { planReopenMakeUp } from './reopen-lesson.ts'

const GOAL = 'goal-synthetic'
const TODAY = new Date(2026, 8, 21) // Monday
const TODAY_YMD = toDateStr(TODAY)
const TOMORROW_YMD = '2026-09-22'
const SCHOOL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const TOTAL = 60
const START_AT = 16 // "we are on lesson 16": 1..15 are history
const START_DATE = '2026-09-01' // 15 school days through TODAY inclusive

type Row = Phase2PlanRow & Phase2CommitRow

function schoolDaysFrom(startYmd: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(`${startYmd}T00:00:00`)
  while (out.length < n) {
    const dow = d.getDay()
    if (dow >= 1 && dow <= 5) out.push(toDateStr(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** The rows after the curriculum's first save: history through today, forward from tomorrow. */
function created(): Row[] {
  const history = schoolDaysFrom(START_DATE, START_AT - 1)
  assert.equal(history[history.length - 1], TODAY_YMD, 'fixture: the last history lesson lands on today')
  const forward = schoolDaysFrom(TOMORROW_YMD, TOTAL - (START_AT - 1))
  const rows: Row[] = []
  for (let n = 1; n < START_AT; n++) {
    rows.push({
      id: `h${String(n).padStart(3, '0')}`, lesson_number: n, queue_position: n, completed: true,
      completed_at: `${history[n - 1]}T12:00:00Z`, queue_pinned: false, skipped: false,
      scheduled_date: history[n - 1], date: history[n - 1], notes: null, minutes_spent: 30, title: `L${n}`,
    })
  }
  for (let n = START_AT; n <= TOTAL; n++) {
    const d = forward[n - START_AT]
    rows.push({
      id: `f${String(n).padStart(3, '0')}`, lesson_number: n, queue_position: n, completed: false,
      completed_at: null, queue_pinned: false, skipped: false, scheduled_date: d, date: d,
      notes: null, minutes_spent: null, title: `L${n}`,
    })
  }
  return rows
}

/** recomputeCurrentLesson's formula. */
function pointer(rows: readonly Row[]): number {
  const maxDone = rows.reduce((m, r) => (r.completed && r.queue_position != null ? Math.max(m, r.queue_position) : m), 0)
  return Math.min(TOTAL, Math.max(START_AT - 1, maxDone))
}

/** Today's and Plan's un-complete write, then the pointer, then Invariant 23. */
function untick(rows: Row[], id: string, opts: { reopen: boolean } = { reopen: true }): Row[] {
  let out = rows.map((r) =>
    r.id === id ? { ...r, completed: false, completed_at: null, queue_pinned: false } : r,
  )
  if (!opts.reopen) return out
  const current = pointer(out)
  const row = out.find((r) => r.id === id)!
  const decision = planReopenMakeUp({ row, currentLesson: current, todayYmd: TODAY_YMD })
  if (decision) {
    out = out.map((r) =>
      r.id === id ? { ...r, queue_pinned: true, scheduled_date: decision.date, date: decision.date } : r,
    )
  }
  return out
}

const perDayAllowed = () => 1
const DAY_START = new Date(2026, 8, 21).toISOString()
const DAY_END = new Date(2026, 8, 22).toISOString()

/** One goal through phase 2, as applyPhase2ForGoal plans it. */
function resave(beforeRows: Row[], opts: { legacyProjection?: boolean } = {}) {
  const currentLesson = pointer(beforeRows)
  const rowsPlan = planPhase2Rows({
    beforeRows, goalId: GOAL, clearPins: false, currentLesson, totalLessons: TOTAL,
    todayYmd: opts.legacyProjection ? undefined : TODAY_YMD,
  })
  const doneToday = countDoneToday(beforeRows, DAY_START, DAY_END)
  const goal = {
    id: GOAL, school_days: SCHOOL_DAYS, lessons_per_day: 1, lessons_per_day_overrides: null,
    current_lesson: currentLesson, total_lessons: TOTAL, start_date: START_DATE,
  }
  // An existing goal is anchored at today.
  const upcoming = computeNextLessonsForGoal(
    goal, TODAY, 3650, [], opts.legacyProjection ? 0 : doneToday, rowsPlan.holds,
  )
  const existingNums = new Set<number>()
  const existingSlots = new Set<number>()
  for (const r of rowsPlan.survivors) {
    if (r.queue_position != null) existingSlots.add(r.queue_position)
    if (r.lesson_number != null) existingNums.add(r.lesson_number)
  }
  const planned = planPhase2LessonInserts({
    upcoming, existingLessonNumbers: existingNums, existingQueuePositions: existingSlots,
    skippedSlots: rowsPlan.projectableSkippedSlots,
  })
  const toInsert = planned.map((p) => ({
    child_id: 'child', lesson_number: p.lesson_number, queue_position: p.queue_position,
    title: `L${p.lesson_number}`, scheduled_date: p.date, date: p.date,
    scheduled_source: 'wizard_create' as const, completed: false, hours: 0,
  }))
  const projDateBySlot = new Map<number, string>()
  for (const u of upcoming) if (!projDateBySlot.has(u.lesson_number)) projDateBySlot.set(u.lesson_number, u.date)
  const commit = planPhase2Commit({
    beforeRows,
    survivors: rowsPlan.survivors,
    deletedIds: rowsPlan.deletedIds,
    releasedIds: new Set(),
    makeUpIds: rowsPlan.makeUpIds,
    behindIds: rowsPlan.behindIds,
    projDateBySlot,
    inserts: toInsert.map(({ date: _d, ...r }) => r),
    totalLessons: TOTAL,
    todayYmd: TODAY_YMD,
    doneToday,
    currentLesson,
    perDayAllowed,
  })
  const verdict = isPhase2NoOp({
    beforeRows, deletedIds: rowsPlan.deletedIds, workRowIds: rowsPlan.workRowIds, toInsert,
    histToInsertCount: 0, projDateBySlot, releasesPins: false, totalLessons: TOTAL,
    todayYmd: TODAY_YMD, perDayAllowed,
  })
  const noop = verdict.noop && rowsPlan.makeUpIds.size === 0 && !commit.redates.some((t) => t.to !== t.from)
  return { currentLesson, rowsPlan, upcoming, doneToday, noop, ...commit }
}

/** The rows the database holds after a plan commits (inserts get fresh ids). */
function committed(beforeRows: Row[], plan: Phase2CommitPlan, save: number): Row[] {
  const before = new Map(beforeRows.map((r) => [r.id, r]))
  return simulatePhase2End(beforeRows, plan).map((e) => {
    const b = before.get(e.id)
    return {
      id: e.inserted ? `s${save}-${String(e.lesson_number).padStart(3, '0')}` : e.id,
      lesson_number: e.lesson_number, queue_position: e.queue_position, completed: e.completed,
      completed_at: b?.completed_at ?? null, queue_pinned: e.queue_pinned, skipped: e.skipped,
      scheduled_date: e.scheduled_date, date: e.scheduled_date, notes: e.notes, minutes_spent: e.minutes_spent,
      title: b?.title ?? `L${e.lesson_number}`,
    }
  })
}

function onDay(rows: readonly Row[], ymd: string) {
  return rows.filter((r) => !r.completed && !r.skipped && r.scheduled_date === ymd).map((r) => r.lesson_number)
}

// ── 1Q, exactly as it happened: unticked on Today before make-ups existed ──

test('1Q: the old projection is refused BEFORE any write, on the complete result', () => {
  const rows = untick(created(), 'h015', { reopen: false })
  const r = resave(rows, { legacyProjection: true })
  // The fresh lesson lands on today, on top of the kept row...
  assert.equal(r.plan.inserts.find((i) => !i.completed)?.scheduled_date, TODAY_YMD)
  // ...and validation of the whole result catches it, where the old pre-write
  // check (inserts only) passed and the post-write check threw after commit.
  assert.deepEqual(r.validation.overCapacity, [{ date: TODAY_YMD, placed: 1, room: 0 }])
})

test('1Q: a row unticked before this fix becomes a make-up and the next lesson waits for tomorrow', () => {
  const rows = untick(created(), 'h015', { reopen: false })
  const r = resave(rows)
  assert.deepEqual(r.validation.overCapacity, [])
  assert.deepEqual(r.validation.integrity, [])
  assert.deepEqual(r.plan.makeup_ids, ['h015'], 'pinned where it is, so every surface sees it')
  assert.ok(!r.plan.delete_ids.includes('h015'), 'never deleted')
  assert.ok(!r.plan.redates.some((t) => t.id === 'h015'), 'never re-dated')
  const first = r.plan.inserts.filter((i) => !i.completed).sort((a, b) => a.lesson_number - b.lesson_number)[0]
  assert.deepEqual([first.lesson_number, first.scheduled_date], [16, TOMORROW_YMD])
  const after = committed(rows, r.plan, 1)
  assert.deepEqual(onDay(after, TODAY_YMD), [15], 'today holds the reopened lesson alone')
  const kept = after.find((r) => r.id === 'h015')!
  assert.equal(kept.completed, false, 'it is not counted as completed work')
  assert.equal(kept.minutes_spent, 30, 'its minutes are kept')
})

// ── Invariant 23: unticking a pre-tracking lesson now ─────────────────────

test('unticking a pre-tracking lesson makes it a make-up on its day, and Today shows it', () => {
  const rows = untick(created(), 'h015')
  const row = rows.find((r) => r.id === 'h015')!
  assert.equal(row.queue_pinned, true)
  assert.equal(row.scheduled_date, TODAY_YMD)
  // Today projects one day from the pointer, with the loaded pins.
  const goal = {
    id: GOAL, school_days: SCHOOL_DAYS, lessons_per_day: 1, lessons_per_day_overrides: null,
    current_lesson: pointer(rows), total_lessons: TOTAL, start_date: START_DATE,
  }
  const todaySlots = computeNextLessonsForGoal(goal, TODAY, 1, [], 0, pinsFromRows(rows, undefined))
  assert.deepEqual(todaySlots.map((p) => p.lesson_number), [15], "Today's list is the make-up, not lesson 16")
})

test('unticking an EARLIER pre-tracking lesson brings it forward to today', () => {
  const rows = untick(created(), 'h005')
  const row = rows.find((r) => r.id === 'h005')!
  assert.equal(pointer(rows), 15, 'the pointer cannot follow it back')
  assert.deepEqual([row.queue_pinned, row.scheduled_date], [true, TODAY_YMD], 'due today, not stranded on Sep 7')
  const r = resave(rows)
  assert.deepEqual(r.validation.overCapacity, [])
  const after = committed(rows, r.plan, 1)
  assert.deepEqual(onDay(after, TODAY_YMD), [5])
  assert.deepEqual(onDay(after, TOMORROW_YMD), [16])
})

test('a lesson unticked inside the live queue is simply next again, not a make-up', () => {
  // Lessons 16 and 17 done, then 17 unticked: the pointer falls back to 16.
  let rows = created().map((r) =>
    r.lesson_number === 16 || r.lesson_number === 17 ? { ...r, completed: true, completed_at: '2026-09-18T15:00:00Z' } : r,
  )
  rows = untick(rows, 'f017')
  const row = rows.find((r) => r.id === 'f017')!
  assert.equal(row.queue_pinned, false)
  assert.equal(pointer(rows), 16)
})

test('notes and minutes on a reopened lesson survive every save', () => {
  let rows = untick(created(), 'h010').map((r) => (r.id === 'h010' ? { ...r, notes: 'redo the worksheet' } : r))
  for (let save = 1; save <= 3; save++) {
    const r = resave(rows)
    assert.deepEqual(r.validation.overCapacity, [])
    rows = committed(rows, r.plan, save)
    const kept = rows.find((x) => x.id === 'h010')!
    assert.deepEqual([kept.notes, kept.minutes_spent, kept.completed], ['redo the worksheet', 30, false])
  }
})

// ── Repeated saves ─────────────────────────────────────────────────────────

test('repeated saves: the second save of an unchanged goal writes nothing', () => {
  const rows0 = untick(created(), 'h015', { reopen: false })
  const first = resave(rows0)
  assert.equal(first.noop, false)
  const rows1 = committed(rows0, first.plan, 1)
  const second = resave(rows1)
  assert.equal(second.noop, true, 'idempotent: nothing moves on the next save')
  assert.deepEqual(second.validation.overCapacity, [])
  const rows2 = committed(rows1, second.plan, 2)
  assert.deepEqual(
    rows2.filter((r) => !r.completed).map((r) => [r.lesson_number, r.scheduled_date]).sort(),
    rows1.filter((r) => !r.completed).map((r) => [r.lesson_number, r.scheduled_date]).sort(),
  )
})

test('repeated saves: every lesson keeps exactly one row and one slot', () => {
  let rows = untick(created(), 'h015')
  for (let save = 1; save <= 4; save++) {
    const r = resave(rows)
    assert.deepEqual(r.validation.integrity, [])
    rows = committed(rows, r.plan, save)
  }
  const nums = rows.map((r) => r.lesson_number).sort((a, b) => a! - b!)
  assert.deepEqual(nums, Array.from({ length: TOTAL }, (_, i) => i + 1))
})

// ── Completed work counts against the day's pace ──────────────────────────

test('completed today: a re-save does not date a second lesson on a day already done', () => {
  // The control case of 1Q: nothing unticked. History's last lesson is done
  // today, so the next lesson belongs to tomorrow. The old builder passed 0 for
  // completed-today and put lesson 16 on today beside it.
  const rows = created()
  const r = resave(rows)
  assert.equal(r.doneToday, 1)
  const first = r.plan.inserts.filter((i) => !i.completed).sort((a, b) => a.lesson_number - b.lesson_number)[0]
  assert.deepEqual([first.lesson_number, first.scheduled_date], [16, TOMORROW_YMD])
  assert.deepEqual(r.validation.overCapacity, [])
})

test('completed today counts in validation: a plan placing a lesson on a full day is refused', () => {
  const rows = created()
  const r = resave(rows, { legacyProjection: true })
  assert.equal(r.plan.inserts.find((i) => !i.completed)?.scheduled_date, TODAY_YMD)
  const v = validatePhase2End({
    beforeRows: rows, plan: r.plan, endRows: simulatePhase2End(rows, r.plan),
    todayYmd: TODAY_YMD, doneToday: 1, currentLesson: 15, perDayAllowed,
  })
  assert.deepEqual(v.overCapacity, [{ date: TODAY_YMD, placed: 1, room: 0 }])
})

// ── Manual pins stay where the family put them ─────────────────────────────

test('manual pins: a family may stack its own lessons; that is a warning, never a refusal', () => {
  // 1J's shape: two lessons moved by hand onto the same day.
  const rows = created().map((r) =>
    r.lesson_number === 20 || r.lesson_number === 21 ? { ...r, queue_pinned: true, scheduled_date: '2026-09-28', date: '2026-09-28' } : r,
  )
  const r = resave(rows)
  assert.deepEqual(r.validation.overCapacity, [], 'the pins are not the scheduler\'s to refuse')
  assert.deepEqual(r.validation.pinStacks, [{ date: '2026-09-28', pinned: 2, allowed: 1 }])
  const after = committed(rows, r.plan, 1)
  assert.deepEqual(onDay(after, '2026-09-28').sort(), [20, 21], 'no scheduler-placed lesson joins them')
  assert.equal(after.find((x) => x.lesson_number === 20)?.scheduled_date, '2026-09-28', 'a pin is never re-dated')
})

// ── The plan never does what only a person may do ─────────────────────────

test('integrity: a plan that would delete the family\'s notes is refused before any write', () => {
  const rows = created().map((r) => (r.lesson_number === 30 ? { ...r, notes: 'ours' } : r))
  const r = resave(rows)
  const bad: Phase2CommitPlan = { ...r.plan, delete_ids: [...r.plan.delete_ids, 'f030'] }
  const v = validatePhase2End({
    beforeRows: rows, plan: bad, endRows: simulatePhase2End(rows, bad),
    todayYmd: TODAY_YMD, doneToday: 1, currentLesson: 15, perDayAllowed,
  })
  assert.ok(v.integrity.some((m) => m.includes('notes or minutes on lesson 30')))
})

test('integrity: a reopened lesson behind the pointer is never deleted', () => {
  const rows = untick(created(), 'h012', { reopen: false }).map((r) => (r.id === 'h012' ? { ...r, minutes_spent: null } : r))
  const r = resave(rows)
  assert.ok(!r.plan.delete_ids.includes('h012'), 'held back even without notes or minutes')
  const bad: Phase2CommitPlan = { ...r.plan, delete_ids: [...r.plan.delete_ids, 'h012'] }
  const v = validatePhase2End({
    beforeRows: rows, plan: bad, endRows: simulatePhase2End(rows, bad),
    todayYmd: TODAY_YMD, doneToday: 0, currentLesson: 15, perDayAllowed,
  })
  assert.ok(v.integrity.some((m) => m.includes('reopened lesson 12')))
})

// ── The commit writes everything or nothing ────────────────────────────────

type Call = { op: string; table?: string; args?: unknown }

function fakeClient(rpcAnswer: { data?: unknown; error?: { code?: string; message?: string } | null }, failAt?: string) {
  const calls: Call[] = []
  const builder = (table: string) => {
    let op = ''
    const chain: Record<string, unknown> = {}
    const done = () => {
      calls.push({ op, table })
      const failed = failAt && op === failAt
      return Promise.resolve(failed ? { data: null, error: { message: `injected ${op} failure` } } : { data: [{ id: 'x' }], error: null })
    }
    for (const m of ['eq', 'in', 'gt', 'not', 'select']) {
      chain[m] = () => chain
    }
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done().then(res, rej)
    return {
      update: () => { op = 'update'; return chain },
      delete: () => { op = 'delete'; return chain },
      insert: () => { op = 'insert'; return chain },
    }
  }
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ op: 'rpc', args: { name, args } })
      return Promise.resolve({ data: rpcAnswer.data ?? null, error: rpcAnswer.error ?? null })
    },
    from: (table: string) => builder(table),
  }
  return { client: client as never, calls }
}

const SAMPLE = (() => {
  const rows = untick(created(), 'h015', { reopen: false })
  const r = resave(rows)
  return {
    goalId: GOAL, localDay: TODAY_YMD,
    expected: phase2Expected({
      goal: { total_lessons: TOTAL, current_lesson: 15, start_at_lesson: START_AT, lessons_per_day: 1, lessons_per_day_overrides: null, school_days: SCHOOL_DAYS, start_date: START_DATE },
      rows, dayStartIso: DAY_START, dayEndIso: DAY_END,
    }),
    plan: r.plan,
  }
})()

test('failed writes: a transaction that fails is reported and nothing else is written', async () => {
  const { client, calls } = fakeClient({ data: { status: 'failed', reason: 'boom' } })
  const res = await applyPhase2Commit(client, SAMPLE)
  assert.deepEqual(res, { status: 'failed', reason: 'boom' })
  assert.deepEqual(calls.map((c) => c.op), ['rpc'], 'no client-side write follows a failed transaction')
})

test('failed writes: a stale plan writes nothing and is retried by the caller', async () => {
  const { client, calls } = fakeClient({ data: { status: 'stale', reason: 'rows' } })
  const res = await applyPhase2Commit(client, SAMPLE)
  assert.deepEqual(res, { status: 'stale', reason: 'rows' })
  assert.deepEqual(calls.map((c) => c.op), ['rpc'])
})

test('failed writes: a refusal inside the transaction is deterministic', async () => {
  const { client } = fakeClient({ data: { status: 'refused', reason: 'rooted_rebuild_overcapacity: 2026-09-21' } })
  const res = await applyPhase2Commit(client, SAMPLE)
  assert.equal(res.status, 'refused')
})

test('failed writes: an RPC error that is not "function missing" never falls back to client writes', async () => {
  const { client, calls } = fakeClient({ error: { code: '57014', message: 'canceling statement' } })
  const res = await applyPhase2Commit(client, SAMPLE)
  assert.equal(res.status, 'failed')
  assert.deepEqual(calls.map((c) => c.op), ['rpc'])
})

test('the commit sends the whole plan and the snapshot it was made from', async () => {
  const { client, calls } = fakeClient({ data: { status: 'applied', inserted: SAMPLE.plan.inserts.length, redated: 0 } })
  const res = await applyPhase2Commit(client, SAMPLE)
  assert.equal(res.status, 'applied')
  const sent = (calls[0].args as { name: string; args: Record<string, unknown> })
  assert.equal(sent.name, 'apply_builder_rebuild')
  assert.deepEqual(Object.keys(sent.args).sort(), ['p_expected', 'p_goal_id', 'p_local_day', 'p_plan'])
  const rows = (sent.args.p_expected as { rows: unknown[][] }).rows
  assert.deepEqual(rows.map((r) => r[0]), [...rows.map((r) => r[0] as string)].sort(), 'rows sorted by id, as the database builds them')
})

test('missing function: no fallback, a retryable "unavailable", and no lesson writes at all', async () => {
  const { client, calls } = fakeClient({ error: { code: 'PGRST202', message: 'Could not find the function' } })
  const res = await applyPhase2Commit(client, SAMPLE)
  assert.equal(res.status, 'unavailable')
  assert.deepEqual(calls.map((c) => c.op), ['rpc'], 'nothing but the one RPC call')
})

test('the commit module has no client-side write path left', () => {
  const src = readFileSync(new URL('./phase2-commit.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /\.from\("lessons"\)/)
  assert.doesNotMatch(src, /legacy/i)
})

// ── reopen planner ─────────────────────────────────────────────────────────

test('planReopenMakeUp: which reopened rows become make-ups, and on which day', () => {
  const base = { completed: false, skipped: false }
  assert.equal(planReopenMakeUp({ row: { ...base, queue_position: 16, scheduled_date: TODAY_YMD }, currentLesson: 15, todayYmd: TODAY_YMD }), null)
  assert.deepEqual(planReopenMakeUp({ row: { ...base, queue_position: 15, scheduled_date: '2026-09-07' }, currentLesson: 15, todayYmd: TODAY_YMD }), { date: TODAY_YMD })
  assert.deepEqual(planReopenMakeUp({ row: { ...base, queue_position: 15, scheduled_date: '2026-09-30' }, currentLesson: 15, todayYmd: TODAY_YMD }), { date: '2026-09-30' })
  assert.equal(planReopenMakeUp({ row: { ...base, completed: true, queue_position: 3, scheduled_date: null }, currentLesson: 15, todayYmd: TODAY_YMD }), null)
  assert.equal(planReopenMakeUp({ row: { ...base, skipped: true, queue_position: 3, scheduled_date: null }, currentLesson: 15, todayYmd: TODAY_YMD }), null)
  assert.deepEqual(planReopenMakeUp({ row: { ...base, queue_position: 3, scheduled_date: null }, currentLesson: 15, todayYmd: TODAY_YMD }), { date: TODAY_YMD })
})

// ── One definition of "carries the family's work", on both sides ───────────

test('holdsParentWork and rooted_private.lesson_carries_work agree on every whitespace character', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260922025647_apply_builder_rebuild_work_guard.sql', import.meta.url), 'utf8')
  const fn = sql.slice(sql.indexOf('function rooted_private.lesson_carries_work('), sql.indexOf('$w$;'))
  const sqlSpaces = new Set([9, 10, 11, 12, 13, 32, ...[...fn.matchAll(/chr\((\d+)\)/g)].map((m) => Number(m[1]))])
  // chr(8192) '-' chr(8202) is a range in the SQL class.
  for (let c = 8192; c <= 8202; c++) sqlSpaces.add(c)
  for (let c = 0; c <= 0xffff; c++) {
    const ch = String.fromCharCode(c)
    if (ch.trim() !== '') continue
    assert.ok(sqlSpaces.has(c), `U+${c.toString(16).padStart(4, '0')} is whitespace to trim() but not to the SQL rule`)
    assert.equal(holdsParentWork({ notes: `${ch}${ch}`, minutes_spent: null }), false)
  }
  assert.equal(holdsParentWork({ notes: ' a ', minutes_spent: null }), true)
  assert.equal(holdsParentWork({ notes: null, minutes_spent: 0 }), true)
})
