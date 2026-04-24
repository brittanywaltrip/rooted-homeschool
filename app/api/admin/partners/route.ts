import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { displayCommission } from "@/lib/commission";

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

  // Fetch referrals ledger. commission_note added in 20260423200000,
  // commission_amount added in 20260423210000.
  const { data: refRows } = await supabaseAdmin
    .from("referrals")
    .select("id, affiliate_code, user_id, stripe_session_id, converted, commission_note, commission_amount, created_at")
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

  // Commission owed = sum of per-referral stored amounts (webhook writes the
  // actual post-coupon commission at conversion time), with pre-migration
  // rows falling back to the $6.63 legacy default via displayCommission.
  const affiliates = (affRows ?? []).map((a) => {
    const referred = (referredProfiles ?? []).filter(
      (p) => p.referred_by?.toUpperCase() === a.code?.toUpperCase()
    );
    const convertedReferrals = (refRows ?? []).filter(
      (r) => r.affiliate_code?.toUpperCase() === a.code?.toUpperCase() && r.converted === true
    );
    const commissionOwed =
      Math.round(
        convertedReferrals.reduce(
          (sum, r) => sum + displayCommission({
            converted: true,
            commission_amount: (r as { commission_amount?: number | string | null }).commission_amount ?? null,
          }),
          0,
        ) * 100,
      ) / 100;

    return {
      ...a,
      account_email: a.user_id ? accountEmailMap.get(a.user_id) ?? null : null,
      signups_referred: referred.length,
      paying_customers: convertedReferrals.length,
      commission_owed: commissionOwed,
    };
  });

  // Collect referred users' auth emails in one paginated sweep so each referral
  // row can show first_name, last_name, and email for admin oversight.
  const referredUserIdSet = new Set<string>(refUserIds);
  const referredEmailMap = new Map<string, string>();
  if (referredUserIdSet.size > 0) {
    let page = 1;
    const perPage = 200;
    while (referredEmailMap.size < referredUserIdSet.size) {
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (listErr || !listData?.users || listData.users.length === 0) break;
      for (const u of listData.users) {
        if (referredUserIdSet.has(u.id) && u.email) referredEmailMap.set(u.id, u.email);
      }
      if (listData.users.length < perPage) break;
      page++;
    }
  }

  // Set of all user_ids that are themselves registered partners — used to flag
  // referrals where the referred user later joined the program.
  const partnerUserIds = new Set<string>(
    (affRows ?? []).map((a) => a.user_id).filter((id): id is string => Boolean(id)),
  );

  // Build referrals feed — includes admin-only fields (first_name, last_name,
  // email, is_also_partner) plus commission_note.
  const referrals = (refRows ?? []).map((r) => {
    const prof = profileMap.get(r.user_id);
    return {
      id: r.id,
      affiliate_code: r.affiliate_code,
      stripe_session_id: r.stripe_session_id,
      converted: r.converted,
      commission_note: (r as { commission_note?: string | null }).commission_note ?? null,
      commission_amount: displayCommission({
        converted: Boolean(r.converted),
        commission_amount: (r as { commission_amount?: number | string | null }).commission_amount ?? null,
      }),
      created_at: r.created_at,
      user_name: prof
        ? (prof.first_name ? `${prof.first_name} ${prof.last_name ?? ""}`.trim() : prof.display_name ?? "Unknown")
        : "Unknown",
      user_plan: prof?.plan_type ?? "free",
      first_name: prof?.first_name ?? null,
      last_name: prof?.last_name ?? null,
      user_email: r.user_id ? referredEmailMap.get(r.user_id) ?? null : null,
      is_also_partner: r.user_id ? partnerUserIds.has(r.user_id) : false,
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

  // Fetch pending partner applications
  const { data: applications } = await supabaseAdmin
    .from("partner_apps")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json({ affiliates, referrals, payments: payments ?? [], applications: applications ?? [] });
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
