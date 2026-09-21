// Parent re-spreads are a person's action; the automatic cache sync is not.
//
// Until 2026-09 the Plan page's catch-up re-spread, push-back and cascade shift
// cleared their pins and then called the AUTOMATIC reconciler, and recalibrate
// called its writer directly. So:
//   - the automatic switch (NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED=false) silently
//     turned those parent actions into "unpin everything, move nothing, say
//     done", and
//   - at the database a parent's tap was byte-identical to a stale tab's
//     background resync, so no guard could block one without the other.
//
// These tests pin the separation: the switch stops only the automatic writer,
// parent writes name their own source and confirm what landed, and undo never
// writes 'queue_resync' back.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  syncProjectedScheduledDates,
  reprojectGoalForParent,
  confirmedLessonsUpdate,
  sourceForUndoRestore,
  isProjectorPlacedSource,
  PARENT_RESPREAD_SOURCE,
  UNDO_RESTORE_SOURCE,
  type CurriculumGoalConfig,
} from './scheduler.ts'
import { recalibrateCurriculumGoal, recalibrateFullyApplied } from './recalibrate.ts'
import { makeMemorySupabase } from './test-helpers/memory-supabase.ts'

const REPO = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')

function withSwitch<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED
  if (value === undefined) delete process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED
  else process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED = value
  return fn().finally(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED
    else process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED = prev
  })
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function plusDays(base: Date, n: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

/** A Mon-Fri, 1/day goal with lessons 1-3 done and 4-12 stamped queue_resync on
 *  stale dates (every one a Saturday in the past), so the projector disagrees
 *  with every row. */
function staleGoal(opts: { pinned?: string[] } = {}) {
  const goalId = 'g-parent'
  const goal: CurriculumGoalConfig = {
    id: goalId,
    total_lessons: 12,
    lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    current_lesson: 3,
    start_date: null,
    lessons_per_day_overrides: null,
  }
  const lessons: Record<string, unknown>[] = []
  for (let n = 1; n <= 12; n++) {
    const done = n <= 3
    lessons.push({
      id: `L${n}`,
      curriculum_goal_id: goalId,
      lesson_number: n,
      queue_position: n,
      completed: done,
      scheduled_date: '2026-01-03',
      date: '2026-01-03',
      scheduled_source: done ? 'completion_today' : 'queue_resync',
      is_backfill: false,
      queue_pinned: (opts.pinned ?? []).includes(`L${n}`),
      skipped: false,
    })
  }
  return { goal, goalId, lessons }
}

// ── The automatic writer, and only it, is switched ─────────────────────────

test('syncProjectedScheduledDates writes nothing when the automatic switch is off', async () => {
  const { lessons } = staleGoal()
  const { client, tables } = makeMemorySupabase({ lessons })
  const proj = new Map<string, string>([['g|4', '2026-10-05'], ['g|5', '2026-10-06']])
  await withSwitch('false', () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    syncProjectedScheduledDates(client as any, tables.lessons as any, proj, (r: any) => `g|${r.queue_position}`),
  )
  assert.ok(
    tables.lessons.every((r) => r.scheduled_date === '2026-01-03'),
    'the direct call (the old Recalibrate path) is gated inside the helper now',
  )
})

test('syncProjectedScheduledDates still writes queue_resync when the switch is on', async () => {
  const { lessons } = staleGoal()
  const { client, tables } = makeMemorySupabase({ lessons })
  const proj = new Map<string, string>([['g|4', '2026-10-05']])
  await withSwitch(undefined, () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    syncProjectedScheduledDates(client as any, tables.lessons as any, proj, (r: any) => `g|${r.queue_position}`),
  )
  const l4 = tables.lessons.find((r) => r.id === 'L4')!
  assert.equal(l4.scheduled_date, '2026-10-05')
  assert.equal(l4.scheduled_source, 'queue_resync')
})

test('the outer guard in reconcileGoalScheduleCache stays, as defence in depth', () => {
  const src = read('app/lib/scheduler.ts')
  const fn = src.slice(src.indexOf('export async function reconcileGoalScheduleCache'))
  assert.ok(/\)\s*:\s*Promise<void>\s*\{[\s\S]{0,600}if \(!isSchedulerSyncEnabled\(\)\) return;/.test(fn))
  const sync = src.slice(src.indexOf('export async function syncProjectedScheduledDates'))
  assert.ok(/\)\s*:\s*Promise<void>\s*\{[\s\S]{0,900}if \(!isSchedulerSyncEnabled\(\)\) return;/.test(sync),
    'the gate is the first statement of the automatic helper')
})

// ── Recalibrate ─────────────────────────────────────────────────────────────

function recalGoal() {
  const goalId = 'g-recal'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const lessons: Record<string, unknown>[] = []
  for (let n = 1; n <= 20; n++) {
    const done = n <= 5
    const d = ymd(plusDays(today, done ? -30 + n : 60 + n)) // upcoming rows far in the future
    lessons.push({
      id: `R${n}`, curriculum_goal_id: goalId, lesson_number: n, queue_position: n,
      completed: done, completed_at: done ? `${d}T15:00:00Z` : null,
      scheduled_date: d, date: d,
      scheduled_source: done ? 'completion_today' : 'queue_resync',
      is_backfill: false, queue_pinned: false, skipped: false,
    })
  }
  const goal = {
    id: goalId, total_lessons: 20, lessons_per_day: 1,
    school_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_date: ymd(plusDays(today, -40)), lessons_per_day_overrides: null,
    created_at: '2026-08-01T00:00:00Z', current_lesson: 5, start_at_lesson: 1,
  }
  return { goalId, lessons, goal }
}

test('Recalibrate with the switch OFF still re-dates the upcoming queue, as recalibrate_respread', async () => {
  const { goalId, lessons, goal } = recalGoal()
  const { client, tables } = makeMemorySupabase({ curriculum_goals: [goal], lessons })
  const res = await withSwitch('false', () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 8, vacationBlocks: [] }),
  )
  assert.ok(res.respread.written > 0, 'the parent asked for this; the automatic switch does not stop it')
  assert.equal(res.respread.failedIds.length, 0)
  assert.equal(recalibrateFullyApplied(res), true)
  for (const id of res.respread.writtenIds) {
    const row = tables.lessons.find((r) => r.id === id)!
    assert.equal(row.scheduled_source, PARENT_RESPREAD_SOURCE.recalibrate, `${id} names the parent's action`)
  }
})

