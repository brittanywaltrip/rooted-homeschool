// Unit tests for the comp-partner helper. Run with:
//   node --test lib/comp-partner.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { COMPED_PARTNER_PROFILE, compPartnerProfile } from './comp-partner.ts'

type UpdateCall = { patch: Record<string, unknown>; filters: Record<string, unknown> }

function makeSupabase(opts: { error?: { message: string } | null } = {}) {
  const updateCalls: UpdateCall[] = []
  const client = {
    from: () => {
      const update = (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {}
        return {
          eq: async (col: string, val: unknown) => {
            filters[col] = val
            updateCalls.push({ patch, filters })
            return { error: opts.error ?? null }
          },
        }
      }
      return { update }
    },
  }
  return { client, updateCalls }
}

type CompOpts = NonNullable<Parameters<typeof compPartnerProfile>[1]>
const sb = (client: unknown) => client as unknown as CompOpts['supabase']

test('compPartnerProfile writes all 8 spec fields in a single UPDATE', async () => {
  const { client, updateCalls } = makeSupabase()
  await compPartnerProfile('user-1', { supabase: sb(client) })

  assert.equal(updateCalls.length, 1, 'exactly one UPDATE per call')
  assert.deepEqual(updateCalls[0].patch, {
    plan_type: 'founding_family',
    is_pro: true,
    subscription_status: 'active',
    legacy_free: false,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: null,
    subscription_end_date: null,
  })
  assert.equal(updateCalls[0].filters.id, 'user-1', 'scoped to the target user')
})

test('compPartnerProfile never writes the rejected partner_comp value', async () => {
  const { client, updateCalls } = makeSupabase()
  await compPartnerProfile('user-2', { supabase: sb(client) })
  assert.notEqual(updateCalls[0].patch.plan_type, 'partner_comp')
  assert.equal(updateCalls[0].patch.plan_type, 'founding_family')
})

test('compPartnerProfile clears every Stripe-linked field for a comped partner', async () => {
  // Regression guard for the Grace bug: approve used to only write plan_type,
  // leaving stripe_customer_id / stripe_subscription_id / current_period_end
  // pointing at stale or nonexistent Stripe state.
  const { client, updateCalls } = makeSupabase()
  await compPartnerProfile('user-3', { supabase: sb(client) })
  const patch = updateCalls[0].patch
  assert.equal(patch.stripe_customer_id, null)
  assert.equal(patch.stripe_subscription_id, null)
  assert.equal(patch.current_period_end, null)
  assert.equal(patch.subscription_end_date, null)
  assert.equal(patch.legacy_free, false)
})

test('COMPED_PARTNER_PROFILE stays in sync with the documented enum', () => {
  // CLAUDE.md lists the only valid plan_type values as NULL,
  // 'founding_family', 'standard', 'monthly', 'gift'. Comped partners are
  // always 'founding_family' — catch accidental rename of the constant.
  assert.equal(COMPED_PARTNER_PROFILE.plan_type, 'founding_family')
  assert.equal(COMPED_PARTNER_PROFILE.is_pro, true)
  assert.equal(COMPED_PARTNER_PROFILE.subscription_status, 'active')
  assert.equal(COMPED_PARTNER_PROFILE.legacy_free, false)
})

test('compPartnerProfile rejects a missing userId', async () => {
  await assert.rejects(() => compPartnerProfile(''), /userId required/)
})

test('compPartnerProfile throws when the UPDATE errors', async () => {
  const { client } = makeSupabase({ error: { message: 'violates constraint plan_type_valid' } })
  await assert.rejects(
    () => compPartnerProfile('user-4', { supabase: sb(client) }),
    /plan_type_valid/,
  )
})
