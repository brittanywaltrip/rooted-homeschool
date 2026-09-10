// Tests for lib/supabase-all-rows.ts, plus a source-level guard on the page
// the missing paging was found on.
//
// The bug: PostgREST answers with at most 1,000 rows and gives no sign it
// left any behind. The Reports page read a family's lessons with no filter
// and no range, so a mother with 1,959 lesson rows across three children saw
// zero hours and zero courses for a child who had nine completed lessons and
// 600 recorded minutes. Transcripts, which reads a different table, showed
// the three hours correctly, so the two pages disagreed about the same week.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { selectAllRows, selectAllRowsResult, DEFAULT_PAGE_SIZE } from './supabase-all-rows.ts'

// ── A fake table that honours .range() the way PostgREST does ───────────────

type Row = { id: number }

function fakeTable(total: number) {
  const calls: Array<[number, number]> = []
  const build = (from: number, to: number) => {
    calls.push([from, to])
    const rows: Row[] = []
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ id: i })
    return Promise.resolve({ data: rows, error: null })
  }
  return { build, calls }
}

// ── selectAllRows ───────────────────────────────────────────────────────────

test('reads 2,350 rows across three pages and stops on the short page', async () => {
  const { build, calls } = fakeTable(2350)

  const rows = await selectAllRows<Row>(build)

  assert.equal(rows.length, 2350)
  assert.equal(calls.length, 3, 'a short third page ends the loop')
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
  // Every row, once, in order.
  assert.equal(rows[0].id, 0)
  assert.equal(rows[2349].id, 2349)
  assert.equal(new Set(rows.map((r) => r.id)).size, 2350)
})

test('a row count that is an exact multiple of the page size costs one empty page', async () => {
  const { build, calls } = fakeTable(2000)

  const rows = await selectAllRows<Row>(build)

  assert.equal(rows.length, 2000)
  // A full page might be the last one; only the empty page after it says so.
  assert.equal(calls.length, 3)
})

test('a single short page is one request', async () => {
  const { build, calls } = fakeTable(12)
  assert.equal((await selectAllRows<Row>(build)).length, 12)
  assert.equal(calls.length, 1)
})

test('no rows is an empty list, not a throw', async () => {
  const { build, calls } = fakeTable(0)
  assert.deepEqual(await selectAllRows<Row>(build), [])
  assert.equal(calls.length, 1)
})

test('honours a custom page size', async () => {
  const { build, calls } = fakeTable(250)
  const rows = await selectAllRows<Row>(build, 100)
  assert.equal(rows.length, 250)
  assert.deepEqual(calls, [[0, 99], [100, 199], [200, 299]])
})

test('the default page size matches the PostgREST cap', () => {
  assert.equal(DEFAULT_PAGE_SIZE, 1000)
})

test('a null data page is treated as empty rather than crashing', async () => {
  const rows = await selectAllRows<Row>(() => Promise.resolve({ data: null, error: null }))
  assert.deepEqual(rows, [])
})

test('rejects a page size that could never terminate', async () => {
  await assert.rejects(() => selectAllRows<Row>(() => Promise.resolve({ data: [], error: null }), 0), /positive integer/)
})

test('throws on an errored page instead of returning a partial answer', async () => {
  let seen = 0
  await assert.rejects(
    () =>
      selectAllRows<Row>((from, to) => {
        seen++
        if (from === 0) {
          const rows: Row[] = []
          for (let i = from; i <= to; i++) rows.push({ id: i })
          return Promise.resolve({ data: rows, error: null })
        }
        return Promise.resolve({ data: null, error: { message: 'connection reset' } })
      }),
    /page starting at 1000 failed: connection reset/,
  )
  assert.equal(seen, 2)
})

test('stops instead of looping forever when a builder ignores its range', async () => {
  // A full page every time and no end in sight. The loop has to give up.
  let calls = 0
  const rows = await selectAllRows<Row>(
    () => {
      calls++
      return Promise.resolve({ data: Array.from({ length: 10 }, (_, i) => ({ id: i })), error: null })
    },
    10,
  )
  assert.equal(calls, 1000, 'gives up at the page cap')
  assert.equal(rows.length, 10_000)
})

// ── selectAllRowsResult ─────────────────────────────────────────────────────

test('selectAllRowsResult hands back supabase-js shape on success', async () => {
  const { build } = fakeTable(1500)
  const { data, error } = await selectAllRowsResult<Row>(build)
  assert.equal(error, null)
  assert.equal(data?.length, 1500)
})

test('selectAllRowsResult degrades to { data: null, error } instead of throwing', async () => {
  const { data, error } = await selectAllRowsResult<Row>(() =>
    Promise.resolve({ data: null, error: { message: 'boom' } }),
  )
  assert.equal(data, null)
  assert.match(String(error?.message), /boom/)
})

// ── Source guard: the Reports page never reads lessons unranged ─────────────

/** Strip comments so prose about the rule cannot satisfy or trip it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/**
 * The method chain starting at `idx`, i.e. everything up to the first comma,
 * semicolon or unmatched closing bracket at depth zero.
 */
function chainAt(src: string, idx: number): string {
  let depth = 0
  for (let i = idx; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return src.slice(idx, i)
      depth--
    } else if ((c === ',' || c === ';' || c === '\n') && depth === 0) {
      if (c === '\n') {
        // A newline only ends the chain if the next thing is not another
        // chained call, which is how these queries are usually formatted.
        const rest = src.slice(i).replace(/^\s+/, '')
        if (rest.startsWith('.')) continue
      }
      return src.slice(idx, i)
    }
  }
  return src.slice(idx)
}

test('the Reports page reads no lessons without a range or a head count', () => {
  const path = resolve(import.meta.dirname, '..', 'app', 'dashboard', 'reports', 'page.tsx')
  const src = stripComments(readFileSync(path, 'utf8'))

  const needle = 'from("lessons")'
  const offenders: string[] = []
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    const chain = chainAt(src, i)
    const paged = chain.includes('.range(')
    const headCount = chain.includes('head: true')
    if (!paged && !headCount) offenders.push(chain.replace(/\s+/g, ' ').slice(0, 160))
  }

  assert.deepEqual(
    offenders,
    [],
    'Every lessons read on the Reports page must page with .range() (see selectAllRows) ' +
      'or be a head count. PostgREST stops at 1,000 rows without saying so.',
  )
})

test('the Reports page still reads lessons at all', () => {
  // Guards the guard: if the query is renamed away, the check above passes
  // for the wrong reason.
  const path = resolve(import.meta.dirname, '..', 'app', 'dashboard', 'reports', 'page.tsx')
  const src = stripComments(readFileSync(path, 'utf8'))
  assert.ok(src.includes('from("lessons")'))
  assert.ok(src.includes('selectAllRowsResult'))
})
