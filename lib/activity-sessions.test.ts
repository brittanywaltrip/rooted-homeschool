// node --test lib/activity-sessions.test.ts
//
// Leslie's shape, reproduced. Reported 2026-09-20: her Progress Report showed
// her recurring-activity time and her Hours & Attendance log showed none of it,
// because that page read timed memories (she has ZERO) and never read
// activity_logs (she has 20 completed).
//
// Production facts these fixtures mirror, read read-only:
//   223 completed lessons, 31 of them standalone (no curriculum_goal_id)
//   29 standalone lessons resolve to a "Subject · Title" category, 2 do not
//   8 activity definitions, of which 3 are RETIRED (is_active false)
//   20 completed activity_logs, 3 of them against those retired definitions
//   0 timed memories

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  selectActivitySessions,
  summarizeActivitySessions,
  groupActivitySessions,
  activityBelongsToChild,
  RETIRED_ACTIVITY_LABEL,
  type ActivityDefinition,
  type ActivityLogRow,
} from './activity-sessions.ts'
import { lessonReportSubject } from './progress-report-rows.ts'

const CHILD_A = 'child-a'
const CHILD_B = 'child-b'
const RANGE = { dateFrom: '2026-08-01', dateTo: '2026-09-30' }

/** 8 definitions: 5 active, 3 retired — exactly her split. */
const DEFS: ActivityDefinition[] = [
  { id: 'a1', name: 'Piano',      emoji: '🎹', child_ids: [CHILD_A], is_active: true },
  { id: 'a2', name: 'Swimming',   emoji: '🏊', child_ids: [CHILD_A], is_active: true },
  { id: 'a3', name: 'Co-op',      emoji: '🤝', child_ids: [],        is_active: true },
  { id: 'a4', name: 'Art Class',  emoji: '🎨', child_ids: [CHILD_B], is_active: true },
  { id: 'a5', name: 'Scouts',     emoji: '⚜️', child_ids: null,      is_active: true },
  { id: 'a6', name: 'Old Ballet', emoji: '🩰', child_ids: [CHILD_A], is_active: false },
  { id: 'a7', name: 'Old Chess',  emoji: '♟️', child_ids: [],        is_active: false },
  { id: 'a8', name: 'Old Choir',  emoji: '🎵', child_ids: [CHILD_A], is_active: false },
]

/** 20 completed logs: 17 against active definitions, 3 against retired ones. */
const LOGS: ActivityLogRow[] = [
  ...Array.from({ length: 5 }, (_, i) => ({ activity_id: 'a1', date: `2026-08-2${i}`, minutes_spent: 60, completed: true })),
  ...Array.from({ length: 4 }, (_, i) => ({ activity_id: 'a2', date: `2026-09-0${i + 1}`, minutes_spent: 45, completed: true })),
  ...Array.from({ length: 4 }, (_, i) => ({ activity_id: 'a3', date: `2026-09-1${i}`, minutes_spent: 90, completed: true })),
  ...Array.from({ length: 2 }, (_, i) => ({ activity_id: 'a4', date: `2026-09-0${i + 5}`, minutes_spent: 30, completed: true })),
  ...Array.from({ length: 2 }, (_, i) => ({ activity_id: 'a5', date: `2026-09-1${i + 5}`, minutes_spent: 30, completed: true })),
  { activity_id: 'a6', date: '2026-08-19', minutes_spent: 60, completed: true },
  { activity_id: 'a7', date: '2026-08-19', minutes_spent: 90, completed: true },
  { activity_id: 'a8', date: '2026-08-19', minutes_spent: 60, completed: true },
]

test("Leslie's shape: 8 activity types and 20 completed sessions", () => {
  assert.equal(DEFS.length, 8, 'the fixture must hold her 8 definitions')
  assert.equal(LOGS.length, 20, 'the fixture must hold her 20 completed logs')

  const sessions = selectActivitySessions(LOGS, DEFS, { ...RANGE, childId: null })
  const summary = summarizeActivitySessions(sessions)

  assert.equal(summary.sessions, 20, 'all 20 completed sessions appear')
  assert.equal(summary.activityTypes, 8, 'all 8 activities are represented')
  // Her real split: 960 minutes against active definitions, 210 against
  // retired ones. The fixture mirrors both so a change that drops the retired
  // three shows up as a minutes difference too, not only a count.
  assert.equal(summary.minutes, 960 + 210, 'minutes are the sum of the logs')
  const activeMinutes = sessions.filter((x) => x.definitionIsActive).reduce((m, x) => m + x.minutes, 0)
  assert.equal(activeMinutes, 960, 'active-definition minutes match production')
})

test('retired definitions keep their historical sessions and their names', () => {
  // The bug this prevents: filtering definitions by is_active would drop 3 of
  // her sessions and 3.5 hours, silently, because she tidied her activity list.
  const sessions = selectActivitySessions(LOGS, DEFS, { ...RANGE, childId: null })
  const retired = sessions.filter((s) => !s.definitionIsActive)
  assert.equal(retired.length, 3, 'the 3 retired-activity sessions survive')
  assert.deepEqual(
    [...new Set(retired.map((s) => s.name))].sort(),
    ['Old Ballet', 'Old Chess', 'Old Choir'],
    'and they keep their real names, not a placeholder',
  )
  assert.equal(retired.reduce((m, s) => m + s.minutes, 0), 210)
})

