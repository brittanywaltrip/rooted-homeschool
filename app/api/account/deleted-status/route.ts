import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { findDeletedAccount } from "@/lib/deleted-account";

/**
 * Backs /welcome-back, the page a family lands on when they sign in to an
 * account that was previously deleted but whose auth.users row survived.
 *
 * GET returns what happened, and when.
 * POST is "start fresh": it creates the profile row so the normal
 * onboarding flow can take over.
 *
 * deleted_accounts is service-role only, so both halves run here rather
 * than in the page.
 */

async function requireUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  const deleted = await findDeletedAccount(user.id);

  return NextResponse.json({
    wasDeleted: deleted !== null,
    deletedAt: deleted?.deletedAt ?? null,
    firstName: deleted?.firstName ?? null,
    // A paid plan at deletion time is worth calling out: the subscription
    // was cancelled with the account, so a returning family needs to know
    // they aren't quietly still being charged.
    wasPaid: Boolean(deleted?.planType),
    hasProfile: Boolean(profile),
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Idempotent by design: ignoreDuplicates means a second "start fresh"
  // tap can't reset a profile the family has already begun filling in.
  const { error } = await supabaseAdmin
    .from("profiles")
    .upsert({ id: user.id, onboarded: false }, { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    console.error("[deleted-status] start-fresh profile create failed:", error);
    return NextResponse.json(
      { error: "Couldn't start your new account. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, redirectTo: "/onboarding" });
}
