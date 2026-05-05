"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Photo = {
  id: string;
  photo_url: string | null;
  title: string | null;
  caption: string | null;
  date: string | null;
};

type CurriculumGoalLite = {
  id: string;
  subject_label: string | null;
  curriculum_name: string | null;
  icon_emoji: string | null;
};

type FamilyStats = {
  total_reactions: number;
  total_comments: number;
  most_loved_memory: {
    id: string;
    photo_url: string | null;
    type: string;
    title: string | null;
    reaction_count: number;
  } | null;
  top_comment: {
    body: string;
    commenter_name: string;
    created_at: string | null;
  } | null;
};

type SummaryData = {
  schoolYear: SchoolYear;
  profile: Profile;
  totalLessonsCompleted: number;
  totalLessonsPlanned: number;
  totalMinutes: number;
  memories: MemoryCount[];
  badges: Badge[];
  photos?: Photo[];
  curriculumGoals?: CurriculumGoalLite[];
  familyStats?: FamilyStats;
};

const MEMORY_CHIP: Record<string, { emoji: string; label: string }> = {
  photo: { emoji: "📷", label: "Photos" },
  win: { emoji: "🏆", label: "Wins" },
  book: { emoji: "📚", label: "Books Read" },
  field_trip: { emoji: "🗺️", label: "Field Trips" },
  project: { emoji: "🔨", label: "Projects" },
  quote: { emoji: "💬", label: "Quotes" },
  drawing: { emoji: "🎨", label: "Drawings" },
  activity: { emoji: "⚡", label: "Activities" },
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

const BADGE_INFO: Record<string, { emoji: string; description: string }> = {
  "On Fire":       { emoji: "🔥", description: "Showed up consistently, day after day" },
  "Memory Keeper": { emoji: "📸", description: "Captured the moments that matter most" },
  "Rhythm":        { emoji: "🎵", description: "Found a school flow and kept it going" },
  "Deep Roots":    { emoji: "🌱", description: "Went deep on a subject all year long" },
  "Growth":        { emoji: "📈", description: "Made measurable progress start to finish" },
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
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
  };
  return `${fmt(startISO)} – ${fmt(endISO)}`;
}

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2";
const CHIP = "bg-[#f0f4f1] text-[#2D5A3D] rounded-full px-3 py-1 text-sm font-medium";

const PRINT_CSS = `
@media print {
  nav, aside, [data-sidebar], .no-print { display: none !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  img { page-break-inside: avoid; }
  body { background: white !important; }
}
`;