test('a session whose definition is gone entirely is still counted', () => {
  const sessions = selectActivitySessions(
    [{ activity_id: 'vanished', date: '2026-09-01', minutes_spent: 30, completed: true }],
    DEFS, { ...RANGE, childId: null },
  )
  assert.equal(sessions.length, 1, 'the hours were really spent; do not drop them')
  assert.equal(sessions[0].name, RETIRED_ACTIVITY_LABEL)
  assert.equal(sessions[0].definitionMissing, true)
})

test('child scoping uses the ACTIVITY definition child_ids', () => {
  const forA = selectActivitySessions(LOGS, DEFS, { ...RANGE, childId: CHILD_A })
  const forB = selectActivitySessions(LOGS, DEFS, { ...RANGE, childId: CHILD_B })

  // a4 (Art Class) is child B's only named activity; child A must not get it.
  assert.ok(!forA.some((s) => s.activityId === 'a4'), "child A must not inherit child B's activity")
  assert.ok(forB.some((s) => s.activityId === 'a4'))

  // Whole-family activities (empty or null child_ids) count for either child.
  for (const shared of ['a3', 'a5']) {
    assert.ok(forA.some((s) => s.activityId === shared), `${shared} is whole-family, so child A gets it`)
    assert.ok(forB.some((s) => s.activityId === shared), `${shared} is whole-family, so child B gets it`)
  }
  assert.equal(activityBelongsToChild(DEFS[2], CHILD_B), true, 'empty child_ids is whole-family')
  assert.equal(activityBelongsToChild(DEFS[4], CHILD_B), true, 'null child_ids is whole-family')
  assert.equal(activityBelongsToChild(DEFS[3], CHILD_A), false)
})

test('inclusion uses the LOG date, and the range is inclusive at both ends', () => {
  const logs: ActivityLogRow[] = [
    { activity_id: 'a1', date: '2026-07-31', minutes_spent: 60, completed: true }, // before
    { activity_id: 'a1', date: '2026-08-01', minutes_spent: 60, completed: true }, // first day
    { activity_id: 'a1', date: '2026-09-30', minutes_spent: 60, completed: true }, // last day
    { activity_id: 'a1', date: '2026-10-01', minutes_spent: 60, completed: true }, // after
  ]
  const got = selectActivitySessions(logs, DEFS, { ...RANGE, childId: null })
  assert.deepEqual(got.map((s) => s.date), ['2026-08-01', '2026-09-30'])
})

test('an incomplete log never appears', () => {
  const got = selectActivitySessions(
    [{ activity_id: 'a1', date: '2026-09-01', minutes_spent: 60, completed: false }],
    DEFS, { ...RANGE, childId: null },
  )
  assert.equal(got.length, 0)
})

test('sessions are not double counted, and types are not counted as sessions', () => {
  const sessions = selectActivitySessions(LOGS, DEFS, { ...RANGE, childId: null })
  const groups = groupActivitySessions(sessions)
  assert.equal(groups.length, 8, 'one row per activity')
  assert.equal(groups.reduce((n, g) => n + g.sessions, 0), 20, 'the rows sum to the sessions')
  assert.notEqual(groups.length, sessions.length, '8 types is not 20 sessions')
  // Every session belongs to exactly one group.
  const ids = new Set(groups.map((g) => g.activityId))
  assert.equal(ids.size, groups.length, 'no activity appears twice')
})

test("Leslie's lessons: 223 completed, only 2 Unassigned", () => {
  // 192 curriculum lessons + 29 standalone WITH a "Subject · Title" + 2 without.
  type L = Parameters<typeof lessonReportSubject>[0]
  const lessons: L[] = [
    ...Array.from({ length: 192 }, () => ({
      title: 'Lesson 4', curriculum_goal_id: 'g1', curriculum_goals: { subject_label: 'Math', curriculum_name: 'Singapore' },
    } as unknown as L)),
    ...Array.from({ length: 29 }, (_, i) => ({
      title: `Music · Practice ${i + 1}`, curriculum_goal_id: null,
    } as unknown as L)),
    // Her 2 truly category-free rows are PLAIN titles with no separator
    // (verified read-only against production: lengths 11 and 15, no middot),
    // not empty strings and not nulls -- lessons.title is NOT NULL.
    { title: 'Field Day', curriculum_goal_id: null } as unknown as L,
    { title: 'Museum Visit', curriculum_goal_id: null } as unknown as L,
  ]
  assert.equal(lessons.length, 223, 'her 223 completed lessons')

  const unassigned = lessons.filter((l) => lessonReportSubject(l, 'Unassigned') === 'Unassigned')
  assert.equal(unassigned.length, 2, 'only the 2 truly category-free rows fall back')

  const standalone = lessons.filter((l) => (l as { curriculum_goal_id: string | null }).curriculum_goal_id === null)
  assert.equal(standalone.length, 31, 'her 31 standalone lessons')
  assert.equal(
    standalone.filter((l) => lessonReportSubject(l, 'Unassigned') !== 'Unassigned').length,
    29,
    'the 29 titled standalone lessons stay categorized',
  )
})

test('standalone lessons are never attached to a curriculum', () => {
  const standalone = { title: 'Music · Practice 1', curriculum_goal_id: null } as unknown as Parameters<typeof lessonReportSubject>[0]
  const subject = lessonReportSubject(standalone, 'Unassigned')
  assert.equal(subject, 'Music', 'it is categorized by its own title')
  assert.equal(
    (standalone as { curriculum_goal_id: string | null }).curriculum_goal_id, null,
    'and it still has no curriculum_goal_id: categorizing is not attaching',
  )
})
