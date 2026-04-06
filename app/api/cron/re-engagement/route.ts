import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ALTER TABLE profiles ADD COLUMN IF NOT EXISTS re_engagement_sent boolean DEFAULT false;

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM = 'Brittany from Rooted <hello@rootedhomeschoolapp.com>'
const TEMPLATE_ID = '5d26f9fd-92fb-47fd-af36-ad33d0632dda'

function resolveFirstName(
  profileName: string | null,
  displayName: string | null,
  authUser: { user_metadata?: Record<string, string> } | null | undefined,
): string {
  return profileName
    || displayName
    || authUser?.user_metadata?.first_name
    || authUser?.user_metadata?.full_name?.split(' ')[0]
    || authUser?.user_metadata?.name?.split(' ')[0]
    || 'there'
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let sent = 0
  let skipped = 0
  let errors = 0

  // Find users who: signed up 3+ days ago, onboarded, never re-engaged,
  // have 0 memories AND 0 lessons logged
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: users, error: queryError } = await supabase
    .from('profiles')
    .select('id, first_name, display_name, email_unsubscribed')
    .eq('onboarded', true)
    .or('re_engagement_sent.eq.false,re_engagement_sent.is.null')
    .lt('created_at', threeDaysAgo)

  if (queryError) {
    console.error('re-engagement query error:', queryError)
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  for (const user of users ?? []) {
    if (user.email_unsubscribed) { skipped++; continue }
    // Check 0 memories
    const { data: memoryData } = await supabase
      .from('memories')
      .select('id')
      .eq('user_id', user.id)

    if ((memoryData?.length ?? 0) > 0) { skipped++; continue }

    // Check 0 lessons via app_events
    const { data: lessonData } = await supabase
      .from('app_events')
      .select('id')
      .eq('user_id', user.id)
      .like('type', 'lesson%')

    if ((lessonData?.length ?? 0) > 0) { skipped++; continue }

    // Get email from auth
    const { data: authData } = await supabase.auth.admin.getUserById(user.id)
    const email = authData.user?.email
    if (!email) { skipped++; continue }

    const firstName = resolveFirstName(user.first_name, user.display_name, authData.user)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: email,
        template_id: TEMPLATE_ID,
        template_variables: {
          firstName,
          dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
          email,
        },
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      console.error(`re-engagement error for ${email}:`, err)
      errors++
    } else {
      await supabase
        .from('profiles')
        .update({ re_engagement_sent: true })
        .eq('id', user.id)
      sent++
    }
  }

  return NextResponse.json({ sent, skipped, errors })
}
