import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

async function verifyAdmin(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user || !ADMIN_EMAILS.includes(user.email ?? "")) return null;
  return user;
}

export async function GET(req: Request) {
  if (!await verifyAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch affiliates
  const { data: affRows } = await supabaseAdmin
    .from("affiliates")
    .select("*")
    .order("created_at", { ascending: true });

  // Look up Rooted account emails for affiliates with user_id
  const affiliateUserIds = (affRows ?? []).map((a) => a.user_id).filter(Boolean);
  const accountEmailMap = new Map<string, string>();
  for (const uid of affiliateUserIds) {
    const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (authUser?.email) accountEmailMap.set(uid, authUser.email);
  }

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
  const allUserIds = [...new Set([...refUserIds, ...(referredProfiles ?? []).map((p) => p.id)])];
  let allProfiles: { id: string; first_name: string | null; last_name: string | null; display_name: string | null; plan_type: string | null }[] = [];
  if (allUserIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, display_name, plan_type")
      .in("id", allUserIds);
    allProfiles = data ?? [];
  }

  // Merge referred profiles data (has referred_by) with full profile data
  const profileMap = new Map(
    allProfiles.map((p) => [p.id, p])
  );

  // Build affiliate stats
  const affiliates = (affRows ?? []).map((a) => {
    const referred = (referredProfiles ?? []).filter(
      (p) => p.referred_by?.toUpperCase() === a.code?.toUpperCase()
    );
    const paying = referred.filter((p) => {
      const fullProfile = profileMap.get(p.id);
      const planType = fullProfile?.plan_type ?? p.plan_type;
      return planType !== "free";
    });
    const rate = a.commission_rate ?? 20;
    const commissionOwed = paying.length * 39 * (rate / 100);

    return {
      ...a,
      account_email: a.user_id ? accountEmailMap.get(a.user_id) ?? null : null,
      signups_referred: referred.length,
      paying_customers: paying.length,
      commission_owed: commissionOwed,
    };
  });

  // Build referrals feed
  const referrals = (refRows ?? []).map((r) => {
    const prof = profileMap.get(r.user_id);
    return {
      id: r.id,
      affiliate_code: r.affiliate_code,
      stripe_session_id: r.stripe_session_id,
      converted: r.converted,
      created_at: r.created_at,
      user_name: prof
        ? (prof.first_name ? `${prof.first_name} ${prof.last_name ?? ""}`.trim() : prof.display_name ?? "Unknown")
        : "Unknown",
      user_plan: prof?.plan_type ?? "free",
    };
  });

  // Fetch commission payments
  const { data: payments } = await supabaseAdmin
    .from("commission_payments")
    .select("*")
    .order("paid_at", { ascending: false });

  // Calculate total paid per affiliate
  const paidMap = new Map<string, number>();
  for (const p of payments ?? []) {
    paidMap.set(p.affiliate_code, (paidMap.get(p.affiliate_code) ?? 0) + Number(p.amount));
  }

  // Attach total_paid to each affiliate
  for (const a of affiliates) {
    (a as Record<string, unknown>).total_paid = paidMap.get(a.code) ?? 0;
  }

  return NextResponse.json({ affiliates, referrals, payments: payments ?? [] });
}

export async function PATCH(req: Request) {
  if (!await verifyAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { code, contact_email, paypal_email, commission_rate, notes } = body;

  if (!code) {
    return NextResponse.json({ error: "Missing affiliate code" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (contact_email !== undefined) patch.contact_email = contact_email;
  if (paypal_email !== undefined) patch.paypal_email = paypal_email;
  if (commission_rate !== undefined) patch.commission_rate = commission_rate;
  if (notes !== undefined) patch.notes = notes;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("affiliates")
    .update(patch)
    .eq("code", code)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, affiliate: data });
}
