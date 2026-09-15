import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canSendMarketingEmail } from '@/lib/email/can-send'
import { buildUserListUnsubscribeHeaders, ensureUnsubscribeToken } from '@/lib/email/list-unsubscribe'
import { loadSuppressedEmails } from '@/lib/email/resend-suppression'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'
import { isNonFamilyEmail } from '@/lib/queue-slot-health'
import { resolveFirstName } from '@/lib/winback'
import { runTrialEnding, TRIAL_ENDING_EMAIL_TYPE, type TrialProfile } from '@/lib/trial-ending'

export const dynamic = 'force-dynamic'

// Daily at 16:00 UTC (vercel.json), an hour after the win-back cron. Who gets it
// and why lives in lib/trial-ending.ts. `?dry=1` (still behind the cron secret)
// counts, logs by user id, and sends nothing.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'
const ALERT_TO = 'garfieldbrittany@gmail.com'
const FAILURE_ALERT_THRESHOLD = 5
const PAGE = 1000
const CHUNK = 200

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const suppressed = await loadSuppressedEmails(supabase)

  const result = await runTrialEnding({
    dry,
    // Paged past PostgREST's 1000-row cap, ordered by id so pages neither
    // repeat nor skip. Paying families are filtered here; the exact
    // still-on-trial test is getUserAccess, in the candidate rule.
    loadProfiles: async (fromIso, toIso) => {
      const out: TrialProfile[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, trial_started_at, is_pro, onboarded, timezone')
          .gte('trial_started_at', fromIso)
          .lte('trial_started_at', toIso)
          .eq('onboarded', true)
          // `neq` would drop rows where is_pro is NULL (the column is nullable),
          // so ask the question NULL answers too.
          .or('is_pro.is.null,is_pro.eq.false')
          .order('id')
          .range(from, from + PAGE - 1)
        if (error) return null
        const rows = (data ?? []) as TrialProfile[]
        out.push(...rows)
        if (rows.length < PAGE) break
      }
      return out
    },
    loadAlreadySent: async (userIds) => {
      const out = new Set<string>()
      for (let i = 0; i < userIds.length; i += CHUNK) {
        const { data, error } = await supabase
          .from('email_log')
          .select('user_id')
          .eq('email_type', TRIAL_ENDING_EMAIL_TYPE)
          .in('user_id', userIds.slice(i, i + CHUNK))
        if (error) return null
        for (const r of (data ?? []) as { user_id: string }[]) out.add(r.user_id)
      }
      return out
    },
    alreadySent: async (userId) => {
      const { data, error } = await supabase
        .from('email_log')
        .select('id')
        .eq('user_id', userId)
        .eq('email_type', TRIAL_ENDING_EMAIL_TYPE)
        .limit(1)
      // Fail closed: a family we cannot prove was never sent is skipped.
      if (error) return true
      return (data?.length ?? 0) > 0
    },
    gate: async (userId) => {
      const gate = await canSendMarketingEmail(userId, 'trial_ending', supabase)
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
      const { data, error } = await supabase
        .from('children')
        .select('name')
        .eq('user_id', userId)
        .eq('archived', false)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
      // A failed read is not "no children": say so, because this email is sent
      // once and "your family's garden" cannot be corrected afterwards.
      if (error) console.warn(`[cron/trial-ending] child read failed for user ${userId}, falling back to "your family"`)
      return ((data ?? [])[0] as { name: string | null } | undefined)?.name ?? null
    },
    send: ({ to, subject, variables, headers }) =>
      sendResendTemplate(to, TEMPLATES.trialEnding, variables, FROM, subject, headers),
    // `email` only ever lands inside the footer's unsubscribe query string, and
    // /unsubscribe reads it with useSearchParams, which turns a raw "+" into a
    // space. A plus-address would arrive as "mom rooted@gmail.com", match no
    // user, and the page would still say "You've been unsubscribed". Encoded
    // here, since a hosted template cannot encode its own variable.
    encodeEmailVariable: true,
    logSent: async (userId) => {
      const { error } = await supabase
        .from('email_log')
        .insert({ user_id: userId, email_type: TRIAL_ENDING_EMAIL_TYPE })
      return !error
    },
    log: (line) => console.log(line),
  })

  // ── Failure alerting, same shape as the win-back cron. User ids only. ──────
  const has4xx = result.failures.some((f) => typeof f.status === 'number' && f.status >= 400 && f.status < 500)
  // A run that sent nothing because a read failed used to be silent: errors = 1
  // never cleared the threshold, and this email has only a three-day window, so
  // three quiet failures would drop a whole cohort for good. Same for a budget
  // that leaves candidates behind.
  const silentFailure = result.errors > 0 && result.sent === 0
  if (has4xx || result.logWriteFailures > 0 || result.deferred > 0 || silentFailure || result.errors > FAILURE_ALERT_THRESHOLD) {
    const text = [
      'The Rooted trial-ending cron encountered send failures.',
      '',
      `Candidates: ${result.candidates}`,
      `Sent: ${result.sent}`,
      `Skipped: ${result.skipped}`,
      `Errors: ${result.errors}`,
      result.deferred > 0
        ? `${result.deferred} candidate(s) hit the per-run budget. The window is three days wide, so raise MAX_TRIAL_ENDING_SENDS_PER_RUN or run it again today.`
        : '',
      silentFailure ? 'The run sent nothing because a read failed. Nobody was emailed; check Supabase.' : '',
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
        body: JSON.stringify({ from: FROM, to: ALERT_TO, subject: 'Trial-ending cron failures', text }),
      })
    } catch (err) {
      console.error('[cron/trial-ending] failed to send failure alert:', err)
    }
  }

  const { candidates, sent, skipped, errors, deferred } = result
  return NextResponse.json({ candidates, sent, skipped, errors, deferred, dry })
}
