import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Verify token
  const { data: invite } = await supabaseAdmin
    .from("family_invites")
    .select("id, user_id, is_active, viewer_name, trial_started_at, trial_ends_at, first_visited_at, email")
    .eq("token", token)
    .maybeSingle();

  if (!invite || !invite.is_active) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const userId = invite.user_id;
  const now = new Date().toISOString();

  // Update last_visited_at, set first_visited_at if null
  const visitUpdates: Record<string, unknown> = { last_visited_at: now };
  const isFirstVisit = !invite.first_visited_at;
  if (isFirstVisit) {
    visitUpdates.first_visited_at = now;
  }
  await supabaseAdmin
    .from("family_invites")
    .update(visitUpdates)
    .eq("id", invite.id);

  // Create first-visit notification for mom
  if (isFirstVisit) {
    await supabaseAdmin.from("family_notifications").insert({
      user_id: userId,
      type: "first_visit",
      actor_name: invite.viewer_name ?? "Someone",
      message: `${invite.viewer_name ?? "Someone"} opened your family portal for the first time 🥹`,
    });
  }

  // Check mom's subscription status for trial logic
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name, first_name, is_pro, subscription_status")
    .eq("id", userId)
    .maybeSingle();

  const momPaid = profile?.is_pro === true && profile?.subscription_status === "active";
  const trialEnded = invite.trial_ends_at && new Date(invite.trial_ends_at) < new Date();
  const trialActive = !trialEnded;

  // Fetch children
  const { data: children } = await supabaseAdmin
    .from("children")
    .select("id, name, color")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("sort_order");

  const childMap: Record<string, { name: string; color: string }> = {};
  (children ?? []).forEach((c: { id: string; name: string; color: string }) => {
    childMap[c.id] = { name: c.name, color: c.color };
  });

  // If trial ended and mom hasn't paid, return limited data
  if (trialEnded && !momPaid) {
    // Still fetch a few memories for the blurred preview
    const { data: mems } = await supabaseAdmin
      .from("memories")
      .select("id, type, title, caption, photo_url, date, child_id")
      .eq("user_id", userId)
      .eq("family_visible", true)
      .order("date", { ascending: false })
      .limit(3);

    const memories = (mems ?? []).map((m: { id: string; type: string; title: string | null; caption: string | null; photo_url: string | null; date: string; child_id: string | null }) => ({
      ...m,
      child_name: m.child_id ? childMap[m.child_id]?.name ?? null : null,
      child_color: m.child_id ? childMap[m.child_id]?.color ?? null : null,
    }));

    return NextResponse.json({
      familyName: profile?.display_name ?? profile?.first_name ?? "Your Family",
      children: children ?? [],
      memories,
      reactions: {},
      comments: {},
      trialEnded: true,
      momPaid: false,
      trialEndsAt: invite.trial_ends_at,
      viewerName: invite.viewer_name,
    });
  }

  // Fetch all family-visible memories
  const { data: mems } = await supabaseAdmin
    .from("memories")
    .select("id, type, title, caption, photo_url, date, child_id, created_at")
    .eq("user_id", userId)
    .eq("family_visible", true)
    .order("created_at", { ascending: false });

  const memories = (mems ?? []).map((m: { id: string; type: string; title: string | null; caption: string | null; photo_url: string | null; date: string; child_id: string | null; created_at: string }) => ({
    ...m,
    child_name: m.child_id ? childMap[m.child_id]?.name ?? null : null,
    child_color: m.child_id ? childMap[m.child_id]?.color ?? null : null,
  }));

  // Fetch reactions + comments
  const memIds = memories.map((m: { id: string }) => m.id);
  let reactions: Record<string, { emoji: string; count: number }[]> = {};
  let comments: Record<string, { id: string; name: string; text: string; created_at: string }[]> = {};

  if (memIds.length > 0) {
    const [{ data: rxns }, { data: cmts }] = await Promise.all([
      supabaseAdmin
        .from("memory_reactions")
        .select("memory_id, emoji, reactor_key")
        .in("memory_id", memIds),
      supabaseAdmin
        .from("memory_comments")
        .select("id, memory_id, commenter_name, body, created_at")
        .in("memory_id", memIds)
        .order("created_at", { ascending: true }),
    ]);

    // Group reactions by memory_id + emoji
    const grouped: Record<string, Record<string, number>> = {};
    (rxns ?? []).forEach((r: { memory_id: string; emoji: string }) => {
      if (!grouped[r.memory_id]) grouped[r.memory_id] = {};
      grouped[r.memory_id][r.emoji] = (grouped[r.memory_id][r.emoji] ?? 0) + 1;
    });
    for (const [memId, types] of Object.entries(grouped)) {
      reactions[memId] = Object.entries(types)
        .map(([emoji, count]) => ({ emoji, count }))
        .sort((a, b) => b.count - a.count);
    }

    // Group comments
    (cmts ?? []).forEach((c: { id: string; memory_id: string; commenter_name: string; body: string; created_at: string }) => {
      if (!comments[c.memory_id]) comments[c.memory_id] = [];
      comments[c.memory_id].push({
        id: c.id,
        name: c.commenter_name,
        text: c.body,
        created_at: c.created_at,
      });
    });
  }

  return NextResponse.json({
    familyName: profile?.display_name ?? profile?.first_name ?? "Your Family",
    children: children ?? [],
    memories,
    reactions,
    comments,
    trialEnded: false,
    momPaid,
    trialActive,
    trialEndsAt: invite.trial_ends_at,
    viewerName: invite.viewer_name,
  });
}