test('Recalibrate performs NO queue_resync date write, whatever the switch says', async () => {
  for (const sw of ['false', 'true']) {
    const { goalId, lessons, goal } = recalGoal()
    const payloads: Record<string, unknown>[] = []
    const { client } = makeMemorySupabase(
      { curriculum_goals: [goal], lessons },
      { refuseUpdate: (_t, _r, p) => (payloads.push(p), false) },
    )
    await withSwitch(sw, () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 8, vacationBlocks: [] }),
    )
    assert.ok(payloads.length > 0)
    assert.ok(payloads.every((p) => p.scheduled_source !== 'queue_resync'), `switch=${sw}`)
  }
})

test('Recalibrate reports a lesson the database silently skipped, instead of success', async () => {
  const { goalId, lessons, goal } = recalGoal()
  const { client } = makeMemorySupabase(
    { curriculum_goals: [goal], lessons },
    // A trigger returning NULL for one upcoming row: no error, just not written.
    { refuseUpdate: (_t, r, p) => r.id === 'R12' && p.scheduled_source === PARENT_RESPREAD_SOURCE.recalibrate },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await recalibrateCurriculumGoal({ supabase: client as any, goalId, newCurrentLesson: 8, vacationBlocks: [] })
  assert.deepEqual(res.respread.failedIds, ['R12'])
  assert.equal(recalibrateFullyApplied(res), false, 'callers must not say "Schedule updated"')
})

// ── reprojectGoalForParent ──────────────────────────────────────────────────

test('parent re-spread is not gated by the automatic switch, and never writes queue_resync', async () => {
  const { goal, lessons } = staleGoal({ pinned: ['L6', 'L9'] })
  const { client, tables } = makeMemorySupabase({ lessons })
  const res = await withSwitch('false', () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reprojectGoalForParent(client as any, goal, [], {
      from: new Date('2026-10-05T00:00:00'), // a Monday
      source: PARENT_RESPREAD_SOURCE.catchUp,
    }),
  )
  assert.equal(res.ok, true)
  assert.equal(res.written, 9, 'lessons 4-12 all moved')
  const tail = tables.lessons.filter((r) => !r.completed)
  assert.deepEqual(
    tail.map((r) => r.scheduled_date),
    ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
     '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'],
    'one per school day, in lesson order, pins released rather than honoured',
  )
  for (const r of tail) {
    assert.equal(r.date, r.scheduled_date)
    assert.equal(r.scheduled_source, 'catchup_spread')
    assert.equal(r.queue_pinned, false)
  }
})

