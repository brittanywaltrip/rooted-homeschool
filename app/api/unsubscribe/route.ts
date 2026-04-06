import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 })
    }

    const cleanEmail = email.trim().toLowerCase()

    // Find user by email
    const { data: listData } = await supabase.auth.admin.listUsers()
    const matchedUser = listData?.users?.find(
      (u) => u.email?.toLowerCase() === cleanEmail
    )

    if (matchedUser) {
      // Set email_unsubscribed flag on profile
      await supabase
        .from('profiles')
        .update({ email_unsubscribed: true })
        .eq('id', matchedUser.id)
    }

    // Always return success (don't reveal if email exists)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[unsubscribe] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
