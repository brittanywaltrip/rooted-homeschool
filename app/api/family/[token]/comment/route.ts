import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { memory_id, commenter_name, commenter_key, body } = await req.json();

  if (!memory_id || !commenter_name || !commenter_key || !body?.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (body.length > 500) {
    return NextResponse.json({ error: "Comment too long (max 500 characters)" }, { status: 400 });
  }

  // Validate token
  const { data: invite } = await supabaseAdmin
    .from("family_invites")
    .select("user_id, is_active")
    .eq("token", token)
    .maybeSingle();

  if (!invite || !invite.is_active) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }

  // Insert comment
  const { data: comment, error: commentErr } = await supabaseAdmin
    .from("memory_comments")
    .insert({
      memory_id,
      invite_token: token,
      commenter_name,
      commenter_key,
      viewer_name: commenter_name,
      body: body.trim(),
    })
    .select("id, commenter_name, body, created_at")
    .single();

  if (commentErr) {
    console.error("Comment error:", commentErr);
    return NextResponse.json({ error: "Failed to save comment" }, { status: 500 });
  }

  // Create notification for mom
  await supabaseAdmin.from("family_notifications").insert({
    user_id: invite.user_id,
    memory_id,
    type: "comment",
    actor_name: commenter_name,
    message: `${commenter_name} left a comment on a memory`,
    preview: body.trim().slice(0, 100),
  });

  // Email notification to mom
  const { data: { user: momUser } } = await supabaseAdmin.auth.admin.getUserById(invite.user_id);

  if (momUser?.email) {
    const resendClient = new Resend(process.env.RESEND_API_KEY);
    await resendClient.emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: momUser.email,
      subject: `${commenter_name} left a comment on your memory 💬`,
      html: `<p><strong>${commenter_name}</strong> commented on one of your memories:<br/><em>"${body.trim().slice(0, 100)}"</em></p><p><a href="https://www.rootedhomeschoolapp.com/dashboard/memories">View your memories →</a></p>`,
      text: `${commenter_name} commented: "${body.trim().slice(0, 100)}" — View at https://www.rootedhomeschoolapp.com/dashboard/memories`,
    });
  }

  return NextResponse.json({ ok: true, comment });
}
