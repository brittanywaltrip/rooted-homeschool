import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
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

  // Insert reaction
  await supabaseAdmin.from("memory_reactions").upsert(
    {
      memory_id,
      invite_token: token,
      reactor_name,
      reactor_key,
      emoji,
      viewer_name: reactor_name,
    },
    { onConflict: "memory_id,reactor_key,emoji" }
  );

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
    const resendClient = new Resend(process.env.RESEND_API_KEY);
    await resendClient.emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: momUser.email,
      subject: `${reactor_name} reacted ${emoji} to "${memoryLabel}"`,
      html: `<p>Hi! <strong>${reactor_name}</strong> reacted ${emoji} to <strong>"${memoryLabel}"</strong> in Rooted.</p><a href="${memoryUrl}" style="background:#4a7c59;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px;">See the memory →</a>`,
      text: `${reactor_name} reacted ${emoji} to "${memoryLabel}". View it at ${memoryUrl}`,
    });
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
