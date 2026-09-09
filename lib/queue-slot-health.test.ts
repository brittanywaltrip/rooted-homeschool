// Tests for the shared queue-slot vocabulary. Run with: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  NON_FAMILY_EMAILS,
  isNonFamilyEmail,
  classifyGoalSlots,
} from './queue-slot-health.ts'

const slots = (...xs: number[]) => new Set(xs)

/* ── the shared exclusion list ────────────────────────────────────────── */

test('the exclusion list holds all four non-family accounts', () => {
  for (const email of [
    'test@rootedhomeschoolapp.com',
    'rooted.e2e@rootedhomeschoolapp.com',
    'garfieldbrittany+test1@gmail.com',
    'brittanywaltrip20@gmail.com',
  ]) {
    assert.ok(NON_FAMILY_EMAILS.includes(email), `${email} must be excluded`)
  }
})

test('a real family is never excluded', () => {
  for (const email of [
    'caseybugg@hotmail.com',
    'littlebitamberdavis@gmail.com',
    // Near-misses. The + tag and the domain are what distinguish the test
    // accounts, so neither may match loosely.
    'garfieldbrittany@gmail.com',
    'brittanywaltrip@gmail.com',
    'test@gmail.com',
  ]) {
    assert.equal(isNonFamilyEmail(email), false, `${email} is a family`)
  }
})

test('exclusion is case- and whitespace-insensitive, and null-safe', () => {
  assert.equal(isNonFamilyEmail('Test@RootedHomeschoolApp.com'), true)
  assert.equal(isNonFamilyEmail('  garfieldbrittany+test1@gmail.com  '), true)
  assert.equal(isNonFamilyEmail(null), false)
  assert.equal(isNonFamilyEmail(undefined), false)
  assert.equal(isNonFamilyEmail(''), false)
})

test('all four consumers import the one list and none redeclares its own', () => {
  const root = resolve(import.meta.dirname, '..')
  for (const file of [
    'scripts/repair-empty-goals.ts',
    'scripts/repair-queue-gaps.ts',
    'scripts/repair-phantom-completions.ts',
    'scripts/health-queue-slots.ts',
  ]) {
    const src = readFileSync(resolve(root, file), 'utf8')
    assert.ok(
      /from '\.\.\/lib\/queue-slot-health\.ts'/.test(src),
      `${file} must import the shared list`,
    )
    assert.ok(
      !/const EXCLUDED_EMAIL\s*=\s*'/.test(src),
      `${file} must not declare its own copy`,
    )
  }
})

/* ── interior hole vs ungenerated tail ────────────────────────────────── */

test('an ungenerated tail is not a hole and never urgent', () => {
  // test@rootedhomeschoolapp.com's "Apologia General Science": pointer at 16,
  // total 60, and exactly one row holding slot 16. Every slot ahead is tail.
  // The first version of the health check called this "blank RIGHT NOW".
  const r = classifyGoalSlots(16, 60, slots(16))
  assert.deepEqual(r.interiorHoles, [])
  assert.equal(r.slotsUntilBlank, null, 'a tail must never set slotsUntilBlank')
  assert.equal(r.missingTail, 44)
})

test('a hole in the middle of what exists is the real defect', () => {
  // The E2E goal repair-queue-gaps flagged: pointer at 1, rows out to slot 20,
  // slot 3 empty.
  const held = new Set<number>()
  for (let s = 1; s <= 20; s++) if (s !== 3) held.add(s)
  const r = classifyGoalSlots(1, 20, held)
  assert.deepEqual(r.interiorHoles, [3])
  assert.equal(r.slotsUntilBlank, 1, 'slot 2 renders, then slot 3 is blank')
  assert.equal(r.missingTail, 0)
})

test('slotsUntilBlank is 0 only when the very next slot is an interior hole', () => {
  const held = new Set<number>()
  for (let s = 1; s <= 10; s++) if (s !== 6) held.add(s)
  assert.equal(classifyGoalSlots(5, 10, held).slotsUntilBlank, 0)
  // One further along: slot 6 renders, 7 is the hole.
  const held2 = new Set<number>()
  for (let s = 1; s <= 10; s++) if (s !== 7) held2.add(s)
  assert.equal(classifyGoalSlots(5, 10, held2).slotsUntilBlank, 1)
})

