// Invariant 10, enforced instead of merely documented.
//
// The sweep below is the point of this file. In September 2026 eleven write
// paths moved a lesson's dates while naming no source, which made a parent's
// tap and a stale tab's background rewrite byte-identical at the database
// boundary. A guard, an audit or a repair cannot classify identical writes.
// This test fails the build if a twelfth one is ever added.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

import {
  ALL_SCHEDULED_SOURCES,
  ARCHIVED_OR_BACKFILL_SOURCES,
  AUTOMATIC_SOURCES,
  COMPLETION_SOURCES,
  PARENT_ACTION_SOURCES,
  RETIRED_SOURCES,
  SETUP_SOURCES,
  classifyScheduledSource,
  isAutomaticSource,
  isKnownIntentionalSource,
  isParentAction,
  shouldBlockAmbiguousScheduleWrite,
} from './scheduled-source.ts'

const REPO = resolve(import.meta.dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try { entries = readdirSync(d) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e === '.git') continue
      const full = join(d, e)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.tsx?$/.test(e)) continue
      if (/\.test\.tsx?$/.test(e)) continue
      out.push(full)
    }
  }
  walk(dir)
  return out
}

/** Extract the balanced (...) payload beginning at the '(' index. */
function balanced(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return src.slice(open + 1, i) }
  }
  return src.slice(open + 1)
}

/** Does this payload assign a NON-NULL value to `date` or `scheduled_date`? */
function writesRealDate(payload: string): boolean {
  const re = /(^|[{,\s])(scheduled_date|date)\s*:\s*([^,}]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(payload))) {
    if (m[3].trim() !== 'null') return true
  }
  return false
}

/**
 * Payloads passed as a bare identifier, whose builder lives elsewhere. Each
 * entry names where the source IS stamped, and the test verifies that claim
 * rather than taking it on trust.
 */
const VARIABLE_PAYLOADS: Record<string, { file: string; stamps: string }> = {
  batch:   { file: 'app/lib/past-year-dates.ts', stamps: 'scheduled_source' },
  planned: { file: 'app/lib/healNextRow.ts',     stamps: 'scheduled_source' },
}

type Offence = { file: string; line: number; payload: string }

