import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Was this auth user's account deleted at some point?
 *
 * WHY THIS EXISTS: account deletion wipes every public table but the
 * auth.users row can survive the wipe (see the vacation_blocks note in
 * app/api/account/delete/route.ts). When it does, the person can still
 * sign in with the password they've always used, and because they have
 * no profile row the app treats them as brand new: straight into
 * onboarding, fresh free tier, no explanation for where a year of
 * memories went. That happened to a paying family on August 12, 2026.
 *
 * deleted_accounts is the only durable record that the account existed
 * and was deliberately deleted, so it is what the sign-in paths check
 * before deciding "new user". Its rows are never removed.
 *
 * Service-role only. deleted_accounts is not readable by anon or
 * authenticated, so this must be called from a route handler, never
 * from the browser.
 */
export type DeletedAccountRecord = {
  deletedAt: string;
  planType: string | null;
  firstName: string | null;
  /** "self_serve" for a delete the family ran themselves. */
  source: string;
};

export async function findDeletedAccount(
  userId: string,
): Promise<DeletedAccountRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("deleted_accounts")
    .select("deleted_at, plan_type, first_name, source")
    .eq("user_id", userId)
    .order("deleted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // A lookup failure must never block a sign-in. Falling through to the
  // normal new-user path is the pre-existing behaviour, so the worst case
  // here is the bug we're fixing, not a locked-out family.
  if (error) {
    console.error("[deleted-account] lookup failed:", error);
    return null;
  }
  if (!data) return null;

  return {
    deletedAt: data.deleted_at as string,
    planType: (data.plan_type as string | null) ?? null,
    firstName: (data.first_name as string | null) ?? null,
    source: (data.source as string) ?? "self_serve",
  };
}

/**
 * True when this user should be sent to /welcome-back instead of being
 * treated as a new signup: their account was deleted AND they have no
 * profile row yet. Once they choose "start fresh" a profile exists and
 * this returns false, so the page can't trap them in a loop.
 */
export async function shouldShowWelcomeBack(userId: string): Promise<boolean> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (profile) return false;

  const deleted = await findDeletedAccount(userId);
  return deleted !== null;
}
