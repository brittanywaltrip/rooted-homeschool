// Unit tests for the print sheets' time formatting + ordering. Run with:
//   npm test
//
// curriculum_goals.scheduled_start_time and activities.scheduled_start_time are
// Postgres `time without time zone`, so they arrive as "HH:MM:SS" with no date
// and no offset. The print sheets are the first surface to render them (94
// active goals across 55 families had the value stored and invisible), so the
// rules that matter here are: a goal WITHOUT a time must render exactly as it
// did before, and untimed items must keep their existing order.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatPrintTime, timeSortKey, sortByTimeThenOriginal } from './printTime.ts'

test('formats a Postgres time string as a 12-hour clock', () => {
  assert.equal(formatPrintTime('09:00:00'), '9:00 AM')
  assert.equal(formatPrintTime('13:30:00'), '1:30 PM')
  assert.equal(formatPrintTime('00:15:00'), '12:15 AM')
  assert.equal(formatPrintTime('12:00:00'), '12:00 PM')
  assert.equal(formatPrintTime('23:59:00'), '11:59 PM')
})

test('accepts HH:MM as well as HH:MM:SS', () => {
  assert.equal(formatPrintTime('08:05'), '8:05 AM')
})

test('returns null for anything unusable, so a goal without a time prints unchanged', () => {
  assert.equal(formatPrintTime(null), null)
  assert.equal(formatPrintTime(undefined), null)
  assert.equal(formatPrintTime(''), null)
  assert.equal(formatPrintTime('not a time'), null)
  assert.equal(formatPrintTime('25:00:00'), null, 'hour out of range')
  assert.equal(formatPrintTime('10:75:00'), null, 'minute out of range')
})

test('never routes a bare time through Date parsing', () => {
  // new Date('09:00:00') is Invalid Date; if the formatter regressed to using
  // it, this would come back null or NaN-ish rather than a clock time.
  assert.equal(formatPrintTime('09:00:00'), '9:00 AM')
})

test('timeSortKey returns minutes since midnight, null when absent', () => {
  assert.equal(timeSortKey('00:00:00'), 0)
  assert.equal(timeSortKey('09:30:00'), 570)
  assert.equal(timeSortKey(null), null)
  assert.equal(timeSortKey('garbage'), null)
})

test('orders timed items ascending and leaves untimed ones after, in order', () => {
  const items = [
    { id: 'no-time-a', t: null },
    { id: 'noon', t: '12:00:00' },
    { id: 'no-time-b', t: null },
    { id: 'early', t: '08:00:00' },
    { id: 'no-time-c', t: '' },
  ]
  const out = sortByTimeThenOriginal(items, (i) => i.t)
  assert.deepEqual(out.map((i) => i.id), ['early', 'noon', 'no-time-a', 'no-time-b', 'no-time-c'])
})

test('a list with no times is returned completely untouched', () => {
  const items = [{ id: 'a', t: null }, { id: 'b', t: null }, { id: 'c', t: null }]
  assert.deepEqual(sortByTimeThenOriginal(items, (i) => i.t).map((i) => i.id), ['a', 'b', 'c'])
})

test('items sharing a time keep their original relative order', () => {
  const items = [
    { id: 'second', t: '09:00:00' },
    { id: 'first', t: '08:00:00' },
    { id: 'third', t: '09:00:00' },
  ]
  assert.deepEqual(
    sortByTimeThenOriginal(items, (i) => i.t).map((i) => i.id),
    ['first', 'second', 'third'],
  )
})

test('an empty list is safe', () => {
  assert.deepEqual(sortByTimeThenOriginal([], () => null), [])
})
