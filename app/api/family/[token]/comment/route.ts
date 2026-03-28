import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── SQL to create memory_comments table ─────────────────────────────────────
//
// CREATE TABLE IF NOT EXISTS memory_comments (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   memory_id uuid REFERENCES memories(id) ON DELETE CASCADE,
//   commenter_key text NOT NULL,
//   commenter_name text NOT NULL,
//   comment_text text NOT NULL,
//   created_at timestamptz DEFAULT now()
// );
//
// ALTER TABLE memory_comments ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Anyone can insert comments" ON memory_comments FOR INSERT WITH CHECK (true);
// CREATE POLICY "Anyone can read comments" ON memory_comments FOR SELECT USING (true);
//
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Verify token
  const { data: invite } = await supabase
    .from("family_invites")
    .select("owner_user_id")
    .eq("token", token)
    .single();

  if (!invite) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { memory_id, commenter_key, commenter_name, comment_text } =
    await req.json();

  if (!memory_id || !commenter_key || !commenter_name || !comment_text?.trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Verify memory belongs to invite owner
  const { data: mem } = await supabase
    .from("memories")
    .select("id")
    .eq("id", memory_id)
    .eq("user_id", invite.owner_user_id)
    .single();

  if (!mem) {
    return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  }

  const { data: comment, error } = await supabase
    .from("memory_comments")
    .insert({
      memory_id,
      commenter_key,
      commenter_name,
      comment_text: comment_text.trim(),
    })
    .select("id, commenter_name, comment_text, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, comment });
}
