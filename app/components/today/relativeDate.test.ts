// Unit tests for the Today relative-date helper. Pin the timezone bug
// that mislabelled completed-today lessons as "Tomorrow" in Brittany's
// account on 2026-05-01.
//
// All tests are TZ-agnostic: `now` and the completion timestamp are
// constructed via `new Date(localYear, localMonth, localDay, ...)`,
// which produces a local-time Date regardless of the runner's TZ.
// Reading back via getFullYear / getMonth / getDate gives the same
// LOCAL year/month/day in any timezone, so the assertions hold whether
// CI runs in UTC, Central, or Hawaii.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatRelativeDate, formatRelativeFromTimestamp } from './relativeDate.ts'

test('formatRelativeDate: same local date returns "Today" (regression for the noon-vs-midnight bug)', () => {
  // The old inline helper built `today` at local midnight and `target`
  // at local noon, producing diff = 0.5 days that Math.round rounded
  // to 1 → "Tomorrow". Repro: now = local May 1 anything, dateStr =
  // "2026-05-01" → must be "Today".
  const now = new Date(2026, 4, 1, 18, 0)
  assert.equal(formatRelativeDate('2026-05-01', now), 'Today')
})

test('formatRelativeDate: previous local date returns "Yesterday"', () => {
  const now = new Date(2026, 4, 1, 18, 0)
  assert.equal(formatRelativeDate('2026-04-30', now), 'Yesterday')
})

test('formatRelativeDate: next local date returns "Tomorrow"', () => {
  const now = new Date(2026, 4, 1, 18, 0)
  assert.equal(formatRelativeDate('2026-05-02', now), 'Tomorrow')
})

test('formatRelativeDate: 2-6 days ahead returns weekday short name', () => {
  // May 1 2026 is Friday. Sun May 3 = +2 days, expect "Sun".
  const now = new Date(2026, 4, 1, 12, 0)
  assert.equal(formatRelativeDate('2026-05-03', now), 'Sun')
})

test('formatRelativeDate: more than a week away returns "Mon Day"', () => {
  const now = new Date(2026, 4, 1, 12, 0)
  // 30 days ago.
  assert.equal(formatRelativeDate('2026-04-01', now), 'Apr 1')
})

// ── Brittany Bug B verbatim repros (2026-05-01) ────────────────────────

test('formatRelativeFromTimestamp: completed earlier today → "Today" (Brittany Bug B test 1)', () => {
  // Spec: now = May 1 6pm local, completed_at = May 1 12:21am local.
  // Both are local May 1 → label must be "Today" (NOT "Tomorrow").
  // The bug we fixed: the old helper sliced the ISO timestamp's UTC
  // date and compared via noon-vs-midnight diff arithmetic, producing
  // "Tomorrow" for same-local-day completions.
  const now = new Date(2026, 4, 1, 18, 0, 0)
  const completedAt = new Date(2026, 4, 1, 0, 21, 31)
  assert.equal(formatRelativeFromTimestamp(completedAt.toISOString(), now), 'Today')
})

test('formatRelativeFromTimestamp: completed yesterday in local time → "Yesterday" (Brittany Bug B test 2)', () => {
  // Spec: now = May 1 6pm local, completed_at = April 30 6:47pm local.
  // Local Y-M-D differs by 1 → "Yesterday".
  const now = new Date(2026, 4, 1, 18, 0, 0)
  const completedAt = new Date(2026, 3, 30, 18, 47, 0)
  assert.equal(formatRelativeFromTimestamp(completedAt.toISOString(), now), 'Yesterday')
})

test('formatRelativeFromTimestamp: completed late at night same local day still says "Today"', () => {
  // Edge case: 11:55 PM local on May 1, "now" is also May 1 11:58 PM.
  // Both are local May 1 → "Today". The function must NOT switch to
  // UTC date math (which would produce "Tomorrow" or "Yesterday"
  // depending on TZ).
  const now = new Date(2026, 4, 1, 23, 58, 0)
  const completedAt = new Date(2026, 4, 1, 23, 55, 0)
  assert.equal(formatRelativeFromTimestamp(completedAt.toISOString(), now), 'Today')
})

test('formatRelativeFromTimestamp: completed early next morning local time is "Tomorrow"', () => {
  // Sanity check the other direction. now = late on day N, completed
  // = early morning of day N+1 → "Tomorrow".
  const now = new Date(2026, 4, 1, 23, 0, 0)
  const completedAt = new Date(2026, 4, 2, 1, 0, 0)
  assert.equal(formatRelativeFromTimestamp(completedAt.toISOString(), now), 'Tomorrow')
})
