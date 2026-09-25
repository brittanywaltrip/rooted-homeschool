// Unit tests for the printed daily-log row.
//
// A family prints this as DOCUMENTATION — for a school district, an umbrella
// school, a state filing. What a row says about their year is worth checking.
//
// Run:
//   node --test lib/progress-report.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  lessonDailyLogRow,
  lessonReportDescription,
  lessonReportSubject,
  subjectTableTotals,
  buildRemovalContext,
  removedCurriculumName,
  type ReportLessonRow,
} from './progress-report-rows.ts'

function loadRepoFile(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), 'utf-8')
}

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

// ── Rule 4: a standalone log carries its subject in its own title ───────────
//
// A log with no curriculum usually has no subject_id either, so it printed as
// "General" even though the family had already said what it was: the add-lesson
// sheet writes the title as "Subject · Title". 193 rows across the database are
// in exactly that shape, and the prefixes are real subjects — Math (34),
// Reading (32), Science (19), Language Arts (15).

const DOT = ' · '

test('a standalone log takes its subject from the title prefix', () => {
  const r = logRow(row({ title: `Music${DOT}Cello Lesson`, curriculum_goal_id: null }))
  assert.equal(r.subject, 'Music')
  // The description keeps the whole title; only the SUBJECT is inferred.
  assert.equal(r.description, `Music${DOT}Cello Lesson`)
})

test('a standalone log with no separator falls back', () => {
  assert.equal(
    lessonReportSubject(row({ title: 'Word of the Day', curriculum_goal_id: null })),
    'General',
  )
})

test('a curriculum lesson never takes its subject from the title (rule 2 wins)', () => {
  // "Kitchen Math — Lesson 3" cannot contain the separator, but the guard is
  // on curriculum_goal_id rather than on the title's shape.
  const r = lessonReportSubject(
    row({
      title: 'Kitchen Math — Lesson 3',
      curriculum_goal_id: 'goal-1',
      curriculum_goals: { subject_label: 'Math', curriculum_name: 'Kitchen Math' },
    }),
  )
  assert.equal(r, 'Math')
})

test('a curriculum lesson is not given a title-derived subject even if it somehow has a separator', () => {
  // Belt and braces: the guard is the curriculum link, not the punctuation.
  assert.equal(
    lessonReportSubject(row({ title: `Music${DOT}Something`, curriculum_goal_id: 'goal-1' })),
    'General',
    'a curriculum row falls to the fallback rather than inferring',
  )
})

test('a prefix longer than 40 characters is a description, not a subject', () => {
  // The one real row in the database that exceeds the bound.
  const long = 'Financial Literacy and Entrepreneur Practice' // 44 chars
  assert.equal(long.length, 44)
  assert.equal(
    lessonReportSubject(row({ title: `${long}${DOT}Budgeting`, curriculum_goal_id: null })),
    'General',
  )
  // 40 exactly is still a subject.
  const forty = 'A'.repeat(40)
  assert.equal(
    lessonReportSubject(row({ title: `${forty}${DOT}Thing`, curriculum_goal_id: null })),
    forty,
  )
})

test('an empty prefix is not a subject', () => {
  assert.equal(
    lessonReportSubject(row({ title: `${DOT}Just a title`, curriculum_goal_id: null })),
    'General',
  )
})

test('only the spaced middle dot counts, not a hyphen or a bare dot', () => {
  // A looser separator would match half the titles in the database.
  //
  // 'Math — Lesson 3' was in this list until 2026-09-09. It is no longer a
  // "must not be split" case: the spaced em dash is the Schedule Builder's own
  // title format, and on a row with NO curriculum it can name a removed
  // curriculum under rule 5, but only when the family's records establish the
  // removal. See "an orphaned lesson is labelled a removed curriculum only
  // when removal is established" below. The middle-dot rule itself is
  // unchanged, which is what this test is about.
  for (const title of ['Math - Addition', 'Math·Addition', 'Math: Addition']) {
    assert.equal(
      lessonReportSubject(row({ title, curriculum_goal_id: null })),
      'General',
      `"${title}" must not be split`,
    )
  }
})

test('an explicit subject still beats the title prefix', () => {
  assert.equal(
    lessonReportSubject(
      row({ title: `Music${DOT}Cello`, curriculum_goal_id: null, subjects: { name: 'Band' } }),
    ),
    'Band',
  )
})

