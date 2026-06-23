import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Load the set of suppressed email addresses (bounced / complained /
 * unsubscribed) so a bulk sender can honor the suppression list and never mail
 * a known-bad address. Addresses are lowercased for case-insensitive matching.
 *
 * Source of truth is the `email_suppressions` table, populated by the Resend
 * webhook (hard_bounce / spam_complaint) and the unsubscribe routes. The query
 * is intentionally defensive: if the table is missing or the read fails we log
 * and return an empty set rather than throwing, so a suppression-read problem
 * can never take down a cron mid-run. (Note: profiles.email_unsubscribed is the
 * other suppression signal and is enforced separately via canSendMarketingEmail.)
 */
export async function loadSuppressedEmails(
  supabaseAdmin: SupabaseClient,
): Promise<Set<string>> {
  try {
    const out = new Set<string>();
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabaseAdmin
        .from("email_suppressions")
        .select("email")
        .range(from, from + pageSize - 1);
      if (error) {
        console.warn("[loadSuppressedEmails] could not load suppression list:", error.message);
        return out;
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        const email = (row as { email: string | null }).email;
        if (email) out.add(email.toLowerCase());
      }
      if (data.length < pageSize) break;
    }
    return out;
  } catch (err) {
    console.warn("[loadSuppressedEmails] threw:", err);
    return new Set();
  }
}

/**
 * Defense-in-depth: when a user unsubscribes/bounces/complains, also tell
 * Resend so the address gets blocked at the edge even if our cron loop has a
 * bug and tries to send. This is intentionally a soft no-op when no audience
 * is configured — we'll wire the audience id from the Resend dashboard later.
 *
 * Set RESEND_AUDIENCE_ID in env to enable. Leaving it unset logs a warning
 * the first time and returns ok=true so callers don't fail their writes.
 */
export async function resendSuppress(email: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  if (!apiKey) {
    console.warn("[resendSuppress] RESEND_API_KEY not set; skipping");
    return { ok: true };
  }
  if (!audienceId) {
    console.warn(`[resendSuppress] RESEND_AUDIENCE_ID not set; ${email} suppressed in DB only`);
    return { ok: true };
  }

  try {
    const res = await fetch(
      `https://api.resend.com/audiences/${audienceId}/contacts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, unsubscribed: true }),
      },
    );
    if (!res.ok && res.status !== 409) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${txt}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
