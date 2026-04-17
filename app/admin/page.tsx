"use client";

// Manual SQL fix 2026-03-21: amannda86@yahoo.com + dward67@yahoo.com
// updated to founding_family via Supabase SQL.
// garfieldbrittany@gmail.com founding membership was a test/refunded —
// update plan_type to 'refunded', subscription_status to 'refunded'.
// Webhook handles all future paying members automatically.

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const TEST_EMAILS_PATTERNS = ["rooted.", "test", "finalpass", "mobiletest", "finaltest"];
const TEST_EMAILS_EXACT = [
  "garfieldbrittany@gmail.com",
  "zoereywaltrip@gmail.com",
  "brittanywaltrip20@gmail.com",
  "het787@gmail.com",
  "wovapi4416@lxbeta.com",
];

function isTestUser(email: string): boolean {
  const lower = email.toLowerCase();
  if (TEST_EMAILS_EXACT.includes(lower)) return true;
  return TEST_EMAILS_PATTERNS.some(p => lower.includes(p));
}

interface AdminSummary {
  // Growth
  totalUsers: number;
  last24hSignups: number;
  yesterdaySignups: number;
  proUsers: number;
  foundingFamilies: number;
  standardSubs: number;
  freeUsers: number;
  // Kids & Learning
  totalChildren: number;
  avgChildrenPerFamily: string;
  totalLessons: number;
  lessonsToday: number;
  totalCurricula: number;
  // Features
  vacationBlocks: number;
  booksLogged: number;
  memoriesCreated: number;
  coTeachers: number;
  // Revenue
  estAnnualRevenue: number;
  stripeFoundingCount: number;
  stripeStandardCount: number;
  stripeActiveTotal: number;
  cancelledFoundingCount: number;
  cancelledStandardCount: number;
  payingFoundingCount: number;
  activeAffiliateCount: number;
  affiliateUserIds: string[];
  // Funnel
  funnel: {
    totalSignups: number;
    completedOnboarding: number;
    addedChild: number;
    loggedLesson: number;
    addedSubject: number;
    addedResource: number;
    createdReflection: number;
    usedVacation: number;
  } | null;
  // All signups
  recentSignups: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    family_name: string | null;
    plan: string;
    plan_type: string | null;
    subscription_status: string | null;
    children_count: number;
    lessons_done: number;
    curricula_count: number;
    joined: string;
    last_active: string | null;
  }[];
  // Today's pulse
  memoriesToday: number;
  upgradesToday: number;
  // Feature adoption (% of users)
  featureAdoption: {
    createdMemory: number;
    loggedLesson: number;
    addedChild: number;
    setCurriculum: number;
    sharedFamily: number;
    usedVacation: number;
  };
  // 30-day signup trend
  signupTrend: { date: string; count: number }[];
  // Churn risk
  churnRisk: { name: string; email: string; lastActive: string | null; plan: string }[];
  // New user health
  newUserHealth: {
    total: number;
    addedChild: number;
    loggedLesson: number;
    createdMemory: number;
    setCurriculum: number;
  };
  // 14-day activity
  activityChart14: { date: string; count: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date      = new Date(dateStr);
  const now       = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const yesterday  = new Date(todayStart); yesterday.setDate(todayStart.getDate() - 1);
  const sevenAgo   = new Date(todayStart); sevenAgo.setDate(todayStart.getDate() - 7);

  if (date >= todayStart) {
    const t = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
    return `Today ${t}`;
  }
  if (date >= yesterday) return "Yesterday";
  if (date >= sevenAgo)  return date.toLocaleDateString("en-US", { weekday: "short" });

  const currentYear = now.getFullYear();
  const dateYear    = date.getFullYear();
  const base = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return dateYear === currentYear ? base : `${base} '${String(dateYear).slice(2)}`;
}

