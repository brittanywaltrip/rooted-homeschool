"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

interface ApproveDraft {
  code: string; stripeCouponId: string; stripeApiId: string; commissionRate: number;
  paypalEmail: string;
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

  // Approve modal
  const [approveApp, setApproveApp] = useState<Application | null>(null);
  const [approveDraft, setApproveDraft] = useState<ApproveDraft>({ code: "", stripeCouponId: "", stripeApiId: "", commissionRate: 20, paypalEmail: "" });
  const [approving, setApproving] = useState(false);

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

  async function toggleActive(e: React.MouseEvent, id: string, active: boolean) {
    e.stopPropagation();
    await supabase.from("affiliates").update({ is_active: !active }).eq("id", id);
    setAffiliates((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: !active } : a)));
  }

  async function confirmApprove() {
    if (!approveApp) return;
    setApproving(true);
    await fetch("/api/admin/partner-action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: "approve",
        applicationId: approveApp.id,
        name: `${approveApp.first_name} ${approveApp.last_name}`,
        contactEmail: approveApp.email,
        rootedAccountEmail: approveApp.rooted_account_email || approveApp.email,
        paypalEmail: approveDraft.paypalEmail || approveApp.paypal_email,
        code: approveDraft.code,
        stripeCouponId: approveDraft.stripeCouponId,
        stripeApiId: approveDraft.stripeApiId,
        commissionRate: approveDraft.commissionRate,
      }),
    });
    setApproving(false); setApproveApp(null);
    await loadData(token);
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
      <div className="sticky top-0 z-50 bg-[var(--g-deep)] border-b border-[#4e7055] px-6 py-4 flex items-center gap-4">
        <img src="/rooted-logo-white.png" alt="Rooted" style={{ height: '32px', width: 'auto' }} />
        <div>
          <Link href="/admin" className="text-xs text-[#a8c5a0] hover:text-[#fefcf9] transition-colors">← Back to admin</Link>
          <h1 className="text-xl font-medium text-[#fefcf9]" style={{ fontFamily: "var(--font-display)" }}>Partner Management</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-8 space-y-10">

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Active Partners" value={affiliates.filter((a) => a.is_active).length} />
          <StatCard label="Total Clicks" value={affiliates.reduce((s, a) => s + (a.clicks ?? 0), 0)} />
          <StatCard label="Pending Apps" value={pendingApps.length} />
          <StatCard label="Paying Conversions" value={referrals.filter((r) => r.converted).length} />
          <StatCard label="Commission Owed" value={`$${netOwed.toFixed(2)}`} />
        </div>

        {/* ── Pending Applications ──────────────────────────────────────── */}
        {pendingApps.length > 0 && (
          <section>
            <SectionHeader emoji="📬" title={`Pending Applications (${pendingApps.length})`} />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8e2d9]">
                    {["Name", "Email", "Rooted Account", "Social", "Audience", "Applied"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pendingApps.map((app) => {
                    const isExpanded = expandedAppId === app.id;
                    return (
                      <React.Fragment key={app.id}>
                        <tr
                          onClick={() => setExpandedAppId(isExpanded ? null : app.id)}
                          className={`border-b border-[#f0ede8] cursor-pointer transition-colors ${isExpanded ? "bg-[#f0f7f1]" : "hover:bg-[#f8f7f4]"}`}
                        >
                          <td className="px-4 py-3 font-medium text-[#2d2926]">{app.first_name} {app.last_name}</td>
                          <td className="px-4 py-3 text-xs text-[#7a6f65]">{app.email}</td>
                          <td className="px-4 py-3 text-xs text-[#7a6f65]">{app.rooted_account_email || (app.has_rooted_account ? "Yes" : "\u2014")}</td>
                          <td className="px-4 py-3 text-xs text-[#5c7f63]">{app.social_handle ?? "\u2014"}</td>
                          <td className="px-4 py-3 text-xs text-[#7a6f65]">{app.audience_size ?? "\u2014"}</td>
                          <td className="px-4 py-3 text-xs text-[#7a6f65]">
                            {new Date(app.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="bg-[#faf8f4] border-b border-[#e8e2d9] px-5 py-5">
                              {/* Why Rooted */}
                              <div className="mb-4">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Why they want to partner</p>
                                <p className="text-sm text-[#2d2926] leading-relaxed bg-white border border-[#e8e2d9] rounded-lg px-4 py-3">
                                  {app.why_rooted || app.about_journey || "No response"}
                                </p>
                              </div>
                              {app.paypal_email && (
                                <p className="text-xs text-[#7a6f65] mb-4">PayPal: <span className="text-[#2d2926]">{app.paypal_email}</span></p>
                              )}
                              <div className="flex gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setApproveApp(app);
                                    setApproveDraft({
                                      code: "",
                                      stripeCouponId: "",
                                      stripeApiId: "",
                                      commissionRate: 20,
                                      paypalEmail: app.paypal_email ?? "",
                                    });
                                  }}
                                  className="px-4 py-2 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white rounded-lg transition-colors"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setRejectApp(app); setRejectNotes(""); }}
                                  className="px-4 py-2 text-xs font-semibold text-[#8b3a3a] hover:text-[#6b2a2a] border border-[#e8e2d9] rounded-lg transition-colors"
                                >
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Partner Roster ────────────────────────────────────────────── */}
        <section>
          <SectionHeader emoji="🤝" title="Partner Roster" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8e2d9]">
                  {["Name", "Code", "Account", "Clicks", "Signups", "Paying", "Owed", "Paid", "Status"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {affiliates.map((a) => {
                  const isExpanded = expandedCode === a.code;
                  const owed = Math.max(0, a.commission_owed - a.total_paid);
                  const refLink = `rootedhomeschoolapp.com/upgrade?ref=${a.code}`;
                  return (
                    <React.Fragment key={a.id}>
                      <tr onClick={() => toggleRow(a)} className={`border-b border-[#f0ede8] cursor-pointer transition-colors ${isExpanded ? "bg-[#f0f7f1]" : "hover:bg-[#f8f7f4]"}`}>
                        <td className="px-4 py-3 font-medium text-[#2d2926]">{a.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#5c7f63]">{a.code}</td>
                        <td className="px-4 py-3 text-xs text-[#7a6f65]">{a.account_email ?? "\u2014"}</td>
                        <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.clicks}</td>
                        <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.signups_referred}</td>
                        <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.paying_customers}</td>
                        <td className="px-4 py-3 font-medium text-[#2d2926]">${owed.toFixed(2)}</td>
                        <td className="px-4 py-3 text-xs text-[#7a6f65]">${a.total_paid.toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <button onClick={(e) => toggleActive(e, a.id, a.is_active)}
                            className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${a.is_active ? "bg-[#e8f0e9] text-[var(--g-brand)]" : "bg-[#f5e6e6] text-[#8b3a3a]"}`}>
                            {a.is_active ? "Active" : "Inactive"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="bg-[#faf8f4] border-b border-[#e8e2d9] px-5 py-5">
                            <div className="space-y-5">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Referral link</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-[#5c7f63] font-mono">{refLink}</span>
                                  <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`https://${refLink}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                                    className="text-xs font-semibold text-[#5c7f63] hover:text-[var(--g-brand)]">{copied ? "Copied" : "Copy"}</button>
                                </div>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-2">Edit details</p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">Contact email</label>
                                    <input type="email" value={editDraft.contact_email} onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, contact_email: e.target.value }))} className={IC} />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">PayPal email</label>
                                    <input type="email" value={editDraft.paypal_email} onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, paypal_email: e.target.value }))} className={IC} />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">Notes</label>
                                    <input type="text" value={editDraft.notes} onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))} className={IC} placeholder="Internal notes..." />
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={(e) => { e.stopPropagation(); saveEdit(); }} disabled={saving}
                                    className="px-4 py-2 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white rounded-lg transition-colors">
                                    {saving ? "Saving..." : "Save"}</button>
                                  <button onClick={(e) => { e.stopPropagation(); setExpandedCode(null); }}
                                    className="px-4 py-2 text-xs font-semibold text-[#7a6f65] border border-[#e8e2d9] rounded-lg">Cancel</button>
                                  {owed > 0 && (
                                    <button onClick={(e) => { e.stopPropagation(); setPayModal(a); }}
                                      className="ml-auto px-4 py-2 text-xs font-semibold bg-[#6366f1] hover:bg-[#4338ca] text-white rounded-lg transition-colors">
                                      Pay ${owed.toFixed(2)}</button>
                                  )}
                                  {a.contact_email && (
                                    <a href={`mailto:${a.contact_email}`} onClick={(e) => e.stopPropagation()}
                                      className="px-4 py-2 text-xs font-semibold text-[#5c7f63] border border-[#e8e2d9] rounded-lg">Email</a>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
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
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[#e8e2d9]">
                  {["Date", "Customer", "Affiliate", "Plan", "Commission"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {referrals.map((r) => (
                    <tr key={r.id} className="border-b border-[#f0ede8] last:border-0">
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td className="px-4 py-3 font-medium text-[#2d2926]">{r.user_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[#5c7f63]">{r.affiliate_code}</td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">{r.user_plan === "founding_family" ? "Founding ($39/yr)" : r.user_plan === "standard" ? "Standard ($59/yr)" : r.user_plan === "monthly" ? "Monthly ($6.99/mo)" : r.user_plan}</td>
                      <td className="px-4 py-3 font-medium text-[#2d2926]">{r.converted ? "$7.80" : "$0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[#e8e2d9]">
                  {["Date", "Affiliate", "Amount", "Month", "PayPal", "Notes"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-[#f0ede8] last:border-0">
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">{new Date(p.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[#5c7f63]">{p.affiliate_code}</td>
                      <td className="px-4 py-3 font-medium text-[#2d2926]">${Number(p.amount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">{p.month}</td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">{p.paypal_email ?? "\u2014"}</td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">{p.notes ?? "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {/* ── Approve Modal ─────────────────────────────────────────────────── */}
      {approveApp && (
        <Modal onClose={() => !approving && setApproveApp(null)} title="Approve partner application">
          <div className="space-y-3 mb-4">
            <Field label="Name" value={`${approveApp.first_name} ${approveApp.last_name}`} readOnly />
            <Field label="Contact email" value={approveApp.email} readOnly />
            <Field label="Rooted account email" value={approveApp.rooted_account_email || approveApp.email} readOnly />
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">PayPal email</label>
              <input value={approveDraft.paypalEmail} onChange={(e) => setApproveDraft((d) => ({ ...d, paypalEmail: e.target.value }))} className={IC} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Referral code *</label>
              <input value={approveDraft.code} onChange={(e) => setApproveDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))} placeholder="e.g. SABBATH" className={IC} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Stripe coupon ID *</label>
              <input value={approveDraft.stripeCouponId} onChange={(e) => setApproveDraft((d) => ({ ...d, stripeCouponId: e.target.value }))} placeholder="Paste from Stripe" className={IC} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Stripe API ID</label>
              <input value={approveDraft.stripeApiId} onChange={(e) => setApproveDraft((d) => ({ ...d, stripeApiId: e.target.value }))} placeholder="promo_..." className={IC} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Commission rate (%)</label>
              <input type="number" min={0} max={100} value={approveDraft.commissionRate} onChange={(e) => setApproveDraft((d) => ({ ...d, commissionRate: parseInt(e.target.value) || 20 }))} className={IC} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={confirmApprove} disabled={approving || !approveDraft.code || !approveDraft.stripeCouponId}
              className="flex-1 px-4 py-2.5 text-sm font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white rounded-xl">
              {approving ? "Approving..." : "Approve & send welcome email"}
            </button>
            <button onClick={() => setApproveApp(null)} disabled={approving} className="px-4 py-2.5 text-sm font-semibold text-[#7a6f65] border border-[#e8e2d9] rounded-xl">Cancel</button>
          </div>
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-1">{label}</p>
      <p className="text-2xl font-bold text-[#2d2926] leading-none">{value}</p>
    </div>
  );
}

function SectionHeader({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-lg">{emoji}</span>
      <h2 className="text-base font-bold text-[#fefcf9]">{title}</h2>
    </div>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
