import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketingEmailType =
  | "weekly_summary"
  | "reengagement_1"
  | "reengagement_2"
  | "reengagement_3"
  | "onboarding_reminder"
  | "family_digest";

export type CanSendResult =
  | { allowed: true }
  | { allowed: false; reason: "unsubscribed" | "type_disabled" | "no_user" };

/**
 * Single source of truth for "may we send this user this kind of marketing
 * email?". Cron routes call this per recipient instead of inlining
 * `if (profile.email_unsubscribed) continue` so a future change to gating
 * (new flag, new audit step) lands in one place.
 *
 * Master gate: profiles.email_unsubscribed = true → blocks everything.
 * Type gates:
 *   - weekly_summary → blocked when profiles.email_weekly_summary = false
 *   - reengagement_*, onboarding_reminder, family_digest → blocked when
 *     profiles.email_marketing = false
 *
 * NULL flags are treated as opt-in (DB default for legacy rows).
 */
export async function canSendMarketingEmail(
  userId: string,
  type: MarketingEmailType,
  supabaseAdmin: SupabaseClient,
): Promise<CanSendResult> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email_unsubscribed, email_marketing, email_weekly_summary")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return { allowed: false, reason: "no_user" };

  const p = profile as {
    email_unsubscribed: boolean | null;
    email_marketing: boolean | null;
    email_weekly_summary: boolean | null;
  };

  if (p.email_unsubscribed === true) {
    return { allowed: false, reason: "unsubscribed" };
  }

  if (type === "weekly_summary") {
    if (p.email_weekly_summary === false) {
      return { allowed: false, reason: "type_disabled" };
    }
    return { allowed: true };
  }

  if (p.email_marketing === false) {
    return { allowed: false, reason: "type_disabled" };
  }
  return { allowed: true };
}
