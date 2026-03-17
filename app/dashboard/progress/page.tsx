"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import FinishLineSection from '@/components/FinishLineSection';

// ─── Types ────────────────────────────────────────────────────────────────────

type Child   = { id: string; name: string; color: string | null };
type Subject = { id: string; name: string; color: string | null };

type SubjectStat = {
  subject: Subject;
  lessons: number;
  hours:   number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STAGE_COLORS = ["#c4956a", "#7a9e7e", "#5c7f63", "#3d5c42", "#2d5c38"];

function leafStageLabel(leaves: number): string {
  if (leaves < 10)  return "Seed";
  if (leaves < 25)  return "Sprout";
  if (leaves < 50)  return "Sapling";
  if (leaves < 100) return "Growing";
  return "Thriving";
}

function leafStageColor(leaves: number): string {
  if (leaves < 10)  return STAGE_COLORS[0];
  if (leaves < 25)  return STAGE_COLORS[1];
  if (leaves < 50)  return STAGE_COLORS[2];
  if (leaves < 100) return STAGE_COLORS[3];
  return STAGE_COLORS[4];
}

// ─── Bar chart row ────────────────────────────────────────────────────────────

function SubjectBar({
  name,
  color,
  lessons,
  hours,
  maxLessons,
  maxHours,
}: {
  name: string;
  color: string | null;
  lessons: number;
  hours: number;
  maxLessons: number;
  maxHours: number;
}) {
  const barColor  = color ?? "#5c7f63";
  const pctLesson = maxLessons > 0 ? (lessons / maxLessons) * 100 : 0;
  const pctHours  = maxHours  > 0 ? (hours  / maxHours)  * 100 : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: barColor }} />
          <span className="text-sm font-medium text-[#2d2926] truncate">{name}</span>
        </div>
        <div className="flex gap-3 shrink-0 text-xs text-[#7a6f65]">
          <span><span className="font-semibold text-[#2d2926]">{lessons}</span> {lessons === 1 ? "lesson" : "lessons"}</span>
          {hours > 0 && <span><span className="font-semibold text-[#2d2926]">{hours % 1 === 0 ? hours : hours.toFixed(1)}</span>h</span>}
        </div>
      </div>
      {/* Lessons bar */}
      <div className="w-full h-2 bg-[#f0ede8] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pctLesson}%`, backgroundColor: barColor }}
        />
      </div>
      {/* Hours bar (lighter / narrower) */}
      {maxHours > 0 && (
        <div className="w-full h-1.5 bg-[#f0ede8] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 opacity-50"
            style={{ width: `${pctHours}%`, backgroundColor: barColor }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProgressPage() {
  const { effectiveUserId } = usePartner();

  const [children,         setChildren]         = useState<Child[]>([]);
  const [selectedChildId,  setSelectedChildId]  = useState<string>("all");
  const [subjectStats,     setSubjectStats]      = useState<SubjectStat[]>([]);
  const [totalLessons,     setTotalLessons]      = useState(0);
  const [totalHours,       setTotalHours]        = useState(0);
  const [leafCounts,       setLeafCounts]        = useState<Record<string, number>>({});
  const [loading,          setLoading]           = useState(true);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;

    const { data: childrenData } = await supabase
      .from("children").select("id, name, color")
      .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order");
    const kids = childrenData ?? [];
    setChildren(kids);

    // Fetch ALL completed lessons with subject info
    const { data: lessonsData } = await supabase
      .from("lessons")
      .select("id, child_id, hours, subject_id, subjects(id, name, color)")
      .eq("user_id", effectiveUserId)
      .eq("completed", true);

    // Fetch book events for leaf count
    const { data: bookEvents } = await supabase
      .from("app_events").select("payload")
      .eq("user_id", effectiveUserId).eq("type", "book_read");

    // Build leaf counts per child
    const counts: Record<string, number> = {};
    lessonsData?.forEach((l) => {
      if (l.child_id) counts[l.child_id] = (counts[l.child_id] ?? 0) + 1;
    });
    bookEvents?.forEach((e) => {
      const cid = e.payload?.child_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    });
    setLeafCounts(counts);

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Recompute subject stats when selection changes
  useEffect(() => {
    if (!effectiveUserId) return;
    const query = supabase
      .from("lessons")
      .select("child_id, hours, subjects(id, name, color)")
      .eq("user_id", effectiveUserId)
      .eq("completed", true);

    const run = async () => {
      const q = selectedChildId === "all"
        ? query
        : query.eq("child_id", selectedChildId);

      const { data } = await q;
      if (!data) return;

      const map: Record<string, SubjectStat> = {};
      let tLessons = 0;
      let tHours   = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data.forEach((row: any) => {
        tLessons++;
        tHours += row.hours ?? 0;

        const subj = row.subjects;
        if (!subj) return;
        if (!map[subj.id]) map[subj.id] = { subject: subj, lessons: 0, hours: 0 };
        map[subj.id].lessons++;
        map[subj.id].hours += row.hours ?? 0;
      });

      const stats = Object.values(map).sort((a, b) => b.lessons - a.lessons);
      setSubjectStats(stats);
      setTotalLessons(tLessons);
      setTotalHours(tHours);
    };
    run();
  }, [selectedChildId, effectiveUserId]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const maxLessons = Math.max(...subjectStats.map((s) => s.lessons), 1);
  const maxHours   = Math.max(...subjectStats.map((s) => s.hours),   0);

  const displayLeaves = selectedChildId === "all"
    ? children.reduce((sum, c) => sum + (leafCounts[c.id] ?? 0), 0)
    : leafCounts[selectedChildId] ?? 0;

  const selectedChild = children.find((c) => c.id === selectedChildId);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl animate-pulse">🌿</span>
          <p className="text-sm text-[#7a6f65]">Counting the leaves…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl px-5 py-7 space-y-6">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Learning Over Time
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Progress 📈</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Watch your children&apos;s knowledge grow, subject by subject.
        </p>
      </div>

      {/* Child Filter Tabs */}
      {children.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedChildId("all")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              selectedChildId === "all"
                ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63] hover:text-[#5c7f63]"
            }`}
          >
            All Children
          </button>
          {children.map((child) => (
            <button
              key={child.id}
              onClick={() => setSelectedChildId(child.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedChildId === child.id
                  ? "text-white border-transparent"
                  : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:text-[#2d2926]"
              }`}
              style={selectedChildId === child.id ? { backgroundColor: child.color ?? "#5c7f63" } : {}}
            >
              {child.name}
            </button>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-[#2d2926]">{totalLessons}</p>
          <p className="text-xs text-[#7a6f65] mt-0.5">Lessons done</p>
        </div>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-[#2d2926]">
            {totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}
          </p>
          <p className="text-xs text-[#7a6f65] mt-0.5">Hours of learning</p>
        </div>
        <div
          className="rounded-2xl p-4 text-center border"
          style={{
            backgroundColor: leafStageColor(displayLeaves) + "22",
            borderColor:      leafStageColor(displayLeaves) + "55",
          }}
        >
          <p className="text-2xl font-bold" style={{ color: leafStageColor(displayLeaves) }}>
            {displayLeaves} 🍃
          </p>
          <p className="text-xs mt-0.5" style={{ color: leafStageColor(displayLeaves) }}>
            {leafStageLabel(displayLeaves)}
          </p>
        </div>
      </div>

      {/* Per-child leaf breakdown when "All" is selected */}
      {selectedChildId === "all" && children.length > 1 && (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">
            Leaves per Child
          </h2>
          {children.map((child) => {
            const leaves = leafCounts[child.id] ?? 0;
            const maxLeaves = Math.max(...children.map((c) => leafCounts[c.id] ?? 0), 1);
            const pct = (leaves / maxLeaves) * 100;
            return (
              <div key={child.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: child.color ?? "#5c7f63" }} />
                    <span className="font-medium text-[#2d2926]">{child.name}</span>
                  </div>
                  <span className="text-xs text-[#7a6f65]">
                    <span className="font-semibold text-[#2d2926]">{leaves}</span> 🍃 · {leafStageLabel(leaves)}
                  </span>
                </div>
                <div className="w-full h-2 bg-[#f0ede8] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: child.color ?? "#5c7f63" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FinishLineSection />

      {/* Subject Breakdown */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-4">
          {selectedChildId === "all" ? "All Subjects" : `${selectedChild?.name ?? ""}'s Subjects`}
        </h2>

        {subjectStats.length === 0 ? (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
            <span className="text-4xl mb-3">🌱</span>
            <p className="font-medium text-[#2d2926] mb-2">No completed lessons yet</p>
            <p className="text-sm text-[#7a6f65] max-w-xs leading-relaxed">
              Complete lessons on Today&apos;s page and assign them subjects — they&apos;ll show up here as progress bars.
            </p>
          </div>
        ) : (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-5">
            {/* Legend */}
            <div className="flex gap-4 text-[10px] text-[#b5aca4]">
              <div className="flex items-center gap-1">
                <span className="block w-6 h-2 rounded-full bg-[#5c7f63]" />
                Lessons completed
              </div>
              {maxHours > 0 && (
                <div className="flex items-center gap-1">
                  <span className="block w-6 h-1.5 rounded-full bg-[#5c7f63] opacity-50" />
                  Hours spent
                </div>
              )}
            </div>

            {subjectStats.map((stat) => (
              <SubjectBar
                key={stat.subject.id}
                name={stat.subject.name}
                color={stat.subject.color}
                lessons={stat.lessons}
                hours={stat.hours}
                maxLessons={maxLessons}
                maxHours={maxHours}
              />
            ))}
          </div>
        )}
      </div>

      {/* Lessons without a subject */}
      {(() => {
        const unassigned = totalLessons - subjectStats.reduce((s, x) => s + x.lessons, 0);
        if (unassigned === 0) return null;
        return (
          <p className="text-xs text-[#b5aca4] text-center">
            +{unassigned} completed {unassigned === 1 ? "lesson" : "lessons"} without a subject assigned
          </p>
        );
      })()}

      <div className="h-4" />
    </div>
  );
}
