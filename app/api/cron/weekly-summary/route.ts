import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'
import { canSendMarketingEmail } from '@/lib/email/can-send'
import { buildUserListUnsubscribeHeaders, ensureUnsubscribeToken } from '@/lib/email/list-unsubscribe'
import { loadSuppressedEmails } from '@/lib/email/resend-suppression'
import { isNonFamilyEmail } from '@/lib/queue-slot-health'
import { resolveFirstName } from '@/lib/winback'
import { getCurrentSchoolYear } from '@/app/lib/school-year'
import { loadLeafCounts } from '@/app/lib/garden-leaves'
import {
  classifyWeeklyRecipient,
  gardenLine,
  isoWeekStart,
  lessonsLine,
  memoriesLine,
  memoriesVariable,
  safeTimeZone,
  weeklySubject,
  weekWindow,
  MAX_WEEKLY_SENDS_PER_RUN,
  WEEKLY_EMAIL_TYPE,
  WEEKLY_TODAY_URL,
  WINBACK_EMAIL_TYPE,
  WINBACK_QUIET_DAYS,
  WEEKLY_AUDIENCE_DAYS,
  WEEKLY_QUIET_SUBJECT,
} from '@/lib/weekly-summary'

export const dynamic = 'force-dynamic'
// Every recipient needs their own garden read (school year + leaf sources), so
// a Monday with the whole 30-day audience in it is minutes of work, not seconds.
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'
const ALERT_TO = 'garfieldbrittany@gmail.com'
const FAILURE_ALERT_THRESHOLD = 5
const PAGE = 1000
const CHUNK = 200
// How many families are prepared and sent at a time. Each one is ~7 small reads;
// serially that is minutes for a big audience, and unbounded parallelism would
// hammer PostgREST.
const CONCURRENCY = 5
const DAY_MS = 24 * 60 * 60 * 1000

type LessonRow = { user_id: string | null; child_id: string | null; scheduled_date: string | null }
type MemoryRow = { user_id: string | null; type: string | null; date: string | null }

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

/** Run `work` over `items`, `CONCURRENCY` at a time, in order. */
async function pool<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      await work(items[index])
    }
  })
  await Promise.all(runners)
}

