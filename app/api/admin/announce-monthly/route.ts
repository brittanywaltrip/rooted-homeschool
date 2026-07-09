import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { emailFooterHtml } from '@/lib/email-footer'
import { canSendMarketingEmail } from '@/lib/email/can-send'
import { buildUserListUnsubscribeHeaders, ensureUnsubscribeToken } from '@/lib/email/list-unsubscribe'
import { loadSuppressedEmails } from '@/lib/email/resend-suppression'

export const dynamic = 'force-dynamic'
// The real send walks the full onboarded-free audience. Give it room; the
// idempotency guard makes a re-run after a timeout safe (never double-sends).
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// FROM matches the shared resend-template default so the sender stays pinned to
// Brittany's address regardless of any helper-default changes.
const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'
const SUBJECT = 'Introducing Rooted+ Monthly Plan'
const BASE_URL = 'https://www.rootedhomeschoolapp.com'
const UPGRADE_URL = `${BASE_URL}/upgrade`
const TEST_EMAIL = 'garfieldbrittany@gmail.com'

// Admin accounts are never part of the announcement audience.
const ADMIN_EMAILS = new Set([
  'garfieldbrittany@gmail.com',
  'hello@rootedhomeschoolapp.com',
  'christopherwaltrip@gmail.com',
])

// Send pacing for mode:send. Resend allows 10 requests/second; a wider burst is
// rejected with "Too many requests" (a 50-wide burst failed ~1160 sends on the
// first run). We send in chunks of RESEND_MAX_PER_SEC and pace each chunk to
// span at least one second so we stay under the limit. Any send that still fails
// has its guard row rolled back, so a re-run of mode:send retries only that
// recipient and never double-sends the ones that already went out.
const RESEND_MAX_PER_SEC = 8
const RATE_WINDOW_MS = 1000
// Hard safety cap on sends per invocation so a single call can never run away.
// The onboarded-free audience is ~1.5k, well under this; the guard lets a
// re-run drain anything left if a run ever hits the cap.
const MAX_SENDS_PER_RUN = 1600

type Mode = 'dry' | 'test' | 'send'

function firstNameOr(there: string | null | undefined): string {
  const trimmed = (there ?? '').trim()
  return trimmed || 'there'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Email content — Brittany's final copy (docs/saved-plans/…), verbatim ─────
// All colors are hardcoded (email clients strip CSS variables). Brand green
// #2D5A3D on the CTA, warm #faf8f4 background. No em dashes anywhere.

function announcementHtml(firstName: string, unsubscribeUrl: string): string {
  const bullet = (text: string) =>
    `<tr><td style="padding:0 0 10px 0;vertical-align:top;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="width:20px;color:#2d5a3d;font-size:15px;line-height:1.6;vertical-align:top;">&bull;</td>
        <td style="font-size:15px;line-height:1.6;color:#2d2926;">${text}</td>
      </tr></table>
    </td></tr>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:540px;background:#fefcf9;border-radius:16px;padding:36px 32px;border:1px solid #e8e2d9;">
<tr><td>
<div style="text-align:center;margin:0 0 28px;"><img src="${BASE_URL}/rooted-logo-nav.png" alt="Rooted" width="140" style="display:inline-block;width:140px;max-width:140px;height:auto;" /></div>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 16px;">Hi ${firstName},</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 16px;">I'm so excited to share something new with you.</p>
<p style="font-size:16px;line-height:1.6;color:#2d5a3d;margin:0 0 16px;font-weight:500;">Rooted+ is now available for just $9.99/month!</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 12px;">Now you can enjoy every premium feature with the flexibility of a monthly subscription, including:</p>
<table cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
${bullet('Unlimited photos')}
${bullet('Your complete family yearbook, ready to view and download anytime')}
${bullet('Progress report downloads')}
${bullet('Unlimited family sharing, so grandparents and loved ones can follow along all year')}
${bullet("Access to every memory you've captured, not just the most recent 30 days")}
</table>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 16px;">If you already know Rooted is the right fit for your family, the annual plan is still the best value at just $59 per year. But now you can choose the option that works best for your family.</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 16px;">As we head into a new homeschool year, I hope Rooted continues to make planning, documenting, and celebrating your homeschool journey just a little easier.</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 20px;">Thank you for being part of the Rooted community. It truly means so much to me.</p>
<table cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td style="background:#2d5a3d;border-radius:10px;padding:13px 30px;">
<a href="${UPGRADE_URL}" style="color:#ffffff;font-size:15px;font-weight:500;text-decoration:none;display:inline-block;">Get Rooted+</a>
</td></tr></table>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 2px;">Cheering you on,</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 20px;">Brittany</p>
<p style="font-size:14px;line-height:1.55;color:#7a6f65;margin:0;">P.S. The free version of Rooted isn't going anywhere. You'll always be able to use it for free. Rooted+ simply unlocks your full family story and all of the premium features whenever you're ready.</p>
<p style="font-size:12px;line-height:1.4;color:#9ca3af;margin:24px 0 0;text-align:center;">
<a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from these emails</a>
</p>
${emailFooterHtml()}
</td></tr></table>
</td></tr></table>
</body></html>`
}

// ── Audience resolution ──────────────────────────────────────────────────────

// Onboarded free families: profiles.plan_type IS NULL AND onboarded_at IS NOT
// NULL. Paged so the full audience is covered.
async function loadCandidateProfiles(): Promise<{ id: string; first_name: string | null }[]> {
  const out: { id: string; first_name: string | null }[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name')
      .is('plan_type', null)
      .not('onboarded_at', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) {
      console.error('[announce-monthly] profile page error:', error.message)
      break
    }
    if (!data || data.length === 0) break
    for (const r of data) out.push(r as { id: string; first_name: string | null })
    if (data.length < pageSize) break
  }
  return out
}

// Map user id -> email via the admin API, paged until an empty page so the
// full user base is covered regardless of the server's page size.
async function loadEmailMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let page = 1; page <= 200; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      console.error('[announce-monthly] listUsers error:', error.message)
      break
    }
    const users = data?.users ?? []
    if (users.length === 0) break
    for (const u of users) {
      if (u.email) map.set(u.id, u.email)
    }
  }
  return map
}

