import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

// ─── SQL to create tables (run in Supabase SQL editor) ───────────────────────
//
// CREATE TABLE IF NOT EXISTS family_invites (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   owner_user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
//   email text NOT NULL,
//   token text NOT NULL UNIQUE,
//   accepted boolean DEFAULT false,
//   created_at timestamptz DEFAULT now()
// );
//
// CREATE TABLE IF NOT EXISTS memory_reactions (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   memory_id uuid REFERENCES memories(id) ON DELETE CASCADE,
//   reactor_email text NOT NULL,
//   reactor_name text,
//   created_at timestamptz DEFAULT now(),
//   UNIQUE(memory_id, reactor_email)
// );
//
// ALTER TABLE memory_reactions ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Anyone with token can react" ON memory_reactions FOR INSERT WITH CHECK (true);
// CREATE POLICY "Owner can view reactions" ON memory_reactions FOR SELECT USING (true);
//
// ─────────────────────────────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 24; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

export async function POST(req: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { email, ownerUserId } = await req.json();

    if (!email || !ownerUserId) {
      return NextResponse.json({ error: "Missing email or ownerUserId" }, { status: 400 });
    }

    // Look up the owner's family name
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, first_name, last_name")
      .eq("id", ownerUserId)
      .single();

    const familyName = profile?.display_name
      || (profile?.first_name ? `${profile.first_name}${profile.last_name ? ` ${profile.last_name}` : ""}` : "")
      || "A Rooted family";

    const token = generateToken();

    // Insert invite
    const { error: insertErr } = await supabaseAdmin.from("family_invites").insert({
      owner_user_id: ownerUserId,
      email: email.toLowerCase().trim(),
      token,
    });

    if (insertErr) {
      // Duplicate email for same owner — find existing token
      if (insertErr.code === "23505") {
        return NextResponse.json({ error: "This person has already been invited." }, { status: 409 });
      }
      console.error("Insert error:", insertErr);
      return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
    }

    const viewUrl = `https://www.rootedhomeschoolapp.com/family/${token}`;

    await resend.emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: email.toLowerCase().trim(),
      subject: `You've been invited to view ${familyName}'s Rooted memories 🌿`,
      text: `Hey there!

${familyName} wants to share their homeschool memories with you.

Rooted is where families capture lessons, photos, books, field trips, and everyday moments — all in one beautiful place.

Tap below to see their story:
${viewUrl}

You can browse their memories and leave a heart on the ones you love.

With love,
— Brittany / Founder, Rooted 🌿`,
    });

    return NextResponse.json({ ok: true, token });
  } catch (err) {
    console.error("Family invite error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
