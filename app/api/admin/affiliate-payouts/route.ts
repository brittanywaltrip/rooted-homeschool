import { NextResponse } from "next/server";
import { buildPayoutSummary, readAllLedgerRows } from "@/lib/payout-ledger";
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

  try {
    const [affiliates, referrals, payments] = await Promise.all([
      readAllLedgerRows((offset, size) => supabaseAdmin.from("affiliates")
        .select("id, name, code, is_active, paypal_email, payment_method")
        .order("id").range(offset, offset + size - 1)),
      readAllLedgerRows((offset, size) => supabaseAdmin.from("referrals")
        .select("id, affiliate_code, converted, commission_amount, created_at")
        .eq("converted", true).order("id").range(offset, offset + size - 1)),
      readAllLedgerRows((offset, size) => supabaseAdmin.from("commission_payments")
        .select("id, affiliate_code, amount, month")
        .order("id").range(offset, offset + size - 1)),
    ]);
    const now = new Date();
    const payouts = affiliates.map((affiliate) => ({
      name: affiliate.name,
      is_active: affiliate.is_active,
      code: affiliate.code,
      paypal_email: affiliate.paypal_email ?? null,
      payment_method: affiliate.payment_method ?? null,
      ...buildPayoutSummary(affiliate.code, referrals, payments, now),
    })).filter(affiliate => affiliate.is_active || affiliate.commission_cents > 0 || affiliate.pending_cents > 0);
    return NextResponse.json({ payouts, as_of: now.toISOString(), source: "commission_ledger" },
      { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read complete commission ledger" }, { status: 503 });
  }
}
