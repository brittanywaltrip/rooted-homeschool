import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
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
      const unsubUrl = `https://www.rootedhomeschoolapp.com/family/${inv.token}/unsubscribe`;

      try {
        await resend.emails.send({
          from: "Rooted <hello@rootedhomeschoolapp.com>",
          to: inv.email,
          subject: `Here's what ${familyName} was up to this week 🌿`,
          html: digestEmailHtml(inv.viewer_name ?? "Friend", familyName, viewUrl, unsubUrl, photoMems, wins, newMems.length),
        });
        sent++;
      } catch (err) {
        console.error(`Digest email error for ${inv.email}:`, err);
      }
    }
  }

  return NextResponse.json({ sent });
}

function digestEmailHtml(
  viewerName: string,
  familyName: string,
  viewUrl: string,
  unsubUrl: string,
  photos: { id: string; photo_url: string | null }[],
  wins: string[],
  totalNew: number,
): string {
  // 2x2 photo grid
  const photoGrid = photos.length > 0
    ? `<table cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
        <tr>
          ${photos.slice(0, 2).map((p: { id: string; photo_url: string | null }) => `
            <td style="width:50%;padding:2px;">
              <a href="${viewUrl}">
                <img src="${p.photo_url}" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:8px;display:block;" />
              </a>
            </td>
          `).join("")}
        </tr>
        ${photos.length > 2 ? `<tr>
          ${photos.slice(2, 4).map((p: { id: string; photo_url: string | null }) => `
            <td style="width:50%;padding:2px;">
              <a href="${viewUrl}">
                <img src="${p.photo_url}" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:8px;display:block;" />
              </a>
            </td>
          `).join("")}
          ${photos.length === 3 ? '<td style="width:50%;padding:2px;"></td>' : ""}
        </tr>` : ""}
      </table>`
    : "";

  const winsList = wins.length > 0
    ? `<div style="margin:16px 0;">
        <p style="font-size:13px;font-weight:600;color:#2d2926;margin:0 0 8px;">Highlights:</p>
        ${wins.map((w: string) => `<p style="font-size:13px;color:#7a6f65;margin:0 0 4px;">• ${w}</p>`).join("")}
      </div>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px;border:1px solid #ebe7e1;">
<tr><td>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">Hi ${viewerName}!</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">${familyName} added ${totalNew} new ${totalNew === 1 ? "memory" : "memories"} this week. Here's a peek:</p>
${photoGrid}
${winsList}
<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#2d5a3d;border-radius:10px;padding:14px 32px;">
<a href="${viewUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">See all memories &rarr;</a>
</td></tr></table>
<p style="font-size:12px;line-height:1.4;color:#b5aca4;margin:2px 0 0;">🌿 Rooted</p>
</td></tr></table>
<p style="font-size:11px;color:#b5aca4;margin-top:16px;text-align:center;">
<a href="${unsubUrl}" style="color:#b5aca4;text-decoration:underline;">Unsubscribe</a>
</p>
</td></tr></table>
</body></html>`;
}
