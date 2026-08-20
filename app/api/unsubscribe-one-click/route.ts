import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resendSuppress } from "@/lib/email/resend-suppression";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe target, reached two ways:
 *   POST - RFC 8058, from Gmail/Apple Mail's inbox unsubscribe button
 *          (List-Unsubscribe / List-Unsubscribe-Post headers).
 *   GET  - a person clicking the Unsubscribe link in the email footer.
 * Token is the user's profiles.unsubscribe_token (UUID).
 */

/** Shared worker for both verbs. Token validation is unchanged. */
async function unsubscribeByToken(token: string): Promise<void> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  // Don't leak whether the token exists: both verbs answer 200 either way, so
  // the inbox button doesn't retry and a stale link doesn't confirm an address.
  if (!profile) return;

  const userId = (profile as { id: string }).id;

  await supabaseAdmin
    .from("profiles")
    .update({ email_unsubscribed: true })
    .eq("id", userId);

  const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = authData?.user?.email ?? null;

  if (email) {
    await supabaseAdmin.from("email_suppressions").insert({
      email,
      reason: "user_unsubscribe",
      source: "list_unsubscribe_header",
    });
    await resendSuppress(email);
  }
}

/**
 * RFC 8058 one-click POST, sent by Gmail/Apple Mail's inbox button.
 */
export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  await unsubscribeByToken(token);
  return NextResponse.json({ ok: true });
}

/**
 * GET, for a human clicking the Unsubscribe link in the email footer.
 *
 * This route was POST-only, so the footer link added alongside this change
 * would have answered 405 to every click. Same token handling as POST; the
 * difference is the response, because a person is looking at it. No login and
 * no confirmation step: the link is the confirmation, which is the point of
 * a one-click unsubscribe.
 */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (token) await unsubscribeByToken(token);

  // Plain inline-styled HTML, no CSS variables (email-adjacent surface, and
  // this renders outside the app shell).
  const body = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsubscribed &middot; Rooted</title>
</head>
<body style="margin:0;background:#faf8f4;font-family:Georgia,serif;color:#2d2926;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:56px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fefcf9;border:1px solid #e8e2d9;border-radius:16px;padding:36px 30px;text-align:center;">
<tr><td>
<div style="font-size:32px;line-height:1;margin-bottom:14px;">&#127807;</div>
<h1 style="font-size:19px;margin:0 0 10px;color:#2d2926;">You're unsubscribed</h1>
<p style="font-size:14px;line-height:1.6;color:#7a6f65;margin:0 0 22px;">
You won't get any more emails like this one. Your account and everything in it are untouched.
</p>
<a href="https://www.rootedhomeschoolapp.com/dashboard/settings" style="display:inline-block;background:#2D5A3D;color:#ffffff;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:10px;">Manage email preferences</a>
<p style="font-size:12px;line-height:1.5;color:#9ca3af;margin:22px 0 0;">
Changed your mind? Turn emails back on any time in settings.
</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
