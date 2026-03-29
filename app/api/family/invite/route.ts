import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    // Authenticate from server-side session — never trust client-sent userId
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: { user } } = await supabaseAdmin.auth.getUser(authToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ownerUserId = user.id;

    const { email, viewerName, resend: isResend } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }
    if (!viewerName?.trim()) {
      return NextResponse.json({ error: "Viewer name is required" }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanName = viewerName.trim();

    // Check for existing invite for this owner + email
    const { data: existing } = await supabaseAdmin
      .from("family_invites")
      .select("id, token, is_active, viewer_name")
      .eq("user_id", ownerUserId)
      .eq("email", cleanEmail)
      .maybeSingle();

    let token: string;
    const now = new Date().toISOString();
    const trialEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    if (existing) {
      if (existing.is_active && !isResend) {
        return NextResponse.json(
          { error: "This person already has access. Use Resend below." },
          { status: 409 }
        );
      }

      // Reactivate or resend
      const updates: Record<string, unknown> = {
        is_active: true,
        viewer_name: cleanName,
      };

      // Reset trial on reactivation (not on simple resend)
      if (!existing.is_active) {
        updates.trial_started_at = now;
        updates.trial_ends_at = trialEnd;
        updates.trial_warning_sent_at = null;
      }

      await supabaseAdmin
        .from("family_invites")
        .update(updates)
        .eq("id", existing.id);

      token = existing.token;
    } else {
      // Create new invite
      const { data: newInvite, error: insertErr } = await supabaseAdmin
        .from("family_invites")
        .insert({
          user_id: ownerUserId,
          email: cleanEmail,
          viewer_name: cleanName,
          is_active: true,
          trial_started_at: now,
          trial_ends_at: trialEnd,
        })
        .select("token")
        .single();

      if (insertErr) {
        console.error("Insert error:", insertErr);
        return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
      }
      token = newInvite.token;
    }

    // Look up family name
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, first_name")
      .eq("id", ownerUserId)
      .maybeSingle();

    const familyName = profile?.display_name ?? profile?.first_name ?? "A Rooted family";
    const viewUrl = `https://www.rootedhomeschoolapp.com/family/${token}`;
    const unsubUrl = `https://www.rootedhomeschoolapp.com/family/${token}/unsubscribe`;

    // Send HTML invite email
    const resendClient = new Resend(process.env.RESEND_API_KEY);
    await resendClient.emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: cleanEmail,
      subject: `${familyName} is sharing their homeschool journey with you 🌿`,
      html: inviteEmailHtml(cleanName, familyName, viewUrl, unsubUrl),
      text: inviteEmailText(cleanName, familyName, viewUrl),
    });

    return NextResponse.json({ ok: true, token });
  } catch (err) {
    console.error("Family invite error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Also support updating an invite (edit viewer name/email)
export async function PATCH(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: { user } } = await supabaseAdmin.auth.getUser(authToken);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ownerUserId = user.id;

    const { inviteId, viewerName, email, trialEndsAt } = await req.json();
    if (!inviteId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (viewerName?.trim()) {
      updates.viewer_name = viewerName.trim();
    }
    if (trialEndsAt !== undefined) {
      updates.trial_ends_at = trialEndsAt;
    }

    const emailChanged = !!email?.trim();
    if (emailChanged) {
      updates.email = email.trim().toLowerCase();
    }

    await supabaseAdmin
      .from("family_invites")
      .update(updates)
      .eq("id", inviteId)
      .eq("user_id", ownerUserId);

    // If email changed, send invite to new address
    if (emailChanged) {
      const { data: invite } = await supabaseAdmin
        .from("family_invites")
        .select("token, viewer_name")
        .eq("id", inviteId)
        .single();

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("display_name, first_name")
        .eq("id", ownerUserId)
        .maybeSingle();

      if (invite) {
        const familyName = profile?.display_name ?? profile?.first_name ?? "A Rooted family";
        const viewUrl = `https://www.rootedhomeschoolapp.com/family/${invite.token}`;
        const unsubUrl = `https://www.rootedhomeschoolapp.com/family/${invite.token}/unsubscribe`;
        const resendClient = new Resend(process.env.RESEND_API_KEY);
        await resendClient.emails.send({
          from: "Rooted <hello@rootedhomeschoolapp.com>",
          to: email.trim().toLowerCase(),
          subject: `${familyName} is sharing their homeschool journey with you 🌿`,
          html: inviteEmailHtml(invite.viewer_name ?? "Friend", familyName, viewUrl, unsubUrl),
          text: inviteEmailText(invite.viewer_name ?? "Friend", familyName, viewUrl),
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Family invite patch error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Revoke or reactivate
export async function PUT(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: { user } } = await supabaseAdmin.auth.getUser(authToken);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ownerUserId = user.id;

    const { inviteId, action } = await req.json();
    if (!inviteId || !action) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (action === "revoke") {
      await supabaseAdmin
        .from("family_invites")
        .update({ is_active: false })
        .eq("id", inviteId)
        .eq("user_id", ownerUserId);
    } else if (action === "reactivate") {
      const now = new Date().toISOString();
      const trialEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from("family_invites")
        .update({
          is_active: true,
          trial_started_at: now,
          trial_ends_at: trialEnd,
          trial_warning_sent_at: null,
        })
        .eq("id", inviteId)
        .eq("user_id", ownerUserId);

      // Send fresh invite email
      const { data: invite } = await supabaseAdmin
        .from("family_invites")
        .select("token, email, viewer_name")
        .eq("id", inviteId)
        .single();

      if (invite?.email) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("display_name, first_name")
          .eq("id", ownerUserId)
          .maybeSingle();

        const familyName = profile?.display_name ?? profile?.first_name ?? "A Rooted family";
        const viewUrl = `https://www.rootedhomeschoolapp.com/family/${invite.token}`;
        const unsubUrl = `https://www.rootedhomeschoolapp.com/family/${invite.token}/unsubscribe`;
        const resendClient = new Resend(process.env.RESEND_API_KEY);
        await resendClient.emails.send({
          from: "Rooted <hello@rootedhomeschoolapp.com>",
          to: invite.email,
          subject: `${familyName} is sharing their homeschool journey with you 🌿`,
          html: inviteEmailHtml(invite.viewer_name ?? "Friend", familyName, viewUrl, unsubUrl),
          text: inviteEmailText(invite.viewer_name ?? "Friend", familyName, viewUrl),
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Family invite action error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// ─── Email templates ─────────────────────────────────────────────────────────

function inviteEmailHtml(viewerName: string, familyName: string, viewUrl: string, unsubUrl: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px;border:1px solid #ebe7e1;">
<tr><td>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">Hi ${viewerName}!</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">${familyName} wanted you to follow along with their homeschool journey. You'll see photos, the books the kids are reading, their wins, field trips, and the everyday moments that make up their year.</p>
<p style="font-size:15px;line-height:1.6;color:#2d2926;margin:0 0 14px;">It's free — no account needed. Just click below. 🌿</p>
<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#2d5a3d;border-radius:10px;padding:14px 32px;">
<a href="${viewUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">See their memories &rarr;</a>
</td></tr></table>
<p style="font-size:13px;line-height:1.5;color:#7a6f65;margin:0 0 4px;">You can leave reactions and comments to let them know you're cheering them on.</p>
<p style="font-size:14px;line-height:1.5;color:#2d2926;margin:24px 0 0;font-weight:600;">&mdash; Brittany</p>
<p style="font-size:12px;line-height:1.4;color:#b5aca4;margin:2px 0 0;">Founder, Rooted 🌿</p>
</td></tr></table>
<p style="font-size:11px;color:#b5aca4;margin-top:16px;text-align:center;">
<a href="${unsubUrl}" style="color:#b5aca4;text-decoration:underline;">Unsubscribe from weekly updates</a>
</p>
</td></tr></table>
</body></html>`;
}

function inviteEmailText(viewerName: string, familyName: string, viewUrl: string): string {
  return `Hi ${viewerName}!

${familyName} wanted you to follow along with their homeschool journey. You'll see photos, the books the kids are reading, their wins, field trips, and the everyday moments that make up their year.

It's free — no account needed. Just click below.

See their memories → ${viewUrl}

— Brittany / Founder, Rooted 🌿`;
}