type Recipient = { userId: string; email: string; firstName: string }

type Audience = {
  eligible: Recipient[]
  skipped_no_email: number
  skipped_admin: number
  skipped_suppressed: number
  skipped_unsubscribed: number
}

// Build the send list: resolve email, drop admins / suppressed / no-email, then
// run canSendMarketingEmail per recipient (concurrency-limited) and drop anyone
// the gate blocks. Used by both dry and send modes so the count is identical.
async function buildAudience(): Promise<Audience> {
  const [candidates, emailMap, suppressed] = await Promise.all([
    loadCandidateProfiles(),
    loadEmailMap(),
    loadSuppressedEmails(supabase),
  ])

  const preGate: Recipient[] = []
  let skipped_no_email = 0
  let skipped_admin = 0
  let skipped_suppressed = 0

  for (const c of candidates) {
    const email = emailMap.get(c.id)
    if (!email) { skipped_no_email++; continue }
    const lower = email.toLowerCase()
    if (ADMIN_EMAILS.has(lower)) { skipped_admin++; continue }
    if (suppressed.has(lower)) { skipped_suppressed++; continue }
    preGate.push({ userId: c.id, email, firstName: firstNameOr(c.first_name) })
  }

  // Per-recipient gate. Run in bounded chunks so ~1.5k reads don't serialize.
  const eligible: Recipient[] = []
  let skipped_unsubscribed = 0
  const gateChunk = 25
  for (let i = 0; i < preGate.length; i += gateChunk) {
    const slice = preGate.slice(i, i + gateChunk)
    const gated = await Promise.all(
      slice.map(async (r) => ({
        r,
        gate: await canSendMarketingEmail(r.userId, 'announcement', supabase),
      })),
    )
    for (const { r, gate } of gated) {
      if (gate.allowed) eligible.push(r)
      else skipped_unsubscribed++
    }
  }

  return { eligible, skipped_no_email, skipped_admin, skipped_suppressed, skipped_unsubscribed }
}

// ── Single send ──────────────────────────────────────────────────────────────

