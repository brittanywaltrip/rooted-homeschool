import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'

const SIG_TEXT = `— Brittany\nFounder, Rooted Homeschool App`

function emailHtml(bodyLines: string[], ctaLabel: string, ctaUrl: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px;border:1px solid #ebe7e1;">
<tr><td>
${bodyLines.map(l => `<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">${l}</p>`).join('\n')}
<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#5c7f63;border-radius:10px;padding:13px 28px;">
<a href="${ctaUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">${ctaLabel}</a>
</td></tr></table>
<p style="font-size:14px;line-height:1.5;color:#7a6f65;margin:0 0 4px;">If you have any questions at all, just hit reply &mdash; it comes straight to me.</p>
<p style="font-size:14px;line-height:1.5;color:#7a6f65;margin:24px 0 0;">Cheering you on,</p>
<p style="font-size:14px;line-height:1.5;color:#2d2926;margin:4px 0 0;font-weight:600;">Brittany</p>
<p style="font-size:12px;line-height:1.4;color:#b5aca4;margin:2px 0 0;">Founder, Rooted Homeschool App</p>
</td></tr></table>
</td></tr></table>
</body></html>`
}

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
    const ctaUrl = 'https://rootedhomeschoolapp.com/dashboard/plan'
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Hey ${firstName}, your Rooted plan is ready \uD83C\uDF31`,
      text: `Hey ${firstName},\n\nIt's Brittany from Rooted — I saw you signed up yesterday and just wanted to say welcome!\n\nThe one thing that makes everything click is setting up your plan. It takes about 5 minutes, and once it's done you'll have your weekly schedule, lesson tracking, and your family's learning garden all ready to go.\n\nSet up your plan here:\n${ctaUrl}\n\nIf anything feels confusing or you just want to say hi, reply to this email — it comes straight to me.\n\n${SIG_TEXT}`,
      html: emailHtml([
        `Hey ${firstName}! \uD83C\uDF31`,
        `It&rsquo;s Brittany from Rooted &mdash; I saw you signed up yesterday and just wanted to say welcome!`,
        `The one thing that makes everything click is <strong>setting up your plan</strong>. It takes about 5 minutes, and once it&rsquo;s done you&rsquo;ll have your weekly schedule, lesson tracking, and your family&rsquo;s learning garden all ready to go.`,
      ], 'Set Up My Plan \u2192', ctaUrl),
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
    const ctaUrl = 'https://rootedhomeschoolapp.com/dashboard/plan'
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `${firstName}, a quick tip that helps most families \uD83C\uDF3F`,
      text: `Hey ${firstName},\n\nIt's Brittany again — just a quick note because I've seen this a hundred times and I don't want you to get stuck where most families do.\n\nThe families who love Rooted all did the same thing first: they started with just one subject and one lesson. That's it. Once you log that first one, everything else starts to feel natural.\n\nHere's your plan — try adding one subject and checking it off today:\n${ctaUrl}\n\nYou've got this. I'm cheering for you.\n\n${SIG_TEXT}`,
      html: emailHtml([
        `Hey ${firstName}!`,
        `It&rsquo;s Brittany again &mdash; just a quick note because I&rsquo;ve seen this a hundred times and I don&rsquo;t want you to get stuck where most families do.`,
        `The families who love Rooted all did the same thing first: they started with <strong>just one subject and one lesson</strong>. That&rsquo;s it. Once you log that first one, everything else starts to feel natural.`,
        `Here&rsquo;s your plan &mdash; try adding one subject and checking it off today:`,
      ], 'Open My Plan \u2192', ctaUrl),
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
    const ctaUrl = 'https://rootedhomeschoolapp.com/dashboard'
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Still here for you, ${firstName} \uD83C\uDF31`,
      text: `Hey ${firstName},\n\nI know life gets busy — especially when you're homeschooling. No guilt here, I promise.\n\nI just wanted you to know that your Rooted account is all set up and waiting whenever the timing feels right. A lot of families come back after a few weeks and tell me they're so glad they did.\n\nIf something felt confusing or just wasn't clicking, I'd love to hear about it. Seriously — just reply and tell me. It helps me make Rooted better for everyone.\n\nYour dashboard is right here whenever you're ready:\n${ctaUrl}\n\nWishing your family a great week.\n\n${SIG_TEXT}`,
      html: emailHtml([
        `Hey ${firstName},`,
        `I know life gets busy &mdash; especially when you&rsquo;re homeschooling. No guilt here, I promise.`,
        `I just wanted you to know that your Rooted account is all set up and waiting whenever the timing feels right. A lot of families come back after a few weeks and tell me they&rsquo;re so glad they did.`,
        `If something felt confusing or just wasn&rsquo;t clicking, I&rsquo;d love to hear about it. Seriously &mdash; just reply and tell me. It helps me make Rooted better for everyone.`,
      ], 'Back to My Dashboard \u2192', ctaUrl),
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
