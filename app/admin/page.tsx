"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAIL = "garfieldbrittany@gmail.com";

interface AdminSummary {
  // Growth
  totalUsers: number;
  weekSignups: number;
  todaySignups: number;
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

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session || session.user.email !== ADMIN_EMAIL) {
        router.replace("/dashboard");
        return;
      }

      const res = await fetch("/api/admin/summary", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        setError("Failed to load admin data.");
        return;
      }

      const json = await res.json();
      setData(json);
    });
  }, [router]);

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
      <div className="bg-[#3d5c42] border-b border-[#4e7055] px-6 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8cba8e] mb-1">Rooted</p>
        <h1 className="text-2xl font-bold text-[#fefcf9]" style={{ fontFamily: "Georgia, serif" }}>
          Founder Dashboard 🌱
        </h1>
        <p className="text-sm text-[#a8c5a0] mt-1">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <div className="max-w-4xl mx-auto px-5 py-8 space-y-10">

        {/* Section 1 — Growth */}
        <section>
          <SectionHeader emoji="🌱" title="Growth" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total Families" value={data.totalUsers} />
            <StatCard label="New This Week" value={data.weekSignups} />
            <StatCard label="New Today" value={data.todaySignups} />
            <StatCard label="Paying Subscribers" value={data.proUsers} sub={`${data.foundingFamilies} founding · ${data.standardSubs} standard`} />
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

        {/* Section 4 — Recent Signups */}
        <section>
          <SectionHeader emoji="📋" title="Recent Signups" />
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead>
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
                  {data.recentSignups.map((u) => (
                    <tr key={u.id} className="hover:bg-[#f8f5f0] transition-colors">
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
                            ? "bg-[#fef9e8] text-[#7a4a1a] border border-[#f0dda8]"
                            : u.plan === "Standard"
                            ? "bg-[#e8f0e9] text-[#3d5c42] border border-[#b8d9bc]"
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
          </div>
        </section>

      </div>
    </div>
  );
}
