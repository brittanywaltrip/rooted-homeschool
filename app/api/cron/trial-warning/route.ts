import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendResendTemplate, TEMPLATES } from "@/lib/resend-template";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[trial-warning] Trial system removed — cron disabled");
  return NextResponse.json({ message: "Trial system removed — cron disabled", sent: 0 });

  // Legacy code below — trial system removed April 2026
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
      const giftUrl = `https://www.rootedhomeschoolapp.com/family/${inv.token}`;
      const result = await sendResendTemplate(inv.email, TEMPLATES.trialWarning, {
        recipientName: inv.viewer_name ?? "Friend",
        familyName,
        expiryDate: trialEndDate,
        giftUrl,
        familyUrl: viewUrl,
        unsubscribeUrl: unsubUrl,
      }, "Rooted <hello@rootedhomeschoolapp.com>");

      if (result.ok) {
        await supabaseAdmin
          .from("family_invites")
          .update({ trial_warning_sent_at: now.toISOString() })
          .eq("id", inv.id);
        sent++;
      } else {
        console.error(`Trial warning email error for ${inv.email}:`, result.error);
      }
    } catch (err) {
      console.error(`Trial warning email error for ${inv.email}:`, err);
    }
  }

  return NextResponse.json({ sent });
}

