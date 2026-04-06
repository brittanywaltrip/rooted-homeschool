import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
  templateId: string,
  variables: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to,
      template_id: templateId,
      template_variables: variables,
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    return { ok: false, error: err.message ?? JSON.stringify(err) }
  }
  return { ok: true }
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let sent = 0
  let skipped = 0
  let errors = 0

  // ── Email 1: 20–28 hours after signup, no subjects ────────────────────────
  const e1WindowStart = new Date(now.getTime() - 28 * 60 * 60 * 1000)
  const e1WindowEnd   = new Date(now.getTime() - 20 * 60 * 60 * 1000)

  const { data: e1Users } = await supabase
    .from('profiles')
    .select('id, first_name, created_at, email_unsubscribed')
    .gte('created_at', e1WindowStart.toISOString())
    .lte('created_at', e1WindowEnd.toISOString())

  for (const user of e1Users ?? []) {
    if (user.email_unsubscribed) { skipped++; continue }
    const emailType = 'reengagement_1'
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasSubjects(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = resolveFirstName(user.first_name, authData.user)
    const result = await sendTemplate(email, TEMPLATE_IDS.reengagement_1, {
      firstName,
      dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
      email,
    })

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
    .select('id, first_name, created_at, email_unsubscribed')
    .gte('created_at', e2WindowStart.toISOString())
    .lte('created_at', e2WindowEnd.toISOString())

  for (const user of e2Users ?? []) {
    if (user.email_unsubscribed) { skipped++; continue }
    const emailType = 'reengagement_2'
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasLessons(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = resolveFirstName(user.first_name, authData.user)
    const result = await sendTemplate(email, TEMPLATE_IDS.reengagement_2, {
      firstName,
      planUrl: 'https://rootedhomeschoolapp.com/dashboard/plan',
      email,
    })

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
    .select('id, first_name, created_at, email_unsubscribed')
    .gte('created_at', e3WindowStart.toISOString())
    .lte('created_at', e3WindowEnd.toISOString())

  for (const user of e3Users ?? []) {
    if (user.email_unsubscribed) { skipped++; continue }
    const emailType = 'reengagement_3'
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasLessons(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = resolveFirstName(user.first_name, authData.user)
    const result = await sendTemplate(email, TEMPLATE_IDS.reengagement_3, {
      firstName,
      dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
      email,
    })

    if (!result.ok) {
      console.error(`reengagement_3 error for ${email}:`, result.error)
      errors++
    } else {
      await logEmail(user.id, emailType)
      sent++
    }
  }

  return NextResponse.json({ sent, skipped, errors })
}
