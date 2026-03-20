import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany at Rooted <hello@rootedhomeschoolapp.com>'

const SIGNATURE = `— Brittany Waltrip
Founder, Rooted Homeschool App
hello@rootedhomeschoolapp.com
rootedhomeschoolapp.com`

async function hasSubjects(userId: string): Promise<boolean> {
  const { count } = await supabase
    .from('subjects')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  return (count ?? 0) > 0
}

async function hasLessons(userId: string): Promise<boolean> {
  const { count } = await supabase
    .from('lessons')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  return (count ?? 0) > 0
}

async function alreadySent(userId: string, emailType: string): Promise<boolean> {
  const { count } = await supabase
    .from('email_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('email_type', emailType)
  return (count ?? 0) > 0
}

async function logEmail(userId: string, emailType: string): Promise<void> {
  await supabase.from('email_log').insert({ user_id: userId, email_type: emailType })
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const now = new Date()
  let sent = 0
  let skipped = 0
  let errors = 0

  // ── Email 1: 20–28 hours after signup, no subjects ────────────────────────
  const e1WindowStart = new Date(now.getTime() - 28 * 60 * 60 * 1000)
  const e1WindowEnd   = new Date(now.getTime() - 20 * 60 * 60 * 1000)

  const { data: e1Users } = await supabase
    .from('profiles')
    .select('id, first_name, created_at')
    .gte('created_at', e1WindowStart.toISOString())
    .lte('created_at', e1WindowEnd.toISOString())

  for (const user of e1Users ?? []) {
    const emailType = 'reengagement_1'
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasSubjects(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = user.first_name ?? 'there'
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Your Rooted account is ready \uD83C\uDF31',
      text: `Hi ${firstName},\n\nYou signed up for Rooted yesterday — welcome! \uD83C\uDF31\n\nThe next step is setting up your curriculum. It only takes about 5 minutes and unlocks everything: your weekly plan, lesson tracking, and your family's learning garden.\n\nSet up your curriculum here:\nhttps://rootedhomeschoolapp.com/dashboard/plan\n\nIf you run into anything or have questions, just reply to this email — I read every one.\n\n${SIGNATURE}`,
    })

    if (result.error) {
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
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasLessons(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = user.first_name ?? 'there'
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Your homeschool plan is waiting \uD83D\uDCDA',
      text: `Hi ${firstName},\n\nI noticed you haven't logged your first lesson in Rooted yet — no pressure at all, just wanted to check in!\n\nA lot of families tell me the first week feels overwhelming. Here's what I suggest: start small. Pick one subject, add it to your plan, and log just one lesson. That's it.\n\nOnce you do that, the whole rhythm of Rooted starts to click.\n\nJump back in here:\nhttps://rootedhomeschoolapp.com/dashboard\n\nI'm rooting for you. \uD83C\uDF31\n\n${SIGNATURE}`,
    })

    if (result.error) {
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
    if (await alreadySent(user.id, emailType)) { skipped++; continue }
    if (await hasLessons(user.id)) { skipped++; continue }

    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = user.first_name ?? 'there'
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Still here when you\'re ready \uD83C\uDF3F',
      text: `Hi ${firstName},\n\nI know homeschool life is full — things come up, schedules shift, and sometimes an app just doesn't get opened.\n\nRooted will be here whenever you're ready. Your account is all set up and waiting.\n\nIf there's anything that felt confusing or missing when you tried it, I'd genuinely love to hear from you. Just reply to this email.\n\nWhenever you're ready:\nhttps://rootedhomeschoolapp.com/dashboard\n\nWishing your family well. \uD83C\uDF31\n\n${SIGNATURE}`,
    })

    if (result.error) {
      console.error(`reengagement_3 error for ${email}:`, result.error)
      errors++
    } else {
      await logEmail(user.id, emailType)
      sent++
    }
  }

  return NextResponse.json({ sent, skipped, errors })
}
