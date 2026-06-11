"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/commission";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface LedgerMonth {
  month: string;          // YYYY-MM
  earned: number;         // commission earned in this earning month
  conversions: number;    // # conversions in this earning month
  paid: number;           // payments whose covering month == this month
  paid_at: string | null; // most recent paid_at for that covering month
}

interface Affiliate {
  id: string; name: string; code: string;
  contact_email: string | null; paypal_email: string | null;
  stripe_coupon_id: string; stripe_api_id: string | null;
  commission_rate: number | null; is_active: boolean; clicks: number;
  notes: string | null; created_at: string; account_email: string | null;
  signups_referred: number; paying_customers: number;
  // Earned-vs-paid fields from /api/admin/partners. payment_method/
  // payment_notes are admin-only partner-payment routing.
  commission_owed: number;   // lifetime earned - paid (>= 0)
  total_earned: number;      // lifetime earned
  total_paid: number;        // lifetime paid
  owed_now: number;          // completed-months earned - total paid (>= 0)
  payment_method: string | null;
  payment_notes: string | null;
  last_paid_month: string | null;
  monthly_ledger: LedgerMonth[];
}

interface PayoutSummary {
  payout_month: string; // YYYY-MM being covered (the current month)
  total_due: number;
  per_affiliate: {
    code: string; name: string; amount: number;
    payment_method: string | null; payment_notes: string | null;
  }[];
}

interface Referral {
  id: string; affiliate_code: string; stripe_session_id: string | null;
  converted: boolean; created_at: string; user_name: string; user_plan: string;
  // Extended fields (admin-only — paired with /api/admin/partners route).
  commission_note: string | null;
  commission_amount: number;
  first_name: string | null;
  last_name: string | null;
  user_email: string | null;
  is_also_partner: boolean;
}

interface Payment {
  id: string; affiliate_code: string; amount: number; month: string;
  paid_at: string; paypal_email: string | null; notes: string | null;
}

interface Application {
  id: string; first_name: string; last_name: string; email: string;
  has_rooted_account: boolean; rooted_account_email: string | null;
  paypal_email: string | null; social_handle: string | null;
  audience_size: string | null; why_rooted: string | null;
  about_journey: string | null; status: string;
  created_at: string; notes: string | null;
  payment_method: string | null;
  platforms: string[] | null;
  platform_sizes: Record<string, string> | null;
  used_rooted: string | null;
}

interface EditDraft { contact_email: string; paypal_email: string; notes: string; }

