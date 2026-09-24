// An in-memory stand-in for the slice of supabase-js the scheduler tests need,
// that actually applies its filters.
//
// The record-and-return fakes elsewhere in the tests ignore .eq/.not/.order and
// hand back whatever the test configured, which is fine for asserting a payload
// and useless for asserting what a query SELECTS. "A continuation row never
// moves the pointer" is a claim about a filter, so it needs a fake that runs
// the filter.
//
// Supported: select (columns ignored, whole rows returned), eq, neq, lt, lte,
// gt, gte, in, not(col, "is", null), is(col, null), or("a.is.null,b.neq.x"),
// order, limit, maybeSingle, and awaiting the chain; update and delete with the
// same filters; insert. update(...).select() returns the rows it changed, the
// way PostgREST's return=representation does. Enough for
// recalibrateCurriculumGoal and recomputeCurrentLesson. Not a database: no
// triggers, no unique indexes. `refuseUpdate` stands in for a BEFORE UPDATE
// trigger that returns NULL: the row is silently left alone and is missing
// from the returned representation, with no error.
//
// rpc: only restore_queue_book_order, written out here independently of the
// app's bookOrderView so a test of one is not a test of itself: the goal's
// slotted lessons take its slots in lesson_number order, then current_lesson
// is recomputed the way the lessons trigger does (the one trigger emulated,
// because the real function's answer depends on it). Any other name answers
// the way PostgREST does for a missing function, PGRST202.

type Row = Record<string, unknown>
type Pred = (r: Row) => boolean

function parseScalar(v: string): unknown {
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  const n = Number(v)
  return Number.isFinite(n) && v.trim() !== '' ? n : v
}

function orPredicate(expr: string): Pred {
  const parts = expr.split(',').map((p) => {
    const [col, op, ...rest] = p.split('.')
    const val = parseScalar(rest.join('.'))
    return (r: Row) => {
      const x = r[col]
      if (op === 'is') return val === null ? x == null : x === val
      if (op === 'eq') return x === val
      if (op === 'neq') return x !== val
      throw new Error(`memory-supabase: unsupported or() operator ${op}`)
    }
  })
  return (r) => parts.some((p) => p(r))
}

export function makeMemorySupabase(
  seed: Record<string, Row[]>,
  opts: { refuseUpdate?: (table: string, row: Row, payload: Row) => boolean; noRpc?: boolean } = {},
) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }))
  let nextId = 1

  function query(table: string, mode: 'select' | 'update' | 'delete', payload?: Row) {
    const preds: Pred[] = []
    let orderCol: string | null = null
    let ascending = true
    let limitN: number | null = null
    let returning = false

    const run = () => {
      const rows = (tables[table] ??= [])
      const hit = rows.filter((r) => preds.every((p) => p(r)))
      if (mode === 'update') {
        const changed = hit.filter((r) => !opts.refuseUpdate?.(table, r, payload ?? {}))
        for (const r of changed) Object.assign(r, payload)
        return { data: returning ? changed.map((r) => ({ ...r })) : null, error: null }
      }
      if (mode === 'delete') {
        tables[table] = rows.filter((r) => !hit.includes(r))
        return { data: null, error: null }
      }
      let out = hit.map((r) => ({ ...r }))
      if (orderCol) {
        const c = orderCol
        out.sort((a, b) => {
          const x = a[c] as number
          const y = b[c] as number
          if (x === y) return 0
          if (x == null) return 1
          if (y == null) return -1
          return ascending ? (x < y ? -1 : 1) : x < y ? 1 : -1
        })
      }
      if (limitN != null) out = out.slice(0, limitN)
      return { data: out, error: null }
    }

    const chain: Record<string, unknown> = {
      select: () => {
        if (mode === 'update') returning = true
        return chain
      },
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), chain),
      neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), chain),
      lt: (c: string, v: number) => (preds.push((r) => r[c] != null && (r[c] as number) < v), chain),
      lte: (c: string, v: number) => (preds.push((r) => r[c] != null && (r[c] as number) <= v), chain),
      gt: (c: string, v: number) => (preds.push((r) => r[c] != null && (r[c] as number) > v), chain),
      gte: (c: string, v: number) => (preds.push((r) => r[c] != null && (r[c] as number) >= v), chain),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), chain),
      is: (c: string, v: null) => (preds.push((r) => (v === null ? r[c] == null : r[c] === v)), chain),
      not: (c: string, op: string, v: unknown) => {
        if (op !== 'is' || v !== null) throw new Error(`memory-supabase: unsupported not(${op}, ${String(v)})`)
        preds.push((r) => r[c] != null)
        return chain
      },
      or: (expr: string) => (preds.push(orPredicate(expr)), chain),
      order: (c: string, o?: { ascending?: boolean }) => {
        orderCol = c
        ascending = o?.ascending ?? true
        return chain
      },
      limit: (n: number) => ((limitN = n), chain),
      maybeSingle: async () => {
        const { data } = run() as { data: Row[] }
        return { data: data[0] ?? null, error: null }
      },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve().then(run).then(ok, bad),
    }
    return chain
  }

  function restoreQueueBookOrder(goalId: string) {
    const goals = tables.curriculum_goals ?? []
    const goal = goals.find((g) => g.id === goalId)
    if (!goal) return { data: { status: 'invalid', reason: 'not_owner' }, error: null }
    const slotted = (tables.lessons ?? []).filter(
      (r) => r.curriculum_goal_id === goalId && r.lesson_number != null && r.queue_position != null,
    )
    const slots = slotted.map((r) => r.queue_position as number).sort((a, b) => a - b)
    const byNumber = [...slotted].sort((a, b) => (a.lesson_number as number) - (b.lesson_number as number))
    let changed = 0
    byNumber.forEach((r, i) => {
      if (r.queue_position !== slots[i]) {
        r.queue_position = slots[i]
        changed++
      }
    })
    if (changed === 0) return { data: { status: 'in_order', changed: 0 }, error: null }
    let maxDone = 0
    for (const r of tables.lessons ?? []) {
      if (r.curriculum_goal_id === goalId && r.completed && r.queue_position != null) {
        maxDone = Math.max(maxDone, r.queue_position as number)
      }
    }
    let current = Math.max(((goal.start_at_lesson as number | null) ?? 1) - 1, maxDone)
    if (goal.total_lessons != null) current = Math.min(current, goal.total_lessons as number)
    goal.current_lesson = current
    return { data: { status: 'restored', changed }, error: null }
  }

  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === 'restore_queue_book_order' && !opts.noRpc) return restoreQueueBookOrder(args.p_goal_id as string)
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } }
    },
    from(table: string) {
      return {
        select: (cols?: string) => (query(table, 'select').select as (c?: string) => unknown)(cols),
        update: (payload: Row) => query(table, 'update', payload),
        delete: () => query(table, 'delete'),
        insert: (rows: Row | Row[]) => {
          const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: `mem-${nextId++}`, ...r }))
          ;(tables[table] ??= []).push(...list)
          const res = { data: list.map((r) => ({ id: r.id })), error: null }
          return { select: async () => res, then: (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok) }
        },
      }
    },
  }

  return { client, tables }
}
