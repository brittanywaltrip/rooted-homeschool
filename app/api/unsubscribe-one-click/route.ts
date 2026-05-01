import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resendSuppress } from "@/lib/email/resend-suppression";

export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click unsubscribe target. Wired into the List-Unsubscribe
 * header so Gmail/Apple Mail's inbox button works without a confirmation
 * page. Token is the user's profiles.unsubscribe_token (UUID).
 */
export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (!profile) {
    // Don't leak whether the token exists. Return 200 so the inbox button
    // doesn't keep retrying or surface an error to the user.
    return NextResponse.json({ ok: true });
  }

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

  return NextResponse.json({ ok: true });
}
