/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS script, not app code */
// node run.cjs <repoDir> <bundle.js> <stagingEnvFile> [scenario...]
// Two Chromium tabs sharing one synthetic session of the staging CI account.
const path = require('node:path'); const fs = require('node:fs'); const http = require('node:http')
const { createRequire } = require('node:module')
const [repo, bundle, envFile, ...only] = process.argv.slice(2)
const req = createRequire(path.join(repo, 'package.json'))
const { chromium } = req('@playwright/test'); const { createClient } = req('@supabase/supabase-js')
const env = fs.readFileSync(envFile, 'utf8'); const g = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.replace(/^"|"$/g, '')
const STAGING_REF = 'cvgqovweybggrqakhdtd', EXPECTED_ID = '1954d827-ac7d-41e8-aeef-f8e07d4337a4', EXPECTED_EMAIL = 'rooted.e2e@rootedhomeschoolapp.com'
const claims = k => JSON.parse(Buffer.from(g(k).split('.')[1], 'base64url'))
if (new URL(g('NEXT_PUBLIC_SUPABASE_URL')).host !== `${STAGING_REF}.supabase.co`) throw new Error('refusing: not staging URL')
if (claims('SUPABASE_SERVICE_ROLE_KEY').ref !== STAGING_REF || claims('SUPABASE_SERVICE_ROLE_KEY').role !== 'service_role') throw new Error('refusing: service key')
if (claims('NEXT_PUBLIC_SUPABASE_ANON_KEY').ref !== STAGING_REF) throw new Error('refusing: anon key')
const admin = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function mintTokenHash() {
  const { data: u, error: ue } = await admin.auth.admin.getUserById(EXPECTED_ID)
  if (ue || u.user.email !== EXPECTED_EMAIL) throw new Error('refusing: CI account identity mismatch')
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EXPECTED_EMAIL })
  if (error) throw error
  if (data.user.id !== EXPECTED_ID) throw new Error('refusing: link minted for another user')
  return data.properties.hashed_token
}

async function setup(browser, origin) {
  const context = await browser.newContext()
  const net = []
  context.on('request', r => { const u = r.url(); if (u.includes('/auth/v1/')) net.push({ tab: r.frame()?.page()?.__name ?? '?', path: new URL(u).pathname + (u.includes('grant_type') ? '?' + new URL(u).searchParams.get('grant_type') : ''), t: Date.now(), r }) })
  const A = await context.newPage(); A.__name = 'A'
  const B = await context.newPage(); B.__name = 'B'
  const pageErrors = []
  for (const p of [A, B]) p.on('pageerror', e => pageErrors.push({ tab: p.__name, name: e.name, message: e.message.slice(0, 200) }))
  await A.goto(origin); 
  const v = await A.evaluate(t => window.h.verify(t), await mintTokenHash())
  if (v.user !== EXPECTED_ID) throw new Error('sign-in failed: ' + JSON.stringify(v))
  await B.goto(origin)
  await Promise.all([A, B].map(p => p.waitForFunction(() => window.__events.some(e => e.event === 'INITIAL_SESSION' || e.event === 'SIGNED_IN'))))
  return { context, A, B, net, pageErrors }
}

async function summarize(s, extra) {
  await sleep(1500)
  const statuses = await Promise.all(s.net.map(async n => { const resp = await n.r.response().catch(() => null); return { tab: n.tab, path: n.path, status: resp?.status() ?? 'failed' } }))
  const tabs = {}
  for (const p of [s.A, s.B]) tabs[p.__name] = await p.evaluate(async uid => ({
    session: await window.h.getSession(), read: await window.h.protectedRead(uid),
    events: window.__events.map(e => e.event), rejections: window.__rejections, lifeboat: window.h.lifeboat(),
  }), EXPECTED_ID)
  const refreshes = statuses.filter(x => x.path.endsWith('refresh_token'))
  return { ...extra, refreshRequests: refreshes, otherAuthRequests: statuses.filter(x => !x.path.endsWith('refresh_token')).map(x => `${x.tab} ${x.path} ${x.status}`), tabs, pageErrors: s.pageErrors }
}

