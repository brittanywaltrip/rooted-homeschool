import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { memory_id, commenter_name, commenter_key, body } = await req.json();

  if (!memory_id || !commenter_name || !commenter_key || !body) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (body.length > 500) {
    return NextResponse.json({ error: "Comment too long (max 500 characters)" }, { status: 400 });
  }

  // Validate token
  const { data: invite } = await supabaseAdmin
    .from("family_invites")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }

  // Insert comment
  const { data: comment, error: commentErr } = await supabaseAdmin
    .from("memory_comments")
    .insert({ memory_id, family_token: token, commenter_name, commenter_key, body })
    .select("id, commenter_name, body, created_at")
    .single();

  if (commentErr) {
    console.error("Comment error:", commentErr);
    return NextResponse.json({ error: "Failed to save comment" }, { status: 500 });
  }

  // Create notification for the memory owner
  await supabaseAdmin.from("family_notifications").insert({
    user_id: invite.user_id,
    memory_id,
    type: "comment",
    actor_name: commenter_name,
    preview: body.slice(0, 100),
  });

  // Send email notification to mom
  try {
    const [{ data: profile }, { data: memory }] = await Promise.all([
      supabaseAdmin.from("profiles").select("first_name").eq("id", invite.user_id).maybeSingle(),
      supabaseAdmin.from("memories").select("title").eq("id", memory_id).maybeSingle(),
    ]);

    const ownerEmail = (
      await supabaseAdmin.auth.admin.getUserById(invite.user_id)
    ).data.user?.email;

    if (ownerEmail) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const memoryTitle = memory?.title ?? "a memory";
      await resend.emails.send({
        from: "Rooted <hello@rootedhomeschoolapp.com>",
        to: ownerEmail,
        subject: `${commenter_name} commented on a memory 💬`,
        text: `Hey ${profile?.first_name ?? "there"}!

${commenter_name} commented on ${memoryTitle}:

"${body}"

Open Rooted to see the full conversation.

With love,
— Brittany / Founder, Rooted 🌿`,
      });
    }
  } catch (emailErr) {
    // Don't fail the request if email fails
    console.error("Email notification error:", emailErr);
  }

  return NextResponse.json({ success: true, comment });
}
