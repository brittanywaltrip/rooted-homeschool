import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // All users who signed up more than 24 hours ago
  const { data: allUsers } = await supabase
    .from('profiles')
    .select('id, first_name, created_at, email_unsubscribed')
    .lt('created_at', cutoff.toISOString())

  let sent = 0
  let skipped = 0
  const errorList: string[] = []

  for (const user of allUsers ?? []) {
    if (user.email_unsubscribed) { skipped++; continue }
    // Skip if already received any reengagement email
    const { data: anyEmailData } = await supabase
      .from('email_log')
      .select('id')
      .eq('user_id', user.id)
      .like('email_type', 'reengagement%')
    if ((anyEmailData?.length ?? 0) > 0) { skipped++; continue }

    // Skip if they already have subjects set up
    const { data: subjectData } = await supabase
      .from('subjects')
      .select('id')
      .eq('user_id', user.id)
    if ((subjectData?.length ?? 0) > 0) { skipped++; continue }

    // Get email from auth
    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = user.first_name
      || authData.user?.user_metadata?.first_name
      || authData.user?.user_metadata?.full_name?.split(' ')[0]
      || 'there'
    const result = await sendResendTemplate(email, TEMPLATES.winback, {
      firstName,
      dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
      email,
    })

    if (!result.ok) {
      console.error(`backfill error for ${email}:`, result.error)
      errorList.push(email)
    } else {
      await supabase.from('email_log').insert({ user_id: user.id, email_type: 'reengagement_backfill' })
      sent++
    }
  }

  return NextResponse.json({ sent, skipped, errors: errorList })
}