test('parent re-spread unpins and re-dates in the SAME update: never pins cleared with dates skipped', async () => {
  const { goal, lessons } = staleGoal({ pinned: ['L4', 'L5'] })
  const payloads: Record<string, unknown>[] = []
  const { client } = makeMemorySupabase({ lessons }, { refuseUpdate: (_t, _r, p) => (payloads.push(p), false) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await reprojectGoalForParent(client as any, goal, [], {
    from: new Date('2026-10-05T00:00:00'),
    source: PARENT_RESPREAD_SOURCE.pushBack,
  })
  for (const p of payloads) {
    assert.equal(p.queue_pinned, false)
    assert.ok('scheduled_date' in p && 'date' in p, 'a pin is only released alongside its new date')
    assert.equal(p.scheduled_source, 'catchup_pushback')
  }
})

test('parent re-spread keeps the pin the cascade just placed, and fills around it', async () => {
  const { goal, lessons } = staleGoal()
  const moved = lessons.find((r) => r.id === 'L4')!
  Object.assign(moved, { queue_pinned: true, scheduled_date: '2026-10-07', date: '2026-10-07', scheduled_source: 'plan_move' })
  const { client, tables } = makeMemorySupabase({ lessons })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await reprojectGoalForParent(client as any, goal, [], {
    from: new Date('2026-10-05T00:00:00'),
    source: PARENT_RESPREAD_SOURCE.cascade,
    keepPinnedIds: ['L4'],
  })
  assert.equal(res.ok, true)
  const l4 = tables.lessons.find((r) => r.id === 'L4')!
  assert.equal(l4.queue_pinned, true)
  assert.equal(l4.scheduled_source, 'plan_move')
  assert.ok(!res.writtenIds.includes('L4'))
  const onWed = tables.lessons.filter((r) => !r.completed && r.scheduled_date === '2026-10-07')
  assert.equal(onWed.length, 1, 'nothing stacks on the kept pin')
})

test('a declined re-spread (read failure) writes nothing at all', async () => {
  const { goal } = staleGoal()
  let writes = 0
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { message: 'boom' } }) }) }),
      update: () => { writes++; throw new Error('must not write') },
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await reprojectGoalForParent(client as any, goal, [], {
    from: new Date('2026-10-05T00:00:00'), source: PARENT_RESPREAD_SOURCE.catchUp,
  })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'read_failed')
  assert.equal(writes, 0)
})

