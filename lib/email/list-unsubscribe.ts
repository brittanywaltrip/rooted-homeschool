import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE_URL = "https://www.rootedhomeschoolapp.com";

/**
 * Build the RFC 8058 one-click List-Unsubscribe header pair for a marketing
 * email targeted at a Rooted user. Returns an empty object if no token —
 * Gmail/Apple Mail just won't show the inbox unsubscribe button, but the
 * footer link still works.
 */
export function buildUserListUnsubscribeHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  const url = `${BASE_URL}/api/unsubscribe-one-click?token=${encodeURIComponent(token)}`;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Build the List-Unsubscribe header pair for the family-digest audience.
 * The recipient is a family invitee, not the Rooted user, so the unsubscribe
 * goes to the existing family-invite POST endpoint.
 */
export function buildFamilyListUnsubscribeHeaders(inviteToken: string): Record<string, string> {
  const url = `${BASE_URL}/api/family/${encodeURIComponent(inviteToken)}/unsubscribe`;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Read profiles.unsubscribe_token; if missing, generate a UUID, persist it,
 * and return it. Cron loops call this before sending so every marketing
 * message gets a usable List-Unsubscribe header even for legacy users whose
 * token was never backfilled. Returns null if the profile doesn't exist or
 * we can't persist a token.
 */
export async function ensureUnsubscribeToken(
  userId: string,
  supabaseAdmin: SupabaseClient,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("unsubscribe_token")
    .eq("id", userId)
    .maybeSingle();

  if (!data) return null;

  const existing = (data as { unsubscribe_token: string | null }).unsubscribe_token;
  if (existing) return existing;

  const token = crypto.randomUUID();
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ unsubscribe_token: token })
    .eq("id", userId);
  if (error) {
    console.error("[ensureUnsubscribeToken] persist failed:", error.message);
    return null;
  }
  return token;
}
