// Guards the family portal reaction set against the July 2026 silent-fail bug:
// the viewer UI offered 🙌 and 😍 while the API allowlist rejected them, so
// those taps 400'd and the optimistic UI hid the failure. Both sides now import
// REACTION_EMOJIS from lib/family-reactions.ts; this test pins its contents.
//
// Run with: node --test lib/family-reactions.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REACTION_EMOJIS } from './family-reactions.ts'

test('the shared reaction set is exactly the five emojis the UI shows and the API accepts', () => {
  assert.deepEqual(REACTION_EMOJIS, ['🥹', '❤️', '😂', '🙌', '😍'])
})

test('the two emojis the API used to reject are in the shared set', () => {
  assert.ok(REACTION_EMOJIS.includes('🙌'), '🙌 must be accepted')
  assert.ok(REACTION_EMOJIS.includes('😍'), '😍 must be accepted')
})

test('the old API-only emojis (never shown to viewers) are not in the set', () => {
  assert.ok(!REACTION_EMOJIS.includes('😮'))
  assert.ok(!REACTION_EMOJIS.includes('👏'))
})

test('the reaction set has no duplicates', () => {
  assert.equal(new Set(REACTION_EMOJIS).size, REACTION_EMOJIS.length)
})
