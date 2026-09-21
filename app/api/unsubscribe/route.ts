import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { resendSuppress } from '@/lib/email/resend-suppression'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 })
    }

    const cleanEmail = email.trim().toLowerCase()

    const { data: listData } = await supabase.auth.admin.listUsers()
    const matchedUser = listData?.users?.find(
      (u) => u.email?.toLowerCase() === cleanEmail
    )

    if (matchedUser) {
      await supabase
        .from('profiles')
        .update({ email_unsubscribed: true })
        .eq('id', matchedUser.id)
    }

    // Audit trail row covers both matched and unmatched paths so we have a
    // record even if the email never had a profile.
    await supabase.from('email_suppressions').insert({
      email: cleanEmail,
      reason: 'user_unsubscribe',
      source: 'click_through_form',
    })
    await resendSuppress(cleanEmail)

    // Always return success (don't reveal if email exists)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[unsubscribe] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