test('a goal can carry both a hole and a tail, counted separately', () => {
  // Rows out to slot 12 with slot 9 missing, total 30.
  const held = new Set<number>()
  for (let s = 1; s <= 12; s++) if (s !== 9) held.add(s)
  const r = classifyGoalSlots(5, 30, held)
  assert.deepEqual(r.interiorHoles, [9])
  assert.equal(r.missingTail, 18, 'slots 13..30')
  assert.equal(r.slotsUntilBlank, 3)
})

test('a healthy goal reports nothing at all', () => {
  const held = new Set<number>()
  for (let s = 1; s <= 60; s++) held.add(s)
  const r = classifyGoalSlots(16, 60, held)
  assert.deepEqual(r.interiorHoles, [])
  assert.equal(r.missingTail, 0)
  assert.equal(r.slotsUntilBlank, null)
})

test('a finished goal has nothing left to project', () => {
  // current_lesson >= total_lessons. This is the shape all 7 "empty" goals in
  // the 2026-09-09 dry run were in, and repair-empty-goals planned 0 rows for
  // every one of them.
  for (const [cur, total] of [[1, 1], [40, 40], [104, 104], [22, 13]]) {
    const r = classifyGoalSlots(cur, total, slots())
    assert.deepEqual(r.interiorHoles, [], `${cur}/${total}`)
    assert.equal(r.missingTail, 0, `${cur}/${total}`)
    assert.equal(r.slotsUntilBlank, null, `${cur}/${total}`)
  }
})

test('a goal with no rows is all tail, never an interior hole', () => {
  // Every slot ahead is missing, but that is the EMPTY problem, which
  // healEmptyGoal and repair-empty-goals own. It must not also be reported as
  // a hole by the gap check.
  const r = classifyGoalSlots(0, 100, slots())
  assert.deepEqual(r.interiorHoles, [])
  assert.equal(r.missingTail, 100)
  assert.equal(r.slotsUntilBlank, null)
})

test('a nonsense total is refused rather than guessed at', () => {
  for (const total of [0, -5, 1.5]) {
    const r = classifyGoalSlots(0, total, slots(1))
    assert.deepEqual(r.interiorHoles, [])
    assert.equal(r.missingTail, 0)
  }
})

/* ── the sweep must not be able to invent a hole ──────────────────────────
 * Two consecutive runs of the health check on 2026-09-09 disagreed: one found
 * 0 interior holes, the other 10 across 7 real families including a "blank
 * RIGHT NOW". The classifier was right both times; the sweep feeding it was
 * offset-paged and broke on any page shorter than the page size, so one short
 * response ended it early and every unread goal looked like a goal with no
 * rows. Direct SQL confirmed 0.
 * ─────────────────────────────────────────────────────────────────────── */

test('an unread goal is indistinguishable from an empty one, which is why the sweep is checked', () => {
  // This is the property that makes a truncated sweep dangerous: the
  // classifier cannot tell "no rows exist" from "no rows were read". It is not
  // the classifier's job to know, so the sweep has to guarantee completeness.
  const unread = classifyGoalSlots(5, 60, new Set())
  const genuinelyEmpty = classifyGoalSlots(5, 60, new Set())
  assert.deepEqual(unread, genuinelyEmpty)
  // And note it reports NO interior hole either way, so a truncated sweep
  // understates rather than inventing one here. The invented holes came from
  // goals read PARTIALLY: some slots present, the rest cut off.
  assert.deepEqual(unread.interiorHoles, [])

  const partiallyRead = classifyGoalSlots(5, 60, new Set([6, 7, 8, 20]))
  assert.deepEqual(partiallyRead.interiorHoles, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  assert.equal(partiallyRead.slotsUntilBlank, 3, 'a partial read manufactures a blank card')
})

test('the health sweep is keyset paged and asserts it read every row', () => {
  const src = readFileSync(
    resolve(import.meta.dirname, '..', 'scripts/health-queue-slots.ts'),
    'utf8',
  )
  // Keyset, not offset: .range() paging is what broke.
  assert.ok(!/\.range\(/.test(src), 'offset paging must not come back')
  assert.ok(/\.gt\('id', lastId\)/.test(src), 'pages advance on the primary key')
  // And the completeness check that turns a shortfall into a loud failure.
  assert.ok(/count: 'exact', head: true/.test(src), 'it must know how many rows to expect')
  assert.ok(
    /refusing to \` \+\s*\`report holes against a partial sweep/.test(src) ||
      /partial sweep/.test(src),
    'a short sweep must throw, not report',
  )
})
