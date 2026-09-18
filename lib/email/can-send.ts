import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketingEmailType =
  | "weekly_summary"
  | "reengagement_1"
  | "reengagement_2"
  | "reengagement_3"
  | "onboarding_reminder"
  | "family_digest"
  | "announcement"
  | "winback"
  | "trial_ending";

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
 *   - trial_ending → nothing but the master gate. It is an account notice, not
 *     marketing: her plan is about to change and what she can see in the app
 *     changes with it, so a family who turned off nurture emails still gets it.
 *   - reengagement_*, onboarding_reminder, family_digest, announcement, winback →
 *     blocked when profiles.email_marketing = false
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

  // An account notice. Only the master unsubscribe stops it.
  if (type === "trial_ending") return { allowed: true };

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

/**
 * Transactional account notices, which are NOT gated by any marketing flag.
 *
 * canSendMarketingEmail above blocks everything on profiles.email_unsubscribed,
 * including trial_ending, which its own comment calls an account notice. That
 * is correct for nurture email and must not change. A failed-payment notice is
 * a different class: the family is paying money, the charge did not go through,
 * and their access is about to end. Withholding that because they once turned
 * off nurture email would take away something they are paying for without
 * telling them.
 *
 * So payment-failure notices DO NOT call canSendMarketingEmail. The only thing
 * that stops them is a dead or hostile address, which is
 * transactionalSuppressionFor() in lib/email/resend-suppression.ts.
 *
 * This function exists to make that decision explicit and greppable rather than
 * an unexplained absence at the call site. It takes no flags on purpose: there
 * is no profile field that may suppress a billing notice.
 */
export type AccountNoticeType = "payment_failed" | "payment_failed_final";

export function accountNoticeIgnoresMarketingFlags(_type: AccountNoticeType): true {
  return true;
}
