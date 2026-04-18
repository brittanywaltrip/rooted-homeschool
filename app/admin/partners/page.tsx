"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Affiliate {
  id: string; name: string; code: string;
  contact_email: string | null; paypal_email: string | null;
  stripe_coupon_id: string; stripe_api_id: string | null;
  commission_rate: number | null; is_active: boolean; clicks: number;
  notes: string | null; created_at: string; account_email: string | null;
  signups_referred: number; paying_customers: number;
  commission_owed: number; total_paid: number;
}

interface Referral {
  id: string; affiliate_code: string; stripe_session_id: string | null;
  converted: boolean; created_at: string; user_name: string; user_plan: string;
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
  const [loading, setLoading] = useState(true);

  // Expanded roster row
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ contact_email: "", paypal_email: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pay modal
  const [payModal, setPayModal] = useState<Affiliate | null>(null);
  const [paying, setPaying] = useState(false);

  // Approve/setup checklist modal
  const [approveApp, setApproveApp] = useState<Application | null>(null);
  const [setupLookup, setSetupLookup] = useState<ProfileMatch | null>(null);
  const [setupLookupRan, setSetupLookupRan] = useState(false);
  const [setupLookingUp, setSetupLookingUp] = useState(false);
  const [setupCompDone, setSetupCompDone] = useState(false);
  const [setupComping, setSetupComping] = useState(false);
  const [setupStripeCoupon, setSetupStripeCoupon] = useState("");
  const [setupStripeApi, setSetupStripeApi] = useState("");
  const [setupCommissionRate, setSetupCommissionRate] = useState(20);
  const [setupQrDataUrl, setSetupQrDataUrl] = useState<string | null>(null);
  const [setupCompleting, setSetupCompleting] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [setupFinalRefLink, setSetupFinalRefLink] = useState("");
  const [setupLinkCopied, setSetupLinkCopied] = useState(false);
  // Manual checkboxes per step
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);
  const [check4, setCheck4] = useState(false);
  const [check5, setCheck5] = useState(false);

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

  async function confirmPay() {
    if (!payModal) return;
    setPaying(true);
    const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const owed = Math.max(0, payModal.commission_owed - payModal.total_paid);
    await fetch("/api/admin/pay-affiliate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ affiliate_code: payModal.code, amount: owed, month, paypal_email: payModal.paypal_email }),
    });
    // Send payment confirmation email
    await fetch("/api/admin/partner-action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: "payment_email",
        contactEmail: payModal.contact_email,
        name: payModal.name,
        affiliateCode: payModal.code,
        amount: owed,
        month,
        paypalEmail: payModal.paypal_email,
        payingCount: payModal.paying_customers,
        lifetimeTotal: payModal.total_paid + owed,
      }),
    });
    setPaying(false); setPayModal(null);
    await loadData(token);
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from("affiliates").update({ is_active: !active }).eq("id", id);
    setAffiliates((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: !active } : a)));
  }

  // Derived referral code — first name uppercased, stripped of non-letters
  const setupCode = approveApp ? (approveApp.first_name || "").toUpperCase().replace(/[^A-Z]/g, "") : "";
  const setupRefLink = setupCode ? `https://rootedhomeschoolapp.com/?ref=${setupCode}` : "";
  const allStepsChecked = check1 && check2 && check3 && check4 && check5;

  // When admin opens the approve modal, reset checklist and run lookup + QR
  useEffect(() => {
    if (!approveApp || !token) return;
    setSetupLookup(null);
    setSetupLookupRan(false);
    setSetupLookingUp(true);
    setSetupCompDone(false);
    setSetupStripeCoupon("");
    setSetupStripeApi("");
    setSetupCommissionRate(20);
    setSetupQrDataUrl(null);
    setSetupDone(false);
    setSetupFinalRefLink("");
    setSetupLinkCopied(false);
    setCheck1(false); setCheck2(false); setCheck3(false); setCheck4(false); setCheck5(false);

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
          // If already comped, mark step 2 as done
          if (json.profile.plan_type === "partner_comp") setSetupCompDone(true);
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

  async function compAccount() {
    if (!setupLookup?.id) return;
    setSetupComping(true);
    const res = await fetch("/api/admin/partner-action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "comp_account", profileId: setupLookup.id }),
    });
    setSetupComping(false);
    if (res.ok) {
      setSetupCompDone(true);
      setSetupLookup((p) => p ? { ...p, is_pro: true, subscription_status: "active", plan_type: "partner_comp" } : p);
    }
  }

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

  const netOwed = affiliates.reduce((s, a) => s + Math.max(0, a.commission_owed - a.total_paid), 0);
  const pendingApps = applications.filter((a) => a.status === "pending");
  const IC = "w-full px-3 py-2 text-sm rounded-lg border border-[#e8e2d9] bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63]";

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
          <StatCard label="Owed" value={`$${netOwed.toFixed(2)}`} />
        </div>

        {/* ── Pending Applications ──────────────────────────────────────── */}
        {pendingApps.length > 0 && (
          <section>
            <SectionHeader emoji="📬" title={`Pending Applications (${pendingApps.length})`} />
            <div className="space-y-3">
              {pendingApps.map((app) => {
                const isExpanded = expandedAppId === app.id;
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
                        {app.social_handle && <Detail label="Social" value={app.social_handle} />}
                        {app.audience_size && <Detail label="Audience" value={app.audience_size} />}
                        <Detail label="Rooted account" value={app.rooted_account_email || (app.has_rooted_account ? "Yes" : "No")} />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[#e8e2d9] px-4 py-4 bg-[#faf8f4] space-y-4">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Why they want to partner</p>
                          <p className="text-sm text-[#2d2926] leading-relaxed bg-white border border-[#e8e2d9] rounded-lg px-4 py-3">
                            {app.why_rooted || app.about_journey || "No response"}
                          </p>
                        </div>
                        {app.paypal_email && (
                          <p className="text-xs text-[#7a6f65]">PayPal: <span className="text-[#2d2926] font-medium">{app.paypal_email}</span></p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => setApproveApp(app)}
                            className="px-4 py-2 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white rounded-lg transition-colors"
                          >
                            Approve
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
              const owed = Math.max(0, a.commission_owed - a.total_paid);
              const refLink = `rootedhomeschoolapp.com/upgrade?ref=${a.code}`;
              return (
                <div key={a.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleRow(a)}
                    className={`w-full text-left px-4 py-4 transition-colors ${isExpanded ? "bg-[#f0f7f1]" : "hover:bg-[#f8f7f4]"}`}
                  >
                    {/* Name + status row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[#2d2926]">{a.name}</p>
                          <span className="font-mono text-xs text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full">{a.code}</span>
                        </div>
                        <p className="text-xs text-[#7a6f65] mt-0.5">{a.account_email ?? a.contact_email ?? "—"}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${a.is_active ? "bg-[#e8f0e9] text-[var(--g-brand)]" : "bg-[#f5e6e6] text-[#8b3a3a]"}`}>
                          {a.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-4 gap-2 mt-3 bg-[#f8f7f4] rounded-xl px-3 py-2.5">
                      <MiniStat label="Clicks" value={a.clicks} />
                      <MiniStat label="Signups" value={a.signups_referred} />
                      <MiniStat label="Paying" value={a.paying_customers} accent />
                      <MiniStat label="Owed" value={`$${owed.toFixed(0)}`} accent={owed > 0} />
                    </div>
                  </button>

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

                      {/* Paid so far */}
                      <div className="flex items-center gap-3 text-xs text-[#7a6f65]">
                        <span>Total paid: <b className="text-[#2d2926]">${a.total_paid.toFixed(2)}</b></span>
                        <span>Commission rate: <b className="text-[#2d2926]">{a.commission_rate ?? 20}%</b></span>
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
                        {owed > 0 && (
                          <button onClick={() => setPayModal(a)}
                            className="px-4 py-2 text-xs font-semibold bg-[#6366f1] hover:bg-[#4338ca] text-white rounded-lg transition-colors">
                            Pay ${owed.toFixed(2)}</button>
                        )}
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
                const commission = r.converted
                  ? `$${(((r.user_plan === "monthly" ? 7.99 : r.user_plan === "standard" ? 49 : 39) * 0.85) * 0.20).toFixed(2)}`
                  : "$0";
                return (
                  <div key={r.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#2d2926]">{r.user_name}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="text-[11px] text-[#7a6f65]">{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        <span className="text-[11px] font-mono text-[#5c7f63]">{r.affiliate_code}</span>
                        <span className="text-[11px] text-[#7a6f65]">{planLabel}</span>
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
                  <p className="text-sm font-bold text-[#2d2926] shrink-0">${Number(p.amount).toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Pay Modal ─────────────────────────────────────────────────────── */}
      {payModal && (() => {
        const ow = Math.max(0, payModal.commission_owed - payModal.total_paid);
        const mo = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
        return (
          <Modal onClose={() => !paying && setPayModal(null)} title="Confirm payment">
            <p className="text-sm text-[#7a6f65] mb-4">
              Pay <b className="text-[#2d2926]">${ow.toFixed(2)}</b> to <b className="text-[#2d2926]">{payModal.paypal_email ?? "no PayPal"}</b> for {payModal.name} ({payModal.code}) {"\u2014"} {mo}?
            </p>
            <div className="flex gap-2">
              <button onClick={confirmPay} disabled={paying} className="flex-1 px-4 py-2.5 text-sm font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white rounded-xl">{paying ? "Processing..." : "Confirm payment"}</button>
              <button onClick={() => setPayModal(null)} disabled={paying} className="px-4 py-2.5 text-sm font-semibold text-[#7a6f65] border border-[#e8e2d9] rounded-xl">Cancel</button>
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
                <b>{approveApp.first_name}</b> is now a Rooted Partner. Welcome email sent to {approveApp.email}.
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

              {/* Step 2 — Comp Account */}
              <SetupStep
                n={2}
                title="Comp Account"
                checked={check2}
                onToggle={() => setCheck2(v => !v)}
              >
                {setupCompDone ? (
                  <p className="text-xs text-[var(--g-deep)]">✓ Account comped (is_pro, subscription_status=active, plan_type=partner_comp)</p>
                ) : (
                  <button onClick={compAccount} disabled={!setupLookup || setupComping}
                    className="px-3 py-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 text-white rounded-lg">
                    {setupComping ? "Comping…" : "Comp This Account"}
                  </button>
                )}
              </SetupStep>

              {/* Step 3 — Stripe Coupon */}
              <SetupStep
                n={3}
                title="Create Stripe Coupon"
                checked={check3}
                canCheck={!!setupStripeCoupon && !!setupStripeApi}
                onToggle={() => setCheck3(v => !v)}
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

              {/* Step 4 — Link & QR */}
              <SetupStep
                n={4}
                title="Affiliate Link & QR Code"
                checked={check4}
                onToggle={() => setCheck4(v => !v)}
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

              {/* Step 5 — Commission Rate */}
              <SetupStep
                n={5}
                title="Set Commission Rate"
                checked={check5}
                onToggle={() => setCheck5(v => !v)}
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