async function sendTo(resend: Resend, r: Recipient): Promise<{ ok: boolean; error?: string }> {
  const token = await ensureUnsubscribeToken(r.userId, supabase)
  const headers = buildUserListUnsubscribeHeaders(token)
  const unsubscribeUrl = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(r.email)}`
  const html = announcementHtml(r.firstName, unsubscribeUrl)

  const { error } = await resend.emails.send({
    from: FROM,
    to: r.email,
    subject: SUBJECT,
    html,
    headers,
  })
  if (error) {
    return { ok: false, error: typeof error === 'string' ? error : error.message }
  }
  return { ok: true }
}

// ── Modes ────────────────────────────────────────────────────────────────────

async function runDry() {
  const audience = await buildAudience()
  return {
    mode: 'dry' as const,
    subject: SUBJECT,
    would_send: audience.eligible.length,
    skipped_no_email: audience.skipped_no_email,
    skipped_admin: audience.skipped_admin,
    skipped_suppressed: audience.skipped_suppressed,
    skipped_unsubscribed: audience.skipped_unsubscribed,
    samples: audience.eligible.slice(0, 5).map((r) => ({ to: r.email, first_name: r.firstName })),
  }
}

async function runTest() {
  const resend = new Resend(process.env.RESEND_API_KEY)

  // Resolve Brittany's profile so the test email mirrors a real send
  // (real first name + a working List-Unsubscribe token). Falls back safely.
  const emailMap = await loadEmailMap()
  const testUserId = [...emailMap.entries()].find(
    ([, email]) => email.toLowerCase() === TEST_EMAIL,
  )?.[0]

  let firstName = 'Brittany'
  let token: string | null = null
  if (testUserId) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('first_name')
      .eq('id', testUserId)
      .maybeSingle()
    firstName = firstNameOr((prof as { first_name?: string | null } | null)?.first_name)
    token = await ensureUnsubscribeToken(testUserId, supabase)
  }

  const unsubscribeUrl = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(TEST_EMAIL)}`
  const html = announcementHtml(firstName, unsubscribeUrl)
  const { error } = await resend.emails.send({
    from: FROM,
    to: TEST_EMAIL,
    subject: SUBJECT,
    html,
    headers: buildUserListUnsubscribeHeaders(token),
  })

  if (error) {
    return {
      mode: 'test' as const,
      sent: 0,
      to: TEST_EMAIL,
      error: typeof error === 'string' ? error : error.message,
    }
  }
  return { mode: 'test' as const, sent: 1, to: TEST_EMAIL }
}

async function runSend() {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const audience = await buildAudience()

  let sent = 0
  let failed = 0
  let already_sent = 0
  let capped = false

  for (let i = 0; i < audience.eligible.length; i += RESEND_MAX_PER_SEC) {
    if (sent >= MAX_SENDS_PER_RUN) { capped = true; break }
    const chunkStartedAt = Date.now()
    const batch = audience.eligible.slice(i, i + RESEND_MAX_PER_SEC)

    await Promise.all(
      batch.map(async (r) => {
        if (sent >= MAX_SENDS_PER_RUN) return

        // Idempotency guard: claim the recipient BEFORE sending. A duplicate
        // user_id (PK conflict) or any insert failure means we skip; a genuine
        // dupe is already-sent, a transient failure simply retries on re-run
        // because no row was written.
        const { error: guardErr } = await supabase
          .from('announce_monthly_sends')
          .insert({ user_id: r.userId })
        if (guardErr) { already_sent++; return }

        const result = await sendTo(resend, r)
        if (result.ok) {
          sent++
          try {
            await supabase.from('email_log').insert({ user_id: r.userId, email_type: 'announcement' })
          } catch { /* logging is best-effort */ }
        } else {
          failed++
          // Roll the guard back so a re-run retries this recipient.
          await supabase.from('announce_monthly_sends').delete().eq('user_id', r.userId)
          console.error(`[announce-monthly] send failed for ${r.email}: ${result.error ?? ''}`)
        }
      }),
    )

    // Pace: keep each chunk to at least one second so we never exceed
    // RESEND_MAX_PER_SEC sends per second.
    const elapsed = Date.now() - chunkStartedAt
    if (elapsed < RATE_WINDOW_MS && i + RESEND_MAX_PER_SEC < audience.eligible.length) {
      await delay(RATE_WINDOW_MS - elapsed)
    }
  }

  return {
    mode: 'send' as const,
    sent,
    skipped_unsubscribed: audience.skipped_unsubscribed,
    skipped_suppressed: audience.skipped_suppressed,
    failed,
    already_sent,
    ...(capped ? { capped: true, note: `Hit MAX_SENDS_PER_RUN (${MAX_SENDS_PER_RUN}); re-run mode:send to drain the rest.` } : {}),
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Admin-only. Same secret the cron routes use. Never publicly callable.
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let mode: Mode
  try {
    const body = (await req.json()) as { mode?: string }
    if (body?.mode !== 'dry' && body?.mode !== 'test' && body?.mode !== 'send') {
      return NextResponse.json(
        { error: 'Invalid mode. Use { "mode": "dry" | "test" | "send" }.' },
        { status: 400 },
      )
    }
    mode = body.mode
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    if (mode === 'dry') return NextResponse.json(await runDry())
    if (mode === 'test') return NextResponse.json(await runTest())
    return NextResponse.json(await runSend())
  } catch (err) {
    console.error('[announce-monthly] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
