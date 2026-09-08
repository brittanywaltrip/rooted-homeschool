// Unit tests for the printed daily-log row.
//
// A family prints this as DOCUMENTATION — for a school district, an umbrella
// school, a state filing. What a row says about their year is worth checking.
//
// Run:
//   node --test lib/progress-report.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  lessonDailyLogRow,
  lessonReportDescription,
  lessonReportSubject,
  type ReportLessonRow,
} from './progress-report-rows.ts'

const row = (over: Partial<ReportLessonRow> = {}): ReportLessonRow => ({
  title: 'Lesson 12',
  subjects: null,
  curriculum_goals: null,
  ...over,
})

const logRow = (l: ReportLessonRow) =>
  lessonDailyLogRow({ lesson: l, childName: 'Zoe', minutes: 30, estimated: false })

// ── is_backfill is not "imported" ───────────────────────────────────────────

test('a backfilled completion prints its plain title, typed as a Lesson', () => {
  // is_backfill is set on EVERY completion a family dates to a day other than
  // today (completeLessonOnDate), because the reconciler reads it to leave the
  // row where they put it. It has not meant "imported" for a long time. 42 of
  // 139 completed lessons on the account this was found on carried it, all of
  // them lessons the family did themselves.
  const r = logRow(row({ is_backfill: true }))
  assert.equal(r.description, 'Lesson 12', 'no "(imported)" suffix')
  assert.equal(r.type, 'Lesson', 'and not typed "Imported"')
})

test('a completion with the flag unset reads identically', () => {
  // The point of the change: the flag makes NO difference to what prints.
  const withFlag = logRow(row({ is_backfill: true }))
  const without = logRow(row({ is_backfill: false }))
  assert.deepEqual(withFlag, without)
  assert.deepEqual(logRow(row({ is_backfill: undefined })), without)
})

test('a lesson with no title still says something', () => {
  assert.equal(lessonReportDescription(row({ title: null })), 'Lesson')
  assert.equal(lessonReportDescription(row({ title: '' })), 'Lesson')
})

// ── The subject lives on the goal ───────────────────────────────────────────

test('a curriculum lesson takes its subject from the goal', () => {
  // Curriculum lessons carry subject_id NULL, so subjects.name is null and the
  // old code printed "General" for 138 of 139 lessons.
  const r = logRow(
    row({ subjects: null, curriculum_goals: { subject_label: 'Math', curriculum_name: 'Saxon 5/4' } }),
  )
  assert.equal(r.subject, 'Math')
})

test('an explicit subject still wins over the goal label', () => {
  const r = logRow(
    row({ subjects: { name: 'Science' }, curriculum_goals: { subject_label: 'Math', curriculum_name: 'Saxon' } }),
  )
  assert.equal(r.subject, 'Science')
})

test('a goal with no subject label falls back to its name, which the family chose', () => {
  const r = logRow(
    row({ subjects: null, curriculum_goals: { subject_label: null, curriculum_name: 'Morning Basket' } }),
  )
  assert.equal(r.subject, 'Morning Basket')
})

test('a lesson with neither reads General', () => {
  assert.equal(lessonReportSubject(row({ subjects: null, curriculum_goals: null })), 'General')
  assert.equal(
    lessonReportSubject(row({ subjects: { name: '' }, curriculum_goals: { subject_label: '', curriculum_name: '' } })),
    'General',
    'empty strings are not a subject',
  )
})

// ── The rest of the row ─────────────────────────────────────────────────────

test('the row carries the child, minutes and estimated flag through untouched', () => {
  const r = lessonDailyLogRow({
    lesson: row({ title: 'Chapter 3' }),
    childName: 'Micah',
    minutes: 45,
    estimated: true,
  })
  assert.equal(r.childName, 'Micah')
  assert.equal(r.minutes, 45)
  assert.equal(r.estimated, true)
  assert.equal(r.description, 'Chapter 3')
})
