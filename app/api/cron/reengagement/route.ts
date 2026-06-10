import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canSendMarketingEmail, type MarketingEmailType } from '@/lib/email/can-send'
import { buildUserListUnsubscribeHeaders, ensureUnsubscribeToken } from '@/lib/email/list-unsubscribe'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'

const TEMPLATE_IDS = {
  reengagement_1: '6bcd32eb-1b86-4a96-8457-384554013b3f',
  reengagement_2: 'c5f091f4-3381-47d1-b286-93349803f41b',
  reengagement_3: '3f2c5bb5-e7f9-4c07-bad3-25b59219dd26',
}

async function hasSubjects(userId: string): Promise<boolean> {
  const { data } = await supabase.from('subjects').select('id').eq('user_id', userId)
  return (data?.length ?? 0) > 0
}

async function hasLessons(userId: string): Promise<boolean> {
  const { data } = await supabase.from('lessons').select('id').eq('user_id', userId)
  return (data?.length ?? 0) > 0
}

async function hasCurriculum(userId: string): Promise<boolean> {
  const { data } = await supabase.from('curriculum_goals').select('id').eq('user_id', userId)
  return (data?.length ?? 0) > 0
}

async function hasMemories(userId: string): Promise<boolean> {
  const { data } = await supabase.from('memories').select('id').eq('user_id', userId)
  return (data?.length ?? 0) > 0
}

async function alreadySent(userId: string, emailType: string): Promise<boolean> {
  const { data } = await supabase.from('email_log').select('id').eq('user_id', userId).eq('email_type', emailType)
  return (data?.length ?? 0) > 0
}

async function logEmail(userId: string, emailType: string): Promise<void> {
  await supabase.from('email_log').insert({ user_id: userId, email_type: emailType })
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

async function sendTemplate(
  to: string,
  subject: string,
  templateId: string,
  variables: Record<string, string>,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    from: FROM,
    to,
    subject,
    template_id: templateId,
    template_variables: variables,
  }
  if (headers && Object.keys(headers).length > 0) payload.headers = headers
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json()
    return { ok: false, error: err.message ?? JSON.stringify(err) }
  }
  return { ok: true }
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

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let sent = 0
  let skipped = 0
  let errors = 0

  // ── Email 1: 2–3 days after signup, no curriculum or lessons ───────────────
  const e1WindowStart = new Date(now.getTime() - 72 * 60 * 60 * 1000)
  const e1WindowEnd   = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  const { data: e1Users } = await supabase
    .from('profiles')
    .select('id, first_name, created_at')
    .gte('created_at', e1WindowStart.toISOString())
    .lte('created_at', e1WindowEnd.toISOString())

  for (const user of e1Users ?? []) {
    const emailType = 'reengagement_1'
    const gate = await gateAndHeaders(user.id, emailType)
    if (!gate.allowed) {
      skipped++
      console.debug(`[reengagement_1] skipped ${user.id}: ${gate.reason}`)
      continue
    }
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasCurriculum(user.id) || await hasLessons(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = resolveFirstName(user.first_name, authData.user)
    const result = await sendTemplate(email, 'One memory is all it takes 🌿', TEMPLATE_IDS.reengagement_1, {
      firstName,
      dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
      email,
    }, gate.headers)

    if (!result.ok) {
      console.error(`reengagement_1 error for ${email}:`, result.error)
      errors++
    } else {
      await logEmail(user.id, emailType)
      sent++
    }
  }

  // ── Email 2: 92–100 hours (4 days) after signup, no lessons ──────────────
  const e2WindowStart = new Date(now.getTime() - 100 * 60 * 60 * 1000)
  const e2WindowEnd   = new Date(now.getTime() -  92 * 60 * 60 * 1000)

  const { data: e2Users } = await supabase
    .from('profiles')
    .select('id, first_name, created_at')
    .gte('created_at', e2WindowStart.toISOString())
    .lte('created_at', e2WindowEnd.toISOString())

  for (const user of e2Users ?? []) {
    const emailType = 'reengagement_2'
    const gate = await gateAndHeaders(user.id, emailType)
    if (!gate.allowed) {
      skipped++
      console.debug(`[reengagement_2] skipped ${user.id}: ${gate.reason}`)
      continue
    }
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasLessons(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = resolveFirstName(user.first_name, authData.user)
    const result = await sendTemplate(email, 'Your garden is still waiting 🌱', TEMPLATE_IDS.reengagement_2, {
      firstName,
      planUrl: 'https://rootedhomeschoolapp.com/dashboard/plan',
      email,
    }, gate.headers)

    if (!result.ok) {
      console.error(`reengagement_2 error for ${email}:`, result.error)
      errors++
    } else {
      await logEmail(user.id, emailType)
      sent++
    }
  }

  // ── Email 3: 238–246 hours (10 days) after signup, no lessons ────────────
  const e3WindowStart = new Date(now.getTime() - 246 * 60 * 60 * 1000)
  const e3WindowEnd   = new Date(now.getTime() - 238 * 60 * 60 * 1000)

  const { data: e3Users } = await supabase
    .from('profiles')
    .select('id, first_name, created_at')
    .gte('created_at', e3WindowStart.toISOString())
    .lte('created_at', e3WindowEnd.toISOString())

  for (const user of e3Users ?? []) {
    const emailType = 'reengagement_3'
    const gate = await gateAndHeaders(user.id, emailType)
    if (!gate.allowed) {
      skipped++
      console.debug(`[reengagement_3] skipped ${user.id}: ${gate.reason}`)
      continue
    }
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasLessons(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = resolveFirstName(user.first_name, authData.user)
    const result = await sendTemplate(email, 'We miss you at Rooted 🌿', TEMPLATE_IDS.reengagement_3, {
      firstName,
      dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
      email,
    }, gate.headers)

    if (!result.ok) {
      console.error(`reengagement_3 error for ${email}:`, result.error)
      errors++
    } else {
      await logEmail(user.id, emailType)
      sent++
    }
  }

  // ── Backfill: users who signed up after March 26 and are completely inactive
  const backfillCutoff = '2026-03-26T00:00:00.000Z'
  // Only backfill users who signed up more than 48 hours ago (would have been
  // eligible for email 1 but were missed due to the old narrow window)
  const backfillEnd = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  const { data: backfillUsers } = await supabase
    .from('profiles')
    .select('id, first_name, created_at')
    .gte('created_at', backfillCutoff)
    .lte('created_at', backfillEnd.toISOString())

  let backfilled = 0

  for (const user of backfillUsers ?? []) {
    const gate = await gateAndHeaders(user.id, 'reengagement_1')
    if (!gate.allowed) {
      skipped++
      console.debug(`[reengagement_1 backfill] skipped ${user.id}: ${gate.reason}`)
      continue
    }
    if (await alreadySent(user.id, 'reengagement_1')) { skipped++; continue }
    if (await hasLessons(user.id) || await hasMemories(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = resolveFirstName(user.first_name, authData.user)
    const result = await sendTemplate(email, 'One memory is all it takes 🌿', TEMPLATE_IDS.reengagement_1, {
      firstName,
      dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
      email,
    }, gate.headers)

    if (!result.ok) {
      console.error(`reengagement_1 backfill error for ${email}:`, result.error)
      errors++
    } else {
      await logEmail(user.id, 'reengagement_1')
      backfilled++
      sent++
    }
  }

  return NextResponse.json({ sent, skipped, errors, backfilled })
}
