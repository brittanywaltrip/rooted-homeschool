import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildFamilyFeed } from "@/lib/family-feed";

/**
 * Owner preview of the family feed. Resolves the logged-in user from their
 * session and returns the SAME feed every invited family member sees — signed
 * photo URLs, reactions, comments. Unlike the token route, it deliberately
 * does NOT update visit timestamps and does NOT insert any family
 * notification: previewing your own feed must not look like a family visit.
 */
export async function GET() {
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
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Mirror the real feed's trial state from the owner's own invites: trial is
  // "ended" only when every active invite's trial has lapsed (paid owners are
  // never gated — the builder ignores trialEnded when momPaid). This way the
  // owner previews the true current state their family sees.
  const { data: invites } = await supabaseAdmin
    .from("family_invites")
    .select("trial_ends_at")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const ends = (invites ?? [])
    .map((i: { trial_ends_at: string | null }) => i.trial_ends_at)
    .filter((e): e is string => Boolean(e));
  const now = new Date();
  const trialEnded = ends.length > 0 && ends.every((e) => new Date(e) < now);
  const trialEndsAt = ends.length > 0 ? ends.slice().sort().at(-1) ?? null : null;

  const data = await buildFamilyFeed(user.id, {
    trialEnded,
    trialEndsAt,
    viewerName: null,
  });

  return NextResponse.json(data);
}