export default function YearEndSummaryPage() {
  const params = useParams<{ schoolYearId: string }>();
  const schoolYearId = params?.schoolYearId;
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rename year state
  const [editingName, setEditingName] = useState(false);
  const [yearName, setYearName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        if (!cancelled) {
          setData(json);
          setYearName(json.schoolYear.name);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load summary.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [schoolYearId, supabase]);

  useEffect(() => {
    if (editingName) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingName]);

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  const familyFirstName = useMemo(() => {
    if (!data) return "";
    return data.profile.first_name?.trim() || "";
  }, [data]);

  const hoursLogged = useMemo(() => {
    if (!data) return "0.0";
    return (data.totalMinutes / 60).toFixed(1);
  }, [data]);

  const memoriesTotal = useMemo(() => {
    if (!data) return 0;
    return data.memories.reduce((sum, m) => sum + (m.count ?? 0), 0);
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

  async function saveYearName() {
    if (!schoolYearId) { setEditingName(false); return; }
    const trimmed = yearName.trim();
    if (!trimmed || (data && trimmed === data.schoolYear.name)) {
      setEditingName(false);
      if (data && !trimmed) setYearName(data.schoolYear.name);
      return;
    }
    const { error: upErr } = await supabase
      .from("school_years")
      .update({ name: trimmed })
      .eq("id", schoolYearId);
    setEditingName(false);
    if (!upErr) {
      setData((prev) => prev ? { ...prev, schoolYear: { ...prev.schoolYear, name: trimmed } } : prev);
      setSavedFlash(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedFlash(false), 2000);
    }
  }

  if (loading) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <p style={{ color: "#1a2c22" }}>Loading your year…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <p style={{ color: "#1a2c22" }}>{error || "No summary available."}</p>
      </div>
    );
  }

  const photos = data.photos ?? [];
  const curriculumGoals = data.curriculumGoals ?? [];
  const familyStats = data.familyStats;
  const memoryChips = data.memories.filter((m) => m.count > 0);

  return (
    <div className="print-page year-end-print-page" style={{ background: "#F8F7F4", minHeight: "100vh" }}>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <section className="bg-[#2D5A3D] rounded-b-[24px] py-16 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-3">
              Your School Year
            </p>
            {editingName ? (
              <input
                ref={renameInputRef}
                type="text"
                value={yearName}
                onChange={(e) => setYearName(e.target.value)}
                onBlur={saveYearName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); saveYearName(); }
                  if (e.key === "Escape") { setYearName(data.schoolYear.name); setEditingName(false); }
                }}
                className="text-4xl md:text-5xl bg-transparent border-b border-[#8B7E74] text-[#F8F7F4] outline-none focus:border-[#F8F7F4] mb-2 w-full"
                style={{ fontFamily: "Georgia, serif" }}
              />
            ) : (
              <h1
                className="text-4xl md:text-5xl text-[#F8F7F4] mb-2"
                style={{ fontFamily: "Georgia, serif" }}
              >
                {data.schoolYear.name}
              </h1>
            )}
            {savedFlash && (
              <p className="text-sm mb-2" style={{ color: "#9bd1a4" }}>Saved ✓</p>
            )}
            {familyFirstName && (
              <p className="text-base text-[#a89e8f]">{familyFirstName} Family</p>
            )}
            <p className="text-sm text-[#8B7E74] mt-1">
              {formatRange(data.schoolYear.start_date, data.schoolYear.end_date)}
            </p>
          </div>

          <div className="no-print flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              className="border border-white text-white rounded-lg px-4 py-2 text-sm hover:bg-white hover:text-[#1a2c22] transition-colors"
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="text-[#a89e8f] hover:text-white text-sm transition-colors"
            >
              Rename Year
            </button>
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-12">

        <section>
          <div className="flex flex-col sm:flex-row gap-4">
            {[
              { value: data.totalLessonsCompleted.toLocaleString(), label: "Lessons Completed" },
              { value: hoursLogged, label: "Hours Learning" },
              { value: memoriesTotal.toLocaleString(), label: "Memories Captured" },
            ].map((s) => (
              <div key={s.label} className="flex-1 bg-[#2D5A3D] rounded-lg text-[#F8F7F4] p-6">
                <p className="text-3xl font-bold leading-none">{s.value}</p>
                <p className="text-sm mt-2 text-[#c8d6cb]">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <p className={SECTION_LABEL}>Photos from this year</p>
          {photos.length === 0 ? (
            <p className="text-sm text-[#8B7E74]">No photos captured this year yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {photos.map((p) => (
                p.photo_url ? (
                  <img
                    key={p.id}
                    src={p.photo_url}
                    alt={p.title ?? p.caption ?? ""}
                    className="aspect-square object-cover rounded-lg w-full"
                    onError={(e) => { (e.target as HTMLImageElement).parentElement?.style.setProperty('display', 'none') }}
                  />
                ) : null
              ))}
            </div>
          )}
        </section>

        {familyStats?.most_loved_memory && familyStats.most_loved_memory.photo_url && (
          <section>
            <p className={SECTION_LABEL}>Your family&apos;s most loved moment</p>
            <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col md:flex-row gap-5">
              <img
                src={familyStats.most_loved_memory.photo_url}
                alt={familyStats.most_loved_memory.title ?? ""}
                className="rounded-lg max-w-[280px] w-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).parentElement?.style.setProperty('display', 'none') }}
              />
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-3">
                <div className="flex flex-wrap gap-2">
                  <span className={CHIP}>❤️ {familyStats.total_reactions} reactions</span>
                  <span className={CHIP}>💬 {familyStats.total_comments} comments</span>
                </div>
                {familyStats.top_comment && (
                  <blockquote
                    className="text-base text-[#1a2c22] italic"
                    style={{ fontFamily: "Georgia, serif" }}
                  >
                    “{familyStats.top_comment.body}”
                    <footer className="not-italic text-sm text-[#8B7E74] mt-2" style={{ fontFamily: "inherit" }}>
                      — {familyStats.top_comment.commenter_name}
                    </footer>
                  </blockquote>
                )}
              </div>
            </div>
          </section>
        )}

        <section>
          <p className={SECTION_LABEL}>A year in moments</p>
          {memoryChips.length === 0 ? (
            <p className="text-sm text-[#8B7E74]">No memories captured this year yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {memoryChips.map((m) => {
                const meta = MEMORY_CHIP[m.type] ?? { emoji: "✨", label: m.type };
                return (
                  <span key={m.type} className={CHIP}>
                    {meta.emoji} {m.count} {meta.label}
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {curriculumGoals.length > 0 && (
          <section>
            <p className={SECTION_LABEL}>What they studied</p>
            <div className="flex flex-wrap gap-2">
              {curriculumGoals.map((g) => (
                <span key={g.id} className={CHIP}>
                  {g.icon_emoji ?? "📚"} {g.subject_label ?? g.curriculum_name ?? "Subject"}
                </span>
              ))}
            </div>
          </section>
        )}

        <section>
          <p className={SECTION_LABEL}>Badges earned</p>
          {topBadges.length === 0 ? (
            <p className="text-sm text-[#8B7E74]">
              Keep going. Badges are earned through consistent learning!
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {topBadges.map((b) => {
                const name = badgeDisplayName(b.badge_type);
                const info = BADGE_INFO[name];
                return (
                  <div
                    key={b.badge_type}
                    className="bg-white rounded-lg border border-gray-200 p-4"
                  >
                    <p className="text-[#1a2c22] font-medium">
                      {info ? `${info.emoji} ${name}` : name}
                    </p>
                    <p className="text-sm mt-1 capitalize text-[#8B7E74]">
                      {b.tier}
                    </p>
                    {info && (
                      <p className="text-xs text-gray-500 mt-1">
                        {info.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <p className={SECTION_LABEL}>Your records</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { href: "/dashboard/plan", label: "Progress Report" },
              { href: "/dashboard/transcript", label: "Transcripts" },
              { href: "/dashboard/memories/yearbook/edit", label: "Yearbook" },
            ].map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm flex items-center justify-between transition-shadow"
              >
                <span className="text-[#1a2c22] font-medium">{r.label}</span>
                <span className="text-[#8B7E74]">→</span>
              </Link>
            ))}
          </div>
        </section>

        {data.schoolYear.status === "archived" && (
          <section className="no-print">
            <div className="border border-[#5c7f63] rounded-2xl p-6 bg-white">
              <h2
                className="text-xl mb-2 text-[#1a2c22]"
                style={{ fontFamily: "Georgia, serif", fontWeight: 500 }}
              >
                Ready for next year?
              </h2>
              <p className="text-sm mb-4 text-[#8B7E74]">
                We&apos;ll copy your subjects as a starting point. Just update the lesson count for each one and adjust anything that&apos;s changed.
              </p>
              <Link
                href="/dashboard/plan"
                className="block w-full bg-[#2D5A3D] text-white rounded-xl py-3 font-medium text-center"
              >
                Set Up Next Year →
              </Link>
            </div>
          </section>
        )}

        <section className="text-center py-12">
          <p
            className="text-base max-w-xl mx-auto italic text-[#1a2c22]"
            style={{ fontFamily: "Georgia, serif" }}
          >
            Every lesson, every memory, every moment. This was your year.
          </p>
          <p className="text-sm text-[#8B7E74] mt-3">
            Rooted. Capturing the life you&apos;re already living.
          </p>
        </section>
      </div>

      <div className="no-print bg-[#1a2c22] py-4 px-6 flex items-center justify-between">
        <p className="text-[#F8F7F4] text-sm">Save this year forever</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="border border-white text-white rounded-lg px-4 py-2 text-sm hover:bg-white hover:text-[#1a2c22] transition-colors"
        >
          Download PDF
        </button>
      </div>
    </div>
  );
}
