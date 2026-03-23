"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAIL = "hello.rootedapp@gmail.com";

// ─── Prices ───────────────────────────────────────────────────────────────────

const FOUNDING_PRICE = 39;
const STANDARD_PRICE = 59;

// ─── Types ────────────────────────────────────────────────────────────────────

type Stats = {
  totalUsers: number;
  freeUsers: number;
  proUsers: number;
  todaySignups: number;
  weekSignups: number;
  foundingFamilies: number;
  standardSubs: number;
  totalLessons: number;
  totalMemories: number;
  totalReports: number;
  recentSignups: { email: string; created_at: string; plan_type: string | null; is_pro: boolean }[];
  // Children
  totalChildren: number;
  avgChildrenPerUser: string;
  usersWith1Child: number;
  usersWith2Plus: number;
  mostCommonChildCount: number;
  // Engagement
  activeUsers: number;
  deadAccounts: number;
  avgLessonsPerActiveUser: string;
  lessonsThisWeek: number;
  lessonsLastWeek: number;
  // Retention
  newUsersWithLesson: number;
  churnedUsers: number;
  // Daily activity
  dailyActivity: { date: string; signups: number; lessons: number }[];
  // Upgrade candidates
  freeWith2PlusChildren: string[];
  freeWith10PlusLessons: string[];
  // Full user activity
  userActivity: {
    id: string;
    email: string;
    signed_up: string;
    plan: string;
    children_added: number;
    lessons_logged: number;
    memories_created: number;
    last_active: string | null;
    is_dead: boolean;
    is_new: boolean;
  }[];
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent,
}: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`bg-[#fefcf9] border rounded-2xl p-5 flex flex-col gap-1 ${accent ? "border-[#5c7f63] bg-[#f0f8f0]" : "border-[#e8e2d9]"}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">{label}</p>
      <p className={`text-3xl font-bold ${accent ? "text-[#3d5c42]" : "text-[#2d2926]"}`}>{value}</p>
      {sub && <p className="text-xs text-[#b5aca4]">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <h2 className="text-sm font-bold uppercase tracking-widest text-[#5c7f63]">{title}</h2>
      <span className="h-px flex-1 bg-[#e8e2d9]" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const router = useRouter();
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [token, setToken]     = useState("");

  const fetchStats = useCallback(async (accessToken: string) => {
    const res = await fetch("/api/admin/stats", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) { setError("Failed to load stats."); return; }
    setStats(await res.json());
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || session.user.email !== ADMIN_EMAIL) {
        router.replace("/dashboard");
        return;
      }
      setToken(session.access_token);
      await fetchStats(session.access_token);
      setLoading(false);
    })();
  }, [router, fetchStats]);

  async function deleteUser(userId: string, email: string) {
    if (!confirm(`Are you sure? This permanently deletes ${email} and all their data.`)) return;
    setDeletingId(userId);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setDeletingId(null);
    if (!res.ok) {
      alert("Delete failed. Check console.");
      return;
    }
    await fetchStats(token);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center">
        <span className="text-3xl animate-pulse">🌿</span>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center">
        <p className="text-sm text-red-600">{error || "Something went wrong."}</p>
      </div>
    );
  }

  // ── Revenue calculations ──────────────────────────────────────────────────

  const foundingARR = stats.foundingFamilies * FOUNDING_PRICE;
  const standardARR = stats.standardSubs    * STANDARD_PRICE;
  const totalARR    = foundingARR + standardARR;
  const mrr         = totalARR / 12;

  // ── Cost calculations (estimates) ────────────────────────────────────────

  const stripeFeesMonthly =
    stats.proUsers * ((mrr / Math.max(stats.proUsers, 1)) * 0.029 + 0.30);
  const estimatedMonthlyCost = stripeFeesMonthly; // Vercel + Supabase are free tier
  const inTheGreen = mrr >= estimatedMonthlyCost;

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  // ── Daily activity bar scale ──────────────────────────────────────────────
  const maxDailyLessons = Math.max(...stats.dailyActivity.map(d => d.lessons), 1);

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      {/* Header bar */}
      <div className="bg-[#fefcf9] border-b border-[#e8e2d9] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="text-xs text-[#7a6f65] hover:text-[#5c7f63] transition-colors">
            ← Settings
          </Link>
          <span className="text-[#e8e2d9]">·</span>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[#5c7f63] flex items-center justify-center text-xs">🌿</div>
            <span className="text-sm font-bold text-[#2d2926]">Admin Dashboard</span>
          </div>
        </div>
        <p className="text-xs text-[#b5aca4]">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-8 space-y-8">

        {/* ── Revenue banner ─────────────────────────────────────────── */}
        <div className={`rounded-2xl px-6 py-4 flex items-center gap-4 ${
          inTheGreen
            ? "bg-gradient-to-r from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc]"
            : "bg-gradient-to-r from-red-50 to-red-100 border border-red-200"
        }`}>
          <span className="text-3xl">{inTheGreen ? "🌿" : "🔴"}</span>
          <div>
            <p className={`text-lg font-bold ${inTheGreen ? "text-[#3d5c42]" : "text-red-700"}`}>
              {inTheGreen ? "IN THE GREEN 🌿" : "IN THE RED 🔴"}
            </p>
            <p className={`text-sm ${inTheGreen ? "text-[#5c7f63]" : "text-red-600"}`}>
              {fmt(mrr)}/mo revenue · ~{fmt(estimatedMonthlyCost)}/mo estimated costs
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-2xl font-bold text-[#2d2926]">{fmt(totalARR)}</p>
            <p className="text-xs text-[#7a6f65]">Annual Recurring Revenue</p>
          </div>
        </div>

        {/* ── Users ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="Users" />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total Users"    value={stats.totalUsers}    accent />
            <StatCard label="Free"           value={stats.freeUsers}     sub="no subscription" />
            <StatCard label="Paying"         value={stats.proUsers}      sub="active sub" accent={stats.proUsers > 0} />
            <StatCard label="New Today"      value={stats.todaySignups}  sub="signups today" />
            <StatCard label="New This Week"  value={stats.weekSignups}   sub="last 7 days" />
          </div>
        </div>

        {/* ── Revenue ────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="Revenue" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Founding Family"
              value={`${stats.foundingFamilies} × $${FOUNDING_PRICE}`}
              sub={`${fmt(foundingARR)}/yr`}
              accent={stats.foundingFamilies > 0}
            />
            <StatCard
              label="Standard"
              value={`${stats.standardSubs} × $${STANDARD_PRICE}`}
              sub={`${fmt(standardARR)}/yr`}
              accent={stats.standardSubs > 0}
            />
            <StatCard label="ARR"  value={fmt(totalARR)} sub="annual recurring" accent={totalARR > 0} />
            <StatCard label="MRR"  value={fmt(mrr)}       sub="ARR ÷ 12" accent={mrr > 0} />
          </div>
        </div>

        {/* ── Costs ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="Estimated Costs" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0ede8] bg-[#f8f5f0]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#7a6f65] uppercase tracking-wide">Service</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-[#7a6f65] uppercase tracking-wide">Monthly Cost</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#7a6f65] uppercase tracking-wide">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede8]">
                {[
                  { service: "Vercel",        cost: "$0.00",                         note: "Hobby plan — free" },
                  { service: "Supabase",      cost: "$0.00",                         note: "Free tier (under 50k users)" },
                  { service: "Anthropic API", cost: "variable",                      note: "⚠️ Check Anthropic console for actual usage" },
                  {
                    service: "Stripe Fees",
                    cost: fmt(stripeFeesMonthly),
                    note: `2.9% + $0.30/txn est. for ${stats.proUsers} subscriber${stats.proUsers !== 1 ? "s" : ""}`,
                  },
                ].map(({ service, cost, note }) => (
                  <tr key={service} className="hover:bg-[#faf8f5]">
                    <td className="px-5 py-3 font-medium text-[#2d2926]">{service}</td>
                    <td className="px-5 py-3 text-right font-mono text-[#2d2926]">{cost}</td>
                    <td className="px-5 py-3 text-xs text-[#7a6f65]">{note}</td>
                  </tr>
                ))}
                <tr className="bg-[#f0f8f0] font-bold">
                  <td className="px-5 py-3 text-[#3d5c42]">Total (excl. Anthropic)</td>
                  <td className="px-5 py-3 text-right font-mono text-[#3d5c42]">{fmt(stripeFeesMonthly)}</td>
                  <td className="px-5 py-3 text-xs text-[#7a6f65]">+ Anthropic variable costs</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── App Usage ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="App Usage" />
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Lessons Logged"      value={stats.totalLessons.toLocaleString()}   sub="completed lessons" accent />
            <StatCard label="Memories Created"    value={stats.totalMemories.toLocaleString()}  sub="photos, projects, books" />
            <StatCard label="Reports Generated"   value={stats.totalReports.toLocaleString()}   sub="app_events: report_generated" />
          </div>
        </div>

        {/* ── Children Insights ──────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="Children Insights" />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total Children"      value={stats.totalChildren}          accent />
            <StatCard label="Avg per User"        value={stats.avgChildrenPerUser}     sub="across all accounts" />
            <StatCard label="1 Child"             value={stats.usersWith1Child}        sub="users with exactly 1" />
            <StatCard label="2+ Children"         value={stats.usersWith2Plus}         sub="users with 2 or more" accent={stats.usersWith2Plus > 0} />
            <StatCard label="Most Common"         value={stats.mostCommonChildCount === 0 ? "—" : `${stats.mostCommonChildCount}`} sub="children count" />
          </div>
        </div>

        {/* ── Engagement ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="Engagement" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Active Users"        value={stats.activeUsers}               sub="logged 1+ lesson" accent={stats.activeUsers > 0} />
            <StatCard label="Dead Accounts"       value={stats.deadAccounts}              sub="never logged a lesson" />
            <StatCard label="Avg Lessons / User"  value={stats.avgLessonsPerActiveUser}   sub="active users only" accent />
            <StatCard label="This Week Lessons"   value={stats.lessonsThisWeek}           sub={`vs ${stats.lessonsLastWeek} last week`} accent={stats.lessonsThisWeek >= stats.lessonsLastWeek} />
          </div>
        </div>

        {/* ── Retention ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="Retention" />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#fefcf9] border border-[#5c7f63] bg-[#f0f8f0] rounded-2xl p-5 flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">New This Week → Active</p>
              <p className="text-3xl font-bold text-[#3d5c42]">{stats.newUsersWithLesson}</p>
              <p className="text-xs text-[#b5aca4]">signed up this week + logged a lesson</p>
            </div>
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">Churned (7+ days, 0 lessons)</p>
              <p className="text-3xl font-bold text-[#2d2926]">{stats.churnedUsers}</p>
              <p className="text-xs text-[#b5aca4]">signed up 7+ days ago, never logged</p>
            </div>
          </div>
        </div>

        {/* ── Daily Activity ─────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="Daily Activity — Last 7 Days" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0ede8] bg-[#f8f5f0]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#7a6f65] uppercase tracking-wide">Date</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-[#7a6f65] uppercase tracking-wide">Signups</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#7a6f65] uppercase tracking-wide w-full">Lessons Logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede8]">
                {stats.dailyActivity.map((day) => (
                  <tr key={day.date} className="hover:bg-[#faf8f5]">
                    <td className="px-5 py-3 font-medium text-[#2d2926] whitespace-nowrap">{day.date}</td>
                    <td className="px-5 py-3 text-right font-mono text-[#2d2926]">{day.signups}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-[#f0ede8] rounded-full h-2 min-w-[80px]">
                          <div
                            className="bg-[#5c7f63] h-2 rounded-full transition-all"
                            style={{ width: `${Math.round((day.lessons / maxDailyLessons) * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-[#2d2926] w-6 text-right">{day.lessons}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Upgrade Candidates ─────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="Upgrade Candidates" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Free with 2+ children */}
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#f0ede8] bg-[#f8f5f0] flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65]">Free Users — 2+ Children</p>
                <span className="text-xs font-bold text-[#3d5c42] bg-[#e8f0e9] px-2 py-0.5 rounded-full">
                  {stats.freeWith2PlusChildren.length}
                </span>
              </div>
              {stats.freeWith2PlusChildren.length === 0 ? (
                <p className="px-5 py-4 text-xs text-[#b5aca4]">None yet</p>
              ) : (
                <ul className="divide-y divide-[#f0ede8]">
                  {stats.freeWith2PlusChildren.map((email, i) => (
                    <li key={i} className="px-5 py-2.5 text-xs text-[#2d2926] font-medium">{email}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Free with 10+ lessons */}
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#f0ede8] bg-[#f8f5f0] flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65]">Free Users — 10+ Lessons</p>
                <span className="text-xs font-bold text-[#3d5c42] bg-[#e8f0e9] px-2 py-0.5 rounded-full">
                  {stats.freeWith10PlusLessons.length}
                </span>
              </div>
              {stats.freeWith10PlusLessons.length === 0 ? (
                <p className="px-5 py-4 text-xs text-[#b5aca4]">None yet</p>
              ) : (
                <ul className="divide-y divide-[#f0ede8]">
                  {stats.freeWith10PlusLessons.map((email, i) => (
                    <li key={i} className="px-5 py-2.5 text-xs text-[#2d2926] font-medium">{email}</li>
                  ))}
                </ul>
              )}
            </div>

          </div>
        </div>

        {/* ── User Activity ───────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader title="All Users" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-x-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-[#f0ede8] bg-[#f8f5f0]">
                  <th className="text-left px-4 py-3 font-semibold text-[#7a6f65] uppercase tracking-wide">Email</th>
                  <th className="text-left px-3 py-3 font-semibold text-[#7a6f65] uppercase tracking-wide">Signed Up</th>
                  <th className="text-left px-3 py-3 font-semibold text-[#7a6f65] uppercase tracking-wide">Plan</th>
                  <th className="text-right px-3 py-3 font-semibold text-[#7a6f65] uppercase tracking-wide">Kids</th>
                  <th className="text-right px-3 py-3 font-semibold text-[#7a6f65] uppercase tracking-wide">Lessons</th>
                  <th className="text-right px-3 py-3 font-semibold text-[#7a6f65] uppercase tracking-wide">Memories</th>
                  <th className="text-left px-3 py-3 font-semibold text-[#7a6f65] uppercase tracking-wide">Last Active</th>
                  <th className="text-left px-3 py-3 font-semibold text-[#7a6f65] uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede8]">
                {stats.userActivity.map((u) => {
                  const rowBg = u.is_dead
                    ? "bg-red-50/60"
                    : u.is_new
                    ? "bg-amber-50/60"
                    : u.lessons_logged > 0 || u.children_added > 0
                    ? "bg-[#f0faf0]/60"
                    : "";
                  return (
                    <tr key={u.id} className={`${rowBg} hover:brightness-95 transition-all`}>
                      <td className="px-4 py-2.5 font-medium text-[#2d2926] max-w-[200px] truncate">{u.email}</td>
                      <td className="px-3 py-2.5 text-[#7a6f65] whitespace-nowrap">
                        {new Date(u.signed_up).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                      </td>
                      <td className="px-3 py-2.5">
                        {u.plan === "founding" ? (
                          <span className="font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Founding</span>
                        ) : u.plan === "standard" ? (
                          <span className="font-bold bg-[#e8f0e9] text-[#3d5c42] px-1.5 py-0.5 rounded-full">Standard</span>
                        ) : (
                          <span className="text-[#b5aca4] px-1.5 py-0.5 rounded-full border border-[#e8e2d9]">Free</span>
                        )}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${u.children_added > 0 ? "text-[#3d5c42] font-bold" : "text-[#c8bfb5]"}`}>
                        {u.children_added}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${u.lessons_logged > 0 ? "text-[#3d5c42] font-bold" : "text-[#c8bfb5]"}`}>
                        {u.lessons_logged}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${u.memories_created > 0 ? "text-[#3d5c42]" : "text-[#c8bfb5]"}`}>
                        {u.memories_created}
                      </td>
                      <td className="px-3 py-2.5 text-[#7a6f65] whitespace-nowrap">
                        {u.last_active
                          ? new Date(u.last_active).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : <span className="text-[#c8bfb5]">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {u.is_dead ? (
                          <span className="text-red-400 font-semibold">Dead</span>
                        ) : u.is_new ? (
                          <span className="text-amber-600 font-semibold">New</span>
                        ) : (
                          <span className="text-[#5c7f63] font-semibold">Active</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Dead Accounts ───────────────────────────────────────────── */}
        {stats.userActivity.filter(u => u.is_dead).length > 0 && (
          <div className="space-y-3">
            <SectionHeader title="Dead Accounts — Cleanup" />
            <div className="bg-[#fefcf9] border border-red-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-red-50 bg-red-50/40">
                <p className="text-xs text-red-600 font-medium">
                  Signed up 7+ days ago with 0 lessons and 0 children. Safe to delete.
                </p>
              </div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[#f0ede8]">
                  {stats.userActivity.filter(u => u.is_dead).map((u) => (
                    <tr key={u.id} className="hover:bg-red-50/30">
                      <td className="px-5 py-3 font-medium text-[#2d2926]">{u.email}</td>
                      <td className="px-3 py-3 text-[#b5aca4]">
                        {new Date(u.signed_up).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => deleteUser(u.id, u.email)}
                          disabled={deletingId === u.id}
                          className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-[11px] font-semibold transition-colors"
                        >
                          {deletingId === u.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
