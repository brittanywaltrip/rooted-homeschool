// Guard-logic tests. These run under `npm test` (node --test), NOT Playwright,
// so the protection is verified on every unit-test run instead of only when
// someone happens to execute the e2e suite.
//
// Context: until 2026-08-03 the suite authenticated as the founder's real
// family account and re-flowed a live curriculum. assertIsTestAccount is what
// makes that impossible now, so it gets tests of its own.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertIsTestAccount,
  E2E_USER_ID,
  E2E_EMAIL,
  E2E_ACCOUNTS,
  NEVER_TOUCH_USER_IDS,
} from './test-account.ts'

const FOUNDER_REAL_ACCOUNT = '033760b9-51fc-4db2-b34a-2fafd6501be2'

const PROD_REF = 'gvkbegvvmhcrmxdorctk'
const STAGING_REF = 'cvgqovweybggrqakhdtd'
const PROD = { projectRef: PROD_REF }
const STAGING = { projectRef: STAGING_REF }
const PROD_ACCOUNT = E2E_ACCOUNTS[PROD_REF]
const STAGING_ACCOUNT = E2E_ACCOUNTS[STAGING_REF]

test('the designated test account passes', () => {
  assert.doesNotThrow(() => assertIsTestAccount(E2E_USER_ID, 'unit', PROD))
})

test("the founder's real family account is rejected", () => {
  assert.throws(
    () => assertIsTestAccount(FOUNDER_REAL_ACCOUNT, 'unit', PROD),
    /REFUSING TO RUN/,
  )
})

test('the rejection message names what the offending account is', () => {
  assert.throws(
    () => assertIsTestAccount(FOUNDER_REAL_ACCOUNT, 'unit', PROD),
    /real family account/i,
  )
})

test('every never-touch id is rejected', () => {
  for (const id of Object.keys(NEVER_TOUCH_USER_IDS)) {
    assert.throws(() => assertIsTestAccount(id, 'unit', PROD), /REFUSING TO RUN/, `id ${id} must be rejected`)
  }
})

test('an unknown account is rejected too (allowlist, not denylist)', () => {
  assert.throws(
    () => assertIsTestAccount('00000000-0000-4000-8000-000000000000', 'unit', PROD),
    /REFUSING TO RUN/,
  )
})

test('fails closed when the id cannot be resolved', () => {
  for (const value of [null, undefined, '']) {
    assert.throws(() => assertIsTestAccount(value, 'unit', PROD), /could not resolve/i)
  }
})

test('the designated test account is not itself on the never-touch list', () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(NEVER_TOUCH_USER_IDS, E2E_USER_ID),
    false,
    'E2E_USER_ID must never be a real account id',
  )
})

// --- project-aware allowlist (added 2026-09-20) -----------------------------
// rooted-staging is a second project with its own synthetic account. The guard
// is keyed by project so neither project's account is accepted on the other.

test('each project accepts its OWN account', () => {
  assert.doesNotThrow(() => assertIsTestAccount(PROD_ACCOUNT.id, 'unit', PROD))
  assert.doesNotThrow(() => assertIsTestAccount(STAGING_ACCOUNT.id, 'unit', STAGING))
})

test('each project accepts its own account WITH the matching email', () => {
  assert.doesNotThrow(() =>
    assertIsTestAccount(PROD_ACCOUNT.id, 'unit', { ...PROD, email: PROD_ACCOUNT.email }))
  assert.doesNotThrow(() =>
    assertIsTestAccount(STAGING_ACCOUNT.id, 'unit', { ...STAGING, email: STAGING_ACCOUNT.email.toUpperCase() }),
    'email comparison must be case-insensitive')
})

test('CROSS-PROJECT: the production account is rejected on staging', () => {
  assert.throws(
    () => assertIsTestAccount(PROD_ACCOUNT.id, 'unit', STAGING),
    (e: unknown) => {
      const m = (e as Error).message
      return /REFUSING TO RUN/.test(m) && new RegExp(`e2e account for project ${PROD_REF}`).test(m)
    },
    'must name the cross-project case, not just "not the e2e test account"',
  )
})

test('CROSS-PROJECT: the staging account is rejected on production', () => {
  assert.throws(
    () => assertIsTestAccount(STAGING_ACCOUNT.id, 'unit', PROD),
    (e: unknown) => {
      const m = (e as Error).message
      return /REFUSING TO RUN/.test(m) && new RegExp(`e2e account for project ${STAGING_REF}`).test(m)
    },
  )
})