const scenarios = {
  // Both tabs find the access token expired and call getUser / getSession at once.
  async concurrent(s) {
    await s.A.evaluate(() => window.h.expireNow())
    const [a, b] = await Promise.all([s.A, s.B].map(p => p.evaluate(async uid => {
      const r = await Promise.all([window.h.getUserWithRetry(), window.h.getSession(), window.h.getUser(), window.h.protectedRead(uid)])
      return r
    }, EXPECTED_ID)))
    return { A: a, B: b }
  },
  // A's refresh is slowed to 8s and runs inside the client's own auto-refresh
  // tick; B asks for the session meanwhile (B waits on the lock, and on 2.99.2
  // steals it after lockAcquireTimeout=5s).
  async contention(s) {
    await s.A.route('**/auth/v1/token?grant_type=refresh_token', async route => { await sleep(8000); await route.continue() })
    await s.A.evaluate(() => window.h.expireNow())
    const tickP = s.A.evaluate(() => window.h.tick())
    await s.A.waitForRequest(r => r.url().includes('grant_type=refresh_token'), { timeout: 10000 })
    const t0 = Date.now()
    const bP = s.B.evaluate(async uid => [await window.h.getSession(), await window.h.protectedRead(uid)], EXPECTED_ID)
    const [tick, b] = await Promise.all([tickP, bP])
    await s.A.unroute('**/auth/v1/token?grant_type=refresh_token')
    const after = await s.A.evaluate(async uid => [await window.h.getUserWithRetry(), await window.h.protectedRead(uid)], EXPECTED_ID)
    return { tickInA: tick, B: b, bWaitedMs: Date.now() - t0, AafterwardsGetUser: after }
  },
  // Same, but A's slowed refresh reaches the server 15s late, past the
  // refresh-token reuse window, so the server answers "already used".
  async late(s) {
    await s.A.route('**/auth/v1/token?grant_type=refresh_token', async route => { await sleep(15000); await route.continue() })
    await s.A.evaluate(() => window.h.expireNow())
    const tickP = s.A.evaluate(() => window.h.tick())
    await s.A.waitForRequest(r => r.url().includes('grant_type=refresh_token'), { timeout: 10000 })
    const bP = s.B.evaluate(async uid => [await window.h.getSession(), await window.h.protectedRead(uid)], EXPECTED_ID)
    const [tick, b] = await Promise.all([tickP, bP])
    await s.A.unroute('**/auth/v1/token?grant_type=refresh_token')
    await sleep(2000)
    const after = await Promise.all([s.A, s.B].map(p => p.evaluate(async uid => [await window.h.getUserWithRetry(), await window.h.protectedRead(uid)], EXPECTED_ID)))
    return { tickInA: tick, B: b, afterA: after[0], afterB: after[1] }
  },
  // No direct calls: the client's own setInterval tick starts a slowed refresh
  // in one tab, then the other tab asks for the session while it is in flight.
  async natural(s) {
    for (const p of [s.A, s.B]) await p.route('**/auth/v1/token?grant_type=refresh_token', async route => { await sleep(12000); await route.continue() })
    await s.A.evaluate(() => window.h.expireNow())
    const first = await Promise.race([s.A, s.B].map(p => p.waitForRequest(r => r.url().includes('grant_type=refresh_token'), { timeout: 40000 }).then(() => p)))
    const other = first === s.A ? s.B : s.A
    const y = await other.evaluate(async uid => [await window.h.getSession(), await window.h.protectedRead(uid)], EXPECTED_ID)
    await sleep(14000)
    for (const p of [s.A, s.B]) await p.unroute('**/auth/v1/token?grant_type=refresh_token')
    const after = await Promise.all([s.A, s.B].map(p => p.evaluate(async uid => [await window.h.getUserWithRetry(), await window.h.protectedRead(uid)], EXPECTED_ID)))
    return { tickTab: first.__name, otherTabResult: y, afterA: after[0], afterB: after[1] }
  },
  // Both tabs go to the background with an expired token, then resume together.
  async resume(s) {
    for (const p of [s.A, s.B]) await p.evaluate(() => window.h.setVisible(false))
    await s.A.evaluate(() => window.h.expireNow())
    await sleep(1000)
    await Promise.all([s.A, s.B].map(p => p.evaluate(() => window.h.setVisible(true))))
    await sleep(4000)
    const [a, b] = await Promise.all([s.A, s.B].map(p => p.evaluate(async uid => [await window.h.getUserWithRetry(), await window.h.protectedRead(uid)], EXPECTED_ID)))
    return { A: a, B: b }
  },
  // A genuine sign-out (local scope: revokes only this synthetic session) in A.
  async signout(s) {
    const out = await s.A.evaluate(() => window.h.signOutLocal())
    await sleep(1500)
    const b = await s.B.evaluate(async () => ({ sawSignedOut: window.__events.some(e => e.event === 'SIGNED_OUT'), check: await window.h.getUserWithRetry() }))
    return { signOut: out, B: b, wouldRedirect: b.sawSignedOut || b.check.kind === 'signed-out' }
  },
}

;(async () => {
  const html = `<!doctype html><meta charset=utf-8><title>auth harness</title><script>${fs.readFileSync(bundle, 'utf8')}</script>`
  const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html) })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://localhost:${server.address().port}/`
  const browser = await chromium.launch({ headless: true })
  const results = { browser: browser.version(), node: process.version }
  try {
    for (const name of only.length ? only : Object.keys(scenarios)) {
      const s = await setup(browser, origin)
      results.version = await s.A.evaluate(() => window.h.version)
      try { results[name] = await summarize(s, await scenarios[name](s)) }
      catch (e) { results[name] = { harnessError: String(e).slice(0, 300) } }
      finally {
        // Dispose the synthetic session with LOCAL scope only (never global).
        if (name !== 'signout') await s.A.evaluate(() => window.h.signOutLocal()).catch(() => {})
        await s.context.close()
      }
    }
  } finally { await browser.close(); server.close() }
  console.log(JSON.stringify(results, null, 1))
})().catch(e => { console.error(e); process.exitCode = 1 })
