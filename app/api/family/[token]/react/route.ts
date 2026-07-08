import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendResendTemplate, TEMPLATES } from "@/lib/resend-template";
import { REACTION_EMOJIS } from "@/lib/family-reactions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { memory_id, reactor_name, reactor_key, emoji } = await req.json();

  if (!memory_id || !reactor_name || !reactor_key || !emoji) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Allowlist comes from the one shared constant the viewer UI renders, so the
  // set of emojis shown can never drift from the set the API accepts.
  if (!REACTION_EMOJIS.includes(emoji)) {
    return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
  }

  // Validate token
  const { data: invite } = await supabaseAdmin
    .from("family_invites")
    .select("user_id, is_active, viewer_name")
    .eq("token", token)
    .maybeSingle();

  if (!invite || !invite.is_active) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }

  // Check if already reacted — toggle off
  const { data: existing } = await supabaseAdmin
    .from("memory_reactions")
    .select("id")
    .eq("memory_id", memory_id)
    .eq("reactor_key", reactor_key)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin.from("memory_reactions").delete().eq("id", existing.id);
    return NextResponse.json({ action: "removed" });
  }

  // Insert reaction. Bail loudly if it fails so we never notify or email mom
  // about a reaction that was not actually saved (the original silent bug).
  // family_token mirrors invite_token so the legacy NOT-dropped column and the
  // FK stay populated for any writer that still reads them.
  const { error: reactErr } = await supabaseAdmin.from("memory_reactions").upsert(
    {
      memory_id,
      invite_token: token,
      family_token: token,
      reactor_name,
      reactor_key,
      emoji,
      viewer_name: reactor_name,
    },
    { onConflict: "memory_id,reactor_key,emoji" }
  );

  if (reactErr) {
    console.error("[family/react] reaction upsert failed:", reactErr);
    return NextResponse.json({ error: "Failed to save reaction" }, { status: 500 });
  }

  // Create notification for mom
  await supabaseAdmin.from("family_notifications").insert({
    user_id: invite.user_id,
    memory_id,
    type: "reaction",
    actor_name: reactor_name,
    emoji,
  });

  // Email notification to mom
  const { data: memory } = await supabaseAdmin
    .from("memories")
    .select("title, type")
    .eq("id", memory_id)
    .maybeSingle();
  const memoryLabel = memory?.title || "a memory";

  const { data: { user: momUser } } = await supabaseAdmin.auth.admin.getUserById(invite.user_id);

  if (momUser?.email) {
    const memoryUrl = `https://www.rootedhomeschoolapp.com/dashboard/memories?highlight=${memory_id}`;
    const momFirstName = momUser.user_metadata?.first_name || momUser.user_metadata?.full_name?.split(' ')[0] || 'there';
    await sendResendTemplate(momUser.email, TEMPLATES.reactionNotification, {
      firstName: momFirstName,
      reactorName: reactor_name,
      reactionEmoji: emoji,
      memoryTitle: memoryLabel,
      memoryUrl,
    }, "Rooted <hello@rootedhomeschoolapp.com>");
  }

  // Return updated counts
  const { data: reactions } = await supabaseAdmin
    .from("memory_reactions")
    .select("emoji")
    .eq("memory_id", memory_id);

  const counts: Record<string, number> = {};
  (reactions ?? []).forEach((r: { emoji: string }) => {
    counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
  });

  return NextResponse.json({ action: "added", reactions: counts });
}
