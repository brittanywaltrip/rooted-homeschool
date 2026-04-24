// Unit tests for partner commission math. Run with:
//   node --test lib/commission.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { commissionFromCents, displayCommission, LEGACY_COMMISSION_PER_PAYING } from './commission.ts'
import { attributeReferral } from './referrals.ts'

// ── commissionFromCents (exercises the two spec'd webhook scenarios) ─────────

test('$33.15 checkout (3315 cents) → $6.63 commission (spec case 1)', () => {
  // Webhook sees checkout.session.completed with amount_total=3315 (the
  // $39 founding plan post-15%-coupon net). Commission should be $6.63.
  assert.equal(commissionFromCents(3315), 6.63)
})

test('$39 subscription (3900 cents) → $7.80 commission (spec case 2)', () => {
  // Webhook sees subscription.created with price.unit_amount=3900 (founding
  // plan at full price, no coupon). Commission should be $7.80.
  assert.equal(commissionFromCents(3900), 7.80)
})

test('monthly plan ($6.99 → 699 cents) → $1.40 commission', () => {
  assert.equal(commissionFromCents(699), 1.40)
})

test('standard plan ($59 → 5900 cents) → $11.80 commission', () => {
  assert.equal(commissionFromCents(5900), 11.80)
})

test('null / undefined / 0 / negative → null (caller falls back)', () => {
  assert.equal(commissionFromCents(null), null)
  assert.equal(commissionFromCents(undefined), null)
  assert.equal(commissionFromCents(0), null)
  assert.equal(commissionFromCents(-100), null)
  assert.equal(commissionFromCents(NaN), null)
})

// ── displayCommission (legacy fallback vs stored per-row amount) ─────────────

test('converted row with stored commission_amount uses the stored value', () => {
  assert.equal(
    displayCommission({ converted: true, commission_amount: 7.80 }),
    7.80,
  )
})

test('converted row stored as numeric string (Postgres NUMERIC) is parsed', () => {
  assert.equal(
    displayCommission({ converted: true, commission_amount: '6.63' }),
    6.63,
  )
})

test('converted row without stored amount falls back to $6.63', () => {
  assert.equal(
    displayCommission({ converted: true, commission_amount: null }),
    LEGACY_COMMISSION_PER_PAYING,
  )
  assert.equal(
    displayCommission({ converted: true }),
    LEGACY_COMMISSION_PER_PAYING,
  )
})

test('non-converted row returns $0 regardless of stored amount', () => {
  assert.equal(
    displayCommission({ converted: false, commission_amount: 6.63 }),
    0,
  )
  assert.equal(
    displayCommission({ converted: false }),
    0,
  )
})

// ── attributeReferral passes commissionAmount through to a follow-up UPDATE ─

type RpcCall = { fn: string; args: Record<string, unknown> }
type UpdateCall = { table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }

function makeSupabase() {
  const rpcCalls: RpcCall[] = []
  const updateCalls: UpdateCall[] = []
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return { data: { action: 'converted' }, error: null }
    },
    from: (table: string) => {
      const update = (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {}
        const chain = {
          eq: (col: string, val: unknown) => { filters[col] = val; return chain },
          ilike: (col: string, val: unknown) => { filters[`${col}.ilike`] = val; return chain },
          then: (resolve: (v: { error: null }) => void) => {
            updateCalls.push({ table, patch, filters })
            resolve({ error: null })
          },
        }
        return chain
      }
      return { update }
    },
  }
  return { client, rpcCalls, updateCalls }
}

test('attributeReferral with commissionAmount writes it via follow-up UPDATE', async () => {
  const { client, updateCalls } = makeSupabase()
  const result = await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-1',
    affiliateCode: 'amber',
    stripeSessionId: 'cs_test_xyz',
    converted: true,
    commissionAmount: 7.80,
  })
  assert.equal(result.action, 'converted')
  assert.equal(updateCalls.length, 1)
  assert.equal(updateCalls[0].table, 'referrals')
  assert.equal(updateCalls[0].patch.commission_amount, 7.80)
  assert.equal(updateCalls[0].filters.user_id, 'user-1')
})

test('attributeReferral without commissionAmount skips the UPDATE', async () => {
  const { client, updateCalls } = makeSupabase()
  await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-2',
    affiliateCode: 'amber',
    converted: true,
  })
  assert.equal(updateCalls.length, 0)
})

test('attributeReferral skips UPDATE when converted=false even with amount', async () => {
  const { client, updateCalls } = makeSupabase()
  await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-3',
    affiliateCode: 'amber',
    converted: false,
    commissionAmount: 6.63,
  })
  assert.equal(updateCalls.length, 0)
})

test('attributeReferral rounds the commission to 2 decimals before writing', async () => {
  const { client, updateCalls } = makeSupabase()
  await attributeReferral({
    supabase: client as unknown as Parameters<typeof attributeReferral>[0]['supabase'],
    userId: 'user-4',
    affiliateCode: 'amber',
    converted: true,
    commissionAmount: 7.8044, // should round to 7.80
  })
  assert.equal(updateCalls[0].patch.commission_amount, 7.80)
})
