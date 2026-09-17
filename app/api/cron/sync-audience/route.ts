import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadSuppressedEmails } from '@/lib/email/resend-suppression'
import { isNonFamilyEmail } from '@/lib/queue-slot-health'
import { createResendContactsClient } from '@/lib/resend-contacts'
import {
  activeUserIdsFrom,
  audienceSince,
  AUDIENCE_ENV_VAR,
  runAudienceSync,
  type AudienceFamily,
} from '@/lib/audience-sync'

export const dynamic = 'force-dynamic'
// Paging every contact and every family, then paced Resend writes.
export const maxDuration = 300

// Daily at 12:00 UTC (vercel.json), two hours before the reengagement drip, so
// the Resend audience is current by the time anyone opens Resend. Makes the
// audience that Resend Broadcasts go to match Rooted's records; the rules, and
// why opting out only ever goes one way, are in lib/audience-sync.ts.
// `?dry=1` (still behind the cron secret) reads everything and writes nothing.
// Sends no email of its own, except the failure alert to Brittany.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'
const ALERT_TO = 'garfieldbrittany@gmail.com'
const PAGE = 1000
const CHUNK = 200

type LessonRow = { user_id: string | null; scheduled_date: string | null }
type MemoryRow = { user_id: string | null; date: string | null }
type ProfileRow = {
  id: string
  first_name: string | null
  display_name: string | null
  onboarded: boolean | null
  email_unsubscribed: boolean | null
  email_marketing: boolean | null
}

// Every row, not the first 1000: PostgREST truncates without saying so. Ordered
// by id so pages neither repeat nor skip a row. Null when any page fails.
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[] | null> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) return null
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// The weekly summary's audience, read the way app/api/cron/weekly-summary reads
// it: completed lessons by scheduled_date and memories by date, since
// WEEKLY_AUDIENCE_DAYS ago (lib/audience-sync.test.ts holds the two in step).
async function loadActiveUserIds(): Promise<Set<string> | null> {
  const since = audienceSince(new Date())
  const [lessons, memories] = await Promise.all([
    pageAll<LessonRow>((from, to) =>
      supabase
        .from('lessons')
        .select('id, user_id, scheduled_date')
        .eq('completed', true)
        .gte('scheduled_date', since)
        .order('id')
        .range(from, to),
    ),
    pageAll<MemoryRow>((from, to) =>
      supabase.from('memories').select('id, user_id, date').gte('date', since).order('id').range(from, to),
    ),
  ])
  if (!lessons || !memories) return null
  return activeUserIdsFrom(lessons, memories)
}

async function loadFamilies(): Promise<AudienceFamily[] | null> {
  const emails = new Map<string, string>()
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    // An error page is not the end of the list: half the users would make the
    // other half look ineligible, and the gap step would act on that.
    if (error) return null
    if (!data?.users?.length) break
    for (const u of data.users) if (u.email) emails.set(u.id, u.email)
    if (data.users.length < 200) break
  }
  const profiles = await pageAll<ProfileRow>((from, to) =>
    supabase
      .from('profiles')
      .select('id, first_name, display_name, onboarded, email_unsubscribed, email_marketing')
      .order('id')
      .range(from, to),
  )
  if (!profiles) return null
  const out: AudienceFamily[] = []
  for (const p of profiles) {
    const email = emails.get(p.id)
    if (!email) continue
    out.push({
      userId: p.id,
      email,
      firstName: p.first_name,
      displayName: p.display_name,
      onboarded: p.onboarded,
      emailUnsubscribed: p.email_unsubscribed,
      emailMarketing: p.email_marketing,
    })
  }
  return out
}

/**
 * A broadcast unsubscribe becomes a Rooted unsubscribe. Only ever sets TRUE,
 * and only on rows that are not already true. Never write false here: opting
 * back in is the family's choice, in the app.
 */
