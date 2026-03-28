import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { memory_id, reactor_name, reactor_key, emoji } = await req.json();

  if (!memory_id || !reactor_name || !reactor_key || !emoji) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const allowedEmoji = ["❤️", "😂", "😮", "🥹", "👏"];
  if (!allowedEmoji.includes(emoji)) {
    return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
  }

  // Validate token
  const { data: invite } = await supabaseAdmin
    .from("family_invites")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }

  // Upsert reaction (ignore conflict = already reacted)
  const { error: reactErr } = await supabaseAdmin
    .from("memory_reactions")
    .upsert(
      { memory_id, family_token: token, reactor_name, reactor_key, emoji },
      { onConflict: "memory_id,reactor_key,emoji" }
    );

  if (reactErr) {
    console.error("React error:", reactErr);
    return NextResponse.json({ error: "Failed to save reaction" }, { status: 500 });
  }

  // Create notification for the memory owner
  await supabaseAdmin.from("family_notifications").insert({
    user_id: invite.user_id,
    memory_id,
    type: "reaction",
    actor_name: reactor_name,
    emoji,
  });

  // Return updated reaction counts for this memory
  const { data: reactions } = await supabaseAdmin
    .from("memory_reactions")
    .select("emoji")
    .eq("memory_id", memory_id);

  const counts: Record<string, number> = {};
  (reactions ?? []).forEach((r) => {
    counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
  });

  return NextResponse.json({ success: true, reactions: counts });
}