test('a row the database silently skips is reported as failed, not written', async () => {
  const { goal, lessons } = staleGoal()
  const { client } = makeMemorySupabase({ lessons }, { refuseUpdate: (_t, r) => r.id === 'L7' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await reprojectGoalForParent(client as any, goal, [], {
    from: new Date('2026-10-05T00:00:00'), source: PARENT_RESPREAD_SOURCE.catchUp,
  })
  assert.equal(res.ok, false)
  assert.deepEqual(res.failedIds, ['L7'])
  assert.ok(!res.writtenIds.includes('L7'))
})

test('confirmedLessonsUpdate treats a request error as every row failed', async () => {
  const client = {
    from: () => ({
      update: () => ({ in: () => ({ select: async () => ({ data: null, error: { message: 'x' } }) }) }),
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await confirmedLessonsUpdate(client as any, ['a', 'b'], { notes: 'n' })
  assert.deepEqual(out, { expected: 2, written: 0, writtenIds: [], failedIds: ['a', 'b'] })
})

// ── Undo and provenance ─────────────────────────────────────────────────────

test('undo maps a restored queue_resync to undo_restore and leaves every other source alone', () => {
  assert.equal(sourceForUndoRestore('queue_resync'), UNDO_RESTORE_SOURCE)
  assert.equal(sourceForUndoRestore('plan_move'), 'plan_move')
  assert.equal(sourceForUndoRestore('wizard_create'), 'wizard_create')
  assert.equal(sourceForUndoRestore(null), null)
  assert.equal(sourceForUndoRestore(undefined), null)
})

test('a re-spread or undone row is still an untouched placeholder; a hand-placed one is not', () => {
  for (const s of [null, undefined, 'queue_resync', 'undo_restore', ...Object.values(PARENT_RESPREAD_SOURCE)]) {
    assert.equal(isProjectorPlacedSource(s), true, String(s))
  }
  for (const s of ['plan_move', 'wizard_create', 'completion_today', 'extra_log']) {
    assert.equal(isProjectorPlacedSource(s), false, s)
  }
})

// ── Source sweeps: the literal has one writer ───────────────────────────────

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('only the automatic helper writes the queue_resync literal in app code', () => {
  const files = ['app/lib/scheduler.ts', 'app/lib/recalibrate.ts', 'app/components/PlanV2/index.tsx',
    'app/components/PlanV2/usePlanLessonActions.ts', 'app/dashboard/page.tsx', 'app/dashboard/plan/schedule/page.tsx']
  for (const f of files) {
    const src = stripComments(read(f))
    const hits = [...src.matchAll(/scheduled_source:\s*["']queue_resync["']/g)]
    if (f === 'app/lib/scheduler.ts') {
      assert.equal(hits.length, 1, 'syncProjectedScheduledDates is the one writer')
      const at = src.indexOf(hits[0][0])
      const owner = src.lastIndexOf('export async function', at)
      assert.ok(src.slice(owner, owner + 60).includes('syncProjectedScheduledDates'))
    } else {
      assert.equal(hits.length, 0, `${f} must not write queue_resync`)
    }
  }
})

test('Plan never routes a parent action through the automatic reconciler', () => {
  const src = stripComments(read('app/components/PlanV2/index.tsx'))
  assert.ok(!/reconcileGoalScheduleCache\s*\(/.test(src))
  assert.ok(!/syncProjectedScheduledDates\s*\(/.test(src))
  const recal = stripComments(read('app/lib/recalibrate.ts'))
  assert.ok(!/syncProjectedScheduledDates\s*\(/.test(recal), 'recalibrate uses the parent writer')
})

/** The argument text of every `.update(...)` call, parens balanced. */
function updateArguments(src: string): string[] {
  const out: string[] = []
  let at = src.indexOf('.update(')
  while (at !== -1) {
    let depth = 0
    let i = at + '.update'.length
    const start = i
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')' && --depth === 0) break
    }
    out.push(src.slice(start, i + 1))
    at = src.indexOf('.update(', i)
  }
  return out
}

test('every Plan undo that restores a snapshotted source maps it', () => {
  const src = stripComments(read('app/components/PlanV2/index.tsx'))
  const copiesSource = /scheduled_source\s*:\s*[a-zA-Z_]+\.scheduled_source\b/
  const raw = updateArguments(src).filter((a) => copiesSource.test(a))
  assert.deepEqual(raw, [], 'an update payload restores a source through sourceForUndoRestore, never raw')
  // Payloads assembled before the call (the edit-lesson undo builds undoUpdate).
  assert.ok(!/\w+\.scheduled_source\s*=\s*[a-zA-Z_]+\.scheduled_source\b/.test(src))
  assert.ok((src.match(/sourceForUndoRestore\(/g) ?? []).length >= 3)
})

test('every Plan write that restores a snapshotted source is confirmed', () => {
  // supabase-js resolves on failure, so an undo that does not ask for the
  // changed rows back cannot know it failed. Each restoring update must end in
  // .select("id") and its result must be checked.
  const src = stripComments(read('app/components/PlanV2/index.tsx'))
  let at = src.indexOf('sourceForUndoRestore(')
  let seen = 0
  while (at !== -1) {
    const updateAt = src.lastIndexOf('.update(', at)
    const tail = src.slice(at, at + 900)
    const lineStart = src.lastIndexOf('\n', at)
    const isHelperDecl = /export function sourceForUndoRestore/.test(src.slice(lineStart, at + 40))
    if (!isHelperDecl && updateAt !== -1) {
      seen++
      assert.ok(/\.select\("id"\)/.test(tail), `restore near offset ${at} is not confirmed with .select("id")`)
    }
    at = src.indexOf('sourceForUndoRestore(', at + 1)
  }
  assert.ok(seen >= 3, `expected at least three restoring writes, saw ${seen}`)
})

test('the edit-date undo no longer swallows its write result', () => {
  const src = stripComments(read('app/components/PlanV2/index.tsx'))
  assert.ok(!/await supabase\.from\("lessons"\)\.update\(undoUpdate\)\.eq\("id", lessonId\);\s*\}\s*catch/.test(src))
  assert.ok(/\.update\(undoUpdate\)\s*\.eq\("id", lessonId\)\s*\.select\("id"\)/.test(src))
})

test('bulk mark-done undo un-completes one row at a time, highest queue slot first', () => {
  // Parallel un-completions let a transaction that still saw a higher slot as
  // completed raise current_lesson again, which fires the orphan cleanup and
  // unschedules the rows the undo had just restored (staging, 2026-09-21).
  const src = stripComments(read('app/components/PlanV2/index.tsx'))
  const at = src.indexOf('const undoOrder')
  assert.ok(at !== -1, 'the bulk undo orders its writes')
  const block = src.slice(at, at + 1500)
  assert.ok(/\.sort\(\s*\(a, b\) => \(snapById\.get\(b\)\?\.queue_position/.test(block), 'descending by queue_position')
  assert.ok(/for \(const id of undoOrder\)\s*\{/.test(block), 'sequential loop')
  assert.ok(!/Promise\.allSettled\(\s*succeededIds\.map/.test(src), 'no parallel un-completion')
  assert.ok(/queue_pinned, queue_position"\)/.test(src), 'the snapshot reads the slot it sorts by')
})
