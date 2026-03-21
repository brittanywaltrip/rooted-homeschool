"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAIL = "garfieldbrittany@gmail.com";

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
  // Recent signups
  recentSignups: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    family_name: string | null;
    plan: string;
    children_count: number;
    lessons_done: number;
    joined: string;
  }[];
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

export default function AdminPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signupFilter, setSignupFilter] = useState<"All" | "Founding" | "Free">("All");
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    setRefreshing(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || session.user.email !== ADMIN_EMAIL) {
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

  return (
    <div className="min-h-screen bg-[#2d3e30]">
      {/* Header */}
      <div className="bg-[#3d5c42] border-b border-[#4e7055] px-6 py-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8cba8e] mb-1">Rooted</p>
          <h1 className="text-2xl font-bold text-[#fefcf9]" style={{ fontFamily: "Georgia, serif" }}>
            Founder Dashboard 🌱
          </h1>
          <p className="text-sm text-[#a8c5a0] mt-1">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={refreshing}
          className="mt-1 flex items-center gap-2 bg-[#4e7055] hover:bg-[#5c7f63] disabled:opacity-50 text-[#fefcf9] text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors border border-[#6a9070] shrink-0"
        >
          <span className={refreshing ? "animate-spin" : ""}>🔄</span>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-5 py-8 space-y-10">

        {/* Section 1 — Growth */}
        <section>
          <SectionHeader emoji="🌱" title="Growth" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total Families" value={data.totalUsers} />
            <StatCard label="Last 24 Hours" value={data.last24hSignups} />
            <StatCard label="Yesterday" value={data.yesterdaySignups} />
            <StatCard label="Paying Subscribers" value={data.stripeActiveTotal} sub={`${data.stripeFoundingCount} founding · ${data.stripeStandardCount} standard · live from Stripe`} />
            <StatCard label="Founding Members" value={data.foundingFamilies} />
            <StatCard label="Free Users" value={data.freeUsers} />
          </div>
        </section>

        {/* Section 2 — Kids & Learning */}
        <section>
          <SectionHeader emoji="👧" title="Kids & Learning" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total Children" value={data.totalChildren} />
            <StatCard label="Avg Children/Family" value={data.avgChildrenPerFamily} />
            <StatCard label="Lessons Logged" value={data.totalLessons.toLocaleString()} />
            <StatCard label="Lessons Today" value={data.lessonsToday} />
            <StatCard label="Total Curricula" value={data.totalCurricula} />
          </div>
        </section>

        {/* Section 3 — Features Used */}
        <section>
          <SectionHeader emoji="🌴" title="Features Used" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Vacation Blocks" value={data.vacationBlocks} />
            <StatCard label="Books Logged" value={data.booksLogged} />
            <StatCard label="Memories Created" value={data.memoriesCreated} />
            <StatCard label="Co-teachers Invited" value={data.coTeachers} />
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

        {/* Section 5 — Recent Signups */}
        <section>
          <SectionHeader emoji="📋" title={`All Signups (${data.recentSignups.length})`} />

          {/* Filter tabs */}
          {(() => {
            const counts = {
              All:      data.recentSignups.length,
              Founding: data.recentSignups.filter(u => u.plan === "Founding").length,
              Free:     data.recentSignups.filter(u => u.plan === "Free").length,
            };
            return (
              <div className="flex gap-2 mb-4 flex-wrap">
                {(["All", "Founding", "Free"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setSignupFilter(tab)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      signupFilter === tab
                        ? tab === "Founding"
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-[#e8f0e9] text-[#3d5c42] border-[#b8d9bc]"
                        : "bg-[#fefcf9] text-[#7a6f65] border-[#e8e2d9] hover:border-[#b5aca4]"
                    }`}
                  >
                    {tab} ({counts[tab]})
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Mobile card list */}
          <div className="block lg:hidden max-h-[70vh] overflow-y-auto space-y-2">
            {data.recentSignups.filter(u => signupFilter === "All" || u.plan === signupFilter).map((u) => {
              const primaryName = (u.first_name || u.last_name)
                ? [u.first_name, u.last_name].filter(Boolean).join(" ")
                : null;
              const joinedStr = new Date(u.joined).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              return (
                <div
                  key={u.id}
                  className={`bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-4 ${
                    u.plan === "Founding" ? "border-l-4 border-l-amber-400" : u.plan === "Standard" ? "border-l-4 border-l-green-500" : ""
                  }`}
                >
                  {/* Row 1: name + badge */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[#2d2926] text-sm truncate">
                      {primaryName ?? u.email}
                    </p>
                    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      u.plan === "Founding"
                        ? "bg-amber-100 text-amber-800"
                        : u.plan === "Standard"
                        ? "bg-green-100 text-green-800"
                        : "bg-[#f0ede8] text-[#7a6f65]"
                    }`}>
                      {u.plan}
                    </span>
                  </div>
                  {/* Row 2: email (only if we showed name above) */}
                  {primaryName && (
                    <p className="text-xs text-[#7a6f65] mt-1 truncate">{u.email}</p>
                  )}
                  {/* Row 3: family name · kids · lessons · joined */}
                  <p className="text-[11px] text-[#b5aca4] mt-1.5 leading-snug">
                    {[
                      u.family_name,
                      `${u.children_count} kid${u.children_count !== 1 ? "s" : ""}`,
                      `${u.lessons_done} lesson${u.lessons_done !== 1 ? "s" : ""}`,
                      joinedStr,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-[#e8e2d9] bg-[#f8f5f0]">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">First Name</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Last Name</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Family Name</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Email</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Plan</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Kids</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Lessons</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4]">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0ede8]">
                  {data.recentSignups.filter(u => signupFilter === "All" || u.plan === signupFilter).map((u) => (
                    <tr
                      key={u.id}
                      className={`hover:brightness-95 transition-colors ${
                        u.plan === "Founding" ? "bg-amber-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-[#2d2926]">
                        {u.first_name ?? <span className="text-[#c8bfb5] italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[#2d2926]">
                        {u.last_name ?? <span className="text-[#c8bfb5] italic">—</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-[#2d2926]">
                        {u.family_name ?? <span className="text-[#c8bfb5] italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[#7a6f65] text-xs">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          u.plan === "Founding"
                            ? "bg-amber-100 text-amber-800"
                            : u.plan === "Standard"
                            ? "bg-green-100 text-green-800"
                            : "bg-[#f0ede8] text-[#7a6f65] border border-[#e8e2d9]"
                        }`}>
                          {u.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[#2d2926]">{u.children_count}</td>
                      <td className="px-4 py-3 text-right text-[#2d2926]">{u.lessons_done}</td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">
                        {new Date(u.joined).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Section 5 — Revenue */}
        <section>
          <SectionHeader emoji="💰" title="Revenue" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 sm:col-span-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-1">Est. Annual Revenue</p>
              <p className="text-4xl font-bold text-[#2d2926] leading-none">${data.estAnnualRevenue.toLocaleString()}</p>
              <p className="text-xs text-[#7a6f65] mt-2">Based on live Stripe active subscriptions</p>
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
