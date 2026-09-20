// Source-level guards on the e2e wiring. These are the properties that cannot
// be checked by running the suite, because running it requires the very
// environment they protect.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const setup = readFileSync(resolve(REPO, 'e2e/global-setup.ts'), 'utf8')
const config = readFileSync(resolve(REPO, 'playwright.config.ts'), 'utf8')
const workflow = readFileSync(resolve(REPO, '.github/workflows/playwright.yml'), 'utf8')

/** Strip comments. A negative assertion that matches its own explanation is
 *  a false positive, and these files explain themselves at length. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
const yamlCode = (src: string) =>
  src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

test('the bypass secret is NEVER a global Playwright header', () => {
  // extraHTTPHeaders apply to every request a context makes, including
  // cross-origin calls to Supabase, PostHog and Sentry.
  // Look for the property being SET, not the word being discussed.
  assert.ok(!/extraHTTPHeaders\s*[:=]/.test(code(config)),
    'playwright.config must not set extraHTTPHeaders; the bypass is a cookie')
  assert.ok(!/extraHTTPHeaders\s*[:=]/.test(code(setup)),
    'global-setup must not set extraHTTPHeaders')
})

test('the bypass is installed as an origin-scoped cookie, and asserted', () => {
  assert.ok(/x-vercel-set-bypass-cookie=true/.test(setup), 'no cookie install')
  assert.ok(/maxRedirects: 0/.test(setup), 'the install request must not follow redirects')
  assert.ok(/_vercel_jwt/.test(setup), 'the cookie is never verified')
  assert.ok(/bypass cookie was not installed/.test(setup), 'a missing cookie must be a hard failure')
  assert.ok(/not \$\{approvedHost\}|approvedHost\.endsWith/.test(setup),
    'the cookie host must be checked against the approved host')
})

test('the server-to-server health fetch cannot be replayed cross-origin', () => {
  assert.ok(/redirect: 'error'/.test(setup),
    "the health fetch must use redirect:'error' so the header cannot follow a redirect")
})

test('global-setup delegates the health gate and refuses when it fails', () => {
  // The four checks (commit, identityOk, env, projectRef) MOVED into
  // e2e/health-gate.ts, where e2e/health-gate.test.ts drives them for real
  // instead of grepping for them. What has to be asserted here is the wiring:
  // that global-setup actually calls the gate and actually stops on a refusal.
  assert.ok(/evaluateHealthGate\(/.test(code(setup)), 'global-setup must call the gate')
  assert.ok(/if \(!gate\.ok\)/.test(code(setup)), 'a failed gate must be checked')
  assert.ok(/throw new Error\(`\[global-setup\] \$\{gate\.message\}/.test(code(setup)),
    'a failed gate must throw, not warn')
})

test('the health gate is NOT gated on GITHUB_SHA', () => {
  // It used to be. Every run outside GitHub Actions therefore skipped the whole
  // gate in silence, which is the failure mode a guard must never have.
  assert.ok(/if \(isRemote\)/.test(code(setup)),
    'the gate must run for any remote base URL, not only in CI')
  const gateAt = code(setup).indexOf('evaluateHealthGate(')
  const shaAt = code(setup).indexOf('GITHUB_SHA')
  assert.ok(gateAt > -1)
  assert.ok(
    shaAt === -1 || !/if \s*\(\s*expectedCommit\s*\)[\s\S]{0,200}evaluateHealthGate/.test(code(setup)),
    'the gate must not sit inside an `if (expectedCommit)` block',
  )
})

test('the identity guard still runs before the browser launches', () => {
  const guardAt = setup.indexOf('assertSafeForTestWrites')
  const launchAt = setup.indexOf('chromium.launch')
  assert.ok(guardAt > -1 && launchAt > -1)
  assert.ok(guardAt < launchAt, 'a guard that runs after the browser launches is decoration')
})

test('the workflow parses JSON and never references a production secret', () => {
  assert.ok(/jq -e/.test(workflow), 'the gate must parse JSON, not grep it')
  for (const prod of [
    'secrets.NEXT_PUBLIC_SUPABASE_URL',
    'secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'secrets.SUPABASE_SERVICE_ROLE_KEY',
    'secrets.PLAYWRIGHT_EMAIL',
    'secrets.PLAYWRIGHT_PASSWORD',
  ]) {
    assert.ok(!workflow.includes(prod), `workflow still references ${prod}`)
  }
  assert.ok(workflow.includes('cvgqovweybggrqakhdtd'), 'the exact staging ref must be asserted')
})

test('layer 1: CI records no trace, video or screenshot', () => {
  // A trace logs every request with its headers and cookies, so a run carrying
  // the bypass cookie writes the secret into it.
  assert.ok(/trace:\s*process\.env\.CI \? 'off' : 'on-first-retry'/.test(code(config)),
    'CI must record no trace')
  assert.ok(/video:\s*'off'/.test(code(config)), 'video must be off')
  assert.ok(/screenshot:\s*'off'/.test(code(config)), 'screenshot must be off')
})

test('layer 2: the whole attachment directory is excluded from the upload', () => {
  // Verified by generating a real report: the trace lands at
  // playwright-report/data/<sha1>.zip, NOT trace.zip, so a filename pattern
  // misses it. Under CI the zips are gone, but an error-context .md attachment
  // survives in the same directory and can embed a code frame. Excluding the
  // directory is what actually holds.
  const y = yamlCode(workflow)
  assert.ok(/!playwright-report\/data\/\*\*/.test(y),
    'playwright-report/data/** must be excluded from the artifact')
  assert.ok(!/trace\.zip/.test(y),
    'a trace.zip filename exclusion is a false comfort and must not be relied on')
})

test('storageState with live tokens is gitignored and outside the artifact path', () => {
  const ignore = readFileSync(resolve(REPO, '.gitignore'), 'utf8')
  assert.ok(/^e2e\/\.auth\/$/m.test(ignore), 'e2e/.auth/ must be gitignored')
  assert.ok(!/e2e\/\.auth/.test(yamlCode(workflow)),
    'e2e/.auth must never appear in an uploaded artifact path')
})
