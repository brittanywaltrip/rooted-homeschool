/**
 * One-off: put the approved words into the hosted `rooted-winback` template and
 * publish them.
 *
 *   npx tsx scripts/publish-winback-template.ts          # PATCH + publish, prints the version id
 *   npx tsx scripts/publish-winback-template.ts --dry    # prints the payload, calls nothing
 *
 * Never sends an email. Talks to the Resend templates API the same way
 * scripts/dump-email-templates.ts does (RESEND_API_KEY from .env.local, never
 * written anywhere).
 *
 * Editing a template is two steps. PATCH writes an UNPUBLISHED draft and returns
 * 200, while GET and every send keep using the published version; only
 * POST /templates/{id}/publish makes the draft live. So this script PATCHes,
 * publishes, then re-reads the template and refuses to report success unless
 * the published html carries the new copy.
 *
 * The old body said "I noticed you stopped logging memories", which is wrong for
 * a family who was doing lessons. The wrapper (Crimson Pro, logo, green button,
 * footer with the Las Vegas address, unsubscribe link) is unchanged. Adds the
 * `who` variable: the first child's name, or "your family".
 *
 * The subject is set by the sending route ("Still here whenever you are"), so
 * the template's own subject is left alone.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TEMPLATES } from '../lib/resend-template.ts'

const ROOT = process.cwd()
const TEMPLATE_ID = TEMPLATES.winback

function loadEnvKey(name: string): string {
  if (process.env[name]) return process.env[name] as string
  const envPath = join(ROOT, '.env.local')
  let raw: string
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    throw new Error(`Could not read ${envPath}, run from the repo root.`)
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && m[1] === name) {
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      return val
    }
  }
  throw new Error(`${name} not found in .env.local`)
}

// The approved copy, one entry per paragraph. The html and text versions are
// both built from this so they cannot drift apart.
export const WINBACK_PARAGRAPHS = [
  'Hi {{{firstName}}},',
  "It's been a couple of weeks since {{{who}}} last checked something off in Rooted. No pressure at all. Homeschool weeks get away from everyone, and your plan is right where you left it.",
  "When you're ready, Today will show what's next and skip over what you missed. Nothing to reset.",
  "If something about Rooted got in the way, reply to this email and tell me. I read every one and I'm the one who fixes it.",
] as const

export const WINBACK_SIGNATURE = ['Brittany', 'Rooted Homeschool'] as const

export function winbackHtml(): string {
  const body = WINBACK_PARAGRAPHS.map((p) => `<p>${p}</p>`).join('')
  return (
    `<style>@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap');</style>` +
    `<div style="font-family: 'Crimson Pro', Georgia, serif; font-size: 20px; font-weight: 500; line-height: 1.7; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #2d2926; background: #fefcf9;">` +
    `<div style="text-align:center;margin-bottom:24px;"><img src="https://rootedhomeschoolapp.com/rooted-logo-nav.png" alt="Rooted" width="130" style="display:inline-block;" /></div>` +
    body +
    `<p style="text-align:center; margin: 32px 0;"><a href="{{{dashboardUrl}}}" style="background: #3d6b47; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 16px; display: inline-block;">Open Rooted</a></p>` +
    `<p>${WINBACK_SIGNATURE[0]}<br /><span style="color:#7a6f65;">${WINBACK_SIGNATURE[1]}</span></p>` +
    `<hr style="border: none; border-top: 1px solid #e8e2d9; margin: 32px 0;" />` +
    `<p style="font-size: 12px; color: #b5aca4; line-height: 1.6;">Rooted &middot; rootedhomeschoolapp.com &middot; Made with care for homeschool families. &middot; 732 S 6th Street, STE N, Las Vegas, NV 89101</p>` +
    `<p style="text-align: center; font-size: 12px; color: #b5aca4; margin-top: 24px;">Want fewer emails? <a href="https://rootedhomeschoolapp.com/unsubscribe?email={{{email}}}" style="color: #b5aca4;">Unsubscribe</a></p>` +
    `</div>`
  )
}

export function winbackText(): string {
  return [
    ...WINBACK_PARAGRAPHS,
    'Open Rooted: {{{dashboardUrl}}}',
    WINBACK_SIGNATURE.join('\n'),
    '--------------------------------------------------------------------------------',
    'Rooted · rootedhomeschoolapp.com · Made with care for homeschool families. · 732 S 6th Street, STE N, Las Vegas, NV 89101',
    'Want fewer emails? Unsubscribe: https://rootedhomeschoolapp.com/unsubscribe?email={{{email}}}',
  ].join('\n\n')
}

export const WINBACK_VARIABLES = [
  { key: 'firstName', type: 'string' },
  { key: 'who', type: 'string', fallback_value: 'your family' },
  { key: 'dashboardUrl', type: 'string' },
  { key: 'email', type: 'string' },
] as const

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call(method: string, path: string, key: string, body?: unknown) {
  let last = { status: 0, text: '' }
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.resend.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    last = { status: res.status, text: await res.text() }
    if (res.status !== 429) break
    await sleep(1000 * (attempt + 1))
  }
  let json: Record<string, unknown> | null = null
  try { json = JSON.parse(last.text) } catch { json = null }
  return { ...last, json }
}

async function main() {
  const payload = { html: winbackHtml(), text: winbackText(), variables: WINBACK_VARIABLES }
  if (process.argv.includes('--dry')) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  const key = loadEnvKey('RESEND_API_KEY')

  const patch = await call('PATCH', `/templates/${TEMPLATE_ID}`, key, payload)
  console.log(`PATCH /templates/${TEMPLATE_ID} -> HTTP ${patch.status}`)
  if (patch.status >= 300) throw new Error(`PATCH refused: ${patch.text}`)
  await sleep(700)

  const publish = await call('POST', `/templates/${TEMPLATE_ID}/publish`, key)
  console.log(`POST /templates/${TEMPLATE_ID}/publish -> HTTP ${publish.status}`)
  if (publish.status >= 300) throw new Error(`publish refused: ${publish.text}`)
  await sleep(700)

  const after = await call('GET', `/templates/${TEMPLATE_ID}`, key)
  const t = after.json ?? {}
  const html = typeof t.html === 'string' ? t.html : ''
  if (!html.includes('since {{{who}}} last checked something off') || html.includes('stopped logging memories')) {
    throw new Error('The published html does not carry the new copy. Check has_unpublished_versions in the dashboard.')
  }
  const keys = Array.isArray(t.variables) ? (t.variables as { key: string }[]).map((v) => v.key).sort() : []
  console.log(`published: status=${String(t.status)} has_unpublished_versions=${String(t.has_unpublished_versions)}`)
  console.log(`variables: ${keys.join(', ')}`)
  console.log(`current_version_id: ${String(t.current_version_id)}`)
}

// Only run when executed directly, so the tests can import the copy builders.
if (process.argv[1] && process.argv[1].endsWith('publish-winback-template.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
