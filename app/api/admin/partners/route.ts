import { NextResponse } from "next/server";
import { readAllLedgerRows } from "@/lib/payout-ledger";
import { buildRosterAccounting } from "@/lib/partner-roster-ledger";
import { displayCommission } from "@/lib/commission";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

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

  try {
    const [affRows, referredProfiles, convertedRefRows, payments, applications] = await Promise.all([
      readAllLedgerRows((offset, size) => supabaseAdmin.from("affiliates")
        .select("*").order("id").range(offset, offset + size - 1)),
      readAllLedgerRows((offset, size) => supabaseAdmin.from("profiles")
        .select("id, referred_by, plan_type, first_name, last_name, display_name")
        .not("referred_by", "is", null).order("id").range(offset, offset + size - 1)),
      readAllLedgerRows((offset, size) => supabaseAdmin.from("referrals")
        .select("id, affiliate_code, converted, commission_amount, created_at")
        .eq("converted", true).order("id").range(offset, offset + size - 1)),
      readAllLedgerRows((offset, size) => supabaseAdmin.from("commission_payments")
        .select("*").order("id").range(offset, offset + size - 1)),
      readAllLedgerRows((offset, size) => supabaseAdmin.from("partner_apps")
        .select("*").order("id").range(offset, offset + size - 1)),
    ]);
    affRows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    payments.sort((a, b) => b.paid_at.localeCompare(a.paid_at));
    applications.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // Look up Rooted account emails for affiliates with user_id
    const affiliateUserIds = (affRows ?? []).map((a) => a.user_id).filter(Boolean);
    const accountEmailMap = new Map<string, string>();
    for (const uid of affiliateUserIds) {
      const { data: { user: authUser }, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(uid);
      if (lookupError && lookupError.status !== 404) throw new Error("Incomplete partner account lookup");
      if (authUser?.email) accountEmailMap.set(uid, authUser.email);
    }

    // The activity feed intentionally shows the latest 100 entries. It is
    // never the source of lifetime balances, signups or conversion counts.
    const { data: refRows, error: refError } = await supabaseAdmin.from("referrals")
      .select("id, affiliate_code, user_id, stripe_session_id, converted, commission_note, commission_amount, created_at")
      .order("created_at", { ascending: false }).order("id").limit(100);
    if (refError || !refRows) throw new Error("Incomplete referral activity read");

    // Fetch profiles for referral user_ids
    const refUserIds = (refRows ?? []).map((r) => r.user_id).filter(Boolean);
    const allUserIds = [...new Set([...refUserIds, ...(referredProfiles ?? []).map((p) => p.id)])];
    const allProfiles: { id: string; first_name: string | null; last_name: string | null; display_name: string | null; plan_type: string | null }[] = [];
    for (let offset = 0; offset < allUserIds.length; offset += 100) {
      const batch = allUserIds.slice(offset, offset + 100);
      const rows = await readAllLedgerRows((pageOffset, size) => supabaseAdmin.from("profiles")
        .select("id, first_name, last_name, display_name, plan_type")
        .in("id", batch).order("id").range(pageOffset, pageOffset + size - 1));
      allProfiles.push(...rows);
    }

    // Merge referred profiles data (has referred_by) with full profile data
    const profileMap = new Map(
      allProfiles.map((p) => [p.id, p])
    );

    // Per-affiliate base fields. commission_owed / owed_now / total_earned /
    // monthly_ledger are computed below once payments + lifetime earnings are
    // aggregated (the old per-100-row 7.80-style math lived here and is gone).
    const partnerRows = affRows.map((a) => {
      const codeUpper = (a.code ?? "").toUpperCase();
      const referred = (referredProfiles ?? []).filter(
        (p) => p.referred_by?.toUpperCase() === codeUpper
      );

      return {
        ...a,
        account_email: a.user_id ? accountEmailMap.get(a.user_id) ?? null : null,
        signups_referred: referred.length,
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
        if (listErr || !listData?.users) throw new Error("Incomplete referral account lookup");
        if (listData.users.length === 0) break;
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

    const { affiliates, payout_summary } = buildRosterAccounting(partnerRows, convertedRefRows, payments, new Date());
    return NextResponse.json({ affiliates, referrals, payments, applications, payout_summary },
      { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read complete partner ledger" }, { status: 503 });
  }
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
