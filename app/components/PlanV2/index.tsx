"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, MousePointerSquareDashed } from "lucide-react";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import MonthGrid from "./MonthGrid";
import { usePlanV2Data } from "./usePlanV2Data";
import { resolveChildColor } from "./colors";
import type { PlanV2Appointment, PlanV2Lesson } from "./types";

/* PlanV2 orchestrator. Owns month nav, view toggle, child filter chips, and
 * wires the toolbar to the MonthGrid. Day-detail panel, drag-drop, select
 * mode, and context menu land in later phases. The legacy plan/page.tsx
 * continues to render when the flag is off — this entire component tree is
 * unreachable unless useFeatureFlag("new_plan_view") resolves true. */

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

type ViewMode = "week" | "month";

export default function PlanV2() {
  const { effectiveUserId } = usePartner();
  const todayStr = useMemo(() => toDateStr(new Date()), []);

  const [monthStart, setMonthStart] = useState<Date>(() => firstOfMonth(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [childFilter, setChildFilter] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const { kids, lessons, appointments, vacationBlocks, loading } =
    usePlanV2Data({ effectiveUserId, monthStart });

  // Default: every child selected. Once data loads, ensure filter includes all
  // current child IDs.
  useMemo(() => {
    if (kids.length > 0 && childFilter.size === 0) {
      setChildFilter(new Set(kids.map((c) => c.id)));
    }
    // We intentionally only run this when the kids identity set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kids.map((c) => c.id).join("|")]);

  const filteredLessons = useMemo<PlanV2Lesson[]>(() => {
    if (childFilter.size === 0 || childFilter.size === kids.length) return lessons;
    return lessons.filter((l) => (l.child_id ? childFilter.has(l.child_id) : true));
  }, [lessons, childFilter, kids.length]);

  const filteredAppointments = useMemo<PlanV2Appointment[]>(() => {
    if (childFilter.size === 0 || childFilter.size === kids.length) return appointments;
    return appointments.filter((a) => {
      if (!a.child_ids || a.child_ids.length === 0) return true;
      return a.child_ids.some((id) => childFilter.has(id));
    });
  }, [appointments, childFilter, kids.length]);

  function prevMonth() {
    setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  function nextMonth() {
    setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  function jumpToToday() {
    setMonthStart(firstOfMonth(new Date()));
  }

  function toggleChild(id: string) {
    setChildFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function flashNotice(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3500);
  }

  const viewingCurrentMonth =
    monthStart.getFullYear() === new Date().getFullYear() &&
    monthStart.getMonth() === new Date().getMonth();

  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <>
      <PageHero overline="Your Curriculum" title="Plan" subtitle="Your lessons, your pace." />

      <div className="px-4 pt-5 pb-28 space-y-4 max-w-5xl mx-auto" style={{ background: "#F8F7F4" }}>
        {/* PlanV2 preview badge — removed when the flag rolls out broadly. */}
        <div
          className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full w-fit"
          style={{ backgroundColor: "#fef0dc", color: "#a07000" }}
        >
          <span>Plan · new layout preview</span>
        </div>

        {/* View toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode("week")}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              viewMode === "week"
                ? "bg-[#2D5A3D] text-white"
                : "bg-white text-[#5C5346] border border-[#e8e5e0]"
            }`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setViewMode("month")}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              viewMode === "month"
                ? "bg-[#2D5A3D] text-white"
                : "bg-white text-[#5C5346] border border-[#e8e5e0]"
            }`}
          >
            Month
          </button>
        </div>

        {viewMode === "week" ? (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl px-5 py-6">
            <p className="text-sm font-medium text-[#2d2926]">Week view</p>
            <p className="text-xs text-[#7a6f65] mt-1">
              Week renders in a later phase of the redesign. Switch to Month to preview the new grid.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3 border-b border-[#f0ede8]">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={prevMonth}
                  aria-label="Previous month"
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[#5c7f63] hover:bg-[#f0ede8] transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-[13px] font-semibold text-[#2D2A26] min-w-[120px] text-center">
                  {monthLabel}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  aria-label="Next month"
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[#5c7f63] hover:bg-[#f0ede8] transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {!viewingCurrentMonth ? (
                <button
                  type="button"
                  onClick={jumpToToday}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#e8f0e9] text-[#2D5A3D] hover:bg-[#d4e8d4] transition-colors"
                >
                  Jump to today
                </button>
              ) : null}

              <div className="flex-1" />

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => flashNotice("Adding a lesson from Plan lands in a later phase. Use Today or Plan (week view) in the meantime.")}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-[#2D5A3D] hover:bg-[#e8f0e9] transition-colors"
                >
                  <Plus size={13} /> Lesson
                </button>
                <button
                  type="button"
                  onClick={() => flashNotice("Adding an appointment from Plan lands in a later phase. Use the old Plan page to add one for now.")}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-[#7a60a8] hover:bg-[#f5f0ff] transition-colors"
                >
                  <Plus size={13} /> Appt
                </button>
                <button
                  type="button"
                  onClick={() => flashNotice("Multi-select lands in a later phase of the redesign.")}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-[#5C5346] hover:bg-[#f0ede8] transition-colors"
                >
                  <MousePointerSquareDashed size={13} /> Select
                </button>
              </div>
            </div>

            {/* Child filter chips */}
            {kids.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-[#f0ede8]">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8B7E74] mr-1">
                  Filter
                </span>
                {kids.map((c, i) => {
                  const active = childFilter.has(c.id);
                  const color = resolveChildColor(c, i);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleChild(c.id)}
                      aria-pressed={active}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
                      style={{
                        backgroundColor: active ? color : "#f4f0e8",
                        color: active ? "#ffffff" : "#7a6f65",
                        border: `1px solid ${active ? color : "#e8e2d9"}`,
                      }}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* Month grid */}
            <div className="p-3">
              <MonthGrid
                monthStart={monthStart}
                todayStr={todayStr}
                kids={kids}
                lessons={filteredLessons}
                appointments={filteredAppointments}
                vacationBlocks={vacationBlocks}
                loading={loading}
                onCellClick={(dateStr) =>
                  flashNotice(`Day detail for ${dateStr} opens in the next phase.`)
                }
                onLessonClick={() =>
                  flashNotice("Lesson actions move into Plan in the next phase.")
                }
                onAppointmentClick={() =>
                  flashNotice("Appointment edit lands in the appointments phase.")
                }
                onOverflowClick={(dateStr) =>
                  flashNotice(`All items for ${dateStr} will show in the day panel (next phase).`)
                }
              />
            </div>
          </div>
        )}

        {notice ? (
          <div
            role="status"
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] pointer-events-none max-w-md px-4"
          >
            <div className="bg-[#2d2926] text-white text-xs font-medium px-4 py-2.5 rounded-2xl shadow-lg leading-relaxed text-center">
              {notice}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
