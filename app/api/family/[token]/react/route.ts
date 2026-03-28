import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── SQL to add reaction_type + reactor_key columns ─────────────────────────
//
// ALTER TABLE memory_reactions ADD COLUMN IF NOT EXISTS reaction_type text DEFAULT '❤️';
// ALTER TABLE memory_reactions ADD COLUMN IF NOT EXISTS reactor_key text;
//
// -- Drop old unique constraint and add new one with reaction_type
// ALTER TABLE memory_reactions DROP CONSTRAINT IF EXISTS memory_reactions_memory_id_reactor_email_key;
// CREATE UNIQUE INDEX IF NOT EXISTS memory_reactions_unique_v2
//   ON memory_reactions (memory_id, reactor_key, reaction_type);
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

  const { memory_id, reaction_type, reactor_key, reactor_name } =
    await req.json();

  if (!memory_id || !reaction_type || !reactor_key || !reactor_name) {
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

  // Check if reaction already exists — toggle off
  const { data: existing } = await supabase
    .from("memory_reactions")
    .select("id")
    .eq("memory_id", memory_id)
    .eq("reactor_key", reactor_key)
    .eq("reaction_type", reaction_type)
    .single();

  if (existing) {
    await supabase.from("memory_reactions").delete().eq("id", existing.id);
    return NextResponse.json({ action: "removed" });
  }

  // Insert reaction
  await supabase.from("memory_reactions").insert({
    memory_id,
    reaction_type,
    reactor_key,
    reactor_name,
    reactor_email: `guest_${reactor_key}`,
  });

  return NextResponse.json({ action: "added" });
}
