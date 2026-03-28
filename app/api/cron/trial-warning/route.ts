import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  let sent = 0;

  // Find invites where trial ends within 3 days, warning not sent yet
  const { data: invites } = await supabaseAdmin
    .from("family_invites")
    .select("id, token, email, viewer_name, user_id, trial_ends_at")
    .eq("is_active", true)
    .eq("email_opt_out", false)
    .is("trial_warning_sent_at", null)
    .gte("trial_ends_at", now.toISOString())
    .lte("trial_ends_at", threeDaysFromNow);

  if (!invites || invites.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  for (const inv of invites) {
    if (!inv.email) continue;

    // Check if mom is paid — if paid, no warning needed
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, first_name, is_pro, subscription_status")
      .eq("id", inv.user_id)
      .maybeSingle();

    const momPaid = profile?.is_pro === true && profile?.subscription_status === "active";
    if (momPaid) continue;

    const familyName = profile?.display_name ?? profile?.first_name ?? "A Rooted family";

    // Get children for gift CTA
    const { data: children } = await supabaseAdmin
      .from("children")
      .select("name")
      .eq("user_id", inv.user_id)
      .eq("archived", false)
      .order("sort_order")
      .limit(3);

    const kidNames = (children ?? []).map((c: { name: string }) => c.name).join(" and ");
    const viewUrl = `https://www.rootedhomeschoolapp.com/family/${inv.token}`;
    const unsubUrl = `https://www.rootedhomeschoolapp.com/family/${inv.token}/unsubscribe`;

    const trialEndDate = inv.trial_ends_at
      ? new Date(inv.trial_ends_at).toLocaleDateString("en-US", { month: "long", day: "numeric" })
      : "soon";

    try {
      await resend.emails.send({
        from: "Rooted <hello@rootedhomeschoolapp.com>",
        to: inv.email,
        subject: `Your preview of ${familyName}'s journey ends in 3 days`,
        html: warningEmailHtml(inv.viewer_name ?? "Friend", familyName, kidNames, viewUrl, unsubUrl, trialEndDate),
      });

      await supabaseAdmin
        .from("family_invites")
        .update({ trial_warning_sent_at: now.toISOString() })
        .eq("id", inv.id);

      sent++;
    } catch (err) {
      console.error(`Trial warning email error for ${inv.email}:`, err);
    }
  }

  return NextResponse.json({ sent });
}

function warningEmailHtml(
  viewerName: string,
  familyName: string,
  kidNames: string,
  viewUrl: string,
  unsubUrl: string,
  trialEndDate: string,
): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px;border:1px solid #ebe7e1;">
<tr><td>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">Hi ${viewerName},</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">Your free preview of ${familyName}'s homeschool journey ends on ${trialEndDate}.</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">Want to keep following${kidNames ? ` ${kidNames}'s` : ""} story? You can gift them a full year of Rooted so they never stop capturing these moments — and you can keep following along.</p>
<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#2d5a3d;border-radius:10px;padding:14px 32px;">
<a href="${viewUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">Gift them a year &mdash; $59 &rarr;</a>
</td></tr></table>
<p style="font-size:13px;line-height:1.5;color:#7a6f65;margin:0;">Or visit their page one more time before your preview ends:</p>
<p style="font-size:13px;margin:4px 0 0;"><a href="${viewUrl}" style="color:#5c7f63;text-decoration:underline;">See their memories</a></p>
<p style="font-size:14px;line-height:1.5;color:#2d2926;margin:24px 0 0;font-weight:600;">&mdash; Brittany</p>
<p style="font-size:12px;line-height:1.4;color:#b5aca4;margin:2px 0 0;">Founder, Rooted 🌿</p>
</td></tr></table>
<p style="font-size:11px;color:#b5aca4;margin-top:16px;text-align:center;">
<a href="${unsubUrl}" style="color:#b5aca4;text-decoration:underline;">Unsubscribe</a>
</p>
</td></tr></table>
</body></html>`;
}
