import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'

const ADMIN_EMAILS = ['garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com', 'hello@rootedhomeschoolapp.com']

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  // Auth check — admin only
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user || !ADMIN_EMAILS.includes(user.email ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email, name, code, stripe_coupon_id } = await req.json()
  if (!email || !name || !code || !stripe_coupon_id) {
    return NextResponse.json({ error: 'Missing required fields: email, name, code, stripe_coupon_id' }, { status: 400 })
  }

  // 1. Find user by email
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) return NextResponse.json({ error: 'Failed to list users' }, { status: 500 })

  const matchedUser = users?.find(u => u.email?.toLowerCase() === email.toLowerCase())
  if (!matchedUser) {
    return NextResponse.json({ error: `No user found with email: ${email}` }, { status: 404 })
  }

  // 2. Insert affiliate row
  const { error: insertError } = await supabase.from('affiliates').insert({
    user_id: matchedUser.id,
    name,
    code: code.toUpperCase(),
    stripe_coupon_id,
  })
  if (insertError) {
    return NextResponse.json({ error: `Failed to create affiliate: ${insertError.message}` }, { status: 500 })
  }

  // 3. Update profile to founding member
  await supabase.from('profiles').update({
    is_pro: true,
    subscription_status: 'founding',
    plan_type: 'founding_family',
  }).eq('id', matchedUser.id)

  // 4. Send welcome email
  try {
    await sendResendTemplate(email, TEMPLATES.affiliateWelcome, {
      firstName: name,
      affiliateCode: code.toUpperCase(),
      referralUrl: `https://rootedhomeschoolapp.com/?ref=${code.toUpperCase()}`,
    })
  } catch (emailErr) {
    console.error('[create-affiliate] Welcome email failed:', emailErr)
  }

  return NextResponse.json({
    success: true,
    userId: matchedUser.id,
    code: code.toUpperCase(),
  })
}
