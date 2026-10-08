import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canReadAffiliateStats } from './affiliate-stats-access.ts'

test('a partner can read only their own stats; an admin can preview another partner', () => {
  assert.equal(canReadAffiliateStats({ id: 'owner', email: 'partner@example.com' }, 'owner'), true)
  assert.equal(canReadAffiliateStats({ id: 'other', email: 'other@example.com' }, 'owner'), false)
  assert.equal(canReadAffiliateStats({ id: 'admin', email: 'garfieldbrittany@gmail.com' }, 'owner'), true)
  assert.equal(canReadAffiliateStats({ id: 'other', email: 'other@example.com' }, null), false)
})
