/**
 * One-off audit script: dump the HTML of every Resend-hosted email template
 * referenced in lib/resend-template.ts.
 *
 * Read-only against the Resend API (GET only — never sends an email).
 *
 *   npx tsx scripts/dump-email-templates.ts
 *
 * Output (gitignored, review-only): email-audit/{name}.html + email-audit/{name}.json
 * The RESEND_API_KEY is read from .env.local and is never written to disk.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { TEMPLATES } from '../lib/resend-template'

const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'email-audit')

/** Read a single key from .env.local (falling back to the process env). */
function loadEnvKey(name: string): string {
  if (process.env[name]) return process.env[name] as string
  const envPath = join(ROOT, '.env.local')
  let raw: string
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    throw new Error(`Could not read ${envPath} — run from the repo root.`)
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && m[1] === name) {
      let val = m[2].trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      return val
    }
  }
  throw new Error(`${name} not found in .env.local`)
}

const RESEND_API_KEY = loadEnvKey('RESEND_API_KEY')
const AUTH = { Authorization: `Bearer ${RESEND_API_KEY}` }

type FetchResult = { status: number; body: unknown; text: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getTemplate(id: string): Promise<FetchResult> {
  // Resend rate-limits (HTTP 429); retry a few times with backoff.
  let last: FetchResult = { status: 0, body: null, text: '' }
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.resend.com/templates/${id}`, { headers: AUTH })
    const text = await res.text()
    let body: unknown = null
    try { body = JSON.parse(text) } catch { body = null }
    last = { status: res.status, body, text }
    if (res.status !== 429) return last
    await sleep(1000 * (attempt + 1))
  }
  return last
}

async function listTemplates(): Promise<{ status: number; text: string }> {
  const res = await fetch('https://api.resend.com/templates', { headers: AUTH })
  const text = await res.text()
  return { status: res.status, text }
}

/** Pull an HTML body out of whatever shape Resend returns. */
function extractHtml(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const b = body as Record<string, unknown>
  const data = (b.data as Record<string, unknown> | undefined) ?? undefined
  const candidate =
    b.html ?? data?.html ?? b.body_html ?? b.content ?? data?.content ?? ''
  return typeof candidate === 'string' ? candidate : ''
}

function extractSubject(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const data = (b.data as Record<string, unknown> | undefined) ?? undefined
  const subject = b.subject ?? data?.subject ?? null
  return typeof subject === 'string' ? subject : null
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const entries = Object.entries(TEMPLATES) as Array<[string, string]>
  console.log(`Dumping ${entries.length} Resend templates → ${OUT_DIR}\n`)

  let listingShown = false

  for (const [name, id] of entries) {
    const { status, body, text } = await getTemplate(id)
    const html = extractHtml(body)
    const subject = extractSubject(body)

    // Write the HTML (or the raw response when no HTML was returned, so a 404
    // body is still inspectable). Metadata goes alongside in the .json.
    writeFileSync(join(OUT_DIR, `${name}.html`), html || text || '')
    writeFileSync(
      join(OUT_DIR, `${name}.json`),
      JSON.stringify({ name, id, status, subject, body }, null, 2),
    )

    console.log(`${name}\t${id}\tHTTP ${status}\thtml=${html.length}`)

    // Gentle pacing to stay under Resend's per-second rate limit.
    await sleep(600)

    // First time the per-id endpoint looks unsupported, dump the list endpoint
    // raw so we can find the correct route.
    if (!listingShown && [400, 401, 403, 404, 405, 501].includes(status)) {
      listingShown = true
      console.log(`\n[fallback] GET /templates/{id} returned ${status}; trying list endpoint…`)
      const list = await listTemplates()
      console.log(`[fallback] GET https://api.resend.com/templates → HTTP ${list.status}`)
      console.log(list.text)
      console.log('')
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
