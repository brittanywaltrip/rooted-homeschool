import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildFamilyFeed } from "@/lib/family-feed";

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

  // Trial gating is per-invite. Decide here, let the shared builder assemble
  // the rest (children, signed memories, reactions, comments).
  const trialEnded = invite.trial_ends_at
    ? new Date(invite.trial_ends_at) < new Date()
    : false;

  const data = await buildFamilyFeed(userId, {
    trialEnded,
    trialEndsAt: invite.trial_ends_at,
    viewerName: invite.viewer_name,
  });

  return NextResponse.json(data);
}
