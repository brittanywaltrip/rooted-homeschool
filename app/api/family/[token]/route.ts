import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Look up invite
  const { data: invite } = await supabaseAdmin
    .from("family_invites")
    .select("user_id, label")
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  const userId = invite.user_id;

  // Fetch family data in parallel
  const [
    { data: profile },
    { data: memories },
    { data: children },
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("display_name, first_name")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("memories")
      .select("id, type, title, caption, photo_url, date, child_id, include_in_book, created_at")
      .eq("user_id", userId)
      .order("date", { ascending: false }),
    supabaseAdmin
      .from("children")
      .select("id, name, color")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("sort_order"),
  ]);

  const memoryIds = (memories ?? []).map((m) => m.id);

  // Fetch reactions and comments for these memories
  let reactionsByMemory: Record<string, Record<string, number>> = {};
  let commentsByMemory: Record<string, { commenter_name: string; body: string; created_at: string }[]> = {};

  if (memoryIds.length > 0) {
    const [{ data: reactions }, { data: comments }] = await Promise.all([
      supabaseAdmin
        .from("memory_reactions")
        .select("memory_id, emoji")
        .in("memory_id", memoryIds),
      supabaseAdmin
        .from("memory_comments")
        .select("memory_id, commenter_name, body, created_at")
        .in("memory_id", memoryIds)
        .order("created_at", { ascending: true }),
    ]);

    // Group reactions: { memory_id: { emoji: count } }
    (reactions ?? []).forEach((r) => {
      if (!reactionsByMemory[r.memory_id]) reactionsByMemory[r.memory_id] = {};
      reactionsByMemory[r.memory_id][r.emoji] = (reactionsByMemory[r.memory_id][r.emoji] ?? 0) + 1;
    });

    // Group comments: { memory_id: [comments] }
    (comments ?? []).forEach((c) => {
      if (!commentsByMemory[c.memory_id]) commentsByMemory[c.memory_id] = [];
      commentsByMemory[c.memory_id].push({
        commenter_name: c.commenter_name,
        body: c.body,
        created_at: c.created_at,
      });
    });
  }

  return NextResponse.json({
    family_name: profile?.display_name ?? "Family",
    first_name: profile?.first_name ?? null,
    memories: memories ?? [],
    children: children ?? [],
    reactions_by_memory: reactionsByMemory,
    comments_by_memory: commentsByMemory,
  });
}
