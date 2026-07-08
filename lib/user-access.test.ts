// Unit tests for the feature-gating helper. Run with:
//   node --test lib/user-access.test.ts
//
// Every paid plan (founding_family, standard, and the $9.99 monthly plan) sets
// is_pro=true on the profile, so getUserAccess is the single gate they all flow
// through. These tests lock that in: a paid profile is 'pro' regardless of tier.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  getUserAccess,
  canExport,
  canShareFamily,
  canUploadUnlimitedPhotos,
  TRIAL_DAYS,
} from './user-access.ts'

test('getUserAccess: any paying subscriber is pro (covers monthly, standard, founding)', () => {
  assert.equal(getUserAccess({ is_pro: true }), 'pro')
  assert.equal(getUserAccess({ is_pro: true, trial_started_at: null }), 'pro')
})

test('getUserAccess: within the trial window is trial, expired is free', () => {
  const now = Date.now()
  const recent = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()
  const expired = new Date(now - (TRIAL_DAYS + 5) * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(getUserAccess({ is_pro: false, trial_started_at: recent }), 'trial')
  assert.equal(getUserAccess({ is_pro: false, trial_started_at: expired }), 'free')
  assert.equal(getUserAccess({ is_pro: false, trial_started_at: null }), 'free')
})

test('paid-only capabilities unlock for any is_pro profile and lock for free', () => {
  const paid = { is_pro: true }
  const free = { is_pro: false, trial_started_at: null }
  for (const can of [canExport, canShareFamily, canUploadUnlimitedPhotos]) {
    assert.equal(can(paid), true)
    assert.equal(can(free), false)
  }
})