test('the fallback is a parameter, so the two reports word it differently', () => {
  const r = row({ title: 'Word of the Day', curriculum_goal_id: null })
  assert.equal(lessonReportSubject(r), 'General', 'the Progress Report default')
  assert.equal(lessonReportSubject(r, 'Unassigned'), 'Unassigned', 'the Attendance Log wording')
  // The fallback must not override a subject that actually resolved.
  assert.equal(
    lessonReportSubject(row({ title: `Math${DOT}Adding`, curriculum_goal_id: null }), 'Unassigned'),
    'Math',
  )
})

test('the attendance page uses the shared resolver and groups by it', () => {
  const src = loadRepoFile('app/dashboard/reports/page.tsx')
  assert.ok(
    /import \{[^}]*\blessonReportSubject\b[^}]*\} from "@\/lib\/progress-report-rows"/.test(src),
    'the page imports the shared resolver',
  )
  assert.ok(
    /lessonReportSubject\(l, "Unassigned", removal\)/.test(src),
    'and calls it with its own fallback wording and the removal context',
  )
  // The family's own subject is read, so a lesson kept after its curriculum was
  // deleted still prints under the subject the delete carried onto it.
  assert.ok(/subjects\(name\)/.test(src.slice(src.indexOf('const LESSON_COLUMNS'), src.indexOf('const LESSON_COLUMNS') + 300)),
    'LESSON_COLUMNS reads subjects(name)')
  assert.ok(/from\("app_events"\)\.select\("payload"\)\.eq\("user_id", effectiveUserId\)\.eq\("type", "curriculum_goal\.deleted"\)/.test(src),
    'removal is established from the family\'s own deletion records')
  assert.ok(
    !/\?\? "Unassigned"/.test(src),
    'the hand-rolled subject_label fallback is gone',
  )
  // Standalone logs must group by their resolved subject, or Music, Math and
  // Writing all collapse into one "Unassigned" line and the fix is invisible.
  assert.ok(
    /uncat:\$\{name\}/.test(src),
    'standalone logs key by subject, not into one bucket',
  )
})

/* ── Item 5: an orphaned curriculum lesson still prints under its subject ──
 * Deleting a curriculum keeps its completed lessons as history, and the FK
 * (ON DELETE SET NULL) clears curriculum_goal_id on the way out. Rules 2 and 3
 * go empty, so without a fallback the work a child really did prints as
 * "General" on a document handed to a school district.
 * ─────────────────────────────────────────────────────────────────────── */

const MDASH = ' — Lesson '

// The family's own records: "Apologia" and "Happy Cheetah" were deleted;
// "Saxon Math" was deleted once but a curriculum by that name exists again.
const removal = buildRemovalContext(['Apologia', ' happy cheetah ', 'Saxon Math'], ['Saxon Math', 'Reading'])

test('an orphaned lesson is labelled a removed curriculum only when removal is established', () => {
  assert.equal(
    lessonReportSubject(row({ title: `Apologia${MDASH}1`, curriculum_goal_id: null }), 'General', removal),
    'Apologia (removed curriculum)',
  )
  // Both report fallbacks, since the Attendance Log passes its own. Name match
  // ignores case and surrounding space.
  assert.equal(
    lessonReportSubject(row({ title: `Happy Cheetah${MDASH}12`, curriculum_goal_id: null }), 'Unassigned', removal),
    'Happy Cheetah (removed curriculum)',
  )
})

test('no removal is claimed without the evidence', () => {
  const orphan = row({ title: `Apologia${MDASH}1`, curriculum_goal_id: null })
  // No context at all: nothing can be established.
  assert.equal(lessonReportSubject(orphan, 'Unassigned'), 'Unassigned')
  // No deletion record for that name.
  assert.equal(
    lessonReportSubject(row({ title: `Math Mammoth${MDASH}4`, curriculum_goal_id: null }), 'Unassigned', removal),
    'Unassigned',
  )
  // A curriculum by that name exists now, so the row may simply be detached.
  assert.equal(
    lessonReportSubject(row({ title: `Saxon Math${MDASH}2`, curriculum_goal_id: null }), 'Unassigned', removal),
    'Unassigned',
  )
  // Not the builder's exact title shape: trailing words after the number.
  assert.equal(
    lessonReportSubject(row({ title: `Apologia${MDASH}1 review`, curriculum_goal_id: null }), 'Unassigned', removal),
    'Unassigned',
  )
  assert.equal(removedCurriculumName(orphan, null), null)
})