async function markUnsubscribed(families: AudienceFamily[]): Promise<boolean> {
  const ids = families.map((f) => f.userId)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await supabase
      .from('profiles')
      .update({ email_unsubscribed: true })
      .in('id', ids.slice(i, i + CHUNK))
      .or('email_unsubscribed.is.null,email_unsubscribed.eq.false')
    if (error) return false
  }
  // The same audit row the app's own unsubscribe routes write. A failure here
  // is logged, not fatal: the profile flag is what every sender checks.
  const { error } = await supabase.from('email_suppressions').insert(
    families.map((f) => ({ email: f.email.trim().toLowerCase(), reason: 'user_unsubscribe', source: 'resend_broadcast' })),
  )
  if (error) console.error('[cron/sync-audience] suppression audit rows did not save:', error.message)
  return true
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const segmentId = process.env[AUDIENCE_ENV_VAR]?.trim()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!segmentId || !apiKey) {
    const missing = !segmentId ? AUDIENCE_ENV_VAR : 'RESEND_API_KEY'
    console.error(`[cron/sync-audience] ${missing} is not set, nothing done`)
    return NextResponse.json(
      {
        error: `${missing} is not set. ${
          missing === AUDIENCE_ENV_VAR
            ? 'Create the audience once in the Resend dashboard and set its id as RESEND_ACTIVE_AUDIENCE_ID in Vercel.'
            : 'Set the Resend API key in Vercel.'
        } Nothing was changed.`,
      },
      { status: 500 },
    )
  }

  const resend = createResendContactsClient({ apiKey })
  const suppressed = await loadSuppressedEmails(supabase)

  const result = await runAudienceSync({
    dry,
    segmentId,
    listAllContacts: () => resend.listContacts(),
    listSegmentContacts: (id) => resend.listSegmentContacts(id),
    loadFamilies,
    loadActiveUserIds,
    suppressed,
    isInternalEmail: (email) => isNonFamilyEmail(email) || email.trim().toLowerCase().startsWith('rooted.e2e@'),
    markUnsubscribed,
    createContact: (args) => resend.createContact(args),
    updateContactName: (id, firstName) => resend.updateContact(id, { firstName }),
    addToSegment: (id, seg) => resend.addToSegment(id, seg),
    removeFromSegment: (id, seg) => resend.removeFromSegment(id, seg),
    log: (line) => console.log(line),
  })

  const { audienceSize, pulledUnsubscribes, pushedNew, pushedUpdated, markedIneligible, errors } = result
  console.log(
    `[cron/sync-audience] ${dry ? 'DRY ' : ''}audienceSize=${audienceSize} pulledUnsubscribes=${pulledUnsubscribes} ` +
      `pushedNew=${pushedNew} pushedUpdated=${pushedUpdated} markedIneligible=${markedIneligible} ` +
      `skippedOptedOut=${result.skippedOptedOut} deferred=${result.deferred} errors=${errors}`,
  )

  // ── Failure alerting, the win-back cron's. User ids and counts only. ───────
  if (errors > 0) {
    const text = [
      'The Rooted audience sync (Resend Broadcasts) hit errors.',
      '',
      `Audience size: ${audienceSize}`,
      `Unsubscribes pulled from Resend: ${pulledUnsubscribes}`,
      `Added: ${pushedNew}`,
      `Names updated: ${pushedUpdated}`,
      `Taken out of the audience: ${markedIneligible}`,
      `Errors: ${errors}`,
      result.removalGuardTripped
        ? 'The removal guard tripped: more than half the audience looked ineligible, so nobody was taken out. Check the reads before the next broadcast.'
        : '',
      '',
      `Failures (showing up to 50 of ${result.failures.length}):`,
      ...result.failures
        .slice(0, 50)
        .map((f) => `- ${f.step}${f.userId ? ` user ${f.userId}` : ''}: ${f.status ?? 'n/a'} ${f.error ?? ''}`),
    ].filter(Boolean).join('\n')

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: FROM, to: ALERT_TO, subject: 'Audience sync failures', text }),
      })
    } catch (err) {
      console.error('[cron/sync-audience] failed to send failure alert:', err)
    }
  }

  return NextResponse.json({
    audienceSize,
    pulledUnsubscribes,
    pushedNew,
    pushedUpdated,
    markedIneligible,
    errors,
    skippedOptedOut: result.skippedOptedOut,
    deferred: result.deferred,
    dry,
  })
}
