// Unit tests for the phantom-completion fingerprint.
//
// This is what decides which rows a DESTRUCTIVE repair reverts, so both
// directions matter: a false positive rewrites a completion a family really
// made, a false negative leaves a phantom in their record.
//
// Run:
//   node --test scripts/phantom-fingerprint.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isExactly24hApart, isNearFingerprint } from './phantom-fingerprint.ts'

// The trigger's signature: completed_at = NOW() - interval '1 day', and
// lessons_set_updated_at stamps updated_at at NOW() in the same statement, so
// the two land exactly 24h apart to the microsecond.
const COMPLETED = '2026-09-06T14:22:31.123456+00:00'
const EXACT_24H = '2026-09-07T14:22:31.123456+00:00'

test('fingerprint: exactly 24h apart to the microsecond matches', () => {
  assert.equal(isExactly24hApart(COMPLETED, EXACT_24H), true)
})

test('fingerprint: a microsecond either way does NOT match', () => {
  // The sub-millisecond digits are most of what makes this a fingerprint
  // rather than a guess. A Date-only comparison would round them away and
  // start reverting rows nobody swept.
  assert.equal(isExactly24hApart(COMPLETED, '2026-09-07T14:22:31.123457+00:00'), false)
  assert.equal(isExactly24hApart(COMPLETED, '2026-09-07T14:22:31.123455+00:00'), false)
})

test('fingerprint: accepts the zone formats the two clients actually send', () => {
  // PostgREST returns '+00:00'; psql returns '+00', which Date.parse rejects
  // outright — and a rejected parse reports "no damage found" rather than an
  // error, the worst possible failure for this script.
  assert.equal(isExactly24hApart('2026-09-06T14:22:31.123456+00', '2026-09-07T14:22:31.123456+00'), true)
  assert.equal(isExactly24hApart('2026-09-06 14:22:31.123456+00', '2026-09-07 14:22:31.123456+00'), true)
  // Zone-less is UTC.
  assert.equal(isExactly24hApart('2026-09-06T14:22:31.123456', '2026-09-07T14:22:31.123456'), true)
})

test('fingerprint: a malformed stamp is not a match, never a throw', () => {
  assert.equal(isExactly24hApart('not-a-timestamp', EXACT_24H), false)
  assert.equal(isExactly24hApart(COMPLETED, ''), false)
})

test('fingerprint: an ordinary completion is nowhere near 24h', () => {
  assert.equal(isExactly24hApart(COMPLETED, '2026-09-06T14:22:35.000000+00:00'), false)
})

// ── Near the fingerprint ────────────────────────────────────────────────────
// Any write to a swept row bumps updated_at and the row stops matching. These
// are reported, never touched.

test('near: an exact match is not ALSO reported as near', () => {
  assert.equal(isNearFingerprint(COMPLETED, EXACT_24H), false)
})

test('near: inside a minute either side is reported', () => {
  assert.equal(isNearFingerprint(COMPLETED, '2026-09-07T14:22:41.123456+00:00'), true, '+10s')
  assert.equal(isNearFingerprint(COMPLETED, '2026-09-07T14:22:21.123456+00:00'), true, '-10s')
  assert.equal(isNearFingerprint(COMPLETED, '2026-09-07T14:23:31.123456+00:00'), true, '+60s edge')
  assert.equal(isNearFingerprint(COMPLETED, '2026-09-07T14:21:31.123456+00:00'), true, '-60s edge')
})

test('near: a microsecond off is near, which is the case that matters', () => {
  // The realign-first mistake: a queue_position update bumped updated_at by a
  // hair, the exact matcher went blind, and the row would have been missed
  // silently. It is now reported.
  assert.equal(isNearFingerprint(COMPLETED, '2026-09-07T14:22:31.123457+00:00'), true)
})

test('near: outside the minute window is not reported', () => {
  assert.equal(isNearFingerprint(COMPLETED, '2026-09-07T14:23:32.123456+00:00'), false, '+61s')
  assert.equal(isNearFingerprint(COMPLETED, '2026-09-06T14:22:35.000000+00:00'), false, 'ordinary completion')
})

test('near: a malformed stamp is not near, never a throw', () => {
  assert.equal(isNearFingerprint('not-a-timestamp', EXACT_24H), false)
})
