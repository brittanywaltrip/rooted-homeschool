// A React setState updater may not touch a ref.
//
// WHY THIS IS A STATIC CHECK AND NOT A UNIT TEST.
//
// ROOTED-HOMESCHOOL-15 was `drag.current!.ox` read INSIDE a setTransform
// updater in FirstDayFrameEditor.onPointerMove. The arithmetic around it was
// correct and is unchanged by the fix; what was wrong was WHEN the ref got
// read. React does not run an updater during the event, it runs it during the
// next render, and by then onPointerUp had already set `drag.current = null`.
// So the guard at the top of the handler was true when evaluated and false
// when the updater ran, the non-null assertion asserted something false, and
// it threw inside React's render phase — taking the page down mid-drag
// instead of dropping one pointer event.
//
// That means the defect is temporal, not arithmetic. Extracting the offset
// math into a pure function and testing it would produce a test that passes
// identically before and after the fix, which is worth nothing. Reproducing it
// for real needs a rendered component and a pointerdown -> pointermove ->
// pointerup -> render sequence, and this repo has no React/DOM test tooling at
// all: no @testing-library, no jsdom, no happy-dom, no vitest, no jest. Adding
// one to cover a four-line handler is not the trade to make here.
//
// What DOES generalise is the shape. A static sweep over the source would have
// caught the original, catches the two adjacent cases fixed alongside it, and
// keeps the class from coming back — the same approach as the projection-slot
// and starting-position guards in app/lib/scheduler.test.ts.
//
// THE RULE: read the ref into a local first, then close over the plain value.
//
//   const d = drag.current;
//   if (!d) return;
//   const next = clamp(d.ox + dx);
//   setTransform((t) => ({ ...t, offsetXPct: next }));
//
// Writing a ref from inside an updater is the same mistake wearing a different
// hat: an updater must be a pure function of its argument, React may call it
// more than once, and a render it belongs to may be discarded — so the ref can
// end up describing state that never committed. DailyListCard.updateItems did
// exactly that, with a comment claiming it was synchronous. It is not.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOTS = ['app', 'components', 'lib']

/** Callables that look like React setters but are not. */
const NOT_REACT_SETTERS = new Set(['setTimeout', 'setInterval', 'setImmediate'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Skip build output and the stray FUSE artifacts in app/dashboard.
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.fuse_hidden')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === '_to_delete') continue
      walk(full, out)
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      if (full.endsWith('.test.ts') || full.endsWith('.test.tsx')) continue
      out.push(full)
    }
  }
  return out
}

/** Index of the ')' matching the '(' at `open`, skipping string literals. */
function matchParen(src: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Strip comments so a match cannot be satisfied by prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

type Offender = { file: string; line: number; setter: string; refs: string[]; snippet: string }

function findOffenders(): Offender[] {
  const out: Offender[] = []
  // Bare-identifier call only. `el.setPointerCapture(...)`, `d.setHours(...)`
  // and every other DOM/Date method are reached through a receiver, so the
  // lookbehind drops them without needing a denylist.
  const setterCall = /(?<![.\w$])(set[A-Z]\w*)\s*\(/g

  for (const root of ROOTS) {
    for (const file of walk(resolve(process.cwd(), root))) {
      const raw = readFileSync(file, 'utf-8')
      const src = stripComments(raw)
      for (const m of src.matchAll(setterCall)) {
        const name = m[1]
        if (NOT_REACT_SETTERS.has(name)) continue
        const open = m.index! + m[0].length - 1
        const close = matchParen(src, open)
        if (close < 0) continue
        const arg = src.slice(open + 1, close)
        // Updater form only: the sole argument is an arrow function.
        if (!/^\s*(\([^)]*\)|\w+)\s*(:[^=]*)?=>/.test(arg)) continue
        const refs = [...new Set([...arg.matchAll(/\b(\w+)\.current\b/g)].map((r) => r[1]))]
        if (refs.length === 0) continue
        out.push({
          file: file.slice(resolve(process.cwd()).length + 1),
          line: src.slice(0, m.index!).split('\n').length,
          setter: name,
          refs: refs.sort(),
          snippet: arg.replace(/\s+/g, ' ').slice(0, 120),
        })
      }
    }
  }
  return out
}

test('no React setState updater reads or writes a ref', () => {
  const offenders = findOffenders()
  const report = offenders
    .map((o) => `  ${o.file}:${o.line}  ${o.setter}((prev) => ...) touches ${o.refs.join(', ')}\n      ${o.snippet}`)
    .join('\n')
  assert.equal(
    offenders.length,
    0,
    `A setState updater runs during the NEXT RENDER, not during the event that ` +
      `queued it, so a ref it reads may already have been cleared (that is ` +
      `ROOTED-HOMESCHOOL-15) and a ref it writes may describe a render that ` +
      `never committed. Read the ref into a local first, then close over the ` +
      `plain value.\n${report}`,
  )
})

test('the scanner can actually see the shape it is looking for', () => {
  // Guard the guard. An empty-result scan passes whether the rule holds or the
  // scanner is broken, and the two are indistinguishable from a green run — so
  // prove the detector fires on the original bug, verbatim, and that it does
  // not fire on the fix that replaced it.
  //
  // These strings are the real before/after of FirstDayFrameEditor.onPointerMove.
  const buggy = `
    function onPointerMove(e: React.PointerEvent) {
      if (!drag.current || box.w === 0) return;
      const dx = (e.clientX - drag.current.startX) / box.w;
      setTransform((t) => ({ ...t, offsetXPct: clamp(drag.current!.ox + dx) }));
    }`
  const fixed = `
    function onPointerMove(e: React.PointerEvent) {
      const d = drag.current;
      if (!d || box.w === 0) return;
      const dx = (e.clientX - d.startX) / box.w;
      const nextX = clamp(d.ox + dx);
      setTransform((t) => ({ ...t, offsetXPct: nextX }));
    }`

  // Same extraction the sweep uses, run over a literal instead of a file.
  const scan = (src: string): string[] => {
    const stripped = stripComments(src)
    const hits: string[] = []
    for (const m of stripped.matchAll(/(?<![.\w$])(set[A-Z]\w*)\s*\(/g)) {
      if (NOT_REACT_SETTERS.has(m[1])) continue
      const open = m.index! + m[0].length - 1
      const close = matchParen(stripped, open)
      if (close < 0) continue
      const arg = stripped.slice(open + 1, close)
      if (!/^\s*(\([^)]*\)|\w+)\s*(:[^=]*)?=>/.test(arg)) continue
      if (/\b\w+\.current\b/.test(arg)) hits.push(m[1])
    }
    return hits
  }

  assert.deepEqual(scan(buggy), ['setTransform'], 'the scanner must flag the original bug')
  assert.deepEqual(scan(fixed), [], 'and must not flag the fix that replaced it')

  // A ref inside a timer callback is correct and must never be flagged.
  assert.deepEqual(
    scan('setTimeout(() => inputRef.current?.focus(), 20);'),
    [],
    'setTimeout is not a React setter',
  )
  // Nor may a DOM method that merely starts with "set" be mistaken for one.
  assert.deepEqual(
    scan('el.setPointerCapture(e.pointerId); target.setAttribute("x", ref.current);'),
    [],
    'methods reached through a receiver are not React setters',
  )
})
