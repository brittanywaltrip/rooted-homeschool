// The Today assertions in the smoke suite must be rooted in Today's own
// section.
//
// Today's cards and the Upcoming/Past tabs below them render the same heading
// (lessonRowTitle: "Subject · Lesson N"). The card helper in
// smoke/critical-paths.spec.ts finds that heading and then walks the
// `ancestor::` axis up to the first element containing a "Mark lesson" toggle.
// Started from an Upcoming row, that walk climbs past the tabs to <main>, which
// does contain Today's toggles — so an unrooted lookup answered "tomorrow's
// lesson is due today" whenever the Upcoming tab had finished loading, and
// passed whenever it had not. That is the 2026-09-22 flake in the Invariant 23
// make-up specs: the database was right every time and only the lookup was
// wrong.
//
// Both halves are asserted here because either one alone is useless: the
// testid with nothing reading it, or the lookup rooted at a testid no component
// renders (getByTestId then matches nothing and every count is 0, which would
// make these specs pass without testing anything).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const TESTID = 'today-schedule'

test("Today's schedule container carries the testid the smoke suite roots in", () => {
  const schedule = read('app/components/today/TodaySchedule.tsx')
  assert.ok(
    schedule.includes(`data-testid="${TESTID}"`),
    `TodaySchedule.tsx must render data-testid="${TESTID}" on the element wrapping Today's cards`,
  )
})

test('the smoke suite looks for Today cards inside that container, not on the page', () => {
  const spec = read('e2e/smoke/critical-paths.spec.ts')
  const helper = spec.slice(spec.indexOf('function todayCard('))
  const body = helper.slice(0, helper.indexOf('\n}'))
  assert.ok(body.length > 0, 'todayCard helper not found in critical-paths.spec.ts')
  assert.ok(
    body.includes(`getByTestId('${TESTID}')`),
    `todayCard must start from getByTestId('${TESTID}'); an unrooted getByText matches the Upcoming tab too`,
  )
  const testid = body.indexOf(`getByTestId('${TESTID}')`)
  const text = body.indexOf('getByText(')
  assert.ok(testid < text, 'the testid must come first, so the text lookup is scoped by it')
})
