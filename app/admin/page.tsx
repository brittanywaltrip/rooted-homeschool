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

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com"];

const TEST_EMAILS_PATTERNS = ["rooted.", "test", "finalpass", "mobiletest", "finaltest"];
const TEST_EMAILS_EXACT = [
  "zoereywaltrip@gmail.com",
  "brittanywaltrip20@gmail.com",
  "josephgarfield12@gmail.com",
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
    plan === "Founding"  ? "bg-amber-100 text-amber-800" :
    plan === "Standard"  ? "bg-green-100 text-green-800" :
    plan === "Refunded"  ? "bg-red-100 text-red-600"     :
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
  const [signupFilter, setSignupFilter] = useState<"All" | "Founding" | "Standard" | "Monthly" | "Free" | "Refunded">("All");
  const [refreshing,   setRefreshing]   = useState(false);
  const [emailsCopied, setEmailsCopied] = useState(false);
  const [hideTestUsers, setHideTestUsers] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [showTestSection, setShowTestSection] = useState(false);

  const loadData = async () => {
    setRefreshing(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !ADMIN_EMAILS.includes(session.user.email ?? "")) {
      router.replace("/dashboard");
      return;
    }
    const res = await fetch("/api/admin/summary", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      setError("Failed to load admin data.");
      setRefreshing(false);
      return;
    }
    const json = await res.json();
    setData(json);
    setRefreshing(false);
  };

  useEffect(() => { loadData(); }, [router]);

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
      <div className="min-h-screen bg-[#3d5c42] flex items-center justify-center">
        <p className="text-[#fefcf9] text-sm">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#3d5c42] flex items-center justify-center">
        <p className="text-[#a8c5a0] text-sm animate-pulse">Loading…</p>
      </div>
    );
  }

  const visible = filteredSignups();

  const testCount = data.recentSignups.filter(u => isTestUser(u.email)).length;
  const realUsers = data.recentSignups.filter(u => !isTestUser(u.email));

  const counts = {
    All:      realUsers.length,
    Founding: realUsers.filter(u => u.plan === "Founding").length,
    Standard: realUsers.filter(u => u.plan === "Standard").length,
    Monthly:  realUsers.filter(u => u.plan === "Monthly").length,
    Free:     realUsers.filter(u => u.plan === "Free").length,
    Refunded: realUsers.filter(u => u.plan === "Refunded").length,
  };

  return (
    <div className="min-h-screen bg-[#2d3e30]">

      {/* ── Sticky Header ──────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-[#3d5c42] border-b border-[#4e7055] px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8cba8e] mb-0.5">Rooted</p>
          <h1 className="text-xl font-bold text-[#fefcf9]" style={{ fontFamily: "var(--font-display)" }}>
            Founder Dashboard 🌱
          </h1>
          <p className="text-xs text-[#a8c5a0]">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={refreshing}
          className="flex items-center gap-2 bg-[#4e7055] hover:bg-[#5c7f63] disabled:opacity-50 text-[#fefcf9] text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors border border-[#6a9070] shrink-0"
        >
          <span className={refreshing ? "animate-spin" : ""}>🔄</span>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-5 py-8 space-y-10">

        {/* Quick Links */}
        <div>
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
        </div>

        {/* Section 1 — Growth */}
        <section>
          <SectionHeader emoji="🌱" title="Growth" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Real Families" value={data.totalUsers - testCount} sub={`${testCount} test accounts hidden`} />
            <StatCard label="Last 24 Hours"        value={data.last24hSignups} />
            <StatCard label="Yesterday"            value={data.yesterdaySignups} />
            <StatCard label="Paying Subscribers"   value={data.stripeActiveTotal}
              sub={`${data.stripeFoundingCount} founding · ${data.stripeStandardCount} standard · live from Stripe`} />
            <StatCard label="Founding Members"     value={data.foundingFamilies} />
            <StatCard label="Free Users"           value={data.freeUsers} />
          </div>
        </section>

        {/* Section 2 — Kids & Learning */}
        <section>
          <SectionHeader emoji="👧" title="Kids & Learning" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total Children"       value={data.totalChildren} />
            <StatCard label="Avg Children/Family"  value={data.avgChildrenPerFamily} />
            <StatCard label="Lessons Logged"       value={data.totalLessons.toLocaleString()} />
            <StatCard label="Lessons Today"        value={data.lessonsToday} />
            <StatCard label="Total Curricula"      value={data.totalCurricula} />
          </div>
        </section>

        {/* Section 3 — Features Used */}
        <section>
          <SectionHeader emoji="🌴" title="Features Used" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Vacation Blocks"      value={data.vacationBlocks} />
            <StatCard label="Books Logged"         value={data.booksLogged} />
            <StatCard label="Memories Created"     value={data.memoriesCreated} />
            <StatCard label="Co-teachers Invited"  value={data.coTeachers} />
          </div>
        </section>

        {/* Section 4 — User Funnel */}
        <section>
          <SectionHeader emoji="🔍" title="User Funnel" />
          {data.funnel === null ? (
            <p className="text-sm text-[#8cba8e] opacity-60">Funnel data unavailable.</p>
          ) : (() => {
            const base = data.funnel!.totalSignups || 1;
            const steps = [
              { label: "Signed up",             count: data.funnel!.totalSignups },
              { label: "Completed onboarding",  count: data.funnel!.completedOnboarding },
              { label: "Added a child",          count: data.funnel!.addedChild },
              { label: "Set up subjects",        count: data.funnel!.addedSubject },
              { label: "Logged a lesson",        count: data.funnel!.loggedLesson },
              { label: "Logged a resource",      count: data.funnel!.addedResource },
              { label: "Created a reflection",   count: data.funnel!.createdReflection },
              { label: "Used vacation blocking", count: data.funnel!.usedVacation },
            ];
            return (
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 space-y-3">
                {steps.map(({ label, count }) => {
                  const pct = Math.round((count / base) * 100);
                  const barColor = pct >= 60 ? "bg-green-500" : pct >= 30 ? "bg-amber-400" : "bg-rose-400";
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <p className="text-sm text-[#2d2926] w-44 shrink-0">{label}</p>
                      <div className="flex-1 bg-[#f0ede8] rounded-full h-2 overflow-hidden">
                        <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-sm text-[#2d2926] w-10 text-right shrink-0">{count}</p>
                      <p className="text-xs text-[#b5aca4] w-10 text-right shrink-0">{pct}%</p>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>

        {/* Section 5 — All Users */}
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
                  ? "bg-[#e8f0e9] text-[#3d5c42] border-[#b8d9bc]"
                  : "bg-rose-50 text-rose-600 border-rose-200"
              }`}
            >
              {hideTestUsers ? `🧪 ${testCount} test hidden` : `🧪 Showing ${testCount} test`}
            </button>
          </div>

          {/* Filter tabs + Copy emails */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {(["All", "Founding", "Standard", "Monthly", "Free", "Refunded"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSignupFilter(tab)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  signupFilter === tab
                    ? tab === "Founding"
                      ? "bg-amber-100 text-amber-800 border-amber-300"
                      : tab === "Standard" || tab === "Monthly"
                      ? "bg-blue-100 text-blue-800 border-blue-300"
                      : tab === "Refunded"
                      ? "bg-red-100 text-red-600 border-red-300"
                      : "bg-[#e8f0e9] text-[#3d5c42] border-[#b8d9bc]"
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
                    u.plan === "Founding" ? "border-l-4 border-l-amber-400" :
                    u.plan === "Standard" ? "border-l-4 border-l-green-500" :
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
                          u.plan === "Founding" ? "bg-amber-50" :
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
                            {u.plan === "Founding" && (
                              <div className="mt-3 inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-bold">
                                ⭐ Founding Member
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

        {/* Section 6 — Revenue */}
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
              label="Founding Members Paying"
              value={data.stripeFoundingCount}
              sub={`$${(data.stripeFoundingCount * 39).toLocaleString()} · $39/yr each`}
            />
            <StatCard
              label="Standard Paying"
              value={data.stripeStandardCount}
              sub={`$${(data.stripeStandardCount * 59).toLocaleString()} · $59/yr each`}
            />
            <div className="bg-rose-50 border border-rose-200 rounded-2xl px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-rose-400 mb-1">Refunded / Cancelled</p>
              <p className="text-2xl font-bold text-rose-700 leading-none">
                {data.cancelledFoundingCount + data.cancelledStandardCount}
              </p>
              <p className="text-xs text-rose-500 mt-1">
                {data.cancelledFoundingCount} founding · {data.cancelledStandardCount} standard
              </p>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
