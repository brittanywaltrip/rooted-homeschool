import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendResendTemplate, TEMPLATES } from "@/lib/resend-template";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let sent = 0;

  // Get all active, opted-in invites
  const { data: invites } = await supabaseAdmin
    .from("family_invites")
    .select("id, token, email, viewer_name, user_id, trial_ends_at, email_opt_out")
    .eq("is_active", true)
    .eq("email_opt_out", false);

  if (!invites || invites.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  // Group invites by user_id to batch memory queries
  const byOwner = new Map<string, typeof invites>();
  for (const inv of invites) {
    if (!byOwner.has(inv.user_id)) byOwner.set(inv.user_id, []);
    byOwner.get(inv.user_id)!.push(inv);
  }

  for (const [userId, ownerInvites] of byOwner) {
    // Check if mom is paid
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, first_name, is_pro, subscription_status")
      .eq("id", userId)
      .maybeSingle();

    const momPaid = profile?.is_pro === true && profile?.subscription_status === "active";
    const familyName = profile?.display_name ?? profile?.first_name ?? "A Rooted family";

    // Fetch new memories from last 7 days
    const { data: newMems } = await supabaseAdmin
      .from("memories")
      .select("id, type, title, photo_url, child_id, date")
      .eq("user_id", userId)
      .eq("family_visible", true)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(8);

    if (!newMems || newMems.length === 0) continue;

    // Get children for win descriptions
    const { data: children } = await supabaseAdmin
      .from("children")
      .select("id, name")
      .eq("user_id", userId)
      .eq("archived", false);

    const childMap: Record<string, string> = {};
    (children ?? []).forEach((c: { id: string; name: string }) => {
      childMap[c.id] = c.name;
    });

    // Build win list
    const wins = newMems
      .filter((m: { type: string }) => m.type === "win" || m.type === "book")
      .slice(0, 4)
      .map((m: { type: string; title: string | null; child_id: string | null }) => {
        const childName = m.child_id ? childMap[m.child_id] : null;
        return childName ? `${childName} — ${m.title ?? m.type}` : (m.title ?? m.type);
      });

    // Get up to 4 photo thumbnails
    const photoMems = newMems
      .filter((m: { photo_url: string | null }) => m.photo_url)
      .slice(0, 4);

    for (const inv of ownerInvites) {
      // Check trial: must be active OR mom paid
      const trialEnded = inv.trial_ends_at && new Date(inv.trial_ends_at) < new Date();
      if (trialEnded && !momPaid) continue;
      if (!inv.email) continue;

      const viewUrl = `https://www.rootedhomeschoolapp.com/family/${inv.token}`;
      const unsubscribeUrl = `https://www.rootedhomeschoolapp.com/family/${inv.token}/unsubscribe`;

      // Build photo grid HTML for template variable
      const photoGridHtml = photoMems.length > 0
        ? photoMems.slice(0, 4).map((p: { photo_url: string | null }) =>
          `<img src="${p.photo_url}" alt="" style="width:48%;height:140px;object-fit:cover;border-radius:8px;display:inline-block;margin:2px;" />`
        ).join("")
        : "";

      const highlightsHtml = wins.length > 0
        ? `<p style="font-weight:600;margin:16px 0 8px;">Highlights:</p>` +
          wins.map((w: string) => `<p style="color:#7a6f65;margin:0 0 4px;">• ${w}</p>`).join("")
        : "";

      try {
        const result = await sendResendTemplate(inv.email, TEMPLATES.familyDigest, {
          recipientName: inv.viewer_name ?? "Friend",
          familyName,
          memoryCount: String(newMems.length),
          photoGrid: photoGridHtml,
          highlights: highlightsHtml,
          familyUrl: viewUrl,
          unsubscribeUrl,
        }, "Rooted <hello@rootedhomeschoolapp.com>");
        if (result.ok) sent++;
        else console.error(`Digest email error for ${inv.email}:`, result.error);
      } catch (err) {
        console.error(`Digest email error for ${inv.email}:`, err);
      }
    }
  }

  return NextResponse.json({ sent });
}

