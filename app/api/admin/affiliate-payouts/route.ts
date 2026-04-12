import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load active affiliates
  const { data: affiliates, error: affErr } = await supabaseAdmin
    .from("affiliates")
    .select("id, name, code, stripe_coupon_id, is_active, paypal_email")
    .eq("is_active", true);

  if (affErr || !affiliates) {
    return NextResponse.json({ error: "Failed to load affiliates" }, { status: 500 });
  }

  // Build coupon ID → affiliate lookup
  const couponToAffiliate = new Map<string, typeof affiliates[number]>();
  for (const aff of affiliates) {
    if (aff.stripe_coupon_id) {
      couponToAffiliate.set(aff.stripe_coupon_id, aff);
    }
  }

  // Fetch ALL charges (paginate through everything)
  const charges: Stripe.Charge[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;
  while (hasMore) {
    const params: Stripe.ChargeListParams = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const batch = await stripe.charges.list(params);
    charges.push(...batch.data);
    hasMore = batch.has_more;
    if (batch.data.length > 0) startingAfter = batch.data[batch.data.length - 1].id;
  }

  // For each charge with an invoice, check if the invoice discount matches an affiliate coupon
  const affiliateStats = new Map<string, { redemptions: number; grossCents: number }>();
  for (const aff of affiliates) {
    affiliateStats.set(aff.code, { redemptions: 0, grossCents: 0 });
  }

  for (const charge of charges) {
    const chargeAny = charge as any;
    if (!chargeAny.invoice || charge.status !== "succeeded") continue;

    try {
      const invoice = await stripe.invoices.retrieve(chargeAny.invoice as string);
      const invoiceAny = invoice as any;
      const couponId = invoiceAny.discount?.coupon?.id
        ?? invoiceAny.discounts?.[0]?.coupon?.id
        ?? null;
      if (!couponId || !couponToAffiliate.has(couponId)) continue;

      const aff = couponToAffiliate.get(couponId)!;
      const stats = affiliateStats.get(aff.code)!;
      stats.redemptions += 1;
      stats.grossCents += charge.amount;
    } catch {
      // Skip charges where invoice retrieval fails
    }
  }

  // Build response
  const payouts = affiliates.map((aff) => {
    const stats = affiliateStats.get(aff.code) ?? { redemptions: 0, grossCents: 0 };
    const commissionCents = Math.round(stats.grossCents * 0.20);
    return {
      name: aff.name,
      code: aff.code,
      redemptions_this_month: stats.redemptions,
      gross_this_month_cents: stats.grossCents,
      commission_cents: commissionCents,
      paypal_email: aff.paypal_email ?? null,
      month_label: "All Time",
    };
  });

  return NextResponse.json({ payouts });
}
