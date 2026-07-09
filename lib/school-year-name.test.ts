// Tests for the school-year rollover name parser. The en-dash case is the
// one that caused the June 19 stranding bug: "2025–2026" (U+2013) must roll
// forward to "2026-2027", not back to "2025-2026".

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deriveEndYear, rolloverYearName } from './school-year-name.ts'

// A fixed "current year" so the fallback cases are deterministic.
const CURRENT_YEAR = 2026

test('hyphen name rolls forward', () => {
  assert.equal(deriveEndYear('2025-2026', CURRENT_YEAR), 2026)
  assert.equal(rolloverYearName('2025-2026', CURRENT_YEAR), '2026-2027')
})

test('en dash name rolls forward (the June 19 bug)', () => {
  // U+2013 EN DASH between the years — split("-") never split this.
  assert.equal(deriveEndYear('2025–2026', CURRENT_YEAR), 2026)
  assert.equal(rolloverYearName('2025–2026', CURRENT_YEAR), '2026-2027')
})

test('slash short-form uses the only 4-digit run', () => {
  // "2025/26" has one 4-digit run ("2025"); the 2-digit suffix is not parsed.
  assert.equal(deriveEndYear('2025/26', CURRENT_YEAR), 2025)
  assert.equal(rolloverYearName('2025/26', CURRENT_YEAR), '2025-2026')
})

test('name with no year falls back to the current calendar year', () => {
  assert.equal(deriveEndYear('My Homeschool Year', CURRENT_YEAR), CURRENT_YEAR)
  assert.equal(rolloverYearName('My Homeschool Year', CURRENT_YEAR), '2026-2027')
})

test('null / empty name falls back to the current calendar year', () => {
  assert.equal(deriveEndYear(null, CURRENT_YEAR), CURRENT_YEAR)
  assert.equal(deriveEndYear('', CURRENT_YEAR), CURRENT_YEAR)
})

test('space-separated name rolls forward', () => {
  assert.equal(deriveEndYear('2025 2026', CURRENT_YEAR), 2026)
  assert.equal(rolloverYearName('2025 2026', CURRENT_YEAR), '2026-2027')
})
