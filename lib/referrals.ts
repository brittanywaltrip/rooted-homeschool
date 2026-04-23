import type { SupabaseClient } from '@supabase/supabase-js'

export type AttributionAction =
  | 'inserted'
  | 'inserted_converted'
  | 'updated'
  | 'converted'
  | 'skipped'

export interface AttributeReferralArgs {
  supabase: SupabaseClient
  userId: string
  affiliateCode: string | null | undefined
  stripeSessionId?: string | null
  converted: boolean
}

export interface AttributionResult {
  action: AttributionAction
  affiliateCode?: string
  error?: string
}

// Single entry point for every partner-attribution write. Calls the atomic
// `record_referral_attribution` RPC so profiles.referred_by and the referrals
// ledger always move together inside one DB transaction.
export async function attributeReferral({
  supabase,
  userId,
  affiliateCode,
  stripeSessionId,
  converted,
}: AttributeReferralArgs): Promise<AttributionResult> {
  const code = (affiliateCode ?? '').trim().toUpperCase()
  if (!code) return { action: 'skipped', error: 'missing_code' }
  if (!userId) return { action: 'skipped', error: 'missing_user_id' }

  const { data, error } = await supabase.rpc('record_referral_attribution', {
    p_user_id: userId,
    p_affiliate_code: code,
    p_stripe_session_id: stripeSessionId ?? null,
    p_converted: converted,
  })

  if (error) {
    console.error('[referrals] attribution RPC failed', {
      userId,
      code,
      converted,
      stripeSessionId,
      message: error.message,
    })
    return { action: 'skipped', error: error.message }
  }

  const action =
    ((data as { action?: AttributionAction } | null)?.action as AttributionAction) ?? 'updated'
  console.log('[referrals] attribution', {
    userId,
    code,
    action,
    converted,
    stripeSessionId,
  })
  return { action, affiliateCode: code }
}

// Resolves a Stripe coupon id back to the affiliate code that owns it.
// Returns null when the coupon isn't attached to any active affiliate.
export async function affiliateCodeForStripeCoupon(
  supabase: SupabaseClient,
  stripeCouponId: string | null | undefined,
): Promise<string | null> {
  if (!stripeCouponId) return null
  const { data, error } = await supabase
    .from('affiliates')
    .select('code')
    .or(`stripe_coupon_id.eq.${stripeCouponId},stripe_api_id.eq.${stripeCouponId}`)
    .eq('is_active', true)
    .maybeSingle()
  if (error) {
    console.error('[referrals] affiliateCodeForStripeCoupon error', {
      stripeCouponId,
      message: error.message,
    })
    return null
  }
  return data?.code ? String(data.code).toUpperCase() : null
}
