import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { displayCommission } from "@/lib/commission";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

// YYYY-MM key in UTC — matches to_char(created_at, 'YYYY-MM') closely enough
// for the monthly ledger, and is internally consistent for earned vs paid vs
// current-month comparisons (all derived the same way on the server).
function ymUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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

  // ALL converted referrals (lifetime, no 100-row cap) — the source of truth
  // for earned commission. refRows above is only the recent Referral Activity
  // feed; using it for earned totals would silently truncate past 100 rows.
  const { data: convertedRefRows } = await supabaseAdmin
    .from("referrals")
    .select("affiliate_code, commission_amount, created_at")
    .eq("converted", true);

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

  // Per-affiliate base fields. commission_owed / owed_now / total_earned /
  // monthly_ledger are computed below once payments + lifetime earnings are
  // aggregated (the old per-100-row 7.80-style math lived here and is gone).
  const affiliates = (affRows ?? []).map((a) => {
    const codeUpper = (a.code ?? "").toUpperCase();
    const referred = (referredProfiles ?? []).filter(
      (p) => p.referred_by?.toUpperCase() === codeUpper
    );
    const payingCount = (convertedRefRows ?? []).filter(
      (r) => (r.affiliate_code ?? "").toUpperCase() === codeUpper
    ).length;

    return {
      ...a,
      account_email: a.user_id ? accountEmailMap.get(a.user_id) ?? null : null,
      signups_referred: referred.length,
      paying_customers: payingCount,
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

  // Per-affiliate aggregates from commission_payments — source of truth for
  // "lifetime paid" and "last paid month". Keyed by UPPERCASE code so it lines
  // up with the earnings buckets below (affiliate codes are uppercase, but
  // referral rows can carry mixed case).
  const paidMap = new Map<string, number>();
  const lastPaidMonthMap = new Map<string, string>();
  for (const p of payments ?? []) {
    const code = (p.affiliate_code ?? "").toUpperCase();
    paidMap.set(code, (paidMap.get(code) ?? 0) + Number(p.amount));
    if (p.month) {
      const prev = lastPaidMonthMap.get(code);
      if (!prev || p.month > prev) lastPaidMonthMap.set(code, p.month);
    }
  }

  // Earned commission grouped by affiliate code → earning month
  // (to_char(created_at, 'YYYY-MM')). This bucket is the source of truth for
  // what each affiliate has earned, replacing the legacy "this cycle" model.
  const earnedByCodeMonth = new Map<string, Map<string, { earned: number; conversions: number }>>();
  for (const r of convertedRefRows ?? []) {
    const code = (r.affiliate_code ?? "").toUpperCase();
    if (!code || !r.created_at) continue;
    const m = ymUTC(new Date(r.created_at as string));
    const amt = displayCommission({
      converted: true,
      commission_amount: (r as { commission_amount?: number | string | null }).commission_amount ?? null,
    });
    let byMonth = earnedByCodeMonth.get(code);
    if (!byMonth) { byMonth = new Map(); earnedByCodeMonth.set(code, byMonth); }
    const agg = byMonth.get(m) ?? { earned: 0, conversions: 0 };
    agg.earned += amt;
    agg.conversions += 1;
    byMonth.set(m, agg);
  }

  // Payments grouped by affiliate code → COVERING month. Going forward,
  // commission_payments.month is the earning month being covered (paid_at is
  // when it was actually sent).
  const paidByCodeMonth = new Map<string, Map<string, { paid: number; paidAt: string | null }>>();
  for (const p of payments ?? []) {
    const code = (p.affiliate_code ?? "").toUpperCase();
    if (!code || !p.month) continue;
    let byMonth = paidByCodeMonth.get(code);
    if (!byMonth) { byMonth = new Map(); paidByCodeMonth.set(code, byMonth); }
    const cur = byMonth.get(p.month) ?? { paid: 0, paidAt: null };
    cur.paid += Number(p.amount);
    if (p.paid_at && (!cur.paidAt || p.paid_at > cur.paidAt)) cur.paidAt = p.paid_at;
    byMonth.set(p.month, cur);
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentYM = ymUTC(now);

  // Attach earned-vs-paid fields to each affiliate.
  for (const a of affiliates) {
    const codeUpper = (a.code ?? "").toUpperCase();
    const earnedMonths = earnedByCodeMonth.get(codeUpper) ?? new Map<string, { earned: number; conversions: number }>();
    const paidMonths = paidByCodeMonth.get(codeUpper) ?? new Map<string, { paid: number; paidAt: string | null }>();

    let totalEarned = 0;
    let completedEarned = 0; // earned in months strictly before the current one
    for (const [m, agg] of earnedMonths) {
      totalEarned += agg.earned;
      if (m < currentYM) completedEarned += agg.earned;
    }
    const totalPaid = paidMap.get(codeUpper) ?? 0;

    // 12-month grid (Jan..Dec of the current year).
    const monthlyLedger: { month: string; earned: number; conversions: number; paid: number; paid_at: string | null }[] = [];
    for (let mo = 1; mo <= 12; mo++) {
      const m = `${currentYear}-${String(mo).padStart(2, "0")}`;
      const e = earnedMonths.get(m);
      const pd = paidMonths.get(m);
      monthlyLedger.push({
        month: m,
        earned: round2(e?.earned ?? 0),
        conversions: e?.conversions ?? 0,
        paid: round2(pd?.paid ?? 0),
        paid_at: pd?.paidAt ?? null,
      });
    }

    const ax = a as Record<string, unknown>;
    ax.total_earned = round2(totalEarned);
    ax.total_paid = round2(totalPaid);
    // Lifetime balance still outstanding (earned minus everything paid).
    ax.commission_owed = Math.max(0, round2(totalEarned - totalPaid));
    // Owed right now = everything from COMPLETED months minus all payments.
    // Current-month earnings are pending (payouts happen on the 1st for the
    // prior month), so they are excluded here.
    ax.owed_now = Math.max(0, round2(completedEarned - totalPaid));
    ax.last_paid_month = lastPaidMonthMap.get(codeUpper) ?? null;
    ax.monthly_ledger = monthlyLedger;
  }

  // Payout summary across all affiliates — the upcoming payout (1st of next
  // month) covering the current month's earnings. Computed from the current
  // date, so it rolls forward automatically each month.
  const payoutMonth = currentYM;
  const payoutPerAffiliate: { code: string; name: string; amount: number; payment_method: string | null; payment_notes: string | null }[] = [];
  let payoutTotalDue = 0;
  for (const a of affiliates) {
    const ax = a as { code: string; name: string; payment_method?: string | null; payment_notes?: string | null; monthly_ledger?: { month: string; earned: number; paid: number }[] };
    const row = (ax.monthly_ledger ?? []).find((m) => m.month === payoutMonth);
    const due = row ? Math.max(0, round2(row.earned - row.paid)) : 0;
    if (due > 0) {
      payoutPerAffiliate.push({
        code: ax.code,
        name: ax.name,
        amount: due,
        payment_method: ax.payment_method ?? null,
        payment_notes: ax.payment_notes ?? null,
      });
      payoutTotalDue += due;
    }
  }
  const payout_summary = {
    payout_month: payoutMonth,
    total_due: round2(payoutTotalDue),
    per_affiliate: payoutPerAffiliate,
  };

  // Fetch pending partner applications
  const { data: applications } = await supabaseAdmin
    .from("partner_apps")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json({ affiliates, referrals, payments: payments ?? [], applications: applications ?? [], payout_summary });
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
