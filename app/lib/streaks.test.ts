// Unit tests for the streak helpers. Run with:
//   node --test app/lib/streaks.test.ts
//
// Covers the five cases the spec calls out plus the belt-and-suspenders
// recompute:
//   • first-time activity (last_logged_date null) → current = 1, longest = 1
//   • same-day repeat → no change
//   • next-school-day activity → streak + 1
//   • weekend between Fri and Mon counted as continuous for Mon–Fri families
//   • multi-week gap resets via login-time recompute to 0

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { recomputeStaleStreak, updateStreak } from './streaks.ts'

type ProfileRow = {
  current_streak_days: number | null
  longest_streak_days: number | null
  last_logged_date: string | null
  school_days: string[] | null
}

type UpdateCall = { patch: Record<string, unknown>; filters: Record<string, unknown> }

function makeSupabase(profile: ProfileRow | null) {
  const updateCalls: UpdateCall[] = []
  const client = {
    from: () => {
      const filters: Record<string, unknown> = {}
      const readChain = {
        select: () => readChain,
        eq: (col: string, val: unknown) => { filters[col] = val; return readChain },
        single: async () => ({ data: profile, error: null }),
      }
      const update = (patch: Record<string, unknown>) => {
        const captured: Record<string, unknown> = {}
        return {
          eq: async (col: string, val: unknown) => {
            captured[col] = val
            updateCalls.push({ patch, filters: captured })
            return { error: null }
          },
        }
      }
      return { ...readChain, update }
    },
  }
  return { client, updateCalls }
}

const MON_FRI = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
type UpdateStreakOpts = NonNullable<Parameters<typeof updateStreak>[1]>
const sb = (client: unknown) => client as unknown as UpdateStreakOpts['supabase']

// ── updateStreak ─────────────────────────────────────────────────────────────

test('first-time activity: last_logged_date null → current=1, longest=1', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 0,
    longest_streak_days: 0,
    last_logged_date: null,
    school_days: MON_FRI,
  })
  const result = await updateStreak('user-1', {
    supabase: sb(client),
    now: new Date('2026-04-22T10:00:00-07:00'), // Wednesday
  })
  assert.equal(result.currentStreak, 1)
  assert.equal(result.longestStreak, 1)
  assert.equal(updateCalls.length, 1)
  assert.equal(updateCalls[0].patch.current_streak_days, 1)
  assert.equal(updateCalls[0].patch.longest_streak_days, 1)
  assert.equal(updateCalls[0].patch.last_logged_date, '2026-04-22')
})

test('same-day repeat: last_logged_date == today → no change, no write', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 4,
    longest_streak_days: 10,
    last_logged_date: '2026-04-22',
    school_days: MON_FRI,
  })
  const result = await updateStreak('user-1', {
    supabase: sb(client),
    now: new Date('2026-04-22T14:00:00-07:00'),
  })
  assert.equal(result.currentStreak, 4)
  assert.equal(result.longestStreak, 10)
  assert.equal(updateCalls.length, 0, 'same-day repeat must not write')
})

test('next school day activity (Tue → Wed): streak + 1, longest updated', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 3,
    longest_streak_days: 3,
    last_logged_date: '2026-04-21', // Tuesday
    school_days: MON_FRI,
  })
  const result = await updateStreak('user-1', {
    supabase: sb(client),
    now: new Date('2026-04-22T09:00:00-07:00'), // Wednesday
  })
  assert.equal(result.currentStreak, 4)
  assert.equal(result.longestStreak, 4)
  assert.equal(updateCalls[0].patch.current_streak_days, 4)
  assert.equal(updateCalls[0].patch.longest_streak_days, 4)
})

test('weekend skip for Mon–Fri family (Fri → Mon): streak + 1, not reset', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 5,
    longest_streak_days: 12,
    last_logged_date: '2026-04-17', // Friday
    school_days: MON_FRI,
  })
  const result = await updateStreak('user-1', {
    supabase: sb(client),
    now: new Date('2026-04-20T08:30:00-07:00'), // Monday
  })
  assert.equal(result.currentStreak, 6, 'weekend gap must not break a Mon–Fri streak')
  assert.equal(result.longestStreak, 12, 'longest untouched because new < previous longest')
  assert.equal(updateCalls[0].patch.current_streak_days, 6)
  assert.equal(updateCalls[0].patch.longest_streak_days, 12)
})

test('gap crossing missed school day resets to 1', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 7,
    longest_streak_days: 15,
    last_logged_date: '2026-04-16', // Thursday
    school_days: MON_FRI,
  })
  const result = await updateStreak('user-1', {
    supabase: sb(client),
    now: new Date('2026-04-20T08:00:00-07:00'), // Monday — skipped Friday
  })
  assert.equal(result.currentStreak, 1)
  assert.equal(result.longestStreak, 15, 'longest never shrinks')
  assert.equal(updateCalls[0].patch.current_streak_days, 1)
  assert.equal(updateCalls[0].patch.longest_streak_days, 15)
})

test('missing profile: returns zeros without writing', async () => {
  const { client, updateCalls } = makeSupabase(null)
  const result = await updateStreak('ghost-user', { supabase: sb(client) })
  assert.equal(result.currentStreak, 0)
  assert.equal(result.longestStreak, 0)
  assert.equal(updateCalls.length, 0)
})

// ── recomputeStaleStreak ─────────────────────────────────────────────────────

test('recomputeStaleStreak: multi-week gap resets current to 0, longest untouched', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 9,
    longest_streak_days: 20,
    last_logged_date: '2026-03-15', // ~5 weeks ago
    school_days: MON_FRI,
  })
  const result = await recomputeStaleStreak('user-1', {
    supabase: sb(client),
    now: new Date('2026-04-22T10:00:00-07:00'),
  })
  assert.equal(result, 'reset')
  assert.equal(updateCalls.length, 1)
  assert.deepEqual(updateCalls[0].patch, { current_streak_days: 0 })
  assert.ok(
    !('longest_streak_days' in (updateCalls[0].patch as Record<string, unknown>)),
    'longest must never be touched by recompute',
  )
})

test('recomputeStaleStreak: fresh streak (logged yesterday, school day) is kept', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 4,
    longest_streak_days: 10,
    last_logged_date: '2026-04-21', // yesterday, Tuesday
    school_days: MON_FRI,
  })
  const result = await recomputeStaleStreak('user-1', {
    supabase: sb(client),
    now: new Date('2026-04-22T10:00:00-07:00'),
  })
  assert.equal(result, 'kept')
  assert.equal(updateCalls.length, 0)
})

test('recomputeStaleStreak: Mon morning after Fri log is kept (weekend skip)', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 5,
    longest_streak_days: 5,
    last_logged_date: '2026-04-17', // Friday
    school_days: MON_FRI,
  })
  const result = await recomputeStaleStreak('user-1', {
    supabase: sb(client),
    now: new Date('2026-04-20T07:00:00-07:00'), // Monday
  })
  assert.equal(result, 'kept')
  assert.equal(updateCalls.length, 0)
})

test('recomputeStaleStreak: already-zero streak is a no-op', async () => {
  const { client, updateCalls } = makeSupabase({
    current_streak_days: 0,
    longest_streak_days: 7,
    last_logged_date: null,
    school_days: MON_FRI,
  })
  const result = await recomputeStaleStreak('user-1', { supabase: sb(client) })
  assert.equal(result, 'kept')
  assert.equal(updateCalls.length, 0)
})
