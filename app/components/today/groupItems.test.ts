// Tests for the Today page grouping logic and the day-of-week boundary
// helpers. The grouping function is pure; "today" is decided by the loader
// before items reach it.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  groupItems,
  jsDowToMonZero,
  curriculumDayLabelToMonZero,
  appointmentDowToMonZero,
  type TodayItem,
  type Child,
} from './groupItems.ts'

const EMMA: Child = { id: 'emma', name: 'Emma', color: '#7a5c8a', sort_order: 1 }
const ZOE: Child = { id: 'zoe', name: 'Zoe', color: '#4a7a8a', sort_order: 2 }
const KIDS = [EMMA, ZOE]

function lesson(over: Partial<TodayItem> = {}): TodayItem {
  return {
    id: 'L' + Math.random().toString(36).slice(2, 7),
    kind: 'lesson',
    child_ids: [EMMA.id],
    time: null,
    duration_minutes: null,
    title: 'A lesson',
    subject_label: 'Math',
    lesson_number: 1,
    completed: false,
    raw: {},
    ...over,
  }
}

function appt(over: Partial<TodayItem> = {}): TodayItem {
  return {
    id: 'A' + Math.random().toString(36).slice(2, 7),
    kind: 'appointment',
    child_ids: [EMMA.id],
    time: '09:00',
    duration_minutes: 30,
    title: 'An appointment',
    subject_label: null,
    lesson_number: null,
    completed: false,
    raw: {},
    ...over,
  }
}

function activity(over: Partial<TodayItem> = {}): TodayItem {
  return {
    id: 'X' + Math.random().toString(36).slice(2, 7),
    kind: 'activity',
    child_ids: [EMMA.id, ZOE.id], // default = whole family
    time: null,
    duration_minutes: 15,
    title: 'An activity',
    subject_label: null,
    lesson_number: null,
    completed: false,
    raw: {},
    ...over,
  }
}

// ─── Routing rules ───────────────────────────────────────────────────────

test('multi-kid item routes to Everyone, not to any kid section', () => {
  const items = [activity({ child_ids: [EMMA.id, ZOE.id], title: 'Co-op' })]
  const g = groupItems(items, KIDS)
  assert.equal(g.everyone.length, 1)
  assert.equal(g.everyone[0].title, 'Co-op')
  assert.equal(g.kids.length, 0)
})

test('null/empty child_ids item routes to Everyone (whole-family appointment)', () => {
  const items = [
    appt({ child_ids: null, title: 'Family dentist' }),
    appt({ child_ids: [], title: 'Family eye exam' }),
  ]
  const g = groupItems(items, KIDS)
  assert.equal(g.everyone.length, 2)
  assert.equal(g.kids.length, 0)
})

test('single-kid item routes to that kid only, not Everyone', () => {
  const items = [appt({ child_ids: [EMMA.id], title: "Emma's pediatrician" })]
  const g = groupItems(items, KIDS)
  assert.equal(g.everyone.length, 0)
  assert.equal(g.kids.length, 1)
  assert.equal(g.kids[0].child.id, EMMA.id)
  assert.equal(g.kids[0].apptsAndActivities[0].title, "Emma's pediatrician")
})

test('kid with zero items is skipped (no empty section rendered)', () => {
  const items = [lesson({ child_ids: [EMMA.id] })]
  const g = groupItems(items, KIDS)
  assert.equal(g.kids.length, 1)
  assert.equal(g.kids[0].child.id, EMMA.id) // Zoe not present
})

test('subjects with zero items are skipped (no empty subject group)', () => {
  // Emma has only Math; verify the section never carries an empty bucket
  // for anything else.
  const items = [lesson({ subject_label: 'Math', lesson_number: 1 })]
  const g = groupItems(items, KIDS)
  const emmaSection = g.kids[0]
  assert.equal(emmaSection.subjects.size, 1)
  assert.ok(emmaSection.subjects.has('Math'))
})

// ─── Sort orders ─────────────────────────────────────────────────────────

test('lessons within a subject sort by time, then lesson_number, then created_at', () => {
  const items = [
    lesson({ id: 'L3', subject_label: 'Math', time: null, lesson_number: 3, created_at: '2026-04-30T08:00:00Z' }),
    lesson({ id: 'L1', subject_label: 'Math', time: '08:00', lesson_number: 7 }),
    lesson({ id: 'L2', subject_label: 'Math', time: '09:00', lesson_number: 2 }),
    lesson({ id: 'L4', subject_label: 'Math', time: null, lesson_number: 1, created_at: '2026-04-30T09:00:00Z' }),
  ]
  const g = groupItems(items, KIDS)
  const math = g.kids[0].subjects.get('Math')!
  assert.deepEqual(math.map((x) => x.id), ['L1', 'L2', 'L4', 'L3'])
})