interface ProfileMatch {
  id: string;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  is_pro: boolean;
  subscription_status: string;
  plan_type: string | null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminPartnersPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [payoutSummary, setPayoutSummary] = useState<PayoutSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Expanded roster row
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ contact_email: "", paypal_email: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pay modal — comprehensive Mark as Paid flow. Branches on
  // affiliate.payment_method (NULL/PayPal vs Mercury/etc.) and supports
  // a "goodwill" mode for paying $0-owed partners (one-off bonuses).
  const [payModal, setPayModal] = useState<Affiliate | null>(null);
  const [paying, setPaying] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMonth, setPayMonth] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payIsGoodwill, setPayIsGoodwill] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Approve/setup checklist modal
  const [approveApp, setApproveApp] = useState<Application | null>(null);
  const [setupLookup, setSetupLookup] = useState<ProfileMatch | null>(null);
  const [setupLookupRan, setSetupLookupRan] = useState(false);
  const [setupLookingUp, setSetupLookingUp] = useState(false);
  const [setupStripeCoupon, setSetupStripeCoupon] = useState("");
  const [setupStripeApi, setSetupStripeApi] = useState("");
  const [setupCommissionRate, setSetupCommissionRate] = useState(20);
  const [setupQrDataUrl, setSetupQrDataUrl] = useState<string | null>(null);
  const [setupCompleting, setSetupCompleting] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [setupFinalRefLink, setSetupFinalRefLink] = useState("");
  const [setupLinkCopied, setSetupLinkCopied] = useState(false);
  // Manual checkboxes per step (4 steps after the May 2026 affiliate
  // relaunch — the "Comp Account" step was removed).
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);
  const [check4, setCheck4] = useState(false);

  // Reject modal
  const [rejectApp, setRejectApp] = useState<Application | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [rejecting, setRejecting] = useState(false);

  // Expanded application
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);

  const loadData = useCallback(async (accessToken: string) => {
    const res = await fetch("/api/admin/partners", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return;
    const json = await res.json();
    setAffiliates(json.affiliates ?? []);
    setReferrals(json.referrals ?? []);
    setPayments(json.payments ?? []);
    setApplications(json.applications ?? []);
    setPayoutSummary(json.payout_summary ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) { router.replace("/dashboard"); return; }
      setAuthed(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { setToken(session.access_token); await loadData(session.access_token); }
      setLoading(false);
    })();
  }, [router, loadData]);

  function toggleRow(a: Affiliate) {
    if (expandedCode === a.code) { setExpandedCode(null); return; }
    setExpandedCode(a.code);
    setEditDraft({ contact_email: a.contact_email ?? "", paypal_email: a.paypal_email ?? "", notes: a.notes ?? "" });
    setCopied(false);
  }

  async function saveEdit() {
    if (!expandedCode) return;
    setSaving(true);
    await fetch("/api/admin/partners", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: expandedCode, ...editDraft }),
    });
    setSaving(false); setExpandedCode(null);
    await loadData(token);
  }

  function openPayModal(a: Affiliate, isGoodwill = false) {
    const method = (a.payment_method ?? "").trim();
    const isPayPal = !method || /paypal/i.test(method);
    const curYM = payoutSummary?.payout_month ?? clientCurrentYM();

    // Completed months (before the current one) that still have an unpaid
    // earned balance. Default the covering month to the most recent of these
    // (or the current month for goodwill / nothing owed) and pre-fill the
    // amount from that month's unpaid balance.
    const completedUnpaid = a.monthly_ledger.filter(
      (m) => m.month < curYM && roundCents(m.earned - m.paid) > 0,
    );
    const defaultMonth = !isGoodwill && completedUnpaid.length > 0
      ? completedUnpaid[completedUnpaid.length - 1].month
      : curYM;
    const defaultLedger = a.monthly_ledger.find((m) => m.month === defaultMonth);
    const defaultAmount = !isGoodwill && defaultLedger
      ? Math.max(0, roundCents(defaultLedger.earned - defaultLedger.paid))
      : 0;

    const monthLabel = formatMonthYM(defaultMonth);
    const baseSuggestion = isGoodwill ? `${monthLabel} goodwill bonus` : `${monthLabel} commission`;
    const suggestedNotes = isPayPal ? baseSuggestion : `[${method}] ${baseSuggestion}`;

    setPayIsGoodwill(isGoodwill);
    setPayAmount(!isGoodwill && defaultAmount > 0 ? defaultAmount.toFixed(2) : "");
    setPayMonth(defaultMonth);
    setPayNotes(suggestedNotes);
    setPayError(null);
    setPayModal(a);
  }

  async function confirmPay() {
    if (!payModal) return;
    setPayError(null);
    const amountNum = Number(payAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setPayError("Enter a valid amount greater than $0.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(payMonth)) {
      setPayError("Month must be in YYYY-MM format.");
      return;
    }
    setPaying(true);
    const res = await fetch("/api/admin/affiliate-payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        affiliate_code: payModal.code,
        amount: amountNum,
        month: payMonth,
        notes: payNotes,
      }),
    });
    if (!res.ok) {
      setPaying(false);
      const json = await res.json().catch(() => ({}));
      setPayError(json.error || "Payment failed.");
      return;
    }
    // Send payment confirmation email (non-blocking — don't fail the
    // whole flow if the email errors out, the payout row is recorded).
    const monthLabel = new Date(`${payMonth}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    fetch("/api/admin/partner-action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: "payment_email",
        contactEmail: payModal.contact_email,
        name: payModal.name,
        affiliateCode: payModal.code,
        amount: amountNum,
        month: monthLabel,
        paypalEmail: payModal.paypal_email,
        payingCount: payModal.paying_customers,
        lifetimeTotal: payModal.total_paid + amountNum,
      }),
    }).catch(() => {});
    setPaying(false);
    setPayModal(null);
    await loadData(token);
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from("affiliates").update({ is_active: !active }).eq("id", id);
    setAffiliates((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: !active } : a)));
  }

  // Derived referral code — first name uppercased, stripped of non-letters
  const setupCode = approveApp ? (approveApp.first_name || "").toUpperCase().replace(/[^A-Z]/g, "") : "";
  const setupRefLink = setupCode ? `https://rootedhomeschoolapp.com/?ref=${setupCode}` : "";
  const allStepsChecked = check1 && check2 && check3 && check4;

  // When admin opens the approve modal, reset checklist and run lookup + QR
  useEffect(() => {
    if (!approveApp || !token) return;
    setSetupLookup(null);
    setSetupLookupRan(false);
    setSetupLookingUp(true);
    setSetupStripeCoupon("");
    setSetupStripeApi("");
    setSetupCommissionRate(20);
    setSetupQrDataUrl(null);
    setSetupDone(false);
    setSetupFinalRefLink("");
    setSetupLinkCopied(false);
    setCheck1(false); setCheck2(false); setCheck3(false); setCheck4(false);

    // Run lookup
    (async () => {
      try {
        const res = await fetch("/api/admin/partner-action", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            action: "lookup_profile",
            firstName: approveApp.first_name,
            lastName: approveApp.last_name,
            rootedAccountEmail: approveApp.rooted_account_email || approveApp.email,
          }),
        });
        const json = await res.json();
        if (json.found && json.profile) {
          setSetupLookup(json.profile);
        } else {
          setSetupLookup(null);
        }
      } finally {
        setSetupLookupRan(true);
        setSetupLookingUp(false);
      }
    })();

    // Generate QR for the ref link
    const code = (approveApp.first_name || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (code) {
      QRCode.toDataURL(`https://rootedhomeschoolapp.com/?ref=${code}`, {
        width: 320,
        margin: 1,
        color: { dark: "#2D5A3D", light: "#FFFFFF" },
      }).then(setSetupQrDataUrl).catch(() => setSetupQrDataUrl(null));
    }
  }, [approveApp, token]);

  async function completeSetup() {
    if (!approveApp) return;
    setSetupCompleting(true);
    const res = await fetch("/api/admin/partner-action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: "complete_setup",
        applicationId: approveApp.id,
        name: `${approveApp.first_name} ${approveApp.last_name}`,
        contactEmail: approveApp.email,
        paypalEmail: approveApp.paypal_email,
        code: setupCode,
        stripeCouponId: setupStripeCoupon,
        stripeApiId: setupStripeApi,
        commissionRate: setupCommissionRate,
        profileId: setupLookup?.id ?? null,
        socialHandle: approveApp.social_handle,
        audienceSize: approveApp.audience_size,
        appCreatedAt: approveApp.created_at,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSetupCompleting(false);
    if (res.ok) {
      setSetupDone(true);
      setSetupFinalRefLink(json.refLink || setupRefLink);
      await loadData(token);
    } else {
      alert(json.error || "Setup failed. Check the logs.");
    }
  }

  async function confirmReject() {
    if (!rejectApp) return;
    setRejecting(true);
    await fetch("/api/admin/partner-action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: "reject",
        applicationId: rejectApp.id,
        name: `${rejectApp.first_name} ${rejectApp.last_name}`,
        contactEmail: rejectApp.email,
        notes: rejectNotes,
      }),
    });
    setRejecting(false); setRejectApp(null); setRejectNotes("");
    await loadData(token);
  }

  if (!authed || loading) {
    return (
      <div className="min-h-screen bg-[#2d3e30] flex items-center justify-center">
        <p className="text-[#a8c5a0] text-sm animate-pulse">Loading...</p>
      </div>
    );
  }

  // "Owed" in the summary card = total currently-overdue balance across
  // partners (completed-month earnings not yet paid).
  const netOwed = affiliates.reduce((s, a) => s + a.owed_now, 0);
  const pendingApps = applications.filter((a) => a.status === "pending");
  const IC = "w-full px-3 py-2 text-sm rounded-lg border border-[#e8e2d9] bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63]";

  // Emails (lowercased) that already have an affiliate row. Used to disable
  // the Approve button on pending apps that match an existing partner so we
  // never create a duplicate affiliates record.
  const partneredEmails = new Set(
    affiliates
      .flatMap((a) => [a.contact_email, a.account_email])
      .filter((e): e is string => !!e)
      .map((e) => e.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-[#2d3e30]">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[var(--g-deep)] border-b border-[#4e7055] px-4 sm:px-6 py-4 flex items-center gap-4">
        <img src="/rooted-logo-white.png" alt="Rooted" style={{ height: '32px', width: 'auto' }} />
        <div>
          <Link href="/admin" className="text-xs text-[#a8c5a0] hover:text-[#fefcf9] transition-colors">← Back to admin</Link>
          <h1 className="text-lg sm:text-xl font-medium text-[#fefcf9]" style={{ fontFamily: "var(--font-display)" }}>Partner Management</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Active" value={affiliates.filter((a) => a.is_active).length} />
          <StatCard label="Clicks" value={affiliates.reduce((s, a) => s + (a.clicks ?? 0), 0)} />
          <StatCard label="Pending" value={pendingApps.length} highlight={pendingApps.length > 0} />
          <StatCard label="Conversions" value={referrals.filter((r) => r.converted).length} />
          <StatCard label="Owed" value={formatCurrency(netOwed)} />
        </div>

        {/* ── Upcoming Payout Summary ───────────────────────────────────── */}
        {payoutSummary && (() => {
          const affByCode = new Map(affiliates.map((a) => [a.code, a]));
          return (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
                  {nextPayoutLabel(payoutSummary.payout_month)} Payout
                </h2>
                <span className="text-lg font-bold text-[#2d2926]">{formatCurrency(payoutSummary.total_due)}</span>
              </div>
              <p className="text-[11px] text-[#7a6f65] mt-0.5 mb-3">
                Next payout, covering {formatMonthYM(payoutSummary.payout_month)} earnings
              </p>
              {payoutSummary.per_affiliate.length === 0 ? (
                <div className="flex items-center gap-2 text-sm font-medium text-[#4a7c59]">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                    <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="#4a7c59" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  All caught up, nothing owed
                </div>
              ) : (
                <div className="space-y-1.5">
                  {payoutSummary.per_affiliate.map((p) => {
                    const aff = affByCode.get(p.code);
                    const method = (p.payment_method ?? "").trim();
                    const isPayPal = !method || /paypal/i.test(method);
                    const channelLabel = isPayPal ? "PayPal" : method;
                    const handle = isPayPal ? (aff?.paypal_email ?? "") : (aff?.contact_email ?? "");
                    return (
                      <div key={p.code} className="flex items-center justify-between gap-3 text-sm border-t border-[#f0ede8] pt-1.5 first:border-t-0 first:pt-0">
                        <div className="min-w-0">
                          <span className="font-medium text-[#2d2926]">{p.name}</span>
                          <span className="text-[11px] text-[#7a6f65] ml-2">
                            {channelLabel}{handle ? ` · ${handle}` : ""}
                          </span>
                        </div>
                        <span className="font-semibold text-[#2d2926] shrink-0">{formatCurrency(p.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Pending Applications ──────────────────────────────────────── */}
        {pendingApps.length > 0 && (
          <section>
            <SectionHeader emoji="📬" title={`Pending Applications (${pendingApps.length})`} />
            <div className="space-y-3">
              {pendingApps.map((app) => {
                const isExpanded = expandedAppId === app.id;
                const lookupEmails = [app.email, app.rooted_account_email]
                  .filter((e): e is string => !!e)
                  .map((e) => e.toLowerCase());
                const isAlreadyPartner = lookupEmails.some((e) => partneredEmails.has(e));
                return (
                  <div key={app.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
                    <button
                      onClick={() => setExpandedAppId(isExpanded ? null : app.id)}
                      className={`w-full text-left px-4 py-4 transition-colors ${isExpanded ? "bg-[#f0f7f1]" : "hover:bg-[#f8f7f4]"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#2d2926]">{app.first_name} {app.last_name}</p>
                          <p className="text-xs text-[#7a6f65] mt-0.5">{app.email}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="inline-block px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 rounded-full">Pending</span>
                          <p className="text-[10px] text-[#b5aca4] mt-1">
                            {new Date(app.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </p>
                        </div>
                      </div>
                      {/* Quick details row */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                        {app.social_handle && (
                          <span className="text-[11px] text-[#7a6f65]">
                            <span className="text-[#b5aca4]">Social:</span>{" "}
                            <InstagramLink handle={app.social_handle} onClick={(e) => e.stopPropagation()} />
                          </span>
                        )}
                        {app.audience_size && <Detail label="Audience" value={app.audience_size} />}
                        <Detail label="Rooted account" value={app.rooted_account_email || (app.has_rooted_account ? "Yes" : "No")} />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[#e8e2d9] px-4 py-4 bg-[#faf8f4] space-y-4">
                        {app.social_handle && (
                          <AppField label="Instagram">
                            <InstagramLink handle={app.social_handle} />
                          </AppField>
                        )}
                        {app.audience_size && (
                          <AppField label="Audience Size">{app.audience_size}</AppField>
                        )}
                        {app.platforms && app.platforms.length > 0 && (
                          <AppField label="Platforms">{app.platforms.join(", ")}</AppField>
                        )}
                        {app.platform_sizes && Object.keys(app.platform_sizes).length > 0 && (
                          <AppField label="Per Platform">
                            <div className="space-y-0.5">
                              {Object.entries(app.platform_sizes).map(([k, v]) => (
                                <p key={k}>{k}: {v}</p>
                              ))}
                            </div>
                          </AppField>
                        )}
                        {app.used_rooted && (
                          <AppField label="Used Rooted">{app.used_rooted}</AppField>
                        )}
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Why they want to partner</p>
                          <p className="text-sm text-[#2d2926] leading-relaxed bg-white border border-[#e8e2d9] rounded-lg px-4 py-3">
                            {app.why_rooted || app.about_journey || "No response"}
                          </p>
                        </div>
                        {app.about_journey && (
                          <AppField label="About their journey">
                            <p className="leading-relaxed bg-white border border-[#e8e2d9] rounded-lg px-4 py-3">{app.about_journey}</p>
                          </AppField>
                        )}
                        {app.payment_method && (
                          <p className="text-xs text-[#7a6f65]">Payment Method: <span className="text-[#2d2926] font-medium">{app.payment_method}</span></p>
                        )}
                        {app.paypal_email && (
                          <p className="text-xs text-[#7a6f65]">PayPal: <span className="text-[#2d2926] font-medium">{app.paypal_email}</span></p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => { if (!isAlreadyPartner) setApproveApp(app); }}
                            disabled={isAlreadyPartner}
                            title={isAlreadyPartner ? "An affiliate row already exists for this email — cannot create a duplicate" : undefined}
                            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                              isAlreadyPartner
                                ? "bg-[#e8e2d9] text-[#7a6f65] cursor-not-allowed"
                                : "bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white"
                            }`}
                          >
                            {isAlreadyPartner ? "Already a partner" : "Approve"}
                          </button>
                          <button
                            onClick={() => { setRejectApp(app); setRejectNotes(""); }}
                            className="px-4 py-2 text-xs font-semibold text-[#8b3a3a] hover:text-[#6b2a2a] border border-[#e8e2d9] rounded-lg transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Partner Roster ────────────────────────────────────────────── */}
        <section>
          <SectionHeader emoji="🤝" title="Partner Roster" />
          <div className="space-y-3">
            {affiliates.map((a) => {
              const isExpanded = expandedCode === a.code;
              const refLink = `rootedhomeschoolapp.com/?ref=${a.code}`;
              const method = (a.payment_method ?? "").trim();
              const isPayPalChannel = !method || /paypal/i.test(method);
              const channelLabel = isPayPalChannel ? "PayPal" : method;
              const channelEmail = isPayPalChannel ? a.paypal_email : a.contact_email;
              const missingPaymentInfo = !channelEmail;
              const lastPaidLabel = a.last_paid_month
                ? formatMonthYM(a.last_paid_month)
                : null;
              return (
                <div key={a.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleRow(a)}
                    className={`w-full text-left px-4 py-4 transition-colors ${isExpanded ? "bg-[#f0f7f1]" : "hover:bg-[#f8f7f4]"}`}
                  >
                    {/* Name + status row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-[#2d2926]">{a.name}</p>
                          <span className="font-mono text-xs text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full">{a.code}</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f8f7f4] text-[#7a6f65]">
                            via {channelLabel}
                          </span>
                        </div>
                        <p className="text-xs text-[#7a6f65] mt-0.5 truncate">{a.account_email ?? a.contact_email ?? "—"}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${a.is_active ? "bg-[#e8f0e9] text-[var(--g-brand)]" : "bg-[#f5e6e6] text-[#8b3a3a]"}`}>
                          {a.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-4 gap-2 mt-3 bg-[#f8f7f4] rounded-xl px-3 py-2.5">
                      <MiniStat label="Lifetime clicks" value={a.clicks} />
                      <MiniStat label="Paying refs" value={a.paying_customers} />
                      <MiniStat label="Earned" value={formatCurrency(a.total_earned)} />
                      <MiniStat
                        label="Owed now"
                        value={formatCurrency(a.owed_now)}
                        accent={a.owed_now > 0}
                      />
                    </div>

                    {/* History sub-line */}
                    <p className="text-[11px] text-[#7a6f65] mt-2">
                      Lifetime: <b className="text-[#2d2926]">{formatCurrency(a.total_paid)}</b>
                      {lastPaidLabel ? (
                        <> · Last paid: <b className="text-[#2d2926]">{lastPaidLabel}</b></>
                      ) : (
                        <span className="text-[#b5aca4]"> · Never paid</span>
                      )}
                    </p>
                  </button>

                  {/* Action row — Mark as Paid + cycle-state cues */}
                  <div className="border-t border-[#e8e2d9] px-4 py-3 bg-[#fdfcfa] flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-[#7a6f65] min-w-0">
                      {missingPaymentInfo ? (
                        <span
                          className="inline-flex items-center gap-1 text-amber-700"
                          title={isPayPalChannel
                            ? "No PayPal email on file — add one in the Edit panel before paying."
                            : `No contact email on file — required for ${channelLabel} payouts.`}
                        >
                          ⚠ Missing payment info
                        </span>
                      ) : (
                        <>
                          Pay to <span className="text-[#2d2926] font-medium truncate">{channelEmail}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.owed_now <= 0 ? (
                        <div className="flex items-center gap-2">
                          <button
                            disabled
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#f0ede8] text-[#b5aca4] cursor-not-allowed"
                          >
                            Nothing owed
                          </button>
                          {!missingPaymentInfo && (
                            <button
                              onClick={(e) => { e.stopPropagation(); openPayModal(a, true); }}
                              className="text-[11px] text-[#7a6f65] hover:text-[#5c7f63] underline-offset-2 hover:underline"
                            >
                              + goodwill payment
                            </button>
                          )}
                        </div>
                      ) : missingPaymentInfo ? (
                        <button
                          disabled
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#f0ede8] text-[#b5aca4] cursor-not-allowed"
                        >
                          Mark as Paid
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); openPayModal(a, false); }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white transition-colors"
                        >
                          Mark as Paid · {formatCurrency(a.owed_now)}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-[#e8e2d9] px-4 py-4 bg-[#faf8f4] space-y-4">
                      {/* Referral link */}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Referral link</p>
                        <div className="flex items-center gap-2 bg-white border border-[#e8e2d9] rounded-lg px-3 py-2">
                          <span className="text-xs text-[#5c7f63] font-mono truncate flex-1">{refLink}</span>
                          <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`https://${refLink}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                            className="text-xs font-semibold text-[#5c7f63] hover:text-[var(--g-brand)] shrink-0">{copied ? "Copied!" : "Copy"}</button>
                        </div>
                      </div>

                      {/* Channel + cycle info */}
                      <div className="grid grid-cols-2 gap-3 text-xs text-[#7a6f65]">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-0.5">Pay via</p>
                          <p className="text-[#2d2926] font-medium">{channelLabel}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-0.5">Commission rate</p>
                          <p className="text-[#2d2926] font-medium">{a.commission_rate ?? 20}%</p>
                        </div>
                      </div>

                      {a.payment_notes && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-800 mb-0.5">Payment notes</p>
                          <p className="text-xs text-amber-900">{a.payment_notes}</p>
                        </div>
                      )}

                      {/* Monthly earned-vs-paid ledger (current year) */}
                      <div>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">
                            {a.monthly_ledger[0]?.month.slice(0, 4)} ledger
                          </p>
                          <p className="text-[10px] text-[#7a6f65]">
                            Earned <b className="text-[#2d2926]">{formatCurrency(a.total_earned)}</b>
                            {" · "}Paid <b className="text-[#2d2926]">{formatCurrency(a.total_paid)}</b>
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {a.monthly_ledger.map((m) => (
                            <MonthCell key={m.month} cell={m} currentYM={payoutSummary?.payout_month ?? clientCurrentYM()} />
                          ))}
                        </div>
                      </div>

                      {/* Edit fields */}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-2">Edit details</p>
                        <div className="space-y-2">
                          <div>
                            <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">Contact email</label>
                            <input type="email" value={editDraft.contact_email}
                              onChange={(e) => setEditDraft((d) => ({ ...d, contact_email: e.target.value }))} className={IC} />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">PayPal email</label>
                            <input type="email" value={editDraft.paypal_email}
                              onChange={(e) => setEditDraft((d) => ({ ...d, paypal_email: e.target.value }))} className={IC} />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">Notes</label>
                            <input type="text" value={editDraft.notes}
                              onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))} className={IC} placeholder="Internal notes..." />
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => saveEdit()} disabled={saving}
                          className="px-4 py-2 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white rounded-lg transition-colors">
                          {saving ? "Saving..." : "Save"}</button>
                        <button onClick={() => setExpandedCode(null)}
                          className="px-4 py-2 text-xs font-semibold text-[#7a6f65] border border-[#e8e2d9] rounded-lg">Cancel</button>
                        <button onClick={() => toggleActive(a.id, a.is_active)}
                          className={`px-4 py-2 text-xs font-semibold border rounded-lg transition-colors ${a.is_active ? "text-[#8b3a3a] border-[#f5e6e6] hover:bg-[#fef2f2]" : "text-[#5c7f63] border-[#d4ead6] hover:bg-[#f0f7f1]"}`}>
                          {a.is_active ? "Deactivate" : "Reactivate"}</button>
                        {a.contact_email && (
                          <a href={`mailto:${a.contact_email}`}
                            className="px-4 py-2 text-xs font-semibold text-[#5c7f63] border border-[#e8e2d9] rounded-lg">Email</a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Referral Activity ─────────────────────────────────────────── */}
        <section>
          <SectionHeader emoji="📋" title="Referral Activity" />
          {referrals.length === 0 ? (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-8 text-center">
              <p className="text-sm text-[#7a6f65]">No referral conversions yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {referrals.map((r) => {
                const planLabel = r.user_plan === "founding_family" ? "Founding ($39/yr)" : r.user_plan === "standard" ? "Standard ($59/yr)" : r.user_plan === "monthly" ? "Monthly ($6.99/mo)" : r.user_plan;
                const commission = formatCurrency(r.converted ? r.commission_amount : 0);
                const status = r.commission_note
                  ? r.commission_note
                  : r.converted
                    ? "Paid subscriber"
                    : "Free user";
                return (
                  <div key={r.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-[#2d2926]">{r.user_name}</p>
                        {r.is_also_partner && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#eef0ff] text-[#4338ca]">
                            Also a partner
                          </span>
                        )}
                      </div>
                      {r.user_email && (
                        <p className="text-[11px] text-[#7a6f65] truncate">{r.user_email}</p>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="text-[11px] text-[#7a6f65]">{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        <span className="text-[11px] font-mono text-[#5c7f63]">{r.affiliate_code}</span>
                        <span className="text-[11px] text-[#7a6f65]">{planLabel}</span>
                        <span className="text-[11px] text-[#2d2926] italic">{status}</span>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-[#2d2926] shrink-0">{commission}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Payment History ───────────────────────────────────────────── */}
        <section>
          <SectionHeader emoji="💸" title="Payment History" />
          {payments.length === 0 ? (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-8 text-center">
              <p className="text-sm text-[#7a6f65]">No payments recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-[#5c7f63]">{p.affiliate_code}</span>
                      <span className="text-[11px] text-[#7a6f65]">{p.month}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      <span className="text-[11px] text-[#7a6f65]">{new Date(p.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      {p.paypal_email && <span className="text-[11px] text-[#7a6f65]">→ {p.paypal_email}</span>}
                      {p.notes && <span className="text-[11px] text-[#b5aca4] italic">{p.notes}</span>}
                    </div>
                  </div>
                  <p className="text-sm font-bold text-[#2d2926] shrink-0">{formatCurrency(Number(p.amount))}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Mark as Paid Modal ───────────────────────────────────────────── */}
      {payModal && (() => {
        const method = (payModal.payment_method ?? "").trim();
        const isPayPal = !method || /paypal/i.test(method);
        const channelLabel = isPayPal ? "PayPal" : method;
        const channelEmail = isPayPal ? payModal.paypal_email : payModal.contact_email;
        const curYM = payoutSummary?.payout_month ?? clientCurrentYM();
        // Covering-month options: this year's months up to (and including) the
        // current one. The select writes the chosen earning month into
        // commission_payments.month.
        const monthOptions = payModal.monthly_ledger.filter((m) => m.month <= curYM);
        const unpaidFor = (ym: string) => {
          const row = payModal.monthly_ledger.find((m) => m.month === ym);
          return row ? Math.max(0, roundCents(row.earned - row.paid)) : 0;
        };
        return (
          <Modal onClose={() => !paying && setPayModal(null)} title={`Mark Payment \u2014 ${payModal.name}`}>
            <div className="space-y-4">
              {!isPayPal && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <p className="text-xs font-semibold text-amber-900">Send via {channelLabel} (not PayPal)</p>
                  {payModal.payment_notes && (
                    <p className="text-[11px] text-amber-800 mt-1">{payModal.payment_notes}</p>
                  )}
                  <p className="text-[11px] text-amber-800 mt-1">
                    Notes will be auto-prefixed with <span className="font-mono">[{channelLabel}]</span> so the channel is logged on the row.
                  </p>
                </div>
              )}

              {payIsGoodwill && (
                <div className="bg-[#f0f7f1] border border-[#d4ead6] rounded-lg px-3 py-2.5">
                  <p className="text-xs font-semibold text-[var(--g-deep)]">Goodwill / one-off payment</p>
                  <p className="text-[11px] text-[#5c5248] mt-1">
                    No commission is currently owed for this cycle. Use this for thank-you bonuses or back-pay.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Affiliate code" value={payModal.code} readOnly />
                <Field label={isPayPal ? "PayPal email" : `${channelLabel} contact`} value={channelEmail ?? ""} readOnly />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Covering month</label>
                <select
                  value={payMonth}
                  onChange={(e) => {
                    const m = e.target.value;
                    setPayMonth(m);
                    if (!payIsGoodwill) {
                      const u = unpaidFor(m);
                      setPayAmount(u > 0 ? u.toFixed(2) : "");
                    }
                  }}
                  className={IC}
                >
                  {monthOptions.map((m) => (
                    <option key={m.month} value={m.month}>
                      {formatMonthYM(m.month)} · earned {formatCurrency(m.earned)} · unpaid {formatCurrency(Math.max(0, roundCents(m.earned - m.paid)))}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#7a6f65] mt-1">
                  The earning month this payment covers (saved to the payout record).
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Amount (USD)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className={IC}
                />
                {!payIsGoodwill && (
                  <p className="text-[11px] text-[#7a6f65] mt-1">
                    Unpaid balance for {formatMonthYM(payMonth)}: {formatCurrency(unpaidFor(payMonth))}.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className={IC + " resize-none"}
                />
              </div>

              {payError && (
                <p className="text-xs text-[#8b3a3a]">{payError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={confirmPay}
                  disabled={paying}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white rounded-xl"
                >
                  {paying ? "Recording..." : `Record payment${payAmount ? ` \u00b7 ${formatCurrency(Number(payAmount) || 0)}` : ""}`}
                </button>
                <button
                  onClick={() => setPayModal(null)}
                  disabled={paying}
                  className="px-4 py-2.5 text-sm font-semibold text-[#7a6f65] border border-[#e8e2d9] rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ── Setup Checklist Modal ─────────────────────────────────────────── */}
      {approveApp && (
        <Modal onClose={() => !setupCompleting && setApproveApp(null)} title={setupDone ? "Setup complete \uD83C\uDF3F" : `Affiliate Setup Checklist for ${approveApp.first_name} ${approveApp.last_name}`}>
          {setupDone ? (
            <div className="space-y-4">
              <p className="text-sm text-[#5c5248]">
                <b>{approveApp.first_name}</b> activated as a Rooted Partner. Approval is silent — remember to send your welcome message to {approveApp.email} manually.
              </p>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Referral link</label>
                <div className="flex items-center gap-2 bg-white border border-[#e8e2d9] rounded-lg px-3 py-2">
                  <span className="text-xs text-[#5c7f63] font-mono truncate flex-1">{setupFinalRefLink || setupRefLink}</span>
                  <button onClick={() => { navigator.clipboard.writeText(setupFinalRefLink || setupRefLink); setSetupLinkCopied(true); setTimeout(() => setSetupLinkCopied(false), 2000); }}
                    className="text-xs font-semibold text-[#5c7f63] hover:text-[var(--g-brand)] shrink-0">{setupLinkCopied ? "Copied!" : "Copy"}</button>
                </div>
              </div>
              {setupQrDataUrl && (
                <div className="text-center">
                  <img src={setupQrDataUrl} alt="Affiliate QR" className="mx-auto w-48 h-48 border border-[#e8e2d9] rounded-lg" />
                  <a href={setupQrDataUrl} download={`${setupCode}-qr.png`}
                    className="inline-block mt-2 text-xs font-semibold text-[#5c7f63] hover:text-[var(--g-brand)]">Download QR code</a>
                </div>
              )}
              <button onClick={() => setApproveApp(null)} className="w-full px-4 py-2.5 text-sm font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white rounded-xl">Done</button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Step 1 — Verify Rooted Account */}
              <SetupStep
                n={1}
                title="Verify Rooted Account"
                checked={check1}
                onToggle={() => setCheck1(v => !v)}
              >
                {setupLookingUp && <p className="text-xs text-[#7a6f65]">Looking up account…</p>}
                {!setupLookingUp && setupLookupRan && setupLookup && (
                  <div className="bg-[#f0f7f1] border border-[#d4ead6] rounded-lg px-3 py-2">
                    <p className="text-xs text-[var(--g-deep)]">
                      Found: <b>{setupLookup.display_name || `${setupLookup.first_name ?? ""} ${setupLookup.last_name ?? ""}`.trim() || "(no name)"}</b> — {setupLookup.subscription_status}{setupLookup.plan_type ? ` · ${setupLookup.plan_type}` : ""}
                    </p>
                    {setupLookup.email && <p className="text-[11px] text-[#7a6f65] mt-0.5">{setupLookup.email}</p>}
                  </div>
                )}
                {!setupLookingUp && setupLookupRan && !setupLookup && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-amber-800">⚠️ No account found. This person needs to create a Rooted account first.</p>
                  </div>
                )}
              </SetupStep>

              {/* Step 2 — Stripe Coupon */}
              <SetupStep
                n={2}
                title="Create Stripe Coupon"
                checked={check2}
                canCheck={!!setupStripeCoupon && !!setupStripeApi}
                onToggle={() => setCheck2(v => !v)}
              >
                <p className="text-xs text-[#5c5248] mb-2">
                  Create coupon in Stripe Dashboard with code: <b className="font-mono text-[var(--g-deep)]">{setupCode || "(need first name)"}</b>
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">Stripe Coupon ID</label>
                    <input value={setupStripeCoupon} onChange={(e) => setSetupStripeCoupon(e.target.value)} placeholder="Paste from Stripe" className={IC} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">Stripe Promo API ID</label>
                    <input value={setupStripeApi} onChange={(e) => setSetupStripeApi(e.target.value)} placeholder="promo_..." className={IC} />
                  </div>
                </div>
              </SetupStep>

              {/* Step 3 — Link & QR */}
              <SetupStep
                n={3}
                title="Affiliate Link & QR Code"
                checked={check3}
                onToggle={() => setCheck3(v => !v)}
              >
                <div className="flex items-center gap-2 bg-white border border-[#e8e2d9] rounded-lg px-3 py-2 mb-2">
                  <span className="text-xs text-[#5c7f63] font-mono truncate flex-1">{setupRefLink}</span>
                  <button onClick={() => { navigator.clipboard.writeText(setupRefLink); setSetupLinkCopied(true); setTimeout(() => setSetupLinkCopied(false), 2000); }}
                    className="text-xs font-semibold text-[#5c7f63] hover:text-[var(--g-brand)] shrink-0">{setupLinkCopied ? "Copied!" : "Copy"}</button>
                </div>
                {setupQrDataUrl && (
                  <div className="text-center">
                    <img src={setupQrDataUrl} alt="Affiliate QR" className="mx-auto w-36 h-36 border border-[#e8e2d9] rounded-lg" />
                    <a href={setupQrDataUrl} download={`${setupCode}-qr.png`}
                      className="inline-block mt-1 text-[11px] font-semibold text-[#5c7f63] hover:text-[var(--g-brand)]">Download PNG</a>
                  </div>
                )}
              </SetupStep>

              {/* Step 4 — Commission Rate */}
              <SetupStep
                n={4}
                title="Set Commission Rate"
                checked={check4}
                onToggle={() => setCheck4(v => !v)}
              >
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={100} value={setupCommissionRate}
                    onChange={(e) => setSetupCommissionRate(parseInt(e.target.value) || 20)}
                    className={IC + " w-24"} />
                  <span className="text-xs text-[#7a6f65]">% commission</span>
                </div>
              </SetupStep>

              <div className="flex gap-2 pt-2 border-t border-[#e8e2d9]">
                <button onClick={completeSetup} disabled={!allStepsChecked || setupCompleting || !setupStripeCoupon || !setupStripeApi || !setupCode}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 text-white rounded-xl">
                  {setupCompleting ? "Completing…" : "Complete Setup"}
                </button>
                <button onClick={() => setApproveApp(null)} disabled={setupCompleting} className="px-4 py-2.5 text-sm font-semibold text-[#7a6f65] border border-[#e8e2d9] rounded-xl">Cancel</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Reject Modal ──────────────────────────────────────────────────── */}
      {rejectApp && (
        <Modal onClose={() => !rejecting && setRejectApp(null)} title="Reject application">
          <p className="text-sm text-[#7a6f65] mb-3">
            Reject <b className="text-[#2d2926]">{rejectApp.first_name} {rejectApp.last_name}</b> ({rejectApp.email})? A polite email will be sent.
          </p>
          <div className="mb-4">
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Internal notes (optional)</label>
            <textarea rows={2} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)}
              className={IC + " resize-none"} placeholder="Reason for rejection (not sent to applicant)..." />
          </div>
          <div className="flex gap-2">
            <button onClick={confirmReject} disabled={rejecting}
              className="flex-1 px-4 py-2.5 text-sm font-semibold bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-50 text-white rounded-xl">
              {rejecting ? "Sending..." : "Reject & send email"}
            </button>
            <button onClick={() => setRejectApp(null)} disabled={rejecting} className="px-4 py-2.5 text-sm font-semibold text-[#7a6f65] border border-[#e8e2d9] rounded-xl">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[11px] text-[#7a6f65]">
      <span className="text-[#b5aca4]">{label}:</span> {value}
    </span>
  );
}

// Normalize a social handle (strip a leading @) for use in an Instagram URL.
function igHandle(raw: string): string {
  return raw.replace(/^@+/, "").trim();
}

// Render a social handle as an @-prefixed clickable Instagram link that opens
// in a new tab. onClick is passed through so callers inside a clickable card
// header can stopPropagation and avoid toggling the card.
function InstagramLink({ handle, onClick }: { handle: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <a
      href={`https://instagram.com/${igHandle(handle)}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="text-[#5c7f63] hover:underline"
    >
      @{igHandle(handle)}
    </a>
  );
}

// A labeled field for the expanded application card — small uppercase label
// above the value, matching the existing card detail style.
function AppField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">{label}</p>
      <div className="text-sm text-[#2d2926]">{children}</div>
    </div>
  );
}

// One month cell in the per-affiliate earned-vs-paid grid. Square/rounded
// rectangle (no round elements). States:
//   gray $0        — nothing earned
//   green + check  — earned and fully paid (paid date shown beneath + on hover)
//   amber          — earned, unpaid, month completed (OWED)
//   neutral outline— current month, pending (not yet owed)
function MonthCell({ cell, currentYM }: { cell: LedgerMonth; currentYM: string }) {
  const { earned, paid } = cell;
  const completed = cell.month < currentYM;
  const isCurrent = cell.month === currentYM;
  const paidFully = earned > 0 && paid + 0.005 >= earned;
  const label = monthShort(cell.month);
  const paidDate = cell.paid_at
    ? new Date(cell.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  let cls = "border-[#e8e2d9] bg-[#f5f3f0] text-[#b5aca4]"; // gray $0
  let showCheck = false;
  let title = `${label}: earned ${formatCurrency(earned)}`;
  if (earned <= 0) {
    // gray default
  } else if (paidFully) {
    cls = "border-[#bfe0c6] bg-[#eaf5ec] text-[#2d5c38]";
    showCheck = true;
    title = `${label}: earned ${formatCurrency(earned)}, paid${paidDate ? ` ${paidDate}` : ""}`;
  } else if (isCurrent) {
    cls = "border-[#d8d2c8] bg-white text-[#2d2926]";
    title = `${label}: earned ${formatCurrency(earned)} (current month, pending)`;
  } else if (completed) {
    cls = "border-[#f0d9a8] bg-[#fdf3e0] text-[#8b6820]";
    title = `${label}: earned ${formatCurrency(earned)}, unpaid (owed)`;
  }

  return (
    <div className={`rounded-md border px-2 py-1.5 text-center min-w-[54px] ${cls}`} title={title}>
      <p className="text-[9px] font-semibold uppercase tracking-wide leading-none">{label}</p>
      <p className="text-[11px] font-bold leading-none mt-1 flex items-center justify-center gap-0.5">
        {showCheck && (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" className="shrink-0">
            <path d="M2.5 6.2L5 8.7L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {formatCurrency(earned)}
      </p>
      {paidFully && paidDate && (
        <p className="text-[8px] leading-none mt-0.5 opacity-70">{paidDate}</p>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-base font-bold leading-none ${accent ? "text-[var(--g-deep)]" : "text-[#2d2926]"}`}>{value}</p>
      <p className="text-[10px] text-[#7a6f65] mt-0.5">{label}</p>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`border rounded-2xl px-4 py-3 ${highlight ? "bg-amber-50 border-amber-200" : "bg-[#fefcf9] border-[#e8e2d9]"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-0.5">{label}</p>
      <p className={`text-xl font-bold leading-none ${highlight ? "text-amber-700" : "text-[#2d2926]"}`}>{value}</p>
    </div>
  );
}

function SectionHeader({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-lg">{emoji}</span>
      <h2 className="text-base font-bold text-[#fefcf9]">{title}</h2>
    </div>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#2d2926] mb-3" style={{ fontFamily: "var(--font-display)" }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, readOnly }: { label: string; value: string; readOnly?: boolean }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">{label}</label>
      <input value={value} readOnly={readOnly} className={`w-full px-3 py-2 text-sm rounded-lg border border-[#e8e2d9] ${readOnly ? "bg-[#f8f7f4] text-[#7a6f65]" : "bg-white text-[#2d2926]"} focus:outline-none`} />
    </div>
  );
}

// Format a YYYY-MM string as "Month YYYY". Used for the disabled
// "Paid {Month YYYY}" button label and the lifetime sub-line.
function formatMonthYM(ym: string): string {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Current earning month (YYYY-MM, UTC) — matches the server's currentYM so
// completed-vs-current comparisons line up.
function clientCurrentYM(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Short month name for a YYYY-MM, e.g. "2026-06" → "Jun".
function monthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

// Label for the next payout (1st of the month AFTER the covered month),
// e.g. covered "2026-06" → "July 1".
function nextPayoutLabel(coveredYM: string): string {
  const [y, m] = coveredYM.split("-").map(Number);
  if (!y || !m) return "Next";
  const d = new Date(y, m, 1); // m is 1-based covered month → 0-based next month
  return `${d.toLocaleDateString("en-US", { month: "long" })} 1`;
}

function SetupStep({ n, title, checked, canCheck = true, onToggle, children }: {
  n: number; title: string; checked: boolean; canCheck?: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className={`border rounded-xl p-3 ${checked ? "border-[#5c7f63] bg-[#f0f7f1]" : "border-[#e8e2d9] bg-[#fefcf9]"}`}>
      <div className="flex items-start gap-2 mb-2">
        <button
          type="button"
          onClick={() => canCheck && onToggle()}
          disabled={!canCheck}
          className={`mt-0.5 w-5 h-5 rounded border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${
            checked ? "bg-[#5c7f63] border-[#5c7f63]" : canCheck ? "bg-white border-[#c8bfb5] hover:border-[#5c7f63]" : "bg-[#f0ede8] border-[#e8e2d9] cursor-not-allowed"
          }`}
          aria-label={`Mark step ${n} as done`}
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <p className="text-sm font-semibold text-[#2d2926]">
          <span className="text-[#7a6f65] mr-1">{n}.</span>
          {title}
        </p>
      </div>
      <div className="pl-7 space-y-1">{children}</div>
    </div>
  );
}
