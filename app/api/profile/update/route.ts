import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { attributeReferral } from '@/lib/referrals'
import { sendResendTemplate, TEMPLATES } from '@/lib/resend-template'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Accept any subset of updatable profile fields
  const allowed = ['family_photo_url', 'state', 'country', 'onboarded', 'display_name', 'partner_email', 'family_name', 'avatar_url', 'first_name', 'last_name', 'referred_by', 'onboarded_at', 'school_days', 'school_start_time', 'homeschool_experience', 'primary_goal', 'school_year_start', 'school_year_end'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  // Partner attribution runs through the atomic RPC so the referrals ledger
  // and profiles.referred_by never drift apart. Strip the field from the
  // generic patch — the RPC will set it.
  const requestedReferralCode =
    typeof patch.referred_by === 'string' && patch.referred_by.trim()
      ? (patch.referred_by as string).trim().toUpperCase()
      : null
  delete patch.referred_by

  if (Object.keys(patch).length === 0 && !requestedReferralCode) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  // Detect the onboarding transition (false → true) BEFORE the write, so we can
  // fire the free welcome email exactly once when a family finishes onboarding.
  // The onboarding page completes by POSTing { onboarded: true, onboarded_at }
  // here, so this is the real completion signal (see /api/onboarding/complete,
  // which is now retired and unused).
  let wasOnboarded = true
  if (patch.onboarded === true) {
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('onboarded')
      .eq('id', user.id)
      .maybeSingle()
    wasOnboarded = (existingProfile as { onboarded?: boolean | null } | null)?.onboarded === true
  }

  // Ensure the profile row exists before the RPC runs — the RPC assumes it
  // can UPDATE profiles by id, and new accounts may not have a row yet.
  const { error } = Object.keys(patch).length > 0
    ? await supabase.from('profiles').upsert({ id: user.id, ...patch }, { onConflict: 'id' })
    : await supabase.from('profiles').upsert({ id: user.id }, { onConflict: 'id', ignoreDuplicates: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (requestedReferralCode) {
    const result = await attributeReferral({
      supabase,
      userId: user.id,
      affiliateCode: requestedReferralCode,
      converted: false,
    })
    if (result.error && result.error !== 'missing_code') {
      // Unknown code or RPC failure — log but don't fail the whole request
      // since the rest of the profile update already succeeded.
      console.warn('[profile/update] referral attribution skipped', {
        userId: user.id,
        code: requestedReferralCode,
        error: result.error,
      })
    }
  }

  // Sync first_name / last_name to auth user_metadata so it's available everywhere
  if (patch.first_name !== undefined || patch.last_name !== undefined) {
    const metaUpdate: Record<string, unknown> = {}
    if (patch.first_name !== undefined) metaUpdate.first_name = patch.first_name
    if (patch.last_name !== undefined) metaUpdate.last_name = patch.last_name
    await supabase.auth.admin.updateUserById(user.id, { user_metadata: metaUpdate })
  }

  // Free welcome email — fire exactly once when a family finishes onboarding
  // (onboarded just flipped false → true). Transactional like the paid welcomes
  // in the Stripe webhook: sent without the marketing gate, but deduped via
  // email_log so it can never go out twice. Fire-and-forget so a slow or failing
  // email never blocks or breaks the onboarding write above.
  if (patch.onboarded === true && !wasOnboarded && user.email) {
    const recipient = user.email
    const firstName =
      user.user_metadata?.first_name
      || user.user_metadata?.full_name?.split(' ')[0]
      || 'there'
    void (async () => {
      try {
        // Dedup guard: skip if a free welcome was already logged for this user.
        const { data: alreadySent } = await supabase
          .from('email_log')
          .select('id')
          .eq('user_id', user.id)
          .eq('email_type', 'welcome_free')
          .maybeSingle()
        if (alreadySent) return

        const result = await sendResendTemplate(recipient, TEMPLATES.welcomeFree, {
          firstName,
          dashboardUrl: 'https://rootedhomeschoolapp.com/dashboard',
        })
        if (result.ok) {
          try { await supabase.from('email_log').insert({ user_id: user.id, email_type: 'welcome_free' }) } catch {}
        }
      } catch (err) {
        console.error('[profile/update] welcome_free email failed:', err)
      }
    })()
  }

  return NextResponse.json({ ok: true })
}
