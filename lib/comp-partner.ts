import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'

// Every field the partner-comp flows own on the profiles row. Writing all
// eight in a single UPDATE prevents the "approve sets plan_type but leaves
// stale stripe_customer_id" bug (Grace) and the "comp_account writes an
// out-of-enum 'partner_comp' value" bug (Amanda Potts).
//
// A comped partner has Rooted+ founding-family access with NO Stripe
// subscription — they're not in Brittany's Stripe customer list, so every
// stripe_* / current_period_end / subscription_end_date field must be NULL.
export const COMPED_PARTNER_PROFILE = {
  plan_type: 'founding_family' as const,
  is_pro: true as const,
  subscription_status: 'active' as const,
  legacy_free: false as const,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  current_period_end: null,
  subscription_end_date: null,
}

export type CompedPartnerProfile = typeof COMPED_PARTNER_PROFILE

export interface CompPartnerProfileOpts {
  supabase?: SupabaseClient
}

function defaultSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Writes the full comped-partner profile shape in a single UPDATE. Use the
// service role client — this can only be called from admin-only code paths
// (handleApprove / handleCompAccount / handleCompleteSetup in the
// partner-action route).
export async function compPartnerProfile(
  userId: string,
  opts: CompPartnerProfileOpts = {},
): Promise<void> {
  if (!userId) throw new Error('compPartnerProfile: userId required')
  const supabase = opts.supabase ?? defaultSupabase()

  const { error } = await supabase
    .from('profiles')
    .update(COMPED_PARTNER_PROFILE)
    .eq('id', userId)

  if (error) {
    console.error('[comp-partner] update failed', { userId, message: error.message })
    throw new Error(`compPartnerProfile failed for ${userId}: ${error.message}`)
  }
  console.log('[comp-partner] comped', { userId })
}
