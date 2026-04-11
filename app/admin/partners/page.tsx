"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Affiliate {
  id: string;
  name: string;
  code: string;
  contact_email: string | null;
  paypal_email: string | null;
  stripe_coupon_id: string;
  stripe_api_id: string | null;
  commission_rate: number | null;
  is_active: boolean;
  clicks: number;
  notes: string | null;
  created_at: string;
  account_email: string | null;
  signups_referred: number;
  paying_customers: number;
  commission_owed: number;
  total_paid: number;
}

interface Referral {
  id: string;
  affiliate_code: string;
  stripe_session_id: string | null;
  converted: boolean;
  created_at: string;
  user_name: string;
  user_plan: string;
}

interface Payment {
  id: string;
  affiliate_code: string;
  amount: number;
  month: string;
  paid_at: string;
  paypal_email: string | null;
  notes: string | null;
}

interface EditDraft {
  contact_email: string;
  paypal_email: string;
  notes: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminPartnersPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  // Expanded row
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ contact_email: "", paypal_email: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pay modal
  const [payModal, setPayModal] = useState<Affiliate | null>(null);
  const [paying, setPaying] = useState(false);

  const loadData = useCallback(async (accessToken: string) => {
    const res = await fetch("/api/admin/partners", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const json = await res.json();
    setAffiliates(json.affiliates ?? []);
    setReferrals(json.referrals ?? []);
    setPayments(json.payments ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
        router.replace("/dashboard");
        return;
      }
      setAuthed(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setToken(session.access_token);
        await loadData(session.access_token);
      }
      setLoading(false);
    })();
  }, [router, loadData]);

  function toggleRow(a: Affiliate) {
    if (expandedCode === a.code) {
      setExpandedCode(null);
      return;
    }
    setExpandedCode(a.code);
    setEditDraft({
      contact_email: a.contact_email ?? "",
      paypal_email: a.paypal_email ?? "",
      notes: a.notes ?? "",
    });
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
    setSaving(false);
    setExpandedCode(null);
    await loadData(token);
  }

  async function confirmPay() {
    if (!payModal) return;
    setPaying(true);
    const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    await fetch("/api/admin/pay-affiliate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        affiliate_code: payModal.code,
        amount: Math.max(0, payModal.commission_owed - payModal.total_paid),
        month,
        paypal_email: payModal.paypal_email,
      }),
    });
    setPaying(false);
    setPayModal(null);
    await loadData(token);
  }

  async function toggleActive(e: React.MouseEvent, id: string, currentlyActive: boolean) {
    e.stopPropagation();
    await supabase.from("affiliates").update({ is_active: !currentlyActive }).eq("id", id);
    setAffiliates((prev) =>
      prev.map((a) => (a.id === id ? { ...a, is_active: !currentlyActive } : a))
    );
  }

  if (!authed || loading) {
    return (
      <div className="min-h-screen bg-[#2d3e30] flex items-center justify-center">
        <p className="text-[#a8c5a0] text-sm animate-pulse">Loading...</p>
      </div>
    );
  }

  const netOwed = affiliates.reduce((s, a) => s + Math.max(0, a.commission_owed - a.total_paid), 0);

  return (
    <div className="min-h-screen bg-[#2d3e30]">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#3d5c42] border-b border-[#4e7055] px-6 py-4">
        <Link href="/admin" className="text-xs text-[#a8c5a0] hover:text-[#fefcf9] transition-colors">
          ← Back to admin
        </Link>
        <h1 className="text-xl font-bold text-[#fefcf9]" style={{ fontFamily: "var(--font-display)" }}>
          Partner Management
        </h1>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-8 space-y-10">

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Active Partners" value={affiliates.filter((a) => a.is_active).length} />
          <StatCard label="Total Clicks" value={affiliates.reduce((s, a) => s + (a.clicks ?? 0), 0)} />
          <StatCard label="Total Referrals" value={affiliates.reduce((s, a) => s + a.signups_referred, 0)} />
          <StatCard label="Paying Conversions" value={referrals.filter((r) => r.converted).length} />
          <StatCard label="Commission Owed" value={`$${netOwed.toFixed(2)}`} />
        </div>

        {/* Section 1 — Partner Roster */}
        <section>
          <SectionHeader emoji="🤝" title="Partner Roster" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8e2d9]">
                  {["Name", "Code", "Account", "Clicks", "Signups", "Paying", "Owed", "Paid", "Status"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">
                      {h}
                    </th>
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
                      <tr
                        onClick={() => toggleRow(a)}
                        className={`border-b border-[#f0ede8] cursor-pointer transition-colors ${isExpanded ? "bg-[#f0f7f1]" : "hover:bg-[#f8f7f4]"}`}
                      >
                        <td className="px-4 py-3 font-medium text-[#2d2926] whitespace-nowrap">{a.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#5c7f63]">{a.code}</td>
                        <td className="px-4 py-3 text-xs text-[#7a6f65] whitespace-nowrap">{a.account_email ?? "\u2014"}</td>
                        <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.clicks}</td>
                        <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.signups_referred}</td>
                        <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.paying_customers}</td>
                        <td className="px-4 py-3 font-medium text-[#2d2926]">${owed.toFixed(2)}</td>
                        <td className="px-4 py-3 text-xs text-[#7a6f65]">${a.total_paid.toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => toggleActive(e, a.id, a.is_active)}
                            className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
                              a.is_active ? "bg-[#e8f0e9] text-[#2d5a3d]" : "bg-[#f5e6e6] text-[#8b3a3a]"
                            }`}
                          >
                            {a.is_active ? "Active" : "Inactive"}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded detail panel */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="bg-[#faf8f4] border-b border-[#e8e2d9] px-5 py-5">
                            <div className="space-y-5">

                              {/* Referral link */}
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-1">Referral link</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-[#5c7f63] font-mono">{refLink}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(`https://${refLink}`);
                                      setCopied(true);
                                      setTimeout(() => setCopied(false), 2000);
                                    }}
                                    className="text-xs font-semibold text-[#5c7f63] hover:text-[#2d5a3d] transition-colors"
                                  >
                                    {copied ? "Copied" : "Copy"}
                                  </button>
                                </div>
                              </div>

                              {/* Edit form */}
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] mb-2">Edit details</p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">Contact email</label>
                                    <input
                                      type="email"
                                      value={editDraft.contact_email}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, contact_email: e.target.value }))}
                                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#e8e2d9] bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">PayPal email</label>
                                    <input
                                      type="email"
                                      value={editDraft.paypal_email}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, paypal_email: e.target.value }))}
                                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#e8e2d9] bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-semibold text-[#b5aca4] mb-1">Notes</label>
                                    <input
                                      type="text"
                                      value={editDraft.notes}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#e8e2d9] bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                                      placeholder="Internal notes..."
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); saveEdit(); }}
                                    disabled={saving}
                                    className="px-4 py-2 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white rounded-lg transition-colors"
                                  >
                                    {saving ? "Saving..." : "Save"}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setExpandedCode(null); }}
                                    className="px-4 py-2 text-xs font-semibold text-[#7a6f65] hover:text-[#2d2926] border border-[#e8e2d9] rounded-lg transition-colors"
                                  >
                                    Cancel
                                  </button>

                                  {/* Pay button */}
                                  {owed > 0 && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPayModal(a); }}
                                      className="ml-auto px-4 py-2 text-xs font-semibold bg-[#6366f1] hover:bg-[#4338ca] text-white rounded-lg transition-colors"
                                    >
                                      Pay ${owed.toFixed(2)} to {a.paypal_email ?? "PayPal"}
                                    </button>
                                  )}

                                  {/* Email button */}
                                  {a.contact_email && (
                                    <a
                                      href={`mailto:${a.contact_email}?subject=${encodeURIComponent("Your Rooted Partner Stats \u2014 April 2026")}&body=${encodeURIComponent(`Hi ${a.name.split(" ")[0]},\n\nHere\u2019s your update:\n\n\u2022 ${a.clicks} clicks\n\u2022 ${a.signups_referred} signups\n\u2022 ${a.paying_customers} paid conversions\n\nCommission owed: $${owed.toFixed(2)}\n\nWe\u2019ll send payment to ${a.paypal_email ?? "your PayPal"} on May 1st.\n\nThank you!\n\n\u2014 Brittany`)}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="px-4 py-2 text-xs font-semibold text-[#5c7f63] hover:text-[#2d5a3d] border border-[#e8e2d9] rounded-lg transition-colors"
                                    >
                                      Email
                                    </a>
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

        {/* Section 2 — Referral Activity Feed */}
        <section>
          <SectionHeader emoji="📋" title="Referral Activity" />
          {referrals.length === 0 ? (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-8 text-center">
              <p className="text-sm text-[#7a6f65]">No referral conversions yet.</p>
            </div>
          ) : (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8e2d9]">
                    {["Date", "Customer", "Affiliate", "Plan", "Commission"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => {
                    const planLabel = r.user_plan === "founding_family" ? "Founding ($39/yr)"
                      : r.user_plan === "standard" ? "Standard ($59/yr)"
                      : r.user_plan === "monthly" ? "Monthly ($6.99/mo)"
                      : r.user_plan;
                    return (
                      <tr key={r.id} className="border-b border-[#f0ede8] last:border-0">
                        <td className="px-4 py-3 text-xs text-[#7a6f65]">
                          {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-4 py-3 font-medium text-[#2d2926]">{r.user_name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#5c7f63]">{r.affiliate_code}</td>
                        <td className="px-4 py-3 text-xs text-[#7a6f65]">{planLabel}</td>
                        <td className="px-4 py-3 font-medium text-[#2d2926]">{r.converted ? "$7.80" : "$0"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section 3 — Payment History */}
        <section>
          <SectionHeader emoji="💸" title="Payment History" />
          {payments.length === 0 ? (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-8 text-center">
              <p className="text-sm text-[#7a6f65]">No payments recorded yet.</p>
            </div>
          ) : (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8e2d9]">
                    {["Date", "Affiliate", "Amount", "Month", "PayPal", "Notes"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-[#f0ede8] last:border-0">
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">
                        {new Date(p.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
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

      {/* ── Pay Confirmation Modal ──────────────────────────────────────── */}
      {payModal && (() => {
        const modalOwed = Math.max(0, payModal.commission_owed - payModal.total_paid);
        const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => !paying && setPayModal(null)}>
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-[#2d2926] mb-2" style={{ fontFamily: "var(--font-display)" }}>
                Confirm payment
              </h3>
              <p className="text-sm text-[#7a6f65] mb-4">
                Pay <span className="font-bold text-[#2d2926]">${modalOwed.toFixed(2)}</span> to{" "}
                <span className="font-medium text-[#2d2926]">{payModal.paypal_email ?? "no PayPal on file"}</span>{" "}
                for <span className="font-medium text-[#2d2926]">{payModal.name}</span> ({payModal.code})
                {" \u2014 "}{monthLabel}?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={confirmPay}
                  disabled={paying}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white rounded-xl transition-colors"
                >
                  {paying ? "Processing..." : "Confirm payment"}
                </button>
                <button
                  onClick={() => setPayModal(null)}
                  disabled={paying}
                  className="px-4 py-2.5 text-sm font-semibold text-[#7a6f65] hover:text-[#2d2926] border border-[#e8e2d9] rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