test('an UNKNOWN project is rejected, not implicitly trusted', () => {
  assert.throws(
    () => assertIsTestAccount(STAGING_ACCOUNT.id, 'unit', { projectRef: 'aaaaaaaaaaaaaaaaaaaa' }),
    /has no designated e2e account/,
  )
})

test('an unresolvable project is rejected', () => {
  for (const ref of [null, undefined, '']) {
    assert.throws(
      () => assertIsTestAccount(STAGING_ACCOUNT.id, 'unit', { projectRef: ref as string | null }),
      /could not determine which Supabase project/,
      `projectRef ${JSON.stringify(ref)} must be rejected`,
    )
  }
})

test('a WRONG id on a known project is rejected', () => {
  assert.throws(
    () => assertIsTestAccount('00000000-0000-4000-8000-000000000000', 'unit', STAGING),
    /REFUSING TO RUN: signed in as/,
  )
})

test('a WRONG email is rejected even when the id is correct', () => {
  for (const [label, id, project] of [
    ['staging', STAGING_ACCOUNT.id, STAGING],
    ['production', PROD_ACCOUNT.id, PROD],
  ] as const) {
    assert.throws(
      () => assertIsTestAccount(id, 'unit', { ...project, email: 'someone@example.com' }),
      /resolved from different sources/,
      `${label}: a foreign address must be rejected`,
    )
  }
})

test('the two projects share one address, so only the id separates them', () => {
  // Deliberate, and asserted so nobody "fixes" the duplicate into a false
  // distinction. PLAYWRIGHT_EMAIL is the same string on both projects, which
  // means the email check CANNOT catch production/staging confusion and is not
  // asked to. Three other things do, and all of them are derived rather than
  // configured: the pinned id differs per project, the project ref is read
  // from the connection target, and lib/env-identity refuses a ref that is not
  // the one ROOTED_EXPECTED_SUPABASE_REF names.
  assert.equal(STAGING_ACCOUNT.email, PROD_ACCOUNT.email)
  assert.notEqual(STAGING_ACCOUNT.id, PROD_ACCOUNT.id)

  // The case this replaces: production credentials against the staging project.
  // It is caught on the id, and the message says which project the id belongs
  // to rather than the useless "not the e2e test account".
  assert.throws(
    () => assertIsTestAccount(PROD_ACCOUNT.id, 'unit', { ...STAGING, email: PROD_ACCOUNT.email }),
    /is the e2e account for project gvkbegvvmhcrmxdorctk/,
  )
  assert.throws(
    () => assertIsTestAccount(STAGING_ACCOUNT.id, 'unit', { ...PROD, email: STAGING_ACCOUNT.email }),
    /is the e2e account for project cvgqovweybggrqakhdtd/,
  )
})

test('a null id is still rejected per project', () => {
  for (const p of [PROD, STAGING]) {
    assert.throws(() => assertIsTestAccount(null, 'unit', p), /could not resolve/i)
  }
})

test('the never-touch ids are rejected on BOTH projects', () => {
  for (const id of Object.keys(NEVER_TOUCH_USER_IDS)) {
    for (const p of [PROD, STAGING]) {
      assert.throws(() => assertIsTestAccount(id, 'unit', p), /REFUSING TO RUN/)
    }
  }
})

test('no env var can add an account or relax the allowlist', () => {
  const src = readFileSync(resolve(import.meta.dirname, 'test-account.ts'), 'utf8')
  // The only env read permitted is the connection target, which can make the
  // guard refuse but can never introduce an account.
  const envReads = src.match(/process\.env\.[A-Z_]+/g) ?? []
  assert.deepEqual(
    [...new Set(envReads)].sort(),
    ['process.env.NEXT_PUBLIC_SUPABASE_URL', 'process.env.SUPABASE_URL'],
    'test-account.ts must read no env var other than the Supabase URL',
  )
  assert.ok(!/E2E_ACCOUNTS\[[^\]]*process\.env/.test(src), 'the allowlist must never be indexed by env')
})

test('both accounts are absent from the never-touch list', () => {
  for (const a of Object.values(E2E_ACCOUNTS)) {
    assert.ok(!Object.prototype.hasOwnProperty.call(NEVER_TOUCH_USER_IDS, a.id))
  }
})

test('E2E_USER_ID and E2E_EMAIL still mean the PRODUCTION account', () => {
  assert.equal(E2E_USER_ID, 'a7011926-149e-42d1-9dde-e55b16059859')
  assert.equal(E2E_EMAIL, 'rooted.e2e@rootedhomeschoolapp.com')
})
