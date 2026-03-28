import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Verify token
  const { data: invite } = await supabase
    .from("family_invites")
    .select("owner_user_id, accepted")
    .eq("token", token)
    .single();

  if (!invite) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Mark accepted on first view
  if (!invite.accepted) {
    await supabase
      .from("family_invites")
      .update({ accepted: true })
      .eq("token", token);
  }

  // Fetch family name
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, first_name")
    .eq("id", invite.owner_user_id)
    .single();

  const rawName =
    profile?.display_name || profile?.first_name || "This family";
  const familyName = rawName.toLowerCase().endsWith("family")
    ? rawName
    : `${rawName}`;

  // Fetch children for child names
  const { data: children } = await supabase
    .from("children")
    .select("id, name, color")
    .eq("user_id", invite.owner_user_id)
    .eq("archived", false)
    .order("sort_order");

  const childMap: Record<string, { name: string; color: string }> = {};
  (children ?? []).forEach((c: { id: string; name: string; color: string }) => {
    childMap[c.id] = { name: c.name, color: c.color };
  });

  // Fetch shareable memories
  const { data: mems } = await supabase
    .from("memories")
    .select("id, type, title, caption, photo_url, date, child_id")
    .eq("user_id", invite.owner_user_id)
    .or("include_in_book.eq.true,type.eq.photo")
    .order("date", { ascending: false });

  const memories = (mems ?? []).map(
    (m: {
      id: string;
      type: string;
      title: string | null;
      caption: string | null;
      photo_url: string | null;
      date: string;
      child_id: string | null;
    }) => ({
      ...m,
      child_name: m.child_id ? childMap[m.child_id]?.name ?? null : null,
      child_color: m.child_id ? childMap[m.child_id]?.color ?? null : null,
    })
  );

  // Fetch reactions
  const memIds = memories.map((m: { id: string }) => m.id);
  let reactions: Record<
    string,
    { emoji: string; count: number }[]
  > = {};
  let userReactions: Record<string, string[]> = {};

  if (memIds.length > 0) {
    const { data: rxns } = await supabase
      .from("memory_reactions")
      .select("memory_id, reaction_type, reactor_key")
      .in("memory_id", memIds);

    // Group by memory_id and reaction_type
    const grouped: Record<string, Record<string, number>> = {};
    const userGrouped: Record<string, string[]> = {};

    (rxns ?? []).forEach(
      (r: {
        memory_id: string;
        reaction_type: string;
        reactor_key: string;
      }) => {
        if (!grouped[r.memory_id]) grouped[r.memory_id] = {};
        grouped[r.memory_id][r.reaction_type] =
          (grouped[r.memory_id][r.reaction_type] ?? 0) + 1;
      }
    );

    for (const [memId, types] of Object.entries(grouped)) {
      reactions[memId] = Object.entries(types)
        .map(([emoji, count]) => ({ emoji, count }))
        .sort((a, b) => b.count - a.count);
    }
  }

  // Fetch comments
  let comments: Record<
    string,
    { id: string; name: string; text: string; created_at: string }[]
  > = {};

  if (memIds.length > 0) {
    const { data: cmts } = await supabase
      .from("memory_comments")
      .select("id, memory_id, commenter_name, comment_text, created_at")
      .in("memory_id", memIds)
      .order("created_at", { ascending: true });

    (cmts ?? []).forEach(
      (c: {
        id: string;
        memory_id: string;
        commenter_name: string;
        comment_text: string;
        created_at: string;
      }) => {
        if (!comments[c.memory_id]) comments[c.memory_id] = [];
        comments[c.memory_id].push({
          id: c.id,
          name: c.commenter_name,
          text: c.comment_text,
          created_at: c.created_at,
        });
      }
    );
  }

  return NextResponse.json({
    familyName,
    memories,
    reactions,
    comments,
  });
}
