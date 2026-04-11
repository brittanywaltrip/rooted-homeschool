"use client";

import React, { useEffect, useState } from "react";
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
  signups_referred: number;
  paying_customers: number;
  commission_owed: number;
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminPartnersPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
        router.replace("/dashboard");
        return;
      }
      setAuthed(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (session) await loadData(session.access_token);
      setLoading(false);
    })();
  }, [router]);

  async function loadData(token: string) {
    const res = await fetch("/api/admin/partners", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const json = await res.json();
    setAffiliates(json.affiliates ?? []);
    setReferrals(json.referrals ?? []);
  }

  async function toggleActive(id: string, currentlyActive: boolean) {
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

  return (
    <div className="min-h-screen bg-[#2d3e30]">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#3d5c42] border-b border-[#4e7055] px-6 py-4 flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-xs text-[#a8c5a0] hover:text-[#fefcf9] transition-colors">
            ← Back to admin
          </Link>
          <h1 className="text-xl font-bold text-[#fefcf9]" style={{ fontFamily: "var(--font-display)" }}>
            Partner Management
          </h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-8 space-y-10">

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Active Partners" value={affiliates.filter((a) => a.is_active).length} />
          <StatCard label="Total Clicks" value={affiliates.reduce((s, a) => s + (a.clicks ?? 0), 0)} />
          <StatCard label="Total Referrals" value={affiliates.reduce((s, a) => s + a.signups_referred, 0)} />
          <StatCard label="Paying Conversions" value={referrals.filter((r) => r.converted).length} />
          <StatCard label="Commission Owed" value={`$${affiliates.reduce((s, a) => s + a.commission_owed, 0).toFixed(2)}`} />
        </div>

        {/* Section 1 — Partner Roster */}
        <section>
          <SectionHeader emoji="🤝" title="Partner Roster" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8e2d9]">
                  {["Name", "Code", "Referral Link", "Contact", "PayPal", "Coupon", "Rate", "Clicks", "Signups", "Paying", "Owed", "Status", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {affiliates.map((a) => {
                  const firstName = a.name.split(" ")[0];
                  const rate = a.commission_rate ?? 20;
                  const mailSubject = encodeURIComponent("Your Rooted Partner Stats \u2014 April 2026");
                  const mailBody = encodeURIComponent(
                    `Hi ${firstName},\n\nHere\u2019s your update:\n\n\u2022 ${a.clicks} clicks\n\u2022 ${a.signups_referred} signups\n\u2022 ${a.paying_customers} paid conversions\n\nCommission owed: $${a.commission_owed.toFixed(2)}\n\nWe\u2019ll send payment to ${a.paypal_email ?? "your PayPal"} on May 1st.\n\nThank you for spreading the word!\n\n\u2014 Brittany`
                  );
                  const mailHref = a.contact_email
                    ? `mailto:${a.contact_email}?subject=${mailSubject}&body=${mailBody}`
                    : undefined;

                  return (
                    <tr key={a.id} className="border-b border-[#f0ede8] last:border-0 hover:bg-[#f8f7f4]">
                      <td className="px-4 py-3 font-medium text-[#2d2926] whitespace-nowrap">{a.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[#5c7f63]">{a.code}</td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65] max-w-[160px] truncate">
                        rootedhomeschoolapp.com/upgrade?ref={a.code}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65] whitespace-nowrap">{a.contact_email ?? "\u2014"}</td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65] whitespace-nowrap">{a.paypal_email ?? "\u2014"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[#7a6f65]">{a.stripe_coupon_id}</td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">{rate}%</td>
                      <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.clicks}</td>
                      <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.signups_referred}</td>
                      <td className="px-4 py-3 text-center font-medium text-[#2d2926]">{a.paying_customers}</td>
                      <td className="px-4 py-3 font-medium text-[#2d2926] whitespace-nowrap">
                        ${a.commission_owed.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleActive(a.id, a.is_active)}
                          className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
                            a.is_active
                              ? "bg-[#e8f0e9] text-[#2d5a3d]"
                              : "bg-[#f5e6e6] text-[#8b3a3a]"
                          }`}
                        >
                          {a.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {mailHref ? (
                          <a
                            href={mailHref}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#5c7f63] hover:text-[#2d5a3d] transition-colors"
                          >
                            Email
                          </a>
                        ) : (
                          <span className="text-xs text-[#b5aca4]">{"\u2014"}</span>
                        )}
                      </td>
                    </tr>
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
              <p className="text-sm text-[#7a6f65]">No referral conversions yet. When someone signs up through a partner link, it will appear here.</p>
            </div>
          ) : (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8e2d9]">
                    {["Date", "Customer", "Affiliate Code", "Plan", "Commission"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => {
                    const planLabel = r.user_plan === "founding_family" ? "Founding ($39/yr)"
                      : r.user_plan === "standard" ? "Standard ($59/yr)"
                      : r.user_plan === "monthly" ? "Monthly ($6.99/mo)"
                      : r.user_plan;
                    const commission = r.converted ? "$7.80" : "$0";
                    return (
                      <tr key={r.id} className="border-b border-[#f0ede8] last:border-0 hover:bg-[#f8f7f4]">
                        <td className="px-4 py-3 text-xs text-[#7a6f65] whitespace-nowrap">
                          {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-4 py-3 font-medium text-[#2d2926]">{r.user_name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#5c7f63]">{r.affiliate_code}</td>
                        <td className="px-4 py-3 text-xs text-[#7a6f65]">{planLabel}</td>
                        <td className="px-4 py-3 font-medium text-[#2d2926]">{commission}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
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
