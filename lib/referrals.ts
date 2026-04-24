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
  // Per-referral commission in dollars, computed by the webhook from the
  // actual Stripe charge (post-coupon). Written via a follow-up UPDATE
  // after the attribution RPC succeeds. Ignored when converted=false or
  // when the RPC skipped the write.
  commissionAmount?: number | null
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
  commissionAmount,
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

  // Stamp commission_amount on the row once attribution succeeded. Separate
  // UPDATE because the RPC was created before this column existed — keeps
  // the deployed function signature stable. Best-effort: a failure here
  // doesn't unwind the attribution (display falls back to $6.63).
  if (
    converted &&
    typeof commissionAmount === 'number' &&
    Number.isFinite(commissionAmount) &&
    commissionAmount >= 0
  ) {
    const rounded = Math.round(commissionAmount * 100) / 100
    const { error: commissionErr } = await supabase
      .from('referrals')
      .update({ commission_amount: rounded })
      .eq('user_id', userId)
      .ilike('affiliate_code', code)
    if (commissionErr) {
      console.error('[referrals] commission_amount update failed', {
        userId,
        code,
        commissionAmount: rounded,
        message: commissionErr.message,
      })
    } else {
      console.log('[referrals] commission_amount set', { userId, code, commissionAmount: rounded })
    }
  }

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
