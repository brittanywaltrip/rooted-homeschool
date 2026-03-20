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

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // All users who signed up more than 24 hours ago
  const { data: allUsers } = await supabase
    .from('profiles')
    .select('id, first_name, created_at')
    .lt('created_at', cutoff.toISOString())

  let sent = 0
  let skipped = 0
  const errorList: string[] = []

  for (const user of allUsers ?? []) {
    // Skip if already received any reengagement email
    const { count: anyEmailCount } = await supabase
      .from('email_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .like('email_type', 'reengagement%')
    if ((anyEmailCount ?? 0) > 0) { skipped++; continue }

    // Skip if they already have subjects set up
    const { count: subjectCount } = await supabase
      .from('subjects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
    if ((subjectCount ?? 0) > 0) { skipped++; continue }

    // Get email from auth
    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = user.first_name ?? 'there'
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'We saved your spot at Rooted \uD83C\uDF31',
      text: `Hi ${firstName},\n\nYou created your Rooted account a little while back — life gets busy, totally understand!\n\nYour account is still all set up and ready whenever you are. Setting up your first subject only takes a few minutes and unlocks everything: your weekly plan, lesson tracking, and your family's learning garden.\n\nJump back in here:\nhttps://rootedhomeschoolapp.com/dashboard/plan\n\n${SIGNATURE}`,
    })

    if (result.error) {
      console.error(`backfill error for ${email}:`, result.error)
      errorList.push(email)
    } else {
      await supabase.from('email_log').insert({ user_id: user.id, email_type: 'reengagement_backfill' })
      sent++
    }
  }

  return NextResponse.json({ sent, skipped, errors: errorList })
}
