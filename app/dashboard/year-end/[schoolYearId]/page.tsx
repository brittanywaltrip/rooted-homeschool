"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type SchoolYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
};

type Profile = {
  first_name: string | null;
  last_name: string | null;
};

type MemoryCount = { type: string; count: number };
type Badge = { badge_type: string; tier: string; earned_at: string | null };

type SummaryData = {
  schoolYear: SchoolYear;
  profile: Profile;
  totalLessonsCompleted: number;
  totalLessonsPlanned: number;
  totalMinutes: number;
  memories: MemoryCount[];
  badges: Badge[];
};

const MEMORY_LABELS: Record<string, string> = {
  photo: "Photos",
  book: "Books Read",
  field_trip: "Field Trips",
  drawing: "Drawings",
  project: "Projects",
  win: "Wins",
  quote: "Quotes",
  activity: "Activities",
};

const BADGE_LABELS: Record<string, string> = {
  "deep-roots": "Deep Roots",
  "growth": "Growth",
  "memory-keeper": "Memory Keeper",
  "bookworm": "Bookworm",
  "rhythm": "Rhythm",
  "flame": "On Fire",
  "explorer": "Explorer",
};

const TIER_RANK: Record<string, number> = { gold: 3, silver: 2, bronze: 1 };

function badgeDisplayName(type: string): string {
  if (BADGE_LABELS[type]) return BADGE_LABELS[type];
  return type
    .split("-")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function formatRange(startISO: string, endISO: string) {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };
  return `${fmt(startISO)} – ${fmt(endISO)}`;
}