function PlanPill({ plan }: { plan: string }) {
  const cls =
    plan === "Rooted+ Founding"  ? "bg-amber-100 text-amber-800" :
    plan === "Rooted+"  ? "bg-green-100 text-green-800" :
    plan === "Refunded"  ? "bg-red-100 text-red-600"     :
    plan === "Partner"   ? "bg-indigo-100 text-indigo-800" :
                           "bg-[#f0ede8] text-[#7a6f65] border border-[#e8e2d9]";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {plan}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-1">{label}</p>
      <p className="text-2xl font-bold text-[#2d2926] leading-none">{value}</p>
      {sub && <p className="text-xs text-[#7a6f65] mt-1">{sub}</p>}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const [data,         setData]         = useState<AdminSummary | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [signupFilter, setSignupFilter] = useState<"All" | "Rooted+ Founding" | "Rooted+" | "Monthly" | "Rooted" | "Refunded" | "Partner">("All");
  const [refreshing,   setRefreshing]   = useState(false);
  const [emailsCopied, setEmailsCopied] = useState(false);
  const [hideTestUsers, setHideTestUsers] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  // Near freemium gate
  const [nearGate, setNearGate] = useState<{ name: string; email: string; count: number }[]>([]);

  // Re-engagement
  const [reengageCount, setReengageCount] = useState(0);
  const [sendingReengage, setSendingReengage] = useState(false);
  const [reengageSent, setReengageSent] = useState(false);

  // Affiliate payouts
  const [affiliatePayouts, setAffiliatePayouts] = useState<{ name: string; code: string; redemptions_this_month: number; gross_this_month_cents: number; commission_cents: number; paypal_email: string | null; month_label: string }[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(false);
  const [payoutsError, setPayoutsError] = useState(false);

  const fetchData = async (accessToken: string) => {
    setRefreshing(true);
    const res = await fetch("/api/admin/summary", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      setError("Failed to load admin data.");
      setRefreshing(false);
      return;
    }
    const json = await res.json();
    setData(json);

    // Single client-side memory query — drives Near Gate + Re-engagement
    const { data: allMems } = await supabase.from("memories").select("user_id");
    const userMemCounts: Record<string, number> = {};
    (allMems ?? []).forEach((m: { user_id: string }) => {
      userMemCounts[m.user_id] = (userMemCounts[m.user_id] ?? 0) + 1;
    });

    // ── Near freemium gate ────────────────────────────────
    const { data: freeProfiles } = await supabase
      .from("profiles")
      .select("id, display_name, email, first_name")
      .or("subscription_status.eq.free,subscription_status.is.null")
      .not("plan_type", "in", "(founding_family,standard,monthly)");
    const gateUsers: { name: string; email: string; count: number }[] = [];
    for (const p of (freeProfiles ?? []) as { id: string; display_name?: string; email?: string; first_name?: string }[]) {
      const cnt = userMemCounts[p.id] ?? 0;
      if (cnt >= 40) {
        gateUsers.push({ name: p.display_name || p.first_name || "Unknown", email: p.email || "", count: cnt });
      }
    }
    gateUsers.sort((a, b) => b.count - a.count);
    setNearGate(gateUsers);

    // ── Re-engagement count ───────────────────────────────
    const threeDaysAgo = new Date(); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const { data: allProfiles } = await supabase
      .from("profiles")
      .select("id")
      .or("re_engagement_sent.eq.false,re_engagement_sent.is.null")
      .lte("created_at", threeDaysAgo.toISOString());
    const noMemoryCount = (allProfiles ?? []).filter((p: { id: string }) => !userMemCounts[p.id]).length;
    setReengageCount(noMemoryCount);

    // ── Affiliate payouts ────────────────────────────────
    setPayoutsLoading(true);
    setPayoutsError(false);
    try {
      const payRes = await fetch("/api/admin/affiliate-payouts", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (payRes.ok) {
        const payJson = await payRes.json();
        setAffiliatePayouts(payJson.payouts ?? []);
      } else {
        setPayoutsError(true);
      }
    } catch {
      setPayoutsError(true);
    }
    setPayoutsLoading(false);

    setRefreshing(false);
  };

  // Wait for Supabase to rehydrate session before checking admin access
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (!session || !ADMIN_EMAILS.includes(session.user.email ?? '')) {
          router.replace('/dashboard');
          return;
        }
        // Refresh the session to get a fresh access token
        const { data: refreshed } = await supabase.auth.refreshSession();
        const token = refreshed.session?.access_token ?? session.access_token;
        await fetchData(token);
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  function copyEmails() {
    if (!data) return;
    const filtered = filteredSignups();
    const emails = filtered.map(u => u.email).join(", ");
    navigator.clipboard.writeText(emails);
    setEmailsCopied(true);
    setTimeout(() => setEmailsCopied(false), 2000);
  }

  function downloadCSV() {
    const rows = filteredSignups();
    const header = "Name,Email,Plan,Kids,Joined,Last Active,Lessons,Curricula";
    const csvRows = rows.map(u => {
      const name = (u.first_name || u.last_name)
        ? [u.first_name, u.last_name].filter(Boolean).join(" ")
        : u.family_name ?? "";
      return [
        `"${name}"`,
        `"${u.email}"`,
        u.plan,
        u.children_count,
        u.joined ? new Date(u.joined).toLocaleDateString() : "",
        u.last_active ? new Date(u.last_active).toLocaleDateString() : "Never",
        u.lessons_done,
        u.curricula_count,
      ].join(",");
    });
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rooted-users-${signupFilter.toLowerCase()}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function filteredSignups() {
    if (!data) return [];
    let list = data.recentSignups;
    // Hide test users
    if (hideTestUsers) {
      list = list.filter(u => !isTestUser(u.email));
    }
    // Filter by tab
    if (signupFilter !== "All") {
      list = list.filter(u => u.plan === signupFilter);
    }
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(u =>
        u.email.toLowerCase().includes(q) ||
        (u.family_name ?? "").toLowerCase().includes(q) ||
        (u.first_name ?? "").toLowerCase().includes(q) ||
        (u.last_name ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--g-deep)] flex items-center justify-center">
        <p className="text-[#fefcf9] text-sm">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--g-deep)] flex items-center justify-center">
        <p className="text-[#a8c5a0] text-sm animate-pulse">Loading…</p>
      </div>
    );
  }

  const visible = filteredSignups();

  const testCount = data.recentSignups.filter(u => isTestUser(u.email)).length;
  const realUsers = data.recentSignups.filter(u => !isTestUser(u.email));
  const realUserCount = data.totalUsers - testCount;
  const payingTotal = data.payingFoundingCount + data.stripeStandardCount;
  const conversionRate = realUserCount > 0 ? ((payingTotal / realUserCount) * 100).toFixed(1) : "0.0";

  const counts = {
    All:      realUsers.length,
    "Rooted+ Founding": realUsers.filter(u => u.plan === "Rooted+ Founding").length,
    "Rooted+": realUsers.filter(u => u.plan === "Rooted+").length,
    Monthly:  realUsers.filter(u => u.plan === "Monthly").length,
    Rooted:   realUsers.filter(u => u.plan === "Rooted").length,
    Refunded: realUsers.filter(u => u.plan === "Refunded").length,
    Partner:  realUsers.filter(u => u.plan === "Partner").length,
  };

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-[#2d3e30]">

      {/* ── Sticky Header ──────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-[var(--g-deep)] border-b border-[#4e7055] px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/rooted-logo-white.png" alt="Rooted" style={{ height: '32px', width: 'auto' }} />
          <div>
            <Link href="/dashboard" className="text-xs text-[#a8c5a0] hover:text-[#fefcf9] transition-colors">
              ← Back to app
            </Link>
            <h1 className="text-xl font-medium text-[#fefcf9]" style={{ fontFamily: "var(--font-display)" }}>
              Founder Dashboard
            </h1>
            <p className="text-xs text-[#a8c5a0]">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
        <button
          onClick={async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) await fetchData(session.access_token);
          }}
          disabled={refreshing}
          className="flex items-center gap-2 bg-[#4e7055] hover:bg-[#5c7f63] disabled:opacity-50 text-[#fefcf9] text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors border border-[#6a9070] shrink-0"
        >
          <span className={refreshing ? "animate-spin" : ""}>🔄</span>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-5 py-8 space-y-10">

        {/* Quick Links */}
        <div className="space-y-3">
          <Link
            href="/admin/resources"
            className="flex items-center gap-4 bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 hover:bg-[#f0f7f1] transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0 text-lg">🔗</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#2d2926]">Manage Resources</p>
              <p className="text-xs text-[#7a6f65]">Edit, add, or hide resource links shown to users</p>
            </div>
            <span className="text-[#5c7f63] text-lg font-semibold leading-none">→</span>
          </Link>
          <Link
            href="/admin/partners"
            className="flex items-center gap-4 bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 hover:bg-[#f0f7f1] transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0 text-lg">🤝</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#2d2926]">Partners</p>
              <p className="text-xs text-[#7a6f65]">Affiliate roster, referral tracking, and commission payouts</p>
            </div>
            <span className="text-[#5c7f63] text-lg font-semibold leading-none">→</span>
          </Link>
        </div>

        {/* Today's Pulse */}
        <section>
          <SectionHeader emoji="⚡" title="Today's Pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Signups" value={data.last24hSignups} />
            <StatCard label="Lessons" value={data.lessonsToday} />
            <StatCard label="Memories" value={data.memoriesToday} />
            <StatCard label="Upgrades" value={data.upgradesToday} />
          </div>
        </section>

        {/* Growth */}
        <section>
          <SectionHeader emoji="🌱" title="Growth" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Real Families" value={realUserCount} sub={`${testCount} test accounts hidden`} />
            <StatCard label="Today"                value={data.last24hSignups} />
            <StatCard label="Yesterday"            value={data.yesterdaySignups} />
            <StatCard
              label="Conversion Rate"
              value={`${conversionRate}%`}
              sub={`${payingTotal} paying of ${realUserCount} families`}
            />
            <StatCard label="Paying Customers"     value={payingTotal}
              sub={`${data.payingFoundingCount} Rooted+ founding · ${data.stripeStandardCount} Rooted+ standard · live from Stripe`} />
            <StatCard label="Rooted Partners"      value={data.activeAffiliateCount}
              sub="Comped affiliates" />
            <StatCard label="Free Users"           value={data.freeUsers} />
          </div>
        </section>

        {/* Signups by Day — 30 days */}
        {data.signupTrend && data.signupTrend.length > 0 && (
          <section>
            <SectionHeader emoji="📈" title="Signups by Day" />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-[#7a6f65]">Last 30 days</p>
                <p className="text-sm font-semibold text-[#2d2926]">
                  This week: {data.signupTrend.slice(-7).reduce((sum, d) => sum + d.count, 0)}
                </p>
              </div>
              <div className="flex items-end gap-[2px]" style={{ height: 120 }}>
                {(() => {
                  const maxCount = Math.max(...data.signupTrend.map(d => d.count), 1);
                  return data.signupTrend.map((d) => {
                    const barH = Math.max(Math.round((d.count / maxCount) * 110), d.count > 0 ? 4 : 1);
                    const isToday = d.date === todayStr;
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center justify-end" style={{ height: 120 }} title={`${d.date}: ${d.count} signups`}>
                        <div
                          className={`w-full rounded-t transition-all ${isToday ? "bg-[#3d6b47]" : "bg-[#5c7f63]"}`}
                          style={{ height: barH }}
                        />
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-[#b5aca4]">{new Date(data.signupTrend[0].date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span className="text-[10px] text-[#b5aca4]">Today</span>
              </div>
            </div>
          </section>
        )}

        {/* Revenue */}
        <section>
          <SectionHeader emoji="💰" title="Revenue" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 sm:col-span-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-1">Est. Annual Revenue</p>
              <p className="text-4xl font-bold text-[#2d2926] leading-none">${data.estAnnualRevenue.toLocaleString()}</p>
              <p className="text-xs text-[#7a6f65] mt-2">Based on live Stripe active subscriptions</p>
              <p className="text-sm font-semibold text-[#5c7f63] mt-2">
                MRR: ${Math.round(data.estAnnualRevenue / 12).toLocaleString()}/mo
              </p>
              <p className="text-xs text-[#b5aca4] mt-1">If you issued a refund, cancel the subscription in Stripe to keep this accurate.</p>
            </div>
            <StatCard
              label="Rooted+ Founding Paying"
              value={data.payingFoundingCount}
              sub={`$${(data.payingFoundingCount * 39).toLocaleString()} · $39/yr each`}
            />
            <StatCard
              label="Rooted+ Standard Paying"
              value={data.stripeStandardCount}
              sub={`$${(data.stripeStandardCount * 59).toLocaleString()} · $59/yr each`}
            />
            <div className="bg-rose-50 border border-rose-200 rounded-2xl px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-rose-400 mb-1">Refunded / Cancelled</p>
              <p className="text-2xl font-bold text-rose-700 leading-none">
                {data.cancelledFoundingCount + data.cancelledStandardCount}
              </p>
              <p className="text-xs text-rose-500 mt-1">
                {data.cancelledFoundingCount} Rooted+ founding · {data.cancelledStandardCount} Rooted+ standard
              </p>
            </div>
          </div>
        </section>

        {/* Feature Adoption */}
        {data.featureAdoption && (
          <section>
            <SectionHeader emoji="🎯" title="Feature Adoption" />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <p className="text-xs text-[#7a6f65] mb-4">% of all users who have used each feature</p>
              <div className="space-y-3">
                {[
                  { label: "Added a child", pct: data.featureAdoption.addedChild },
                  { label: "Created a memory", pct: data.featureAdoption.createdMemory },
                  { label: "Logged a lesson", pct: data.featureAdoption.loggedLesson },
                  { label: "Set up curriculum", pct: data.featureAdoption.setCurriculum },
                  { label: "Shared with family", pct: data.featureAdoption.sharedFamily },
                  { label: "Used vacation blocking", pct: data.featureAdoption.usedVacation },
                ]
                  .sort((a, b) => b.pct - a.pct)
                  .map(({ label, pct }) => (
                    <div key={label} className="flex items-center gap-3">
                      <p className="text-sm text-[#2d2926] w-44 shrink-0">{label}</p>
                      <div className="flex-1 bg-[#f0ede8] rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-3 rounded-full transition-all ${pct >= 50 ? "bg-green-500" : pct >= 20 ? "bg-amber-400" : "bg-rose-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-sm font-semibold text-[#2d2926] w-12 text-right">{pct}%</p>
                    </div>
                  ))}
              </div>
            </div>
          </section>
        )}

        {/* New User Health */}
        {data.newUserHealth && data.newUserHealth.total > 0 && (
          <section>
            <SectionHeader emoji="🌱" title={`New User Health (last 7 days — ${data.newUserHealth.total} signups)`} />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <p className="text-xs text-[#7a6f65] mb-4">Of {data.newUserHealth.total} new signups, how many activated?</p>
              <div className="space-y-3">
                {[
                  { label: "Added a child", count: data.newUserHealth.addedChild },
                  { label: "Logged a lesson", count: data.newUserHealth.loggedLesson },
                  { label: "Created a memory", count: data.newUserHealth.createdMemory },
                  { label: "Set up curriculum", count: data.newUserHealth.setCurriculum },
                ].map(({ label, count }) => {
                  const pct = data.newUserHealth.total > 0 ? Math.round((count / data.newUserHealth.total) * 100) : 0;
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <p className="text-sm text-[#2d2926] w-40 shrink-0">{label}</p>
                      <div className="flex-1 bg-[#f0ede8] rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-3 rounded-full transition-all ${pct >= 50 ? "bg-green-500" : pct >= 20 ? "bg-amber-400" : "bg-rose-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-sm text-[#2d2926] w-16 text-right">
                        <span className="font-semibold">{count}</span>
                        <span className="text-[#b5aca4] text-xs ml-1">({pct}%)</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* User Funnel */}
        <section>
          <SectionHeader emoji="🔍" title="User Funnel" />
          {data.funnel === null ? (
            <p className="text-sm text-[rgba(254, 252, 249, 0.55)] opacity-60">Funnel data unavailable.</p>
          ) : (() => {
            const base = data.funnel!.totalSignups || 1;
            const steps = [
              { label: "Signed up",             count: data.funnel!.totalSignups },
              { label: "Completed onboarding",  count: data.funnel!.completedOnboarding },
              { label: "Added a child",          count: data.funnel!.addedChild },
              { label: "Set up subjects",        count: data.funnel!.addedSubject },
              { label: "Logged a lesson",        count: data.funnel!.loggedLesson },
              { label: "Created a reflection",   count: data.funnel!.createdReflection },
              { label: "Used vacation blocking", count: data.funnel!.usedVacation },
            ];
            return (
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 space-y-3">
                {steps.map(({ label, count }, i) => {
                  const pct = Math.round((count / base) * 100);
                  const barColor = pct >= 60 ? "bg-green-500" : pct >= 30 ? "bg-amber-400" : "bg-rose-400";
                  const prevCount = i > 0 ? steps[i - 1].count : 0;
                  const dropOff = i > 0 && prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 100) : 0;
                  return (
                    <React.Fragment key={label}>
                      {i > 0 && dropOff > 0 && (
                        <p className="text-[10px] text-rose-400 ml-[11.5rem] -mt-1 mb-1">
                          ↓ {dropOff}% drop-off
                        </p>
                      )}
                      <div className="flex items-center gap-3">
                        <p className="text-sm text-[#2d2926] w-44 shrink-0">{label}</p>
                        <div className="flex-1 bg-[#f0ede8] rounded-full h-2 overflow-hidden">
                          <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-sm text-[#2d2926] w-10 text-right shrink-0">{count}</p>
                        <p className="text-xs text-[#b5aca4] w-10 text-right shrink-0">{pct}%</p>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            );
          })()}
        </section>

        {/* 14-Day Active Users */}
        {data.activityChart14 && data.activityChart14.length > 0 && (
          <section>
            <SectionHeader emoji="📊" title="14-Day Active Users" />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <p className="text-xs text-[#7a6f65] mb-3">Users who logged a lesson or memory each day</p>
              <div className="flex items-end justify-between gap-1" style={{ height: 140 }}>
                {(() => {
                  const maxCount = Math.max(...data.activityChart14.map(d => d.count), 1);
                  return data.activityChart14.map((d) => {
                    const barH = Math.max(Math.round((d.count / maxCount) * 130), d.count > 0 ? 4 : 1);
                    const dayLabel = new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "narrow" });
                    const isToday = d.date === todayStr;
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1" style={{ height: 140 }}>
                        <span className="text-[10px] font-semibold text-[#2d2926]">{d.count > 0 ? d.count : ""}</span>
                        <div
                          className={`w-full max-w-[24px] rounded-t-lg transition-all ${isToday ? "bg-[#3d6b47]" : "bg-[#5c7f63]"}`}
                          style={{ height: barH }}
                        />
                        <span className={`text-[9px] ${isToday ? "font-bold text-[#2d2926]" : "text-[#7a6f65]"}`}>{dayLabel}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </section>
        )}

        {/* Churn Risk */}
        {data.churnRisk && data.churnRisk.length > 0 && (
          <section>
            <SectionHeader emoji="🚨" title={`Churn Risk (${data.churnRisk.length} paid users)`} />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <p className="text-xs text-[#7a6f65] mb-3">Paying users with no activity in 7+ days</p>
              <div className="space-y-2">
                {data.churnRisk.slice(0, 15).map((u) => (
                  <div key={u.email} className="flex items-center justify-between text-sm">
                    <div className="min-w-0 flex-1">
                      <span className="text-[#2d2926] font-medium">{u.name}</span>
                      <span className="text-[#b5aca4] text-xs ml-2">{u.email}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-xs text-[#b5aca4]">{u.plan}</span>
                      <span className="text-rose-500 text-xs font-medium">
                        {u.lastActive ? `Last active ${formatRelativeDate(u.lastActive)}` : "Never active"}
                      </span>
                    </div>
                  </div>
                ))}
                {data.churnRisk.length > 15 && (
                  <p className="text-xs text-[#b5aca4] text-center pt-2">+ {data.churnRisk.length - 15} more</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Near Freemium Gate */}
        {nearGate.length > 0 && (
          <section>
            <SectionHeader emoji="⚠️" title={`Near Freemium Gate (${nearGate.length})`} />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <p className="text-xs text-[#7a6f65] mb-3">Free users with 40+ memories — approaching the free plan limit</p>
              <div className="space-y-2">
                {nearGate.map((u) => (
                  <div key={u.email} className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <span className="text-[#2d2926] font-medium">{u.name}</span>
                      <span className="text-[#b5aca4] text-xs ml-2">{u.email}</span>
                    </div>
                    <span className="text-amber-600 font-semibold shrink-0 ml-2">{u.count} memories</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Re-engagement */}
        <section>
          <SectionHeader emoji="📬" title="Re-engagement" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
            <p className="text-sm text-[#2d2926] mb-3">
              <span className="font-semibold">{reengageCount}</span> users qualify (signed up 3+ days ago, 0 memories, not yet emailed)
            </p>
            {reengageSent ? (
              <p className="text-sm text-[#5c7f63] font-medium">Re-engagement emails sent!</p>
            ) : (
              <button
                onClick={async () => {
                  setSendingReengage(true);
                  try {
                    await fetch("/api/cron/reengagement", { method: "POST" });
                    setReengageSent(true);
                  } catch { /* ignore */ }
                  setSendingReengage(false);
                }}
                disabled={sendingReengage || reengageCount === 0}
                className="px-4 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {sendingReengage ? "Sending…" : `Send re-engagement emails → (${reengageCount})`}
              </button>
            )}
          </div>
        </section>

        {/* Affiliate Payouts */}
        <section>
          <SectionHeader emoji="💸" title="Affiliate Payouts" />
          {payoutsLoading ? (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-6 flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-[#5c7f63] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[#7a6f65]">Loading Stripe data…</span>
            </div>
          ) : payoutsError ? (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <p className="text-sm text-red-500 mb-2">Could not load Stripe data</p>
              <button
                onClick={async () => {
                  setPayoutsLoading(true);
                  setPayoutsError(false);
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const res = await fetch("/api/admin/affiliate-payouts", {
                      headers: { Authorization: `Bearer ${session?.access_token}` },
                    });
                    if (res.ok) {
                      const json = await res.json();
                      setAffiliatePayouts(json.payouts ?? []);
                    } else {
                      setPayoutsError(true);
                    }
                  } catch {
                    setPayoutsError(true);
                  }
                  setPayoutsLoading(false);
                }}
                className="px-4 py-2 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          ) : affiliatePayouts.length === 0 ? (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <p className="text-sm text-[#7a6f65]">No active affiliates found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {affiliatePayouts.map((aff) => {
                const gross = (aff.gross_this_month_cents / 100).toFixed(2);
                const commission = (aff.commission_cents / 100).toFixed(2);
                const nextMonth = new Date();
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                const payoutDue = nextMonth.toLocaleDateString("en-US", { month: "long" }) + " 1";
                return (
                  <div key={aff.code} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
                    {/* Row 1: Name + code */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-medium text-[#2d2926]">{aff.name}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#e8e2d9] text-[#7a6f65]">{aff.code}</span>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="bg-[#faf8f4] border border-[#e8e2d9] rounded-xl px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-0.5">Sales</p>
                        <p className="text-lg font-bold text-[#2d2926] leading-none">{aff.redemptions_this_month}</p>
                      </div>
                      <div className="bg-[#faf8f4] border border-[#e8e2d9] rounded-xl px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-0.5">Gross</p>
                        <p className="text-lg font-bold text-[#2d2926] leading-none">${gross}</p>
                      </div>
                      <div className="bg-[#faf8f4] border border-[#e8e2d9] rounded-xl px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-0.5">Commission</p>
                        <p className="text-lg font-bold text-[#5c7f63] leading-none">${commission}</p>
                      </div>
                    </div>

                    {/* PayPal row */}
                    {aff.paypal_email && (
                      <div className="flex items-center gap-2 mb-2 text-sm text-[#7a6f65]">
                        <span>Pay via PayPal Business → {aff.paypal_email}</span>
                        <span className="text-[#2d2926] font-medium">Send ${commission}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(commission)}
                          className="text-[11px] px-2 py-0.5 rounded-lg bg-[#e8e2d9] hover:bg-[#d4cec5] text-[#7a6f65] transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    )}

                    {/* Month label */}
                    <p className="text-xs text-[#b5aca4]">
                      {aff.month_label} · Payout due {payoutDue}
                    </p>

                    {/* Zero sales note */}
                    {aff.redemptions_this_month === 0 && (
                      <p className="text-xs text-[#b5aca4] mt-1">No sales this month</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* All Users */}
        <section>
          <SectionHeader emoji="📋" title={`All Signups (${data.recentSignups.length})`} />

          {/* Search + test toggle */}
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-[#fefcf9] border border-[#e8e2d9] rounded-xl text-sm text-[#2d2926] placeholder-[#b5aca4] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
            />
            <button
              onClick={() => setHideTestUsers(v => !v)}
              className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap ${
                hideTestUsers
                  ? "bg-[#e8f0e9] text-[var(--g-deep)] border-[#b8d9bc]"
                  : "bg-rose-50 text-rose-600 border-rose-200"
              }`}
            >
              {hideTestUsers ? `🧪 ${testCount} test hidden` : `🧪 Showing ${testCount} test`}
            </button>
          </div>

          {/* Filter tabs + Copy emails */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {(["All", "Rooted+ Founding", "Rooted+", "Monthly", "Partner", "Rooted", "Refunded"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSignupFilter(tab)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  signupFilter === tab
                    ? tab === "Rooted+ Founding"
                      ? "bg-amber-100 text-amber-800 border-amber-300"
                      : tab === "Rooted+" || tab === "Monthly"
                      ? "bg-blue-100 text-blue-800 border-blue-300"
                      : tab === "Partner"
                      ? "bg-indigo-100 text-indigo-800 border-indigo-300"
                      : tab === "Refunded"
                      ? "bg-red-100 text-red-600 border-red-300"
                      : "bg-[#e8f0e9] text-[var(--g-deep)] border-[#b8d9bc]"
                    : "bg-[#fefcf9] text-[#7a6f65] border-[#e8e2d9] hover:border-[#b5aca4]"
                }`}
              >
                {tab} ({counts[tab]})
              </button>
            ))}

            <button
              onClick={copyEmails}
              className="ml-auto px-3 py-1.5 rounded-full text-xs font-semibold border bg-[#fefcf9] text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors"
            >
              {emailsCopied ? "✓ Copied!" : "📋 Copy emails"}
            </button>
            <button
              onClick={downloadCSV}
              className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-[#fefcf9] text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors"
            >
              📥 Download CSV
            </button>
          </div>

          {/* Mobile card list */}
          <div className="block lg:hidden max-h-[70vh] overflow-y-auto space-y-2">
            {visible.map((u) => {
              const name = (u.first_name || u.last_name)
                ? [u.first_name, u.last_name].filter(Boolean).join(" ")
                : u.family_name ?? u.email.split("@")[0];
              return (
                <div
                  key={u.id}
                  className={`bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-4 ${
                    u.plan === "Rooted+ Founding" ? "border-l-4 border-l-amber-400" :
                    u.plan === "Rooted+" ? "border-l-4 border-l-green-500" :
                    u.plan === "Refunded" ? "border-l-4 border-l-red-400"  : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[#2d2926] text-sm truncate">{name ?? u.email}</p>
                    <PlanPill plan={u.plan} />
                  </div>
                  {name && <p className="text-xs text-[#7a6f65] mt-1 truncate">{u.email}</p>}
                  <p className="text-[11px] text-[#b5aca4] mt-1.5 leading-snug">
                    {[
                      `${u.children_count} kid${u.children_count !== 1 ? "s" : ""}`,
                      `${u.curricula_count} curricula`,
                      `${u.lessons_done} lessons`,
                      `Joined ${formatRelativeDate(u.joined)}`,
                      u.last_active ? `Active ${formatRelativeDate(u.last_active)}` : "Never active",
                    ].join(" · ")}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Desktop table — column order: NAME | EMAIL | JOINED | LAST ACTIVE | PLAN | KIDS | CURRICULA | LESSONS */}
          <div className="hidden lg:block bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-[#e8e2d9] bg-[#f8f5f0]">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Name</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Email</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Joined</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Last Active</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Plan</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Kids</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Curricula</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Lessons</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0ede8]">
                  {visible.map((u) => {
                    const name = (u.first_name || u.last_name)
                      ? [u.first_name, u.last_name].filter(Boolean).join(" ")
                      : u.family_name ?? u.email.split("@")[0];
                    return (
                      <React.Fragment key={u.id}>
                      <tr
                        onClick={() => setSelectedUser(selectedUser === u.id ? null : u.id)}
                        className={`hover:brightness-95 transition-colors cursor-pointer ${
                          u.plan === "Rooted+ Founding" ? "bg-amber-50" :
                          u.plan === "Refunded" ? "bg-red-50"   : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-[#2d2926] max-w-[140px] truncate">{name}</td>
                        <td className="px-4 py-3 text-[#7a6f65] text-xs whitespace-nowrap">{u.email}</td>
                        <td className="px-4 py-3 text-xs text-[#7a6f65] whitespace-nowrap">{formatRelativeDate(u.joined)}</td>
                        <td className="px-4 py-3 text-xs text-[#7a6f65] whitespace-nowrap">{formatRelativeDate(u.last_active)}</td>
                        <td className="px-4 py-3"><PlanPill plan={u.plan} /></td>
                        <td className="px-4 py-3 text-right text-[#2d2926]">{u.children_count}</td>
                        <td className="px-4 py-3 text-right text-[#2d2926]">{u.curricula_count}</td>
                        <td className="px-4 py-3 text-right text-[#2d2926]">{u.lessons_done}</td>
                      </tr>
                      {selectedUser === u.id && (
                        <tr className="bg-[#f8f5f0]">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                              <div>
                                <p className="text-[#b5aca4] font-semibold uppercase tracking-wider mb-1">Full Name</p>
                                <p className="text-[#2d2926]">{name !== u.email.split("@")[0] ? name : "Not set"}</p>
                              </div>
                              <div>
                                <p className="text-[#b5aca4] font-semibold uppercase tracking-wider mb-1">Email</p>
                                <p className="text-[#2d2926] break-all">{u.email}</p>
                              </div>
                              <div>
                                <p className="text-[#b5aca4] font-semibold uppercase tracking-wider mb-1">Plan & Status</p>
                                <div className="flex items-center gap-2">
                                  <PlanPill plan={u.plan} />
                                  {u.subscription_status && (
                                    <span className="text-[10px] text-[#7a6f65]">{u.subscription_status}</span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <p className="text-[#b5aca4] font-semibold uppercase tracking-wider mb-1">Signup Date</p>
                                <p className="text-[#2d2926]">{u.joined ? new Date(u.joined).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"}</p>
                              </div>
                              <div>
                                <p className="text-[#b5aca4] font-semibold uppercase tracking-wider mb-1">Children</p>
                                <p className="text-[#2d2926]">{u.children_count}</p>
                              </div>
                              <div>
                                <p className="text-[#b5aca4] font-semibold uppercase tracking-wider mb-1">Lessons Logged</p>
                                <p className="text-[#2d2926]">{u.lessons_done}</p>
                              </div>
                              <div>
                                <p className="text-[#b5aca4] font-semibold uppercase tracking-wider mb-1">Curricula</p>
                                <p className="text-[#2d2926]">{u.curricula_count}</p>
                              </div>
                              <div>
                                <p className="text-[#b5aca4] font-semibold uppercase tracking-wider mb-1">Last Active</p>
                                <p className="text-[#2d2926]">{formatRelativeDate(u.last_active)}</p>
                              </div>
                            </div>
                            {u.plan === "Rooted+ Founding" && (
                              <div className="mt-3 inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-bold">
                                ⭐ Rooted+ Founding Member
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
