import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { removeFamilyComment, type RemovalClient } from "@/lib/family-comment-removal";

// DELETE a family viewer's comment from one of the signed-in parent's
// memories. The ownership rule is in lib/family-comment-removal.ts. This route
// only reads the session (no-op setAll), so per CLAUDE.md auth invariant 9 it
// does not need the middleware bypass.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Read-only route. Session refresh writes are not needed here.
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { status } = await removeFamilyComment(supabaseAdmin as unknown as RemovalClient, {
    userId: user.id,
    memoryId: id,
    commentId,
  });
  if (status === 200) return NextResponse.json({ ok: true });
  if (status === 404) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ error: "failed" }, { status: 500 });
}
