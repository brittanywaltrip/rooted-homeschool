import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { emailFooterHtml, emailFooterText } from "@/lib/email-footer";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const FOUNDING_MEMBERS: { name: string; email?: string }[] = [
  { name: "Amanda Deardorff" },
  { name: "Amber Hudson Slaughter", email: "amannda86@yahoo.com" },
  { name: "Donna Ward",             email: "dward67@yahoo.com" },
  { name: "Lacie Hawkins",          email: "lacey.medio@gmail.com" },
  { name: "Joselyn Minchey",        email: "jpirtlaw@gmail.com" },
];

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

  // Look up founding members by their known email addresses
  const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const allUsers = authList?.users ?? [];
  const emailToUser = new Map(allUsers.map((u) => [u.email?.toLowerCase(), u]));

  const matched: { id: string; name: string; email: string }[] = [];
  const notFound: string[] = [];

  for (const member of FOUNDING_MEMBERS) {
    if (member.email) {
      // Direct email lookup
      const authUser = emailToUser.get(member.email.toLowerCase());
      if (authUser?.email) {
        matched.push({ id: authUser.id, name: member.name, email: authUser.email });
      } else {
        notFound.push(`${member.name} (${member.email} not found in auth)`);
      }
    } else {
      // Fallback: name-based profile search (for Amanda Deardorff)
      const [firstName, ...rest] = member.name.split(" ");
      const lastName = rest.join(" ");
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("first_name", `%${firstName}%`)
        .ilike("last_name", `%${lastName}%`);
      const profile = profiles?.[0];
      if (profile) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.id);
        if (authUser?.user?.email) {
          matched.push({ id: profile.id, name: member.name, email: authUser.user.email });
        } else {
          notFound.push(`${member.name} (no email in auth)`);
        }
      } else {
        notFound.push(member.name);
      }
    }
  }

  if (matched.length === 0) {
    return NextResponse.json({ error: "No matching profiles found", notFound }, { status: 404 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0;
  const errors: string[] = [];

  for (const member of matched) {
    const firstName = member.name.split(" ")[0];

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#faf9f7;padding:32px 16px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ebe7e1;border-radius:16px;padding:36px 32px">
    <p style="color:#2d2926;font-size:15px;line-height:1.7;margin:0 0 16px">Hi ${firstName},</p>
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

    const text = `Hi ${firstName},

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
      errors.push(`${member.name}: ${result.error.message}`);
    } else {
      sent++;
    }
  }

  return NextResponse.json({ sent, total: matched.length, notFound, errors });
}
