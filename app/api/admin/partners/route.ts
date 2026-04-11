import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch affiliates
  const { data: affRows } = await supabaseAdmin
    .from("affiliates")
    .select("*")
    .order("created_at", { ascending: true });

  // Fetch all profiles with referred_by set
  const { data: referredProfiles } = await supabaseAdmin
    .from("profiles")
    .select("id, referred_by, plan_type, first_name, last_name, display_name")
    .not("referred_by", "is", null);

  // Fetch referrals ledger
  const { data: refRows } = await supabaseAdmin
    .from("referrals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  // Fetch profiles for referral user_ids
  const refUserIds = (refRows ?? []).map((r) => r.user_id).filter(Boolean);
  let refUserProfiles: { id: string; first_name: string | null; last_name: string | null; display_name: string | null; plan_type: string | null }[] = [];
  if (refUserIds.length > 0) {
    const { data: rup } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, display_name, plan_type")
      .in("id", refUserIds);
    refUserProfiles = rup ?? [];
  }

  // Build affiliate stats
  const affiliates = (affRows ?? []).map((a) => {
    const referred = (referredProfiles ?? []).filter(
      (p) => p.referred_by?.toUpperCase() === a.code?.toUpperCase()
    );
    const paying = referred.filter((p) => p.plan_type !== "free");
    const rate = a.commission_rate ?? 20;
    const commissionOwed = paying.length * 39 * (rate / 100);

    return {
      ...a,
      signups_referred: referred.length,
      paying_customers: paying.length,
      commission_owed: commissionOwed,
    };
  });

  // Build referrals feed
  const allProfileMap = new Map(
    [...(referredProfiles ?? []), ...refUserProfiles].map((p) => [
      p.id,
      {
        name: p.first_name
          ? `${p.first_name} ${p.last_name ?? ""}`.trim()
          : p.display_name ?? "Unknown",
        plan: p.plan_type ?? "free",
      },
    ])
  );

  const referrals = (refRows ?? []).map((r) => {
    const prof = allProfileMap.get(r.user_id);
    return {
      id: r.id,
      affiliate_code: r.affiliate_code,
      stripe_session_id: r.stripe_session_id,
      converted: r.converted,
      created_at: r.created_at,
      user_name: prof?.name ?? "Unknown",
      user_plan: prof?.plan ?? "free",
    };
  });

  return NextResponse.json({ affiliates, referrals });
}
