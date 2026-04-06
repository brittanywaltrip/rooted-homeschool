import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendResendTemplate, TEMPLATES } from "@/lib/resend-template";

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
  });

  // Email notification to mom
  const { data: memory } = await supabaseAdmin
    .from("memories")
    .select("title, type")
    .eq("id", memory_id)
    .maybeSingle();
  const memoryLabel = memory?.title || "a memory";

  const { data: { user: momUser } } = await supabaseAdmin.auth.admin.getUserById(invite.user_id);

  if (momUser?.email) {
    const memoryUrl = `https://www.rootedhomeschoolapp.com/dashboard/memories?highlight=${memory_id}`;
    const momFirstName = momUser.user_metadata?.first_name || momUser.user_metadata?.full_name?.split(' ')[0] || 'there';
    await sendResendTemplate(momUser.email, TEMPLATES.commentNotification, {
      firstName: momFirstName,
      commenterName: commenter_name,
      memoryTitle: memoryLabel,
      commentText: body.trim().slice(0, 100),
      memoryUrl,
    }, "Rooted <hello@rootedhomeschoolapp.com>");
  }

  return NextResponse.json({ ok: true, comment });
}
