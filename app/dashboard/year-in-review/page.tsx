"use client";

import { useEffect, useState, useCallback } from "react";
import { Sparkles, Download, ArrowLeft, BookOpen, Clock, Star, Camera, FolderOpen, PenLine, Leaf } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import Link from "next/link";
import type { YearStats, YearReviewResponse } from "@/app/api/year-in-review/route";
import UpgradePrompt from "@/components/UpgradePrompt";

// ─── Types ────────────────────────────────────────────────────────────────────

type SubjectRow = { name: string; hours: number };

type LessonRow = {
  hours: number | null;
  subjects: { name: string } | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STAGE_EMOJIS: Record<string, string> = {
  Seed: "🌱",
  Sprout: "🌿",
  Sapling: "🌳",
  Growing: "🌲",
  Thriving: "🌟",
};

function leafStage(count: number) {
  if (count >= 100) return "Thriving";
  if (count >= 50)  return "Growing";
  if (count >= 25)  return "Sapling";
  if (count >= 10)  return "Sprout";
  return "Seed";
}

function StatCard({
  icon: Icon,
  color,
  bg,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  color: string;
  bg: string;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 flex flex-col gap-3 print:border-[#d0ccc8]">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        <Icon size={18} style={{ color }} strokeWidth={1.8} />
      </div>
      <div>
        <p className="text-2xl font-bold text-[#2d2926] leading-none">{value}</p>
        {sub && <p className="text-xs text-[#7a6f65] mt-0.5">{sub}</p>}
      </div>
      <p className="text-xs font-semibold text-[#7a6f65] uppercase tracking-widest">{label}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function YearInReviewPage() {
  const { effectiveUserId } = usePartner();
  const [isPro,      setIsPro]      = useState<boolean | null>(null);
  const [checkingPro, setCheckingPro] = useState(true);
  const [stats,     setStats]     = useState<YearStats | null>(null);
  const [review,    setReview]    = useState<YearReviewResponse | null>(null);
  const [loading,   setLoading]   = useState(true);   // data loading
  const [generating, setGenerating] = useState(false); // AI generating
  const [error,     setError]     = useState<string | null>(null);

  const year = new Date().getFullYear();

  useEffect(() => { document.title = "Year in Review \u00b7 Rooted"; }, []);

  // ── Pro check (before any data fetching) ───────────────────────────────────

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from("profiles")
      .select("is_pro")
      .eq("id", effectiveUserId)
      .single()
      .then(({ data }) => {
        setIsPro((data as { is_pro?: boolean } | null)?.is_pro ?? false);
        setCheckingPro(false);
      });
  }, [effectiveUserId]);

  // ── Fetch all data ───────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    if (!effectiveUserId || !isPro) return;

    const [
      { data: profile },
      { data: kids },
      { data: lessons },
      { data: bookEvents },
      { data: memoryEvents },
      { data: reflections },
    ] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", effectiveUserId).single(),
      supabase.from("children").select("id, name").eq("user_id", effectiveUserId).eq("archived", false),
      supabase
        .from("lessons")
        .select("hours, subjects(name)")
        .eq("user_id", effectiveUserId)
        .eq("completed", true),
      supabase
        .from("app_events")
        .select("id")
        .eq("user_id", effectiveUserId)
        .eq("type", "book_read"),
      supabase
        .from("app_events")
        .select("type, payload")
        .eq("user_id", effectiveUserId)
        .in("type", ["memory_photo", "memory_project", "memory_book"]),
      supabase
        .from("daily_reflections")
        .select("id")
        .eq("user_id", effectiveUserId),
    ]);

    const lessonRows = (lessons as unknown as LessonRow[]) ?? [];

    // Hours
    const totalHours = lessonRows.reduce((sum, l) => sum + (l.hours ?? 0), 0);

    // Subjects
    const subjectMap = new Map<string, number>();
    for (const l of lessonRows) {
      const name = l.subjects?.name;
      if (name) {
        subjectMap.set(name, (subjectMap.get(name) ?? 0) + (l.hours ?? 0));
      }
    }
    const subjectsCovered = Array.from(subjectMap.keys());
    const topSubjects: SubjectRow[] = Array.from(subjectMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, hours]) => ({ name, hours }));

    // Memory breakdown
    const photos    = (memoryEvents ?? []).filter((e) => e.type === "memory_photo").length;
    const projects  = (memoryEvents ?? []).filter((e) => e.type === "memory_project").length;
    const memBooks  = (memoryEvents ?? []).filter((e) => e.type === "memory_book").length;

    // Recent memory titles for AI context
    const recentMemoryTitles = (memoryEvents ?? [])
      .filter((e) => e.payload?.title)
      .slice(0, 12)
      .map((e) => e.payload.title as string);

    const built: YearStats = {
      familyName:        profile?.display_name ?? "",
      childrenNames:     (kids ?? []).map((c) => c.name),
      year,
      totalLessons:      lessonRows.length,
      totalHours,
      booksRead:         (bookEvents ?? []).length,
      subjectsCovered,
      photosUploaded:    photos,
      projectsCompleted: projects,
      memoryBooksLogged: memBooks,
      reflectionsWritten: (reflections ?? []).length,
      topSubjects,
      recentMemoryTitles,
    };

    setStats(built);
    setLoading(false);
  }, [effectiveUserId, isPro, year]);

  useEffect(() => { if (isPro) fetchStats(); }, [fetchStats, isPro]);

  // ── Generate review ──────────────────────────────────────────────────────────

  async function generate() {
    if (!stats) return;
    setGenerating(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setGenerating(false); return; }

      const res = await fetch("/api/year-in-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(stats),
      });

      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg ?? "Something went wrong");
      }

      const data: YearReviewResponse = await res.json();
      setReview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (checkingPro) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#e8e2d9] border-t-[#5c7f63]" />
      </div>
    );
  }

  if (!isPro) {
    return (
      <div className="max-w-3xl px-4 py-7 space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">Your Family&apos;s</p>
          <h1 className="text-2xl font-bold text-[#2d2926]">Year in Review ✨</h1>
        </div>
        <UpgradePrompt
          inline
          feature="AI Year in Review"
          valueProp="Get a beautiful AI-written summary of your family's entire homeschool year — lessons, books, milestones, and memories."
        />
      </div>
    );
  }

  const totalLeaves = stats
    ? stats.totalLessons + stats.booksRead
    : 0;

  return (
    <div className="max-w-3xl px-4 py-7 space-y-8 print:max-w-none print:px-8 print:py-6 print:space-y-6">

      {/* Back link — hidden in print */}
      <div className="no-print">
        <Link
          href="/dashboard/memories"
          className="inline-flex items-center gap-1.5 text-sm text-[#7a6f65] hover:text-[#2d2926] transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Memories
        </Link>
      </div>

      {/* Header */}
      <div className="text-center space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">
          {stats?.familyName || "Your Family"}
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#2d2926]">
          {year} Year in Review 🌿
        </h1>
        <p className="text-[#7a6f65] text-sm max-w-md mx-auto">
          A celebration of everything your family learned, created, and experienced this year.
        </p>
      </div>

      {/* ── Stats Grid ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-[#f0ede8] rounded-2xl p-5 h-28 animate-pulse" />
          ))}
        </div>
      ) : stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard
            icon={Leaf}   color="#5c7f63" bg="#e8f0e9"
            label="Lessons Completed" value={stats.totalLessons}
            sub={`${STAGE_EMOJIS[leafStage(totalLeaves)]} ${leafStage(totalLeaves)}`}
          />
          <StatCard
            icon={Clock}  color="#4a7a8a" bg="#e0f0f4"
            label="Hours Logged" value={stats.totalHours.toFixed(1)}
            sub="hours of learning"
          />
          <StatCard
            icon={BookOpen} color="#8b6f47" bg="#f5ede0"
            label="Books Read" value={stats.booksRead}
            sub={stats.booksRead === 1 ? "book this year" : "books this year"}
          />
          <StatCard
            icon={Star}   color="#d4874e" bg="#fdf0e0"
            label="Subjects Explored" value={stats.subjectsCovered.length}
            sub={stats.subjectsCovered.slice(0, 2).join(", ") || undefined}
          />
          <StatCard
            icon={Camera} color="#7a60a8" bg="#f0edf8"
            label="Photos Captured" value={stats.photosUploaded}
            sub={stats.projectsCompleted > 0 ? `${stats.projectsCompleted} projects` : undefined}
          />
          <StatCard
            icon={PenLine} color="#5c7f63" bg="#e8f0e9"
            label="Reflections Written" value={stats.reflectionsWritten}
            sub="days of reflection"
          />
        </div>
      )}

      {/* ── Subject Breakdown (if subjects exist) ──────────────────────────── */}
      {!loading && stats && stats.topSubjects.length > 0 && (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">
            Top Subjects This Year
          </p>
          <div className="space-y-2.5">
            {stats.topSubjects.map((s) => {
              const pct = stats.totalHours > 0 ? (s.hours / stats.totalHours) * 100 : 0;
              return (
                <div key={s.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-[#2d2926]">{s.name}</span>
                    <span className="text-[#7a6f65]">{s.hours.toFixed(1)} hrs</span>
                  </div>
                  <div className="h-2 bg-[#f0ede8] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#5c7f63] rounded-full transition-all duration-700"
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Generate / AI Review Section ──────────────────────────────────── */}
      {!review && !loading && (
        <div className="bg-gradient-to-br from-[#e8f0e9] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-6 text-center space-y-4 no-print">
          <div className="w-14 h-14 rounded-2xl bg-[#5c7f63] flex items-center justify-center mx-auto">
            <Sparkles size={24} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#2d2926] mb-1">
              Generate Your {year} Story
            </h2>
            <p className="text-sm text-[#5c6e5d] max-w-sm mx-auto leading-relaxed">
              Our AI will read your family&apos;s data and write a beautiful, personal narrative of
              your homeschool year — something you&apos;ll want to print and save forever.
            </p>
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}
          <button
            onClick={generate}
            disabled={generating || !stats}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white font-semibold text-sm transition-colors shadow-sm"
          >
            {generating ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Writing your story…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate My Year in Review
              </>
            )}
          </button>
          {generating && (
            <p className="text-xs text-[#5c6e5d] animate-pulse">
              Our AI is reading your family&apos;s whole year… this takes about 10 seconds.
            </p>
          )}
        </div>
      )}

      {/* ── AI Output ──────────────────────────────────────────────────────── */}
      {review && stats && (
        <div className="space-y-6">

          {/* Decorative header for print */}
          <div className="print-only hidden print:block text-center pb-4 border-b border-[#e8e2d9]">
            <p className="text-xs uppercase tracking-widest text-[#7a6f65]">
              {stats.familyName || "Our Family"}
            </p>
            <h2 className="text-2xl font-bold text-[#2d2926] mt-1">{year} Year in Review</h2>
          </div>

          {/* Narrative */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 sm:p-8 print:border-[#d0ccc8] print:shadow-none relative overflow-hidden">
            {/* Decorative leaf — screen only */}
            <div className="absolute top-4 right-4 text-4xl opacity-10 select-none no-print">🌿</div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-4">
              Your Year in Words
            </p>
            <div className="space-y-4">
              {review.narrative.split("\n\n").filter(Boolean).map((para, i) => (
                <p
                  key={i}
                  className="text-[#2d2926] leading-relaxed text-[15px] sm:text-base"
                  style={{ fontStyle: i === 0 ? "italic" : "normal" }}
                >
                  {i === 0 && (
                    <span className="text-[#5c7f63] font-bold text-xl leading-none mr-1 float-left mt-0.5">❝</span>
                  )}
                  {para}
                </p>
              ))}
            </div>
            <p className="text-[#b5aca4] text-xs mt-6 text-right">
              — {stats.familyName || "Your Family"}, {year}
            </p>
          </div>

          {/* Highlights */}
          <div className="bg-gradient-to-br from-[#fdf8f0] to-[#f8f4ec] border border-[#ede5d8] rounded-2xl p-6 print:border-[#d0ccc8]">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-4">
              This Year&apos;s Highlights
            </p>
            <div className="space-y-3">
              {review.highlights.map((h, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#5c7f63] flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-white text-[10px] font-bold">{i + 1}</span>
                  </div>
                  <p className="text-sm text-[#2d2926] leading-snug pt-0.5">{h}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Children section (if multiple) */}
          {stats.childrenNames.length > 0 && (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 print:border-[#d0ccc8]">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-4">
                Our Learners
              </p>
              <div className="flex flex-wrap gap-3">
                {stats.childrenNames.map((name, i) => {
                  const colors = ["#5c7f63", "#8b6f47", "#4a7a8a", "#7a60a8", "#d4874e"];
                  const c = colors[i % colors.length];
                  return (
                    <div
                      key={name}
                      className="flex items-center gap-2.5 bg-white border border-[#e8e2d9] rounded-full px-4 py-2"
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: c }}
                      >
                        {name[0].toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-[#2d2926]">{name}</span>
                      <span className="text-xs text-[#7a6f65]">{year}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer for print */}
          <div className="hidden print:block text-center pt-4 border-t border-[#e8e2d9]">
            <p className="text-xs text-[#b5aca4]">
              Generated with Rooted · rootedhomeschoolapp.com · {year}
            </p>
          </div>

          {/* Action row — screen only */}
          <div className="flex flex-col sm:flex-row gap-3 no-print pb-4">
            <button
              onClick={() => window.print()}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white font-semibold text-sm transition-colors shadow-sm"
            >
              <Download size={16} />
              Save as PDF / Print
            </button>
            <button
              onClick={() => setReview(null)}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-[#e8e2d9] text-[#7a6f65] hover:bg-[#f0ede8] font-medium text-sm transition-colors"
            >
              <Sparkles size={14} />
              Regenerate
            </button>
          </div>
        </div>
      )}

      <div className="h-4 no-print" />
    </div>
  );
}
