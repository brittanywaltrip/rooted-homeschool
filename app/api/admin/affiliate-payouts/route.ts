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

async function verifyAdmin(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user || !ADMIN_EMAILS.includes(user.email ?? "")) return null;
  return user;
}

// POST — record a commission payout. Resolves the affiliate row server-side
// so the client only has to send the code; we figure out the right channel
// (PayPal vs Mercury/other) from affiliates.payment_method.
//
// Body: { affiliate_code, amount, month, notes }
// Returns: { success: true, row: <inserted commission_payments row> }
export async function POST(req: Request) {
  if (!await verifyAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { affiliate_code, amount, month, notes } = body as {
    affiliate_code?: string;
    amount?: number | string;
    month?: string;
    notes?: string;
  };

  if (!affiliate_code || amount == null || !month) {
    return NextResponse.json({ error: "Missing affiliate_code, amount, or month" }, { status: 400 });
  }

  const amountNum = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  // Resolve the affiliate row. payment_method + payment_notes are columns
  // outside the generated database.types — cast through unknown so the
  // typed client still narrows the rest of the row.
  const { data: affiliateRowRaw, error: affErr } = await supabaseAdmin
    .from("affiliates")
    .select("*")
    .ilike("code", affiliate_code)
    .maybeSingle();
  if (affErr) {
    return NextResponse.json({ error: affErr.message }, { status: 500 });
  }
  if (!affiliateRowRaw) {
    return NextResponse.json({ error: `No affiliate found for code "${affiliate_code}"` }, { status: 404 });
  }

  const affiliateRow = affiliateRowRaw as unknown as {
    code: string;
    paypal_email: string | null;
    contact_email: string | null;
    payment_method: string | null;
    payment_notes: string | null;
  };

  const paymentMethod = (affiliateRow.payment_method ?? "").trim();
  const isPayPal = !paymentMethod || /paypal/i.test(paymentMethod);

  // Channel routing —
  //   PayPal     → store paypal_email in commission_payments.paypal_email,
  //                pass through notes as-is.
  //   Other      → commission_payments.paypal_email is required, so we
  //                stash the partner's contact_email there and prepend
  //                "[<payment_method>] " to notes so the channel is
  //                self-evident on the historical row.
  const trimmedNotes = (notes ?? "").trim();
  let storedPayPalEmail: string;
  let storedNotes: string | null;
  if (isPayPal) {
    if (!affiliateRow.paypal_email) {
      return NextResponse.json({ error: "Affiliate has no PayPal email on file" }, { status: 400 });
    }
    storedPayPalEmail = affiliateRow.paypal_email;
    storedNotes = trimmedNotes || null;
  } else {
    if (!affiliateRow.contact_email) {
      return NextResponse.json({ error: "Affiliate has no contact email — required when paying via non-PayPal channel" }, { status: 400 });
    }
    storedPayPalEmail = affiliateRow.contact_email;
    const channelPrefix = `[${paymentMethod}] `;
    storedNotes = trimmedNotes
      ? (trimmedNotes.startsWith(channelPrefix) ? trimmedNotes : channelPrefix + trimmedNotes)
      : channelPrefix.trim();
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("commission_payments")
    .insert({
      affiliate_code: affiliateRow.code,
      amount: Math.round(amountNum * 100) / 100,
      month,
      paid_at: new Date().toISOString(),
      paypal_email: storedPayPalEmail,
      notes: storedNotes,
    })
    .select()
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, row: inserted });
}

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
    .select("id, name, code, stripe_coupon_id, is_active, paypal_email, payment_method")
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

  // Pull historical commission_payments aggregates so the admin home
  // widget surfaces "lifetime paid" + "last paid month" alongside the
  // live Stripe-side stats. commission_payments is the source of truth
  // for what we've actually paid out — Stripe data is what's owed.
  const { data: paymentRows } = await supabaseAdmin
    .from("commission_payments")
    .select("affiliate_code, amount, month")
    .order("month", { ascending: false });
  const lifetimePaidByCode = new Map<string, number>();
  const lastPaidMonthByCode = new Map<string, string>();
  for (const p of paymentRows ?? []) {
    const code = p.affiliate_code;
    lifetimePaidByCode.set(code, (lifetimePaidByCode.get(code) ?? 0) + Number(p.amount));
    if (p.month) {
      const prev = lastPaidMonthByCode.get(code);
      if (!prev || p.month > prev) lastPaidMonthByCode.set(code, p.month);
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
      payment_method: aff.payment_method ?? null,
      lifetime_paid: Math.round((lifetimePaidByCode.get(aff.code) ?? 0) * 100) / 100,
      last_paid_month: lastPaidMonthByCode.get(aff.code) ?? null,
      month_label: "All Time",
    };
  });

  return NextResponse.json({ payouts });
}
