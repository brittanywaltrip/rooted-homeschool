import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { emailFooterText } from "@/lib/email-footer";

export async function POST(req: NextRequest) {
  try {
    const { email, ownerUserId, recipientName } = await req.json();

    if (!email || !ownerUserId) {
      return NextResponse.json({ error: "Missing email or ownerUserId" }, { status: 400 });
    }

    // Get or create the family invite token
    let { data: invite } = await supabaseAdmin
      .from("family_invites")
      .select("token")
      .eq("user_id", ownerUserId)
      .maybeSingle();

    if (!invite) {
      const { data: newInvite, error: insertErr } = await supabaseAdmin
        .from("family_invites")
        .insert({ user_id: ownerUserId, label: recipientName ?? null })
        .select("token")
        .single();

      if (insertErr) {
        console.error("Insert error:", insertErr);
        return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
      }
      invite = newInvite;
    }

    // Look up family name
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, first_name")
      .eq("id", ownerUserId)
      .maybeSingle();

    const familyName = profile?.display_name ?? "A Rooted family";
    const firstName = profile?.first_name ?? "Your family";
    const viewUrl = `https://www.rootedhomeschoolapp.com/family/${invite!.token}`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: email.toLowerCase().trim(),
      subject: `${familyName} is sharing their homeschool memories with you 🌿`,
      text: `${firstName} has invited you to see The ${familyName} Family's homeschool memories on Rooted.

Click below to see their photos, wins, books, field trips and more — and leave a reaction to let them know you're cheering them on.

See our memories → ${viewUrl}

— Brittany / Founder, Rooted 🌿${emailFooterText()}`,
    });

    return NextResponse.json({ ok: true, token: invite!.token });
  } catch (err) {
    console.error("Family invite error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
