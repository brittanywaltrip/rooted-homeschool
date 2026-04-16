import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendResendTemplate, TEMPLATES } from "@/lib/resend-template";
import { canShareFamily } from "@/lib/user-access";

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

    // Gate: check if user can share
    const { data: ownerProfile } = await supabaseAdmin
      .from("profiles")
      .select("is_pro, trial_started_at")
      .eq("id", ownerUserId)
      .maybeSingle();

    if (!canShareFamily({ is_pro: ownerProfile?.is_pro, trial_started_at: ownerProfile?.trial_started_at })) {
      return NextResponse.json({ error: "Family sharing requires Rooted+" }, { status: 403 });
    }

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

      // Clear any legacy trial data on reactivation
      if (!existing.is_active) {
        updates.trial_ends_at = null;
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
          trial_ends_at: null,
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

    // Send invite email via template
    await sendResendTemplate(cleanEmail, TEMPLATES.familyInvite, {
      recipientName: cleanName,
      familyName,
      familyUrl: viewUrl,
    }, "Rooted <hello@rootedhomeschoolapp.com>");

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
        await sendResendTemplate(email.trim().toLowerCase(), TEMPLATES.familyInvite, {
          recipientName: invite.viewer_name ?? "Friend",
          familyName,
          familyUrl: viewUrl,
        }, "Rooted <hello@rootedhomeschoolapp.com>");
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
      await supabaseAdmin
        .from("family_invites")
        .update({
          is_active: true,
          trial_started_at: now,
          trial_ends_at: null,
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
        await sendResendTemplate(invite.email, TEMPLATES.familyInvite, {
          recipientName: invite.viewer_name ?? "Friend",
          familyName,
          familyUrl: viewUrl,
        }, "Rooted <hello@rootedhomeschoolapp.com>");
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Family invite action error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

