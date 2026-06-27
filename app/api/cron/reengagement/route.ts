import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canSendMarketingEmail, type MarketingEmailType } from '@/lib/email/can-send'
import { buildUserListUnsubscribeHeaders, ensureUnsubscribeToken } from '@/lib/email/list-unsubscribe'
import { loadSuppressedEmails } from '@/lib/email/resend-suppression'
import { sendResendTemplate } from '@/lib/resend-template'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'
const ALERT_TO = 'garfieldbrittany@gmail.com'

// Deliverability guard: never blast the whole dormant backlog at once. The
// newest dormant signups are prioritized (created_at DESC) and the older
// backlog drains across the following daily runs.
const MAX_SENDS_PER_RUN = 150
// Alert if more than this many sends fail in a single run (any 4xx always alerts).
const FAILURE_ALERT_THRESHOLD = 5
// Bound how many profile rows we scan for reengagement_1 in one run so a deep
// backlog can never turn into an unbounded loop.
const MAX_E1_SCAN = 5000

const DAY_MS = 24 * 60 * 60 * 1000

const TEMPLATE_IDS = {
  reengagement_1: '6bcd32eb-1b86-4a96-8457-384554013b3f',
  reengagement_2: 'c5f091f4-3381-47d1-b286-93349803f41b',
  reengagement_3: '3f2c5bb5-e7f9-4c07-bad3-25b59219dd26',
} as const

type ReType = 'reengagement_1' | 'reengagement_2' | 'reengagement_3'

// Subject line on every send is the April→June 422 fix — Resend rejects template
// sends without an explicit subject. Do not remove these.
const SUBJECTS: Record<ReType, string> = {
  reengagement_1: 'One memory is all it takes 🌿',
  reengagement_2: 'Your garden is still waiting 🌱',
  reengagement_3: 'We miss you at Rooted 🌿',
}

async function alreadySent(userId: string, emailType: string): Promise<boolean> {
  const { data } = await supabase.from('email_log').select('id').eq('user_id', userId).eq('email_type', emailType).limit(1)
  return (data?.length ?? 0) > 0
}

async function logEmail(userId: string, emailType: string): Promise<void> {
  await supabase.from('email_log').insert({ user_id: userId, email_type: emailType })
}

// "Not activated" = zero memories AND zero lessons. Cheap existence checks.
async function notActivated(userId: string): Promise<boolean> {
  const { data: mem } = await supabase.from('memories').select('id').eq('user_id', userId).limit(1)
  if ((mem?.length ?? 0) > 0) return false
  const { data: les } = await supabase.from('lessons').select('id').eq('user_id', userId).limit(1)
  if ((les?.length ?? 0) > 0) return false
  return true
}

function resolveFirstName(
  profileName: string | null,
  authUser: { user_metadata?: Record<string, string> } | null | undefined,
): string {
  return profileName
    || authUser?.user_metadata?.first_name
    || authUser?.user_metadata?.full_name?.split(' ')[0]
    || authUser?.user_metadata?.name?.split(' ')[0]
    || 'there'
}

async function gateAndHeaders(
  userId: string,
  type: MarketingEmailType,
): Promise<{ allowed: boolean; reason?: string; headers: Record<string, string> }> {
  const gate = await canSendMarketingEmail(userId, type, supabase)
  if (!gate.allowed) return { allowed: false, reason: gate.reason, headers: {} }
  const token = await ensureUnsubscribeToken(userId, supabase)
  return { allowed: true, headers: buildUserListUnsubscribeHeaders(token) }
}

// Page through email_log to collect every user_id already sent a given type.
// Used for cheap in-memory dedup pre-filtering; the authoritative per-user
// email_log check still runs immediately before each send.
async function loadSentUserIds(emailType: string): Promise<Set<string>> {
  const ids = new Set<string>()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('email_log')
      .select('user_id')
      .eq('email_type', emailType)
      .range(from, from + pageSize - 1)
    if (error || !data || data.length === 0) break
    for (const r of data) ids.add((r as { user_id: string }).user_id)
    if (data.length < pageSize) break
  }
  return ids
}

// Users whose prior-step email was logged at/before the cutoff — the set that
// is now "due" for the next step in the sequence (oldest first so people
// already mid-sequence keep moving).
async function loadDueFromLog(priorType: string, cutoffIso: string): Promise<string[]> {
  const out: string[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('email_log')
      .select('user_id, sent_at')
      .eq('email_type', priorType)
      .lte('sent_at', cutoffIso)
      .order('sent_at', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error || !data || data.length === 0) break
    for (const r of data) out.push((r as { user_id: string }).user_id)
    if (data.length < pageSize) break
  }
  return out
}