export default function YearEndSummaryPage() {
  const params = useParams<{ schoolYearId: string }>();
  const schoolYearId = params?.schoolYearId;
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!schoolYearId) return;
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          if (!cancelled) setError("Please sign in to view your summary.");
          return;
        }
        const res = await fetch(`/api/year-end-summary/${schoolYearId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setError(body.error || "Failed to load summary.");
          return;
        }
        const json: SummaryData = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load summary.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [schoolYearId, supabase]);

  const familyName = useMemo(() => {
    if (!data) return "";
    const first = data.profile.first_name?.trim() || "";
    const last = data.profile.last_name?.trim() || "";
    return `${first} ${last}`.trim();
  }, [data]);

  const completionRate = useMemo(() => {
    if (!data || data.totalLessonsPlanned === 0) return 0;
    return Math.round((data.totalLessonsCompleted / data.totalLessonsPlanned) * 100);
  }, [data]);

  const hoursLogged = useMemo(() => {
    if (!data) return "0.0";
    return (data.totalMinutes / 60).toFixed(1);
  }, [data]);

  const topBadges = useMemo(() => {
    if (!data) return [] as Badge[];
    const byType = new Map<string, Badge>();
    for (const b of data.badges) {
      const cur = byType.get(b.badge_type);
      const curRank = cur ? TIER_RANK[cur.tier] ?? 0 : -1;
      const newRank = TIER_RANK[b.tier] ?? 0;
      if (newRank > curRank) byType.set(b.badge_type, b);
    }
    return Array.from(byType.values());
  }, [data]);

  if (loading) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <p style={{ color: "var(--g-deep)" }}>Loading your year...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <p style={{ color: "var(--g-deep)" }}>{error || "No summary available."}</p>
      </div>
    );
  }

  return (
    <div className="print-page year-end-print-page" style={{ background: "#F8F7F4", minHeight: "100vh" }}>
      <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex justify-end mb-6">
            <button
              type="button"
              onClick={() => window.print()}
              className="no-print px-4 py-2 rounded-md text-white text-sm"
              style={{ background: "var(--g-brand)" }}
            >
              Download as PDF
            </button>
          </div>

          <section
            className="rounded-lg p-8 mb-8 text-white"
            style={{ background: "var(--g-deep)" }}
          >
            <img src="/rooted-logo-white.png" alt="Rooted" className="h-8 mb-6" />
            <h1 className="text-3xl mb-2" style={{ fontFamily: "Lora, serif", fontWeight: 500 }}>
              {data.schoolYear.name} School Year
            </h1>
            {familyName && (
              <p className="text-lg mb-1" style={{ fontWeight: 400 }}>
                {familyName} Family
              </p>
            )}
            <p className="text-sm opacity-90">
              {formatRange(data.schoolYear.start_date, data.schoolYear.end_date)}
            </p>
          </section>

          <section className="mb-8">
            <h2
              className="text-xl mb-4"
              style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}
            >
              Year at a glance
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-6 border" style={{ borderColor: "#e8e2d9" }}>
                <p className="text-sm" style={{ color: "#7a6f65" }}>Lessons Completed</p>
                <p className="text-2xl mt-2" style={{ color: "var(--g-deep)", fontWeight: 500 }}>
                  {data.totalLessonsCompleted} / {data.totalLessonsPlanned}
                </p>
              </div>
              <div className="bg-white rounded-lg p-6 border" style={{ borderColor: "#e8e2d9" }}>
                <p className="text-sm" style={{ color: "#7a6f65" }}>Completion Rate</p>
                <p className="text-2xl mt-2" style={{ color: "var(--g-deep)", fontWeight: 500 }}>
                  {completionRate}%
                </p>
              </div>
              <div className="bg-white rounded-lg p-6 border" style={{ borderColor: "#e8e2d9" }}>
                <p className="text-sm" style={{ color: "#7a6f65" }}>Hours Logged</p>
                <p className="text-2xl mt-2" style={{ color: "var(--g-deep)", fontWeight: 500 }}>
                  {hoursLogged}
                </p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2
              className="text-xl mb-4"
              style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}
            >
              Memories captured
            </h2>
            {data.memories.filter((m) => m.count > 0).length === 0 ? (
              <p className="text-sm" style={{ color: "#7a6f65" }}>
                No memories captured this year yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {data.memories
                  .filter((m) => m.count > 0)
                  .map((m) => (
                    <div
                      key={m.type}
                      className="bg-white rounded-lg p-4 border text-center"
                      style={{ borderColor: "#e8e2d9" }}
                    >
                      <p className="text-2xl" style={{ color: "var(--g-deep)", fontWeight: 500 }}>
                        {m.count}
                      </p>
                      <p className="text-sm mt-1" style={{ color: "#7a6f65" }}>
                        {MEMORY_LABELS[m.type] || m.type}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </section>

          <section className="mb-10">
            <h2
              className="text-xl mb-4"
              style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}
            >
              Badges earned
            </h2>
            {topBadges.length === 0 ? (
              <p className="text-sm" style={{ color: "#7a6f65" }}>
                Keep going. Badges are earned through consistent learning!
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {topBadges.map((b) => (
                  <div
                    key={b.badge_type}
                    className="bg-white rounded-lg p-4 border"
                    style={{ borderColor: "#e8e2d9" }}
                  >
                    <p style={{ color: "var(--g-deep)", fontWeight: 500 }}>
                      {badgeDisplayName(b.badge_type)}
                    </p>
                    <p className="text-sm mt-1 capitalize" style={{ color: "#7a6f65" }}>
                      {b.tier}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-10">
            <h2
              className="text-xl mb-4"
              style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}
            >
              Your records
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href="/dashboard/plan"
                className="bg-white rounded-lg p-4 border block"
                style={{ borderColor: "#e8e2d9", color: "var(--g-accent)" }}
              >
                <p style={{ fontWeight: 500 }}>📊 Progress Report</p>
                <p className="text-sm mt-1" style={{ color: "#7a6f65" }}>
                  Detailed lessons and hours by child
                </p>
              </Link>
              <Link
                href="/dashboard/transcript"
                className="bg-white rounded-lg p-4 border block"
                style={{ borderColor: "#e8e2d9", color: "var(--g-accent)" }}
              >
                <p style={{ fontWeight: 500 }}>🎓 Transcripts</p>
                <p className="text-sm mt-1" style={{ color: "#7a6f65" }}>
                  Courses, credits, and GPA
                </p>
              </Link>
            </div>
          </section>

          <section className="text-center py-8">
            <p
              className="text-base max-w-xl mx-auto"
              style={{ color: "#7a6f65", fontFamily: "Lora, serif", fontStyle: "italic" }}
            >
              Congratulations on completing your school year! We&apos;re so glad Rooted got to be part of it. We can&apos;t wait to see what next year brings for your family.
            </p>
          </section>
        </div>
      </div>
  );
}
