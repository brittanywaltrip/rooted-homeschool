import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: invite } = await supabaseAdmin
    .from("family_invites")
    .select("id, user_id")
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await supabaseAdmin
    .from("family_invites")
    .update({ email_opt_out: true })
    .eq("id", invite.id);

  // Get family name for the confirmation message
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name, first_name")
    .eq("id", invite.user_id)
    .maybeSingle();

  const familyName = profile?.display_name ?? profile?.first_name ?? "this family";

  return NextResponse.json({ ok: true, familyName });
}
