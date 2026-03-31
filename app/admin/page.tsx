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
  const [signupFilter, setSignupFilter] = useState<"All" | "Founding" | "Standard" | "Monthly" | "Free" | "Refunded" | "Partner">("All");
  const [refreshing,   setRefreshing]   = useState(false);
  const [emailsCopied, setEmailsCopied] = useState(false);
  const [hideTestUsers, setHideTestUsers] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [showTestSection, setShowTestSection] = useState(false);
  const [affiliates, setAffiliates] = useState<{ id: string; name: string; code: string; stripe_coupon_id: string; is_active: boolean; created_at: string; profiles: { display_name: string | null; first_name: string | null; last_name: string | null } | null }[]>([]);
  const [foundingByDay, setFoundingByDay] = useState<{ date: string; count: number }[]>([]);
  const [partnerApps, setPartnerApps] = useState<{ id: string; first_name: string; last_name: string; email: string; platforms: string[]; platform_sizes: Record<string, string>; used_rooted: string; status: string; created_at: string; about_journey: string }[]>([]);
  const [appFilter, setAppFilter] = useState<"pending" | "approved" | "declined">("pending");
  const [appProcessing, setAppProcessing] = useState<string | null>(null);

  // Memory stats
  const [memStats, setMemStats] = useState<{
    total: number;
    today: number;
    thisWeek: number;
    byType: { type: string; count: number }[];
    topLoggers: { name: string; count: number }[];
  } | null>(null);

  // 7-day activity chart
  const [activityChart, setActivityChart] = useState<{ day: string; label: string; count: number }[]>([]);

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

  // Testimonial request
  const [sendingTestimonial, setSendingTestimonial] = useState(false);
  const [testimonialResult, setTestimonialResult] = useState<{ sent: number; errors: string[]; notFound: string[] } | null>(null);

  // Weekly summary
  const [sendingWeekly, setSendingWeekly] = useState(false);
  const [weeklySent, setWeeklySent] = useState(false);
  const [weeklyResult, setWeeklyResult] = useState<string | null>(null);

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

    // Load affiliates
    const { data: affRows } = await supabase
      .from("affiliates")
      .select("id, name, code, stripe_coupon_id, is_active, created_at, profiles(display_name, first_name, last_name)")
      .order("created_at", { ascending: false });
    if (affRows) setAffiliates(affRows as unknown as typeof affiliates);

    // Load partner applications
    const { data: appRows } = await supabase
      .from("partner_apps")
      .select("id, first_name, last_name, email, platforms, platform_sizes, used_rooted, status, created_at, about_journey")
      .order("created_at", { ascending: false });
    if (appRows) setPartnerApps(appRows as unknown as typeof partnerApps);

    // Founding members by day — last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const { data: foundingRows } = await supabase
      .from("profiles")
      .select("created_at")
      .eq("plan_type", "founding_family")
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: false });
    if (foundingRows) {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        counts[d.toISOString().split("T")[0]] = 0;
      }
      foundingRows.forEach((r) => {
        const day = (r as { created_at: string }).created_at.split("T")[0];
        if (counts[day] !== undefined) counts[day]++;
      });
      setFoundingByDay(
        Object.entries(counts)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([date, count]) => ({ date, count }))
      );
    }

    // ── Memory stats ─────────────────────────────────────
    const todayStr = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().split("T")[0];

    const [
      { data: memTotalData },
      { data: memTodayData },
      { data: memWeekData },
      { data: memByType },
    ] = await Promise.all([
      supabase.from("memories").select("id"),
      supabase.from("memories").select("id").gte("created_at", todayStr + "T00:00:00"),
      supabase.from("memories").select("id").gte("created_at", weekStr + "T00:00:00"),
      supabase.from("memories").select("type"),
    ]);
    const memTotal = memTotalData?.length ?? 0;
    const memToday = memTodayData?.length ?? 0;
    const memWeek = memWeekData?.length ?? 0;

    const typeCounts: Record<string, number> = {};
    (memByType ?? []).forEach((r: { type: string }) => {
      typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1;
    });
    const byTypeArr = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Top 5 memory loggers
    const { data: allMems } = await supabase.from("memories").select("user_id");
    const userMemCounts: Record<string, number> = {};
    (allMems ?? []).forEach((m: { user_id: string }) => {
      userMemCounts[m.user_id] = (userMemCounts[m.user_id] ?? 0) + 1;
    });
    const topUserIds = Object.entries(userMemCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    const topLoggers: { name: string; count: number }[] = [];
    for (const [uid, cnt] of topUserIds) {
      const { data: p } = await supabase.from("profiles").select("display_name, first_name").eq("id", uid).single();
      topLoggers.push({ name: (p as { display_name?: string; first_name?: string } | null)?.display_name || (p as { first_name?: string } | null)?.first_name || uid.slice(0, 8), count: cnt });
    }

    setMemStats({ total: memTotal, today: memToday, thisWeek: memWeek, byType: byTypeArr, topLoggers });

    // ── 7-day activity chart ──────────────────────────────
    const chartDays: { day: string; label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split("T")[0];
      const dayStart = ds + "T00:00:00";
      const dayEnd = ds + "T23:59:59";
      const [{ data: memUsers }, { data: lessonUsers }] = await Promise.all([
        supabase.from("memories").select("user_id").gte("created_at", dayStart).lte("created_at", dayEnd),
        supabase.from("lessons").select("user_id").eq("completed", true).gte("scheduled_date", ds).lte("scheduled_date", ds),
      ]);
      const uniq = new Set([
        ...(memUsers ?? []).map((r: { user_id: string }) => r.user_id),
        ...(lessonUsers ?? []).map((r: { user_id: string }) => r.user_id),
      ]);
      chartDays.push({ day: ds, label: d.toLocaleDateString("en-US", { weekday: "short" }), count: uniq.size });
    }
    setActivityChart(chartDays);

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
    const { data: reCountData } = await supabase
      .from("profiles")
      .select("id")
      .or("re_engagement_sent.eq.false,re_engagement_sent.is.null")
      .lte("created_at", threeDaysAgo.toISOString());
    // Filter to only those with 0 memories — approximate with userMemCounts
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
    Partner:  realUsers.filter(u => u.plan === "Partner").length,
  };

  return (
    <div className="min-h-screen bg-[#2d3e30]">

      {/* ── Sticky Header ──────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-[#3d5c42] border-b border-[#4e7055] px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-xs text-[#a8c5a0] hover:text-[#fefcf9] transition-colors">
            ← Back to app
          </Link>
          <h1 className="text-xl font-bold text-[#fefcf9]" style={{ fontFamily: "var(--font-display)" }}>
            Founder Dashboard 🌱
          </h1>
          <p className="text-xs text-[#a8c5a0]">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
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
            <StatCard label="Today"                value={data.last24hSignups} />
            <StatCard label="Yesterday"            value={data.yesterdaySignups} />
            <StatCard label="Paying Customers"     value={data.payingFoundingCount + data.stripeStandardCount}
              sub={`${data.payingFoundingCount} founding · ${data.stripeStandardCount} standard · live from Stripe`} />
            <StatCard label="Rooted Partners"      value={data.activeAffiliateCount}
              sub="Comped affiliates" />
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

        {/* Section 3b — Memory Stats */}
        {memStats && (
          <section>
            <SectionHeader emoji="📸" title="Memories" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <StatCard label="Total Memories" value={memStats.total.toLocaleString()} />
              <StatCard label="Today" value={memStats.today} />
              <StatCard label="This Week" value={memStats.thisWeek} />
            </div>
            {memStats.byType.length > 0 && (
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">By Type</p>
                <div className="space-y-2">
                  {memStats.byType.map(({ type, count }) => {
                    const pct = memStats.total > 0 ? Math.round((count / memStats.total) * 100) : 0;
                    return (
                      <div key={type} className="flex items-center gap-3">
                        <p className="text-sm text-[#2d2926] w-24 shrink-0 capitalize">{type.replace("_", " ")}</p>
                        <div className="flex-1 bg-[#f0ede8] rounded-full h-2 overflow-hidden">
                          <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-sm text-[#2d2926] w-10 text-right shrink-0">{count}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {memStats.topLoggers.length > 0 && (
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">Top 5 Memory Loggers</p>
                <div className="space-y-2">
                  {memStats.topLoggers.map((u, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-[#2d2926]">{i + 1}. {u.name}</span>
                      <span className="text-[#5c7f63] font-semibold">{u.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Section 3c — 7-Day Activity */}
        {activityChart.length > 0 && (
          <section>
            <SectionHeader emoji="📊" title="7-Day Active Users" />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <div className="flex items-end justify-between gap-2" style={{ height: 140 }}>
                {(() => {
                  const maxCount = Math.max(...activityChart.map((d) => d.count), 1);
                  return activityChart.map((d) => {
                    const h = Math.round((d.count / maxCount) * 100);
                    return (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-xs font-semibold text-[#2d2926]">{d.count}</span>
                        <div className="w-full max-w-[32px] rounded-t-lg transition-all" style={{ height: `${Math.max(h, 4)}%`, backgroundColor: "#5c7f63" }} />
                        <span className="text-[10px] text-[#7a6f65]">{d.label}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </section>
        )}

        {/* Section 3d — Near Freemium Gate */}
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

        {/* Section 3e — Re-engagement */}
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
                className="px-4 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {sendingReengage ? "Sending…" : `Send re-engagement emails → (${reengageCount})`}
              </button>
            )}
          </div>
        </section>

        {/* Section — Affiliate Payouts */}
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
                className="px-4 py-2 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-medium transition-colors"
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

        {/* Section 3f — Testimonial Requests */}
        <section>
          <SectionHeader emoji="💬" title="Testimonial Requests" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
            <p className="text-sm text-[#7a6f65] mb-3">
              Send a personal email to 5 Founding Members asking for a 1-2 sentence quote about Rooted.
            </p>
            <p className="text-xs text-[#b5aca4] mb-3">
              Amanda Deardorff, Amber Hudson Slaughter, Donna Ward, Lacie Hawkins, Joselyn Minchey
            </p>
            {testimonialResult ? (
              <div className="space-y-1">
                <p className="text-sm text-[#5c7f63] font-medium">
                  Sent {testimonialResult.sent} testimonial request{testimonialResult.sent !== 1 ? "s" : ""}!
                </p>
                {testimonialResult.notFound.length > 0 && (
                  <p className="text-xs text-[#b5aca4]">Not found: {testimonialResult.notFound.join(", ")}</p>
                )}
                {testimonialResult.errors.length > 0 && (
                  <p className="text-xs text-red-400">Errors: {testimonialResult.errors.join(", ")}</p>
                )}
              </div>
            ) : (
              <button
                onClick={async () => {
                  setSendingTestimonial(true);
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const res = await fetch("/api/admin/testimonial-request", {
                      method: "POST",
                      headers: { Authorization: `Bearer ${session?.access_token}` },
                    });
                    const json = await res.json();
                    if (res.ok) {
                      setTestimonialResult({ sent: json.sent, errors: json.errors ?? [], notFound: json.notFound ?? [] });
                    } else {
                      setTestimonialResult({ sent: 0, errors: [json.error ?? "Unknown error"], notFound: json.notFound ?? [] });
                    }
                  } catch {
                    setTestimonialResult({ sent: 0, errors: ["Network error"], notFound: [] });
                  }
                  setSendingTestimonial(false);
                }}
                disabled={sendingTestimonial}
                className="px-4 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {sendingTestimonial ? "Sending…" : "Request testimonials →"}
              </button>
            )}
          </div>
        </section>

        {/* Section 3g — Weekly Summary */}
        <section>
          <SectionHeader emoji="📧" title="Weekly Summary" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
            <p className="text-sm text-[#2d2926] mb-3">
              Send a test weekly summary email to garfieldbrittany@gmail.com
            </p>
            {weeklySent ? (
              <p className="text-sm text-[#5c7f63] font-medium">{weeklyResult ?? "Test email sent!"}</p>
            ) : (
              <button
                onClick={async () => {
                  setSendingWeekly(true);
                  try {
                    const res = await fetch("/api/cron/weekly-summary?test=true", { method: "POST" });
                    const json = await res.json();
                    setWeeklyResult(`Sent ${json.sent} test email (${json.totalUsers} active users total)`);
                    setWeeklySent(true);
                  } catch { /* ignore */ }
                  setSendingWeekly(false);
                }}
                disabled={sendingWeekly}
                className="px-4 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {sendingWeekly ? "Sending…" : "Send weekly summary now →"}
              </button>
            )}
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
            {(["All", "Founding", "Standard", "Monthly", "Partner", "Free", "Refunded"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSignupFilter(tab)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  signupFilter === tab
                    ? tab === "Founding"
                      ? "bg-amber-100 text-amber-800 border-amber-300"
                      : tab === "Standard" || tab === "Monthly"
                      ? "bg-blue-100 text-blue-800 border-blue-300"
                      : tab === "Partner"
                      ? "bg-indigo-100 text-indigo-800 border-indigo-300"
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
              value={data.payingFoundingCount}
              sub={`$${(data.payingFoundingCount * 39).toLocaleString()} · $39/yr each`}
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

        {/* ── Founding Members by Day ─────────────────────────────────── */}
        {foundingByDay.length > 0 && (
          <section>
            <SectionHeader emoji="📈" title="Founding Members by Day" />
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-[#7a6f65]">Last 7 days</p>
                <p className="text-sm font-semibold text-[#2d2926]">
                  This week: {foundingByDay.reduce((sum, d) => sum + d.count, 0)}
                </p>
              </div>
              <div className="space-y-2">
                {foundingByDay.map(({ date, count }) => {
                  const maxCount = Math.max(...foundingByDay.map(d => d.count), 1);
                  const label = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                    weekday: "short", month: "short", day: "numeric",
                  });
                  return (
                    <div key={date} className="flex items-center gap-3">
                      <span className="text-xs text-[#7a6f65] w-24 shrink-0">{label}</span>
                      <div className="flex-1 h-5 bg-[#f0ede8] rounded-full overflow-hidden">
                        {count > 0 && (
                          <div
                            className="h-full bg-[#5c7f63] rounded-full transition-all"
                            style={{ width: `${Math.max((count / maxCount) * 100, 8)}%` }}
                          />
                        )}
                      </div>
                      <span className={`text-sm font-semibold w-6 text-right ${count > 0 ? "text-[#2d2926]" : "text-[#d4d0c8]"}`}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── Affiliates / Ambassadors ────────────────────────────────── */}
        {affiliates.length > 0 && (
          <section>
            <SectionHeader emoji="🤝" title="Ambassadors" />
            <div className="space-y-3">
              {affiliates.map((aff) => {
                const displayName = aff.profiles?.first_name
                  ? [aff.profiles.first_name, aff.profiles.last_name].filter(Boolean).join(" ")
                  : aff.profiles?.display_name ?? aff.name;
                return (
                  <div key={aff.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-[#2d2926]">{displayName}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${aff.is_active ? 'bg-green-100 text-green-800' : 'bg-[#f0ede8] text-[#7a6f65]'}`}>
                        {aff.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-sm font-mono text-[#4338ca] font-bold tracking-wider mb-1">{aff.code}</p>
                    <p className="text-xs text-[#7a6f65]">
                      Partner since {new Date(aff.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                    <a
                      href={`https://dashboard.stripe.com/coupons/${aff.stripe_coupon_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 text-xs text-[#4338ca] hover:underline"
                    >
                      View coupon in Stripe →
                    </a>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Affiliate Applications ─────────────────────────── */}
        <section>
          <SectionHeader emoji={"\uD83E\uDD1D"} title={`Affiliate Applications (${partnerApps.filter(a => a.status === "pending").length} pending)`} />

          <div className="flex gap-1.5 mb-4">
            {(["pending", "approved", "declined"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setAppFilter(s)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  appFilter === s ? "bg-[#3d5c42] text-white" : "bg-white text-[#7a6f65] border border-[#e8e2d9]"
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)} ({partnerApps.filter(a => a.status === s).length})
              </button>
            ))}
          </div>

          {partnerApps.filter(a => a.status === appFilter).length === 0 ? (
            <p className="text-sm text-[#b5aca4] text-center py-6">No {appFilter} applications</p>
          ) : (
            <div className="space-y-3">
              {partnerApps.filter(a => a.status === appFilter).map((app) => (
                <div key={app.id} className="bg-white border border-[#e8e2d9] rounded-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#2d2926]">{app.first_name} {app.last_name}</p>
                      <p className="text-xs text-[#7a6f65]">{app.email}</p>
                    </div>
                    <span className="text-[10px] text-[#b5aca4]">
                      {new Date(app.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {(app.platforms ?? []).map((p) => (
                      <span key={p} className="text-[10px] bg-[#f0ede8] text-[#5c5248] px-2 py-0.5 rounded-full">
                        {p} {app.platform_sizes?.[p] ? `(${app.platform_sizes[p]})` : ""}
                      </span>
                    ))}
                  </div>

                  {app.used_rooted && (
                    <p className="text-xs text-[#7a6f65]"><span className="font-medium">Used Rooted:</span> {app.used_rooted}</p>
                  )}

                  {app.about_journey && (
                    <p className="text-xs text-[#5c5248] leading-relaxed line-clamp-3">{app.about_journey}</p>
                  )}

                  {appFilter === "pending" && (
                    <div className="flex gap-2 pt-1">
                      <button
                        disabled={appProcessing === app.id}
                        onClick={async () => {
                          setAppProcessing(app.id);
                          await supabase.from("partner_apps").update({ status: "approved" }).eq("id", app.id);
                          setPartnerApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: "approved" } : a));
                          setAppProcessing(null);
                        }}
                        className="flex-1 py-2 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                      >
                        {appProcessing === app.id ? "..." : "Approve \u2192"}
                      </button>
                      <button
                        disabled={appProcessing === app.id}
                        onClick={async () => {
                          setAppProcessing(app.id);
                          await supabase.from("partner_apps").update({ status: "declined" }).eq("id", app.id);
                          setPartnerApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: "declined" } : a));
                          setAppProcessing(null);
                        }}
                        className="px-4 py-2 rounded-xl border border-[#e8e2d9] text-xs font-medium text-[#7a6f65] hover:bg-[#f0ede8] disabled:opacity-40 transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
