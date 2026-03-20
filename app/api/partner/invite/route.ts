import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const { email, familyName } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const displayName = familyName || "Your family";

    await resend.emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: email,
      subject: `${displayName} invited you to Rooted 🌱`,
      text: `Hey!

${displayName} has invited you to view their family's Rooted dashboard.

Rooted is a homeschool planning app — it tracks lessons, a family garden that grows with every lesson completed, memories, books, and more.

To get started, just sign up or log in with this email address at:
https://rootedhomeschoolapp.com

Once you're in, you'll see ${displayName}'s dashboard automatically.

— The Rooted Team 🌱`,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Fire-and-forget — caller doesn't block on this, so just log
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