async function alertBrittany(subject: string, text: string): Promise<void> {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: ALERT_TO, subject, text }),
    })
  } catch (err) {
    console.error('[cron/weekly-summary] failed to send failure alert:', err)
  }
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const now = new Date()

  let full = 0
  let quiet = 0
  let skipped = 0
  let skippedRecentWinback = 0
  let errors = 0
  let deferred = 0
  let logWriteFailures = 0
  const failures: { userId: string; status?: number; error?: string }[] = []

  // A read that failed cannot be told from a read that found nothing, and every
  // wrong answer here sends a family the wrong email. Stop, say so, send none.
  const readFailed = async (what: string) => {
    console.error(`[cron/weekly-summary] ${what} read failed, nothing sent`)
    await alertBrittany(
      'Weekly-summary cron could not read',
      `The Monday email did not go out: the ${what} read failed. Nobody was emailed. Check Supabase and re-run /api/cron/weekly-summary.`,
    )
    return NextResponse.json({ full: 0, quiet: 0, skipped: 0, skippedRecentWinback: 0, deferred: 0, errors: 1, dry })
  }

  // ── Who did what, for everyone, in two paged reads ────────────────────────
  // The same two sources the win-back cron reads: a memory's `date` and a
  // completed lesson's `scheduled_date`. The audience is 30 days (it was 14,
  // which meant a family who took a fortnight off never heard from us again);
  // the week counted in the email is the Monday to Sunday just gone.
  const since = new Date(now.getTime() - WEEKLY_AUDIENCE_DAYS * DAY_MS).toISOString().slice(0, 10)
  const [lessons, memories] = await Promise.all([
    pageAll<LessonRow>((from, to) =>
      supabase
        .from('lessons')
        .select('id, user_id, child_id, scheduled_date')
        .eq('completed', true)
        .gte('scheduled_date', since)
        .order('id')
        .range(from, to),
    ),
    pageAll<MemoryRow>((from, to) =>
      supabase.from('memories').select('id, user_id, type, date').gte('date', since).order('id').range(from, to),
    ),
  ])
  if (!lessons || !memories) return readFailed('activity')

  const audience = new Set<string>()
  for (const l of lessons) if (l.user_id && l.scheduled_date) audience.add(l.user_id)
  for (const m of memories) if (m.user_id && m.date) audience.add(m.user_id)
  const userIds = [...audience]

  if (userIds.length === 0) {
    return NextResponse.json({ full: 0, quiet: 0, skipped: 0, skippedRecentWinback: 0, deferred: 0, errors: 0, dry })
  }

  // ── Profiles, emails, and the two email_log questions ─────────────────────
  // Every bulk read below fails CLOSED. A chunk that errors and is treated as
  // "no rows" sends the wrong thing: a missing profile means the wrong timezone
  // and so the wrong week, a missing email_log row means a second copy of an
  // email the family already has.
  const profiles = new Map<string, { first_name: string | null; timezone: string | null }>()
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, timezone')
      .in('id', userIds.slice(i, i + CHUNK))
    if (error) return readFailed('profiles')
    for (const p of (data ?? []) as { id: string; first_name: string | null; timezone: string | null }[]) {
      profiles.set(p.id, { first_name: p.first_name, timezone: p.timezone })
    }
  }

  const emailMap = new Map<string, string>()
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    // An error page is not the end of the list. Reading half the users would
    // silently drop every family after it, counted as an ordinary skip.
    if (error) return readFailed('auth users')
    if (!data?.users?.length) break
    for (const u of data.users) if (u.email) emailMap.set(u.id, u.email)
    if (data.users.length < 200) break
  }

  // Already sent this week (the dedup the schedule used to provide on its own),
  // and win-backs from the last 7 days: a family who just got "Still here
  // whenever you are" should not also get a Monday summary.
  const sentThisWeek = new Set<string>()
  const recentWinback = new Set<string>()
  const weekKey = isoWeekStart(now, 'UTC')
  const winbackSince = new Date(now.getTime() - WINBACK_QUIET_DAYS * DAY_MS).toISOString()
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const slice = userIds.slice(i, i + CHUNK)
    const [{ data: weekly, error: weeklyErr }, { data: wins, error: winsErr }] = await Promise.all([
      supabase
        .from('email_log')
        .select('user_id')
        .eq('email_type', WEEKLY_EMAIL_TYPE)
        .gte('sent_at', `${weekKey}T00:00:00Z`)
        .in('user_id', slice),
      supabase
        .from('email_log')
        .select('user_id')
        .eq('email_type', WINBACK_EMAIL_TYPE)
        .gte('sent_at', winbackSince)
        .in('user_id', slice),
    ])
    if (weeklyErr || winsErr) return readFailed('email_log')
    for (const r of (weekly ?? []) as { user_id: string }[]) sentThisWeek.add(r.user_id)
    for (const r of (wins ?? []) as { user_id: string }[]) recentWinback.add(r.user_id)
  }

  const suppressed = await loadSuppressedEmails(supabase)

  // ── One family at a time ──────────────────────────────────────────────────
  // Bucketed once. Re-scanning the whole 30 days per family was O(families x
  // rows), which is minutes of pure CPU on a big audience.
  const lessonsByUser = new Map<string, LessonRow[]>()
  const memoriesByUser = new Map<string, MemoryRow[]>()
  for (const l of lessons) {
    if (!l.user_id) continue
    const list = lessonsByUser.get(l.user_id) ?? []
    list.push(l)
    lessonsByUser.set(l.user_id, list)
  }
  for (const m of memories) {
    if (!m.user_id) continue
    const list = memoriesByUser.get(m.user_id) ?? []
    list.push(m)
    memoriesByUser.set(m.user_id, list)
  }

  const lastActive = new Map<string, string>()
  const remember = (id: string | null | undefined, date: string | null | undefined) => {
    if (!id || !date) return
    const prev = lastActive.get(id)
    if (!prev || date > prev) lastActive.set(id, date)
  }
  for (const l of lessons) remember(l.user_id, l.scheduled_date)
  for (const m of memories) remember(m.user_id, m.date)

  const prepared = userIds.filter((id) => {
    const email = emailMap.get(id)
    if (!email || isNonFamilyEmail(email) || suppressed.has(email.toLowerCase())) { skipped++; return false }
    if (recentWinback.has(id)) { skippedRecentWinback++; return false }
    if (sentThisWeek.has(id)) { skipped++; return false }
    return true
  })

  await pool(prepared, async (userId) => {
    try {
      await sendOne(userId)
    } catch (err) {
      // One family's unexpected throw is not the whole Monday.
      errors++
      failures.push({ userId, error: err instanceof Error ? err.message : String(err) })
      console.error(`[cron/weekly-summary] threw for user ${userId}`)
    }
  })

  async function sendOne(userId: string): Promise<void> {
    if (full + quiet >= MAX_WEEKLY_SENDS_PER_RUN) { deferred++; return }
    const email = emailMap.get(userId)!
    const profile = profiles.get(userId) ?? { first_name: null, timezone: null }

    const gate = await canSendMarketingEmail(userId, 'weekly_summary', supabase)
    if (!gate.allowed) { skipped++; return }

    const zone = safeTimeZone(profile.timezone)
    const week = weekWindow(now, zone)

    const weekLessons = (lessonsByUser.get(userId) ?? []).filter(
      (l) => l.scheduled_date && l.scheduled_date >= week.start && l.scheduled_date <= week.end,
    )
    const weekMemories = (memoriesByUser.get(userId) ?? []).filter(
      (m) => m.date && m.date >= week.start && m.date <= week.end,
    )

    // Children: names for both sentences, and the ids the garden counts by.
    // Archived children included: a child archived on Sunday still did the
    // lessons, and leaving them out made the subject count work the body never
    // mentioned. The garden below uses the unarchived ones only, as the Garden
    // page does.
    const { data: childRows } = await supabase
      .from('children')
      .select('id, name, archived')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    const allChildren = (childRows ?? []) as { id: string; name: string | null; archived: boolean | null }[]
    const children = allChildren.filter((c) => c.archived !== true)

    const perChild = allChildren.map((c) => ({
      name: c.name ?? '',
      count: weekLessons.filter((l) => l.child_id === c.id).length,
    }))
    const knownChildIds = new Set(allChildren.map((c) => c.id))
    // A lesson whose child row is gone altogether still happened.
    const unassigned = weekLessons.filter((l) => !l.child_id || !knownChildIds.has(l.child_id)).length
    const byType: Record<string, number> = {}
    for (const m of weekMemories) {
      const type = m.type ?? 'memory'
      byType[type] = (byType[type] ?? 0) + 1
    }

    // The garden, per child, for the family's current school year: the same
    // countLeaves every other surface reads, so the email cannot disagree with
    // the Garden page.
    let leavesByChild: Record<string, number> = {}
    try {
      const year = await getCurrentSchoolYear(supabase, userId)
      leavesByChild = await loadLeafCounts(supabase, userId, year)
    } catch (err) {
      console.warn(`[cron/weekly-summary] garden read failed for user ${userId}`, err)
    }
    const garden = gardenLine(children.map((c) => ({ name: c.name ?? '', leaves: leavesByChild[c.id] ?? 0 })))

    const firstName = resolveFirstName(profile.first_name, null)
    const unsubscribeUrl = `https://www.rootedhomeschoolapp.com/unsubscribe?email=${encodeURIComponent(email)}`
    // The audience and the two versions are one rule, in lib/weekly-summary.ts.
    const verdict = classifyWeeklyRecipient({
      lastActiveDate: lastActive.get(userId) ?? null,
      now,
      timeZone: zone,
      weekLessons: weekLessons.length,
      weekMemories: weekMemories.length,
      recentWinback: false,
      sentThisWeek: false,
    })
    if (verdict === "too_stale") { skipped++; return }
    const isQuiet = verdict === "quiet"

    const lessons_sentence = lessonsLine(perChild, unassigned)

    if (full + quiet >= MAX_WEEKLY_SENDS_PER_RUN) { deferred++; return }
    if (dry) {
      if (isQuiet) quiet++
      else full++
      console.log(`[cron/weekly-summary] DRY ${isQuiet ? 'quiet' : 'full'} for user ${userId}`)
      return
    }

    const headers = buildUserListUnsubscribeHeaders(await ensureUnsubscribeToken(userId, supabase))
    const result = isQuiet
      ? await sendResendTemplate(
          email,
          TEMPLATES.weeklySummaryQuiet,
          { firstName, gardenLine: garden, todayUrl: WEEKLY_TODAY_URL, unsubscribeUrl },
          FROM,
          WEEKLY_QUIET_SUBJECT,
          headers,
        )
      : await sendResendTemplate(
          email,
          TEMPLATES.weeklySummary,
          {
            firstName,
            lessonsLine: lessons_sentence,
            memoriesLine: memoriesVariable(memoriesLine(byType), lessons_sentence),
            gardenLine: garden,
            todayUrl: WEEKLY_TODAY_URL,
            unsubscribeUrl,
          },
          FROM,
          weeklySubject(weekLessons.length, weekMemories.length),
          headers,
        )

    if (!result.ok) {
      errors++
      failures.push({ userId, status: result.status, error: result.error })
      console.error(`[cron/weekly-summary] send failed for user ${userId}: ${result.status ?? 'n/a'}`)
      return
    }
    if (isQuiet) quiet++
    else full++
    const { error: logErr } = await supabase
      .from('email_log')
      .insert({ user_id: userId, email_type: WEEKLY_EMAIL_TYPE })
    if (logErr) {
      errors++
      logWriteFailures++
      failures.push({ userId, error: 'sent, but the email_log row did not save' })
      console.error(`[cron/weekly-summary] sent to user ${userId}, email_log write FAILED`)
      return
    }
    console.log(`[cron/weekly-summary] sent ${isQuiet ? 'quiet' : 'full'} to user ${userId}`)
  }

  // ── Failure alerting, same shape as the win-back cron. User ids only. ──────
  const has4xx = failures.some((f) => typeof f.status === 'number' && f.status >= 400 && f.status < 500)
  // A lost email_log row means a duplicate on any re-run, and a family left
  // behind by the budget never catches up: this send happens once a week.
  if (has4xx || logWriteFailures > 0 || deferred > 0 || errors > FAILURE_ALERT_THRESHOLD) {
    const text = [
      'The Rooted weekly-summary cron encountered send failures.',
      '',
      `Full: ${full}`,
      `Quiet: ${quiet}`,
      `Skipped: ${skipped}`,
      `Skipped for a recent win-back: ${skippedRecentWinback}`,
      `Errors: ${errors}`,
      deferred > 0
        ? `${deferred} family(ies) hit the per-run budget of ${MAX_WEEKLY_SENDS_PER_RUN} and got nothing this week. Raise it or run the cron again today.`
        : '',
      logWriteFailures > 0
        ? `${logWriteFailures} send(s) went out but their email_log row did not save. A re-run this week would send them again.`
        : '',
      has4xx ? 'A 4xx response was returned. Check the template variables and subject payload.' : '',
      '',
      `Failures (showing up to 50 of ${failures.length}):`,
      ...failures.slice(0, 50).map((f) => `- user ${f.userId}: ${f.status ?? 'n/a'} ${f.error ?? ''}`),
    ].filter(Boolean).join('\n')
    await alertBrittany('Weekly-summary cron failures', text)
  }

  return NextResponse.json({ full, quiet, skipped, skippedRecentWinback, deferred, errors, dry })
}