// Batch-resolve profiles.first_name for a set of user ids.
async function fetchFirstNames(userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  const chunk = 500
  for (let i = 0; i < userIds.length; i += chunk) {
    const slice = userIds.slice(i, i + chunk)
    const { data } = await supabase.from('profiles').select('id, first_name').in('id', slice)
    for (const r of data ?? []) {
      const row = r as { id: string; first_name: string | null }
      map.set(row.id, row.first_name)
    }
  }
  return map
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  let sent = 0
  let skipped = 0
  let errors = 0
  const byType = { reengagement_1: 0, reengagement_2: 0, reengagement_3: 0 }
  const failures: Array<{ type: ReType; email: string; status?: number; error?: string }> = []

  // Suppression list (bounced/complained/unsubscribed) — loaded once, matched
  // in memory. Defensive: empty set if the table is missing or unreadable.
  const suppressed = await loadSuppressedEmails(supabase)

  // In-memory dedup sets per step so we don't re-scan already-sent users.
  const [sent1, sent2, sent3] = await Promise.all([
    loadSentUserIds('reengagement_1'),
    loadSentUserIds('reengagement_2'),
    loadSentUserIds('reengagement_3'),
  ])

  // Attempt one send. Runs the full gate → email_log dedup → not-activated →
  // suppression checks before sending. Mutates the run counters.
  async function processOne(userId: string, type: ReType, profileFirstName: string | null): Promise<void> {
    if (sent >= MAX_SENDS_PER_RUN) return

    const gate = await gateAndHeaders(userId, type)
    if (!gate.allowed) { skipped++; return }

    // Authoritative email_log dedup — runs before EVERY send (idempotency guard).
    if (await alreadySent(userId, type)) { skipped++; return }

    if (!(await notActivated(userId))) { skipped++; return }

    const { data: authData } = await supabase.auth.admin.getUserById(userId)
    const email = authData.user?.email
    if (!email) { skipped++; return }

    if (suppressed.has(email.toLowerCase())) { skipped++; return }

    // Re-check budget after the awaits above so a concurrent send can't push us over.
    if (sent >= MAX_SENDS_PER_RUN) return

    const firstName = resolveFirstName(profileFirstName, authData.user)
    const variables: Record<string, string> = type === 'reengagement_2'
      ? { firstName, planUrl: 'https://rootedhomeschoolapp.com/dashboard/plan', email }
      : { firstName, dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard', email }

    // Shared helper posts the correct nested `template: { id, variables }`
    // payload (the flat template_id shape 422'd the whole drip Apr to Jun 2026).
    // FROM matches the helper default; pass it explicitly so the sender stays
    // pinned to Brittany's address regardless of helper-default changes.
    const result = await sendResendTemplate(
      email,
      TEMPLATE_IDS[type],
      variables,
      FROM,
      SUBJECTS[type],
      gate.headers,
    )
    if (!result.ok) {
      errors++
      failures.push({ type, email, status: result.status, error: result.error })
      console.error(`[${type}] send error for ${email}: ${result.status ?? 'n/a'} ${result.error ?? ''}`)
      return
    }
    await logEmail(userId, type)
    sent++
    byType[type]++
  }

  // ── Step 3: reengagement_2 sent >= 5 days ago, no reengagement_3 yet ───────
  // Process the later steps first so families already mid-sequence aren't
  // starved of their follow-ups by the large reengagement_1 backlog.
  {
    const due = await loadDueFromLog('reengagement_2', new Date(now - 5 * DAY_MS).toISOString())
    const eligible = due.filter((id) => !sent3.has(id))
    const names = await fetchFirstNames(eligible)
    for (const id of eligible) {
      if (sent >= MAX_SENDS_PER_RUN) break
      await processOne(id, 'reengagement_3', names.get(id) ?? null)
    }
  }

  // ── Step 2: reengagement_1 sent >= 3 days ago, no reengagement_2 yet ───────
  {
    const due = await loadDueFromLog('reengagement_1', new Date(now - 3 * DAY_MS).toISOString())
    const eligible = due.filter((id) => !sent2.has(id))
    const names = await fetchFirstNames(eligible)
    for (const id of eligible) {
      if (sent >= MAX_SENDS_PER_RUN) break
      await processOne(id, 'reengagement_2', names.get(id) ?? null)
    }
  }

  // ── Step 1: not activated, signed up >= 2 days ago, no reengagement_1 yet ──
  // State-based + self-healing: any dormant family ever (including the months-old
  // backlog) is reachable here, newest-first, regardless of a missed prior run.
  // No hardcoded date cutoff.
  {
    const cutoff = new Date(now - 2 * DAY_MS).toISOString()
    const pageSize = 500
    let scanned = 0
    outer: for (let from = 0; sent < MAX_SENDS_PER_RUN && scanned < MAX_E1_SCAN; from += pageSize) {
      const { data: page, error } = await supabase
        .from('profiles')
        .select('id, first_name, created_at')
        .lte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1)
      if (error || !page || page.length === 0) break
      for (const p of page) {
        if (sent >= MAX_SENDS_PER_RUN || scanned >= MAX_E1_SCAN) break outer
        scanned++
        const row = p as { id: string; first_name: string | null }
        if (sent1.has(row.id)) { skipped++; continue }
        await processOne(row.id, 'reengagement_1', row.first_name)
      }
      if (page.length < pageSize) break
    }
  }

  // ── Failure alerting — never die silently again ────────────────────────────
  const has4xx = failures.some((f) => typeof f.status === 'number' && f.status >= 400 && f.status < 500)
  if (has4xx || errors > FAILURE_ALERT_THRESHOLD) {
    const text = [
      'The Rooted re-engagement cron encountered send failures.',
      '',
      `Sent: ${sent}`,
      `Skipped: ${skipped}`,
      `Errors: ${errors}`,
      `By type: ${JSON.stringify(byType)}`,
      has4xx ? 'A 4xx response was returned — possible Resend 422 regression, check the template/subject payload.' : '',
      '',
      `Failures (showing up to 50 of ${failures.length}):`,
      ...failures.slice(0, 50).map((f) => `- ${f.type} → ${f.email}: ${f.status ?? 'n/a'} ${f.error ?? ''}`),
    ].filter(Boolean).join('\n')

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: FROM, to: ALERT_TO, subject: '🔴 Re-engagement cron failures', text }),
      })
    } catch (err) {
      console.error('[reengagement] failed to send failure alert:', err)
    }
  }

  return NextResponse.json({ sent, skipped, errors, byType })
}
