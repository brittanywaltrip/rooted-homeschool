// Unit tests for the Stripe price id -> plan_type mapping that stamps profiles
// and gates features. Run with:
//   node --test lib/plan-mapping.test.ts
//
// PRICE_TO_PLAN is built from the STRIPE_*_PRICE_ID env vars at module load, so
// the env is set BEFORE the module is imported. `node --test` runs each test
// file in its own process, so setting the env here does not leak into or from
// other suites, and the dynamic import below loads the module fresh with these
// values applied.

import { test } from 'node:test'
import assert from 'node:assert/strict'

test('planTypeForPriceId maps each configured price id to its plan_type', async () => {
  process.env.STRIPE_FOUNDING_FAMILY_PRICE_ID = 'price_founding_unit'
  process.env.STRIPE_STANDARD_PRICE_ID = 'price_standard_unit'
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly_unit'

  const { planTypeForPriceId } = await import('./link-stripe-to-profile.ts')

  assert.equal(planTypeForPriceId('price_founding_unit'), 'founding_family')
  assert.equal(planTypeForPriceId('price_standard_unit'), 'standard')
  // The new $9.99 monthly plan resolves to plan_type 'monthly'.
  assert.equal(planTypeForPriceId('price_monthly_unit'), 'monthly')
  // Unknown / missing price ids fall back to founding_family (documented safe default).
  assert.equal(planTypeForPriceId('price_unknown'), 'founding_family')
  assert.equal(planTypeForPriceId(null), 'founding_family')
})
