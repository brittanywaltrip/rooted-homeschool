/**
 * The Resend templates API, for the one-off scripts that create and edit hosted
 * email templates. Never sends an email.
 *
 * Generalised from scripts/publish-winback-template.ts (which is left as it
 * was). Same env handling as scripts/dump-email-templates.ts: RESEND_API_KEY from
 * .env.local, never written anywhere.
 *
 * Editing is two steps and the second is the one that matters. POST or PATCH
 * writes a DRAFT and returns 200 while GET and every send keep using the
 * published version; only POST /templates/{id}/publish makes it live. So every
 * change goes through publishAndVerify, which publishes and then re-reads the
 * template and refuses to report success unless the published html says what it
 * was asked to say.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type TemplateVariable = { key: string; type: 'string'; fallback_value?: string }

export type TemplateBody = {
  id?: string
  alias?: string
  name?: string
  status?: string
  current_version_id?: string
  has_unpublished_versions?: boolean
  subject?: string | null
  html?: string
  text?: string
  variables?: { key: string }[]
}

export function loadEnvKey(name: string): string {
  if (process.env[name]) return process.env[name] as string
  const envPath = join(process.cwd(), '.env.local')
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function resendCall(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string; json: Record<string, unknown> | null }> {
  const key = loadEnvKey('RESEND_API_KEY')
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
  // Pace every call: Resend rate-limits per second.
  await sleep(700)
  return { ...last, json }
}

export async function getTemplate(idOrAlias: string): Promise<TemplateBody | null> {
  const res = await resendCall('GET', `/templates/${encodeURIComponent(idOrAlias)}`)
  if (res.status === 404) return null
  if (res.status >= 300) throw new Error(`GET /templates/${idOrAlias} -> ${res.status}: ${res.text}`)
  return res.json as TemplateBody
}

/** Publish, re-read, and prove the published html carries every `mustInclude` and no `mustExclude`. */
export async function publishAndVerify(
  id: string,
  check: { mustInclude: string[]; mustExclude?: string[]; field?: 'html' | 'text' }[],
): Promise<TemplateBody> {
  const publish = await resendCall('POST', `/templates/${id}/publish`)
  console.log(`POST /templates/${id}/publish -> HTTP ${publish.status}`)
  if (publish.status >= 300) throw new Error(`publish refused: ${publish.text}`)
  const after = await getTemplate(id)
  if (!after) throw new Error(`template ${id} vanished after publish`)
  for (const c of check) {
    const body = (c.field === 'text' ? after.text : after.html) ?? ''
    for (const s of c.mustInclude) {
      if (!body.includes(s)) throw new Error(`published ${c.field ?? 'html'} is missing: ${s}`)
    }
    for (const s of c.mustExclude ?? []) {
      if (body.includes(s)) throw new Error(`published ${c.field ?? 'html'} still contains: ${s}`)
    }
  }
  const keys = (after.variables ?? []).map((v) => v.key).sort()
  console.log(`published: status=${after.status} has_unpublished_versions=${String(after.has_unpublished_versions)}`)
  console.log(`variables: ${keys.join(', ')}`)
  console.log(`id: ${after.id}`)
  console.log(`current_version_id: ${after.current_version_id}`)
  return after
}

/** Replace `from` with `to` in `source`, and throw unless `from` occurs exactly once. */
export function replaceExactlyOnce(source: string, from: string, to: string, label: string): string {
  const first = source.indexOf(from)
  if (first < 0) throw new Error(`${label}: text to replace not found: ${from}`)
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`${label}: text to replace occurs more than once: ${from}`)
  return source.slice(0, first) + to + source.slice(first + from.length)
}
