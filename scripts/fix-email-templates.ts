/**
 * One-off: apply surgical string corrections to live Resend templates.
 *
 * Resend templates are versioned: PATCH /templates/{id} writes an UNPUBLISHED
 * draft, and POST /templates/{id}/publish activates it (sends + GET use the
 * published version). So each fix is: fetch published html → require each FIND
 * (STOP if missing) → apply exact replacement(s) → PATCH → publish → re-fetch
 * published html → verify.
 *
 *   npx tsx scripts/fix-email-templates.ts
 *
 * Resend API only. Not committed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function loadEnvKey(name: string): string {
  if (process.env[name]) return process.env[name] as string
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && m[1] === name) {
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      return v
    }
  }
  throw new Error(`${name} not found in .env.local`)
}

const RESEND_API_KEY = loadEnvKey('RESEND_API_KEY')
const AUTH = { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const count = (s: string, sub: string) => s.split(sub).length - 1

async function rfetch(url: string, init: RequestInit): Promise<{ status: number; body: any; text: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, init)
    const text = await res.text()
    let body: any = null
    try { body = JSON.parse(text) } catch { body = null }
    if (res.status === 429) { await sleep(1200 * (attempt + 1)); continue }
    return { status: res.status, body, text }
  }
  return { status: 429, body: null, text: 'rate-limited' }
}

const getTemplate = (id: string) => rfetch(`https://api.resend.com/templates/${id}`, { headers: AUTH })
const getHtml = (body: any): string => (typeof body?.html === 'string' ? body.html : typeof body?.data?.html === 'string' ? body.data.html : '')

type Edit = {
  name: string
  id: string
  replacements: Array<{ find: string; replace: string }>
  verify: (html: string) => { ok: boolean; detail: string }
}

const EDITS: Edit[] = [
  {
    name: 'weeklySummary',
    id: 'c3fff265-4d07-4062-b78a-d16626af9c7f',
    replacements: [
      {
        find: 'Rooted · rootedhomeschoolapp.com · Made with care for homeschool families. · <a href="{{{unsubscribeUrl}}}" style="color: #b5aca4;">Unsubscribe</a></a>',
        replace: 'Rooted · rootedhomeschoolapp.com · Made with care for homeschool families. · 732 S 6th Street, STE N, Las Vegas, NV 89101 · <a href="{{{unsubscribeUrl}}}" style="color: #b5aca4;">Unsubscribe</a>',
      },
    ],
    verify: (html) => ({
      ok: html.includes('732 S 6th Street') && count(html, '</a></a>') === 0,
      detail: `contains "732 S 6th Street"=${html.includes('732 S 6th Street')}, "</a></a>" count=${count(html, '</a></a>')}`,
    }),
  },
  {
    name: 'familyDigest',
    id: '1d5d5a36-453f-4f39-b62c-3cdaf59ed7f8',
    replacements: [
      { find: "has been busy this week , here's a peek", replace: "has been busy this week, here's a peek" },
      // (b) — updated per follow-up: collapse the whole sign-off to "Brittany 🌿".
      { find: '<p>With love,<br />, Brittany and the Rooted team 🌿</p>', replace: '<p>Brittany 🌿</p>' },
      { find: '732 S 6th Street, STE N, Las Vegas, NV 89101 · <a href="{{{unsubscribeUrl}}}" style="color: #b5aca4;">Unsubscribe</a></a>', replace: '732 S 6th Street, STE N, Las Vegas, NV 89101 · <a href="{{{unsubscribeUrl}}}" style="color: #b5aca4;">Unsubscribe</a>' },
    ],
    verify: (html) => ({
      ok: !html.includes('week ,') && !html.includes('>, Brittany') && count(html, '</a></a>') === 0,
      detail: `"week ," present=${html.includes('week ,')}, ">, Brittany" present=${html.includes('>, Brittany')}, "</a></a>" count=${count(html, '</a></a>')}`,
    }),
  },
  {
    name: 'trialWarning',
    id: '5bf4459b-40bc-4767-92e8-07cb452f2deb',
    replacements: [
      { find: '732 S 6th Street, STE N, Las Vegas, NV 89101 · <a href="{{{unsubscribeUrl}}}" style="color: #b5aca4;">Unsubscribe</a></a>', replace: '732 S 6th Street, STE N, Las Vegas, NV 89101 · <a href="{{{unsubscribeUrl}}}" style="color: #b5aca4;">Unsubscribe</a>' },
    ],
    verify: (html) => ({ ok: count(html, '</a></a>') === 0, detail: `"</a></a>" count=${count(html, '</a></a>')}` }),
  },
  {
    name: 'giftReceived',
    id: '90e75658-0bc3-4f92-87dc-b18c98207d33',
    replacements: [
      { find: '<p>With love,<br />Brittany<br /><span style="color:#7a6f65;">Founder, Rooted</span></p>', replace: '<p>Brittany<br /><span style="color:#7a6f65;">Founder, Rooted</span></p>' },
    ],
    verify: (html) => ({
      ok: !html.includes('With love,<br />Brittany<br /><span style="color:#7a6f65;">Founder, Rooted')
        && html.includes('<p>Brittany<br /><span style="color:#7a6f65;">Founder, Rooted</span></p>'),
      detail: `old sign-off present=${html.includes('With love,<br />Brittany<br /><span style="color:#7a6f65;">Founder, Rooted')}, new sign-off present=${html.includes('<p>Brittany<br /><span style="color:#7a6f65;">Founder, Rooted</span></p>')}`,
    }),
  },
]

async function patchTemplate(id: string, fetchedObj: any, newHtml: string): Promise<{ status: number; mode: string; text: string }> {
  let r = await rfetch(`https://api.resend.com/templates/${id}`, { method: 'PATCH', headers: AUTH, body: JSON.stringify({ html: newHtml }) })
  if (r.status >= 200 && r.status < 300) return { status: r.status, mode: 'html-only', text: r.text }
  const full = { ...(fetchedObj ?? {}), html: newHtml }
  r = await rfetch(`https://api.resend.com/templates/${id}`, { method: 'PATCH', headers: AUTH, body: JSON.stringify(full) })
  if (r.status >= 200 && r.status < 300) return { status: r.status, mode: 'full-object', text: r.text }
  return { status: r.status, mode: 'failed', text: r.text }
}

const publishTemplate = (id: string) => rfetch(`https://api.resend.com/templates/${id}/publish`, { method: 'POST', headers: AUTH, body: '{}' })

async function main() {
  let anyProblem = false
  for (const edit of EDITS) {
    console.log(`\n=== ${edit.name} (${edit.id}) ===`)

    const got = await getTemplate(edit.id)
    if (got.status !== 200) { console.log(`  STOP: fetch failed HTTP ${got.status}. ${got.text}`); anyProblem = true; continue }
    const beforeHtml = getHtml(got.body)
    console.log(`  BEFORE: ${edit.verify(beforeHtml).detail}`)

    let missing = false
    for (const [i, rep] of edit.replacements.entries()) {
      const c = count(beforeHtml, rep.find)
      console.log(`  replacement ${i + 1}: found ${c} occurrence(s)`)
      if (c < 1) { console.log(`  STOP: FIND #${i + 1} not present — not patching ${edit.name}. FIND:\n    ${JSON.stringify(rep.find)}`); missing = true }
    }
    if (missing) { anyProblem = true; continue }

    let newHtml = beforeHtml
    for (const rep of edit.replacements) newHtml = newHtml.split(rep.find).join(rep.replace)
    if (newHtml === beforeHtml) { console.log('  STOP: html unchanged after replacements.'); anyProblem = true; continue }

    const patched = await patchTemplate(edit.id, got.body, newHtml)
    console.log(`  PATCH:   HTTP ${patched.status} (${patched.mode})`)
    if (patched.mode === 'failed') { console.log(`  STOP: PATCH failed. ${patched.text}`); anyProblem = true; continue }

    const pub = await publishTemplate(edit.id)
    console.log(`  PUBLISH: HTTP ${pub.status}`)
    if (pub.status < 200 || pub.status >= 300) { console.log(`  STOP: publish failed. ${pub.text}`); anyProblem = true; continue }

    // Re-fetch published html and verify (publish may be eventually consistent).
    let afterReport = { ok: false, detail: '(not fetched)' }
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(1200)
      const after = await getTemplate(edit.id)
      afterReport = edit.verify(getHtml(after.body))
      if (afterReport.ok) break
    }
    console.log(`  AFTER:   ${afterReport.detail}`)
    console.log(`  VERIFY:  ${afterReport.ok ? 'PASS ✓' : 'FAIL ✗'}`)
    if (!afterReport.ok) anyProblem = true
  }
  console.log(`\nDone. ${anyProblem ? 'One or more templates STOPPED/FAILED — see above.' : 'All updated, published, and verified.'}`)
  if (anyProblem) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
