// Guard-logic tests. These run under `npm test` (node --test), NOT Playwright,
// so the protection is verified on every unit-test run instead of only when
// someone happens to execute the e2e suite.
//
// Context: until 2026-08-03 the suite authenticated as the founder's real
// family account and re-flowed a live curriculum. assertIsTestAccount is what
// makes that impossible now, so it gets tests of its own.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assertIsTestAccount, E2E_USER_ID, NEVER_TOUCH_USER_IDS } from './test-account.ts'

const FOUNDER_REAL_ACCOUNT = '033760b9-51fc-4db2-b34a-2fafd6501be2'

test('the designated test account passes', () => {
  assert.doesNotThrow(() => assertIsTestAccount(E2E_USER_ID, 'unit'))
})

test("the founder's real family account is rejected", () => {
  assert.throws(
    () => assertIsTestAccount(FOUNDER_REAL_ACCOUNT, 'unit'),
    /REFUSING TO RUN/,
  )
})

test('the rejection message names what the offending account is', () => {
  assert.throws(
    () => assertIsTestAccount(FOUNDER_REAL_ACCOUNT, 'unit'),
    /real family account/i,
  )
})

test('every never-touch id is rejected', () => {
  for (const id of Object.keys(NEVER_TOUCH_USER_IDS)) {
    assert.throws(() => assertIsTestAccount(id, 'unit'), /REFUSING TO RUN/, `id ${id} must be rejected`)
  }
})

test('an unknown account is rejected too (allowlist, not denylist)', () => {
  assert.throws(
    () => assertIsTestAccount('00000000-0000-4000-8000-000000000000', 'unit'),
    /REFUSING TO RUN/,
  )
})

test('fails closed when the id cannot be resolved', () => {
  for (const value of [null, undefined, '']) {
    assert.throws(() => assertIsTestAccount(value, 'unit'), /could not resolve/i)
  }
})

test('the designated test account is not itself on the never-touch list', () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(NEVER_TOUCH_USER_IDS, E2E_USER_ID),
    false,
    'E2E_USER_ID must never be a real account id',
  )
})
