import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canSendMarketingEmail } from '@/lib/email/can-send'
import { buildUserListUnsubscribeHeaders, ensureUnsubscribeToken } from '@/lib/email/list-unsubscribe'
import { loadSuppressedEmails } from '@/lib/email/resend-suppression'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'
import { isNonFamilyEmail } from '@/lib/queue-slot-health'
import {
  resolveFirstName,
  runWinback,
  WINBACK_EMAIL_TYPE,
  WINBACK_SUBJECT,
} from '@/lib/winback'

export const dynamic = 'force-dynamic'

// Daily at 15:00 UTC (vercel.json), an hour after the reengagement drip. Who
// gets it and why lives in lib/winback.ts. `?dry=1` (still behind the cron
// secret) counts and logs would-be sends by user id and sends nothing.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'
const ALERT_TO = 'garfieldbrittany@gmail.com'
// Alert if more than this many sends fail in a single run (any 4xx always alerts).
const FAILURE_ALERT_THRESHOLD = 5
const PAGE = 1000
const CHUNK = 200

type ActivityRow = { user_id: string | null; date: string | null }

// Every row, not the first 1000: PostgREST truncates without saying so. Ordered
// by id so pages neither repeat nor skip a row.
async function pageAll(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) return null
    const rows = (data ?? []) as Record<string, unknown>[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// The same two sources weekly-summary reads to decide who is active: a
// memory's `date` and a completed lesson's `scheduled_date`.
async function loadActivitySince(since: string): Promise<ActivityRow[] | null> {
  const [memories, lessons] = await Promise.all([
    pageAll((from, to) =>
      supabase.from('memories').select('id, user_id, date').gte('date', since).order('id').range(from, to),
    ),
    pageAll((from, to) =>
      supabase
        .from('lessons')
        .select('id, user_id, scheduled_date')
        .eq('completed', true)
        .gte('scheduled_date', since)
        .order('id')
        .range(from, to),
    ),
  ])
  if (!memories || !lessons) return null
  return [
    ...memories.map((m) => ({ user_id: m.user_id as string | null, date: m.date as string | null })),
    ...lessons.map((l) => ({ user_id: l.user_id as string | null, date: l.scheduled_date as string | null })),
  ]
}

// Null when any chunk's read fails, so the caller can refuse to act on half an answer.
async function idsWhere(
  userIds: string[],
  query: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
  column: string,
): Promise<Set<string> | null> {
  const out = new Set<string>()
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const { data, error } = await query(userIds.slice(i, i + CHUNK))
    if (error) return null
    for (const r of (data ?? []) as Record<string, unknown>[]) out.add(r[column] as string)
  }
  return out
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const suppressed = await loadSuppressedEmails(supabase)

  const result = await runWinback({
    dry,
    loadActivitySince,
    loadOnboarded: (ids) =>
      idsWhere(ids, (chunk) => supabase.from('profiles').select('id').in('id', chunk).eq('onboarded', true), 'id'),
    loadAlreadySent: (ids) =>
      idsWhere(
        ids,
        (chunk) => supabase.from('email_log').select('user_id').eq('email_type', WINBACK_EMAIL_TYPE).in('user_id', chunk),
        'user_id',
      ),
    alreadySent: async (userId) => {
      const { data, error } = await supabase
        .from('email_log')
        .select('id')
        .eq('user_id', userId)
        .eq('email_type', WINBACK_EMAIL_TYPE)
        .limit(1)
      // Fail closed: a family we cannot prove was never sent is skipped.
      if (error) return true
      return (data?.length ?? 0) > 0
    },
    gate: async (userId) => {
      const gate = await canSendMarketingEmail(userId, 'winback', supabase)
      if (!gate.allowed) return { allowed: false, reason: gate.reason, headers: {} }
      // A dry run writes nothing, and ensureUnsubscribeToken can write a token.
      if (dry) return { allowed: true, headers: {} }
      const token = await ensureUnsubscribeToken(userId, supabase)
      return { allowed: true, headers: buildUserListUnsubscribeHeaders(token) }
    },
    getUser: async (userId) => {
      const [{ data: authData }, { data: profile }] = await Promise.all([
        supabase.auth.admin.getUserById(userId),
        supabase.from('profiles').select('first_name').eq('id', userId).maybeSingle(),
      ])
      if (!authData.user) return null
      const profileName = (profile as { first_name: string | null } | null)?.first_name ?? null
      return { email: authData.user.email ?? null, firstName: resolveFirstName(profileName, authData.user) }
    },
    isInternalEmail: (email) => isNonFamilyEmail(email) || email.trim().toLowerCase().startsWith('rooted.e2e@'),
    suppressed,
    firstChildName: async (userId) => {
      const { data } = await supabase
        .from('children')
        .select('name')
        .eq('user_id', userId)
        .eq('archived', false)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
      return ((data ?? [])[0] as { name: string | null } | undefined)?.name ?? null
    },
    // The helper has no reply_to parameter, so none is set. Replies to FROM
    // already land in the hello@ inbox.
    send: ({ to, variables, headers }) =>
      sendResendTemplate(to, TEMPLATES.winback, variables, FROM, WINBACK_SUBJECT, headers),
    // `email` only ever lands inside the footer's unsubscribe query string, and
    // /unsubscribe reads it with useSearchParams, which turns a raw "+" into a
    // space. A plus-address arrived as "mom rooted@gmail.com", matched no user,
    // and app/api/unsubscribe still answered ok, so the page told her she was
    // unsubscribed while nothing had been written. Encoded here, because a
    // hosted template cannot encode its own variable.
    encodeEmailVariable: true,
    logSent: async (userId) => {
      const { error } = await supabase.from('email_log').insert({ user_id: userId, email_type: WINBACK_EMAIL_TYPE })
      return !error
    },
    log: (line) => console.log(line),
  })

  // ── Failure alerting, copied from the reengagement cron. User ids only. ────
  const has4xx = result.failures.some((f) => typeof f.status === 'number' && f.status >= 400 && f.status < 500)
  // A send with no email_log row would be repeated by tomorrow's run, so any one
  // of those alerts too.
  if (has4xx || result.logWriteFailures > 0 || result.errors > FAILURE_ALERT_THRESHOLD) {
    const text = [
      'The Rooted win-back cron encountered send failures.',
      '',
      `Candidates: ${result.candidates}`,
      `Sent: ${result.sent}`,
      `Skipped: ${result.skipped}`,
      `Errors: ${result.errors}`,
      result.logWriteFailures > 0
        ? `${result.logWriteFailures} send(s) went out but their email_log row did not save. Insert those rows by hand or they will be sent again tomorrow.`
        : '',
      has4xx ? 'A 4xx response was returned. Check the template variables and subject payload.' : '',
      '',
      `Failures (showing up to 50 of ${result.failures.length}):`,
      ...result.failures.slice(0, 50).map((f) => `- user ${f.userId}: ${f.status ?? 'n/a'} ${f.error ?? ''}`),
    ].filter(Boolean).join('\n')

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: FROM, to: ALERT_TO, subject: 'Win-back cron failures', text }),
      })
    } catch (err) {
      console.error('[cron/winback] failed to send failure alert:', err)
    }
  }

  const { candidates, sent, skipped, errors } = result
  return NextResponse.json({ candidates, sent, skipped, errors, dry })
}