test('the family\'s own subject beats any curriculum label, and a curriculum is never printed as a subject', () => {
  assert.equal(
    lessonReportSubject(row({ title: `Apologia${MDASH}1`, curriculum_goal_id: null, subjects: { name: 'Science' } }), 'General', removal),
    'Science',
  )
  // Without established removal the title prefix is NOT used as a subject.
  assert.notEqual(lessonReportSubject(row({ title: `Apologia${MDASH}1`, curriculum_goal_id: null })), 'Apologia')
})

test('the orphan rule keeps the whole title as the description', () => {
  const r = lessonDailyLogRow({ lesson: row({ title: `Apologia${MDASH}1`, curriculum_goal_id: null }), childName: 'Ava', minutes: 30, estimated: false, removal })
  assert.equal(r.subject, 'Apologia (removed curriculum)')
  assert.equal(r.description, `Apologia${MDASH}1`)
  // Unestablished: the saved title is still printed in full.
  const u = logRow(row({ title: `Apologia${MDASH}1`, curriculum_goal_id: null }))
  assert.equal(u.subject, 'General')
  assert.equal(u.description, `Apologia${MDASH}1`)
})

test('a row that still has its curriculum never uses the orphan rule', () => {
  // Rule 2 wins. Otherwise a live goal renamed since its lessons were written
  // would print under the OLD name still sitting in the titles.
  assert.equal(
    lessonReportSubject(
      row({
        title: `Old Name${MDASH}1`,
        curriculum_goal_id: 'g1',
        curriculum_goals: { subject_label: 'Science', curriculum_name: 'New Name' },
      }),
    ),
    'Science',
  )
})

test('the orphan rule is bounded the same way the middle-dot rule is', () => {
  // 41 characters: a description, not a subject heading.
  const long = 'Financial Literacy and Entrepreneur Practic'
  assert.ok(long.length > 40)
  assert.equal(
    lessonReportSubject(row({ title: `${long}${MDASH}3`, curriculum_goal_id: null })),
    'General',
  )
  // A plain hyphen is not the builder's separator and must not match.
  assert.equal(
    lessonReportSubject(row({ title: 'Apologia - Lesson 1', curriculum_goal_id: null })),
    'General',
  )
})

test('the middle-dot rule still wins over the orphan rule when both could match', () => {
  assert.equal(
    lessonReportSubject(row({ title: `Music · Apologia${MDASH}1`, curriculum_goal_id: null })),
    'Music',
  )
})

// ── the PDF's per-child subject table ──────────────────────────────────────

test('the subject table puts a curriculum lesson under its goal subject, not General', () => {
  const lessons: ReportLessonRow[] = [
    // A curriculum lesson: subject_id NULL, the subject lives on the goal.
    { title: 'Math Mammoth 3 — Lesson 1', subjects: null, curriculum_goal_id: 'g1', curriculum_goals: { subject_label: 'Math', curriculum_name: 'Math Mammoth 3' } },
    { title: 'Math Mammoth 3 — Lesson 2', subjects: null, curriculum_goal_id: 'g1', curriculum_goals: { subject_label: 'Math', curriculum_name: 'Math Mammoth 3' } },
    // No subject_label: the curriculum the family named.
    { title: 'All About Reading — Lesson 4', subjects: null, curriculum_goal_id: 'g2', curriculum_goals: { subject_label: null, curriculum_name: 'All About Reading' } },
    // A true one-off with no subject anywhere is the only General.
    { title: 'Nature walk', subjects: null, curriculum_goal_id: null, curriculum_goals: null },
  ]
  const rows = subjectTableTotals(lessons, () => ({ m: 30, e: false }))
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
  assert.equal(byName['Math']?.count, 2, 'curriculum lessons land under Math')
  assert.equal(byName['Math']?.minutes, 60)
  assert.equal(byName['All About Reading']?.count, 1)
  assert.equal(byName['General']?.count, 1, 'only the one-off is General')
})

test('the PDF subject table and the day-by-day log use the same subject rule', () => {
  const src = loadRepoFile('lib/progress-report.ts')
  assert.match(src, /subjectTableTotals\(childLessons, /)
  assert.ok(!/l\.subjects\?\.name \|\| "General"/.test(src), 'the subjects.name-only lookup is gone')
})