function sweep(): { offences: Offence[]; checked: number } {
  const offences: Offence[] = []
  let checked = 0
  const files = [
    ...sourceFiles(join(REPO, 'app')),
    ...sourceFiles(join(REPO, 'lib')),
    ...sourceFiles(join(REPO, 'scripts')),
  ]
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const anchor = /from\(\s*["']lessons["']\s*\)/g
    let a: RegExpExecArray | null
    while ((a = anchor.exec(src))) {
      const after = src.slice(a.index, a.index + 400)
      const op = /\.\s*(update|insert|upsert)\s*\(/.exec(after)
      if (!op) continue
      const openAbs = a.index + op.index + op[0].length - 1
      const payload = balanced(src, openAbs)
      checked++
      const bare = payload.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(bare)) {
        // Identifier payload: resolve in-file, else fall back to the allowlist.
        const defRe = new RegExp(`(const|let|var)\\s+${bare}\\s*[:=]`)
        const d = defRe.exec(src)
        if (d) {
          const window = src.slice(d.index, d.index + 1200)
          if (writesRealDate(window) && !window.includes('scheduled_source')) {
            offences.push({ file, line: src.slice(0, d.index).split('\n').length, payload: bare })
          }
          continue
        }
        const allow = VARIABLE_PAYLOADS[bare]
        assert.ok(allow, `lessons write with an unresolvable payload '${bare}' in ${relative(REPO, file)}. Add it to VARIABLE_PAYLOADS with the file that stamps the source.`)
        const builder = readFileSync(join(REPO, allow.file), 'utf8')
        assert.ok(builder.includes(allow.stamps), `${allow.file} no longer stamps ${allow.stamps}; the '${bare}' allowlist entry is stale.`)
        continue
      }
      if (writesRealDate(payload) && !payload.includes('scheduled_source')) {
        offences.push({ file, line: src.slice(0, openAbs).split('\n').length, payload: payload.replace(/\s+/g, ' ').slice(0, 120) })
      }
    }
  }
  return { offences, checked }
}

test('Invariant 10: no lessons write sets a real date without naming its source', () => {
  const { offences, checked } = sweep()
  assert.ok(checked >= 20, `sweep only found ${checked} lessons writes; the matcher is probably broken`)
  assert.deepEqual(
    offences.map((o) => `${relative(REPO, o.file)}:${o.line}  ${o.payload}`),
    [],
    'Every UPDATE/INSERT that puts a lesson on a calendar day must set scheduled_source.\n' +
    'A date write with no source is indistinguishable from the automatic reconciler,\n' +
    'which is what made queue_resync uncontainable. Pick a name from\n' +
    'app/lib/scheduled-source.ts, or add one there if none fits.',
  )
})

test('every path stamped in this batch names itself, via the typed constant', () => {
  const today = readFileSync(join(REPO, 'app/dashboard/page.tsx'), 'utf8')
  const plan = readFileSync(join(REPO, 'app/components/PlanV2/index.tsx'), 'utf8')
  const past = readFileSync(join(REPO, 'app/lib/past-year-respread.ts'), 'utf8')

  // assert.ok, never assert.match: a failing assert.match prints the whole
  // 377KB file as `actual`, which buries the one line that matters.
  const uses = (src: string, name: string) =>
    (src.match(new RegExp(`scheduled_source: SOURCE\\.${name}\\b`, 'g')) ?? []).length

  for (const c of ['CATCHUP_SPREAD', 'CATCHUP_PUSHBACK', 'CATCHUP_PUSH_ALL',
                   'MANUAL_RESCHEDULE', 'CATCHUP_DOUBLE_UP', 'DAY_RESCHEDULE_UNCOMPLETE']) {
    assert.ok(uses(today, c) >= 1, `app/dashboard/page.tsx no longer stamps SOURCE.${c}`)
  }
  // The undo writes both ternary branches.
  assert.equal(uses(today, 'RESCHEDULE_UNDO'), 2,
    'undoReschedule must stamp BOTH the unskip and the plain branch')

  assert.ok(uses(plan, 'PLAN_MOVE_UNDO') >= 1, 'PlanV2 undo-move lost its source')
  assert.ok(uses(plan, 'SKIP_UNDO') >= 1, 'PlanV2 undo-skip lost its source')
  assert.ok(uses(plan, 'COMPLETION_BACKFILL') >= 1, 'PlanV2 backfill insert lost its source')

  // The respread re-stamps the SAME tag on purpose: past_year is what marks a
  // year as filed, and three readers depend on it (see scheduled-source.ts).
  assert.ok(/scheduled_source: PAST_YEAR_SOURCE/.test(past),
    'the past-year respread must re-stamp past_year, not a respread-specific tag')
  assert.ok(!/past_year_respread/.test(past),
    'a respread-specific tag would break the respread guard, the Years page filed-count, and no-badges-for-a-filed-year')
})

test('no batch value collides with a source a reader switches on', () => {
  // The readers that compare scheduled_source to a literal, verified by hand
  // on 2026-09-18. A new value must not accidentally equal one of these.
  const READER_LITERALS = ['past_year', 'recalibrate_estimate', 'queue_resync', 'continuation', 'wizard_edit', 'plan_move']
  const BATCH_NEW = ['catchup_spread', 'catchup_pushback', 'catchup_push_all', 'catchup_double_up',
                     'day_reschedule_uncomplete', 'manual_reschedule', 'reschedule_undo',
                     'plan_move_undo', 'skip_undo', 'completion_backfill']
  for (const v of BATCH_NEW) {
    assert.ok(!READER_LITERALS.includes(v), `${v} collides with a value a reader switches on`)
    assert.ok(ALL_SCHEDULED_SOURCES.includes(v as never), `${v} is not in the vocabulary`)
  }
  // plan_move_undo must not be mistaken for plan_move by a prefix/substring test.
  assert.ok(!READER_LITERALS.some((r) => r !== 'plan_move' && 'plan_move_undo'.startsWith(r)))
})

test('every scheduled_source literal in the repo is a known value', () => {
  // Catches a typo anywhere, including the legacy writers this batch did not
  // convert to SOURCE.* constants.
  const files = [
    ...sourceFiles(join(REPO, 'app')),
    ...sourceFiles(join(REPO, 'lib')),
    ...sourceFiles(join(REPO, 'scripts')),
  ]
  const known = new Set<string>(ALL_SCHEDULED_SOURCES as readonly string[])
  const unknown: string[] = []
  for (const f of files) {
    if (f.endsWith('scheduled-source.ts')) continue
    const src = readFileSync(f, 'utf8')
    const re = /scheduled_source\s*[:=]\s*['"]([a-z_]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      if (!known.has(m[1])) unknown.push(`${relative(REPO, f)}  "${m[1]}"`)
    }
  }
  assert.deepEqual(unknown, [],
    'These scheduled_source values are written but not declared in app/lib/scheduled-source.ts.\n' +
    'Either it is a typo, or the vocabulary is missing a value.')
})

test('nulling a slot is not a date write and needs no source', () => {
  // Skip and unschedule set scheduled_date = null and never touch `date`.
  // They are outside Invariant 10 and the sweep must not flag them.
  assert.equal(writesRealDate('{ skipped: true, scheduled_date: null, queue_pinned: false }'), false)
  assert.equal(writesRealDate('{ scheduled_date: null, queue_position: null, queue_pinned: false }'), false)
  assert.equal(writesRealDate('{ scheduled_date: d, date: d }'), true)
  assert.equal(writesRealDate('{ notes: "x" }'), false)
})

test('the gate lives inside syncProjectedScheduledDates, not in its callers', () => {
  // recalibrate.ts imports the helper directly. Before this change it was the
  // one caller that never checked the switch.
  const sched = readFileSync(join(REPO, 'app/lib/scheduler.ts'), 'utf8')
  const body = sched.slice(sched.indexOf('export async function syncProjectedScheduledDates'))
  const head = body.slice(0, body.indexOf('const byDate'))
  assert.ok(/if \(!isSchedulerSyncEnabled\(\)\) return;/.test(head),
    'syncProjectedScheduledDates must gate itself so every caller inherits it')

  const recal = readFileSync(join(REPO, 'app/lib/recalibrate.ts'), 'utf8')
  assert.ok(recal.includes('syncProjectedScheduledDates('),
    'recalibrate still calls the helper; that is fine now that the helper gates itself')
})

test('classification: only known automatic sources classify automatic', () => {
  for (const v of AUTOMATIC_SOURCES) {
    assert.equal(classifyScheduledSource(v), 'automatic', `${v} should classify automatic`)
    assert.equal(isAutomaticSource(v), true)
  }
})

test('classification: no intentional category classifies automatic', () => {
  const cases: [readonly string[], string][] = [
    [COMPLETION_SOURCES, 'completion'],
    [SETUP_SOURCES, 'setup'],
    [ARCHIVED_OR_BACKFILL_SOURCES, 'archived_or_backfill'],
    [PARENT_ACTION_SOURCES, 'parent_action'],
    [RETIRED_SOURCES, 'parent_action'],
  ]
  for (const [list, expected] of cases) {
    for (const v of list) {
      assert.equal(classifyScheduledSource(v), expected, `${v} should classify ${expected}`)
      assert.equal(isAutomaticSource(v), false, `${v} must NOT be described as automatic`)
    }
  }
  // Named regressions: these were mislabelled automatic by the previous helper.
  for (const v of ['past_year', 'completion_backfill', 'catchup_resched', 'wizard_create', 'completion_today']) {
    assert.notEqual(classifyScheduledSource(v), 'automatic', `${v} must not be automatic`)
  }

  // catchup_resched is a COMPLETION, not archive/backfill. Its name says
  // "reschedule" but it marks an existing queue row done on a chosen past day,
  // keeping lesson_number and queue_position. The misleading name is exactly
  // why this assertion exists.
  assert.equal(classifyScheduledSource('catchup_resched'), 'completion')
  assert.equal(classifyScheduledSource('completion_backfill'), 'archived_or_backfill')
  assert.equal(classifyScheduledSource('past_year'), 'archived_or_backfill')
})

test('classification: null, empty and unrecognised values classify unknown', () => {
  for (const v of [null, undefined, '', 'a_source_from_a_newer_deploy', 'legacy_typo']) {
    assert.equal(classifyScheduledSource(v), 'unknown', `${String(v)} should classify unknown`)
    assert.equal(isAutomaticSource(v), false, `${String(v)} must NOT be described as automatic`)
    assert.equal(isParentAction(v), false)
  }
})

test('containment policy stays fail-closed, and is named for the policy', () => {
  // Fail-closed on BOTH automatic and unknown.
  for (const v of [...AUTOMATIC_SOURCES, null, undefined, '', 'a_source_from_a_newer_deploy']) {
    assert.equal(isKnownIntentionalSource(v), false, `${String(v)} must not be vouched for`)
    assert.equal(shouldBlockAmbiguousScheduleWrite(v), true, `${String(v)} must be blocked`)
  }
  // Permitted: every known intentional category.
  for (const v of [...COMPLETION_SOURCES, ...SETUP_SOURCES, ...ARCHIVED_OR_BACKFILL_SOURCES,
                   ...PARENT_ACTION_SOURCES, ...RETIRED_SOURCES]) {
    assert.equal(isKnownIntentionalSource(v), true, `${v} should be permitted`)
    assert.equal(shouldBlockAmbiguousScheduleWrite(v), false, `${v} should not be blocked`)
  }
})

test('category sets are disjoint and cover the whole vocabulary', () => {
  const sets: [string, readonly string[]][] = [
    ['automatic', AUTOMATIC_SOURCES],
    ['completion', COMPLETION_SOURCES],
    ['setup', SETUP_SOURCES],
    ['archived_or_backfill', ARCHIVED_OR_BACKFILL_SOURCES],
    ['parent_action', PARENT_ACTION_SOURCES],
    ['retired', RETIRED_SOURCES],
  ]
  const seen = new Map<string, string>()
  for (const [name, list] of sets) {
    for (const v of list) {
      assert.ok(!seen.has(v), `${v} is in both ${seen.get(v)} and ${name}`)
      seen.set(v, name)
    }
  }
  // Coverage: nothing in the vocabulary classifies unknown.
  for (const v of ALL_SCHEDULED_SOURCES) {
    assert.notEqual(classifyScheduledSource(v), 'unknown', `${v} is in the vocabulary but classifies unknown`)
  }
  assert.equal(seen.size, ALL_SCHEDULED_SOURCES.length)
})

test('the vocabulary has no duplicates', () => {
  const seen = new Set(ALL_SCHEDULED_SOURCES)
  assert.equal(seen.size, ALL_SCHEDULED_SOURCES.length)
  assert.ok(ALL_SCHEDULED_SOURCES.includes('queue_resync'))
})
