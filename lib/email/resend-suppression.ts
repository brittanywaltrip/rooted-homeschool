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
