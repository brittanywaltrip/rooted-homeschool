import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { emailFooterHtml, emailFooterText } from "@/lib/email-footer";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Query all founding family members from the database
  const { data: founders, error: queryErr } = await supabaseAdmin
    .from("profiles")
    .select("id, first_name, last_name, email_unsubscribed")
    .eq("plan_type", "founding_family");

  if (queryErr || !founders?.length) {
    return NextResponse.json({ error: "No founding family profiles found" }, { status: 404 });
  }

  // Resolve email from auth.users for each founder
  const matched: { id: string; firstName: string; email: string }[] = [];
  const skipped: string[] = [];

  for (const prof of founders) {
    if (prof.email_unsubscribed) {
      skipped.push(`${prof.first_name ?? "?"} ${prof.last_name ?? ""} (unsubscribed)`);
      continue;
    }

    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(prof.id);
    const email = authData?.user?.email;
    if (!email) {
      skipped.push(`${prof.first_name ?? "?"} ${prof.last_name ?? ""} (no email in auth)`);
      continue;
    }

    // Skip admin accounts
    if (ADMIN_EMAILS.includes(email.toLowerCase())) {
      skipped.push(`${email} (admin)`);
      continue;
    }

    const firstName = prof.first_name || authData.user?.user_metadata?.first_name || "there";
    matched.push({ id: prof.id, firstName, email });
  }

  if (matched.length === 0) {
    return NextResponse.json({ error: "No eligible founders found", skipped }, { status: 404 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0;
  const errors: string[] = [];

  for (const member of matched) {
    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#faf9f7;padding:32px 16px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ebe7e1;border-radius:16px;padding:36px 32px">
    <p style="color:#2d2926;font-size:15px;line-height:1.7;margin:0 0 16px">Hi ${member.firstName},</p>
    <p style="color:#2d2926;font-size:15px;line-height:1.7;margin:0 0 16px">
      I wanted to reach out personally because you were one of our very first Founding Families at Rooted,
      and that means the world to me.
    </p>
    <p style="color:#2d2926;font-size:15px;line-height:1.7;margin:0 0 16px">
      We're putting together our website and I'd love to feature words from the families who were here
      from the beginning. Would you be willing to share a short quote (just 1-2 sentences) about what
      Rooted means to your family or your homeschool journey?
    </p>
    <p style="color:#2d2926;font-size:15px;line-height:1.7;margin:0 0 16px">
      It doesn't have to be polished or fancy. Just honest words from your heart.
      You can simply reply to this email with your thoughts.
    </p>
    <p style="color:#2d2926;font-size:15px;line-height:1.7;margin:0 0 8px">
      Thank you for believing in Rooted early on. I'm so glad you're here.
    </p>
    <p style="color:#2d2926;font-size:15px;line-height:1.7;margin:24px 0 0">
      With love,<br/>
      <span style="color:#5c7f63;font-weight:500">Brittany</span><br/>
      <span style="color:#7a6f65;font-size:13px">Founder, Rooted</span>
    </p>
    ${emailFooterHtml()}
  </div>
</div>`;

    const text = `Hi ${member.firstName},

I wanted to reach out personally because you were one of our very first Founding Families at Rooted, and that means the world to me.

We're putting together our website and I'd love to feature words from the families who were here from the beginning. Would you be willing to share a short quote (just 1-2 sentences) about what Rooted means to your family or your homeschool journey?

It doesn't have to be polished or fancy. Just honest words from your heart. You can simply reply to this email with your thoughts.

Thank you for believing in Rooted early on. I'm so glad you're here.

With love,
Brittany
Founder, Rooted${emailFooterText()}`;

    const result = await resend.emails.send({
      from: "Brittany from Rooted <hello@rootedhomeschoolapp.com>",
      replyTo: "hello@rootedhomeschoolapp.com",
      to: member.email,
      subject: "Would you share your Rooted story? \u{1F33F}",
      text,
      html,
    });

    if (result.error) {
      errors.push(`${member.email}: ${result.error.message}`);
    } else {
      sent++;
    }
  }

  return NextResponse.json({ sent, total: matched.length, skipped, errors });
}