test('subjects within a kid sort by earliest time, ties broken alphabetically', () => {
  const items = [
    lesson({ subject_label: 'Math', time: '10:00', lesson_number: 1 }),
    lesson({ subject_label: 'Language Arts', time: '08:00', lesson_number: 1 }),
    lesson({ subject_label: 'Bible', time: null, lesson_number: 1 }),
    lesson({ subject_label: 'Art', time: null, lesson_number: 1 }),
  ]
  const g = groupItems(items, KIDS)
  const subjectOrder = Array.from(g.kids[0].subjects.keys())
  // Language Arts first (08:00), Math next (10:00), then null-time
  // alphabetically: Art < Bible.
  assert.deepEqual(subjectOrder, ['Language Arts', 'Math', 'Art', 'Bible'])
})

test('kids ordered by sort_order ascending; missing sort_order sinks to bottom', () => {
  const A: Child = { id: 'a', name: 'A', color: '#000000', sort_order: 5 }
  const B: Child = { id: 'b', name: 'B', color: '#000000', sort_order: 1 }
  const C: Child = { id: 'c', name: 'C', color: '#000000', sort_order: null }
  const items = [
    lesson({ child_ids: ['c'], subject_label: 'Math' }),
    lesson({ child_ids: ['a'], subject_label: 'Math' }),
    lesson({ child_ids: ['b'], subject_label: 'Math' }),
  ]
  const g = groupItems(items, [A, B, C])
  assert.deepEqual(g.kids.map((k) => k.child.id), ['b', 'a', 'c'])
})

test('Everyone section sorts by time ascending, untimed last', () => {
  const items = [
    appt({ child_ids: null, title: 'untimed', time: null }),
    appt({ child_ids: null, title: 'noon', time: '12:00' }),
    appt({ child_ids: null, title: 'morning', time: '09:00' }),
  ]
  const g = groupItems(items, KIDS)
  assert.deepEqual(g.everyone.map((x) => x.title), ['morning', 'noon', 'untimed'])
})

// ─── Counts ──────────────────────────────────────────────────────────────

test('per-kid totalCount and doneCount include every item type for that kid', () => {
  const items = [
    lesson({ child_ids: [EMMA.id], completed: true }),
    lesson({ child_ids: [EMMA.id], completed: false }),
    appt({ child_ids: [EMMA.id], completed: true }),
    activity({ child_ids: [EMMA.id], completed: false }),
  ]
  const g = groupItems(items, KIDS)
  assert.equal(g.kids[0].totalCount, 4)
  assert.equal(g.kids[0].doneCount, 2)
})

// ─── The day-of-week landmine: Tuesday from each source ──────────────────

test('day-of-week boundary: Tuesday converts identically across all three source conventions', () => {
  // JS Date.getDay() for a Tuesday returns 2.
  const aTuesday = new Date('2026-05-05T12:00:00Z') // Tue
  assert.equal(aTuesday.getUTCDay(), 2)

  // activities.days[]: Mon=0..Sun=6 → Tuesday is index 1
  const ACTIVITIES_TUESDAY = 1
  // appointments.recurrence_rule.days[]: Sun=0..Sat=6 → Tuesday is index 2
  const APPOINTMENTS_TUESDAY = 2
  // curriculum_goals.school_days[]: ["Mon","Tue",...] → label "Tue"
  const CURRICULUM_TUESDAY = 'Tue'

  // Normalize all three to the module's internal Mon=0..Sun=6 convention.
  // All three should land on the same value: 1.
  const fromActivities = ACTIVITIES_TUESDAY // already Mon=0
  const fromAppointments = appointmentDowToMonZero(APPOINTMENTS_TUESDAY)
  const fromCurriculum = curriculumDayLabelToMonZero(CURRICULUM_TUESDAY)
  const fromJs = jsDowToMonZero(aTuesday.getUTCDay())

  assert.equal(fromActivities, 1)
  assert.equal(fromAppointments, 1)
  assert.equal(fromCurriculum, 1)
  assert.equal(fromJs, 1)
})

test('day-of-week boundary: Sunday and Saturday edge cases', () => {
  // JS Sunday = 0 → Mon=0 convention = 6
  assert.equal(jsDowToMonZero(0), 6)
  // JS Saturday = 6 → Mon=0 convention = 5
  assert.equal(jsDowToMonZero(6), 5)
  // Appointments Sunday = 0 → Mon=0 convention = 6
  assert.equal(appointmentDowToMonZero(0), 6)
  // Appointments Saturday = 6 → Mon=0 convention = 5
  assert.equal(appointmentDowToMonZero(6), 5)
  // Curriculum labels:
  assert.equal(curriculumDayLabelToMonZero('Sun'), 6)
  assert.equal(curriculumDayLabelToMonZero('Sat'), 5)
  // Unknown label returns -1, NOT a default — caller must handle.
  assert.equal(curriculumDayLabelToMonZero('Bogus'), -1)
})

// ─── Empty input ─────────────────────────────────────────────────────────

test('empty items array: empty Everyone, empty kids', () => {
  const g = groupItems([], KIDS)
  assert.equal(g.everyone.length, 0)
  assert.equal(g.kids.length, 0)
})
