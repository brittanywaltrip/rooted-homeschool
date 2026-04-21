"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, MousePointerSquareDashed, X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import MonthGrid from "./MonthGrid";
import DayDetailPanelV2 from "./DayDetailPanel";
import UndoBar, { type UndoAction } from "./UndoBar";
import { usePlanV2Data } from "./usePlanV2Data";
import { usePlanLessonActions } from "./usePlanLessonActions";
import { resolveChildColor } from "./colors";
import { PillShell } from "./LessonPill";
import { useIsMobile } from "./useIsMobile";
import { hapticTap } from "./haptic";
import type { PlanV2Appointment, PlanV2Lesson } from "./types";
import type {
  TodayLessonCardChild,
  TodayLessonCardLesson,
} from "@/app/components/TodayLessonCard";

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

/** Narrow PlanV2Lesson → TodayLessonCardLesson. Drops null-child_id rows
 * (unassigned lessons render as "Unassigned" in the panel via a synthetic
 * child_id). TodayLessonCard requires a non-null child_id; we coerce so the
 * panel can still show the lesson under an Unassigned block. */
function toTodayLessons(ls: PlanV2Lesson[]): TodayLessonCardLesson[] {
  return ls.map((l) => ({
    id: l.id,
    title: l.title ?? "",
    completed: l.completed,
    child_id: l.child_id ?? "__unassigned",
    hours: l.hours,
    minutes_spent: l.minutes_spent,
    subjects: l.subjects,
    lesson_number: l.lesson_number,
    curriculum_goal_id: l.curriculum_goal_id,
    notes: l.notes,
  }));
}

function toTodayKids(ks: { id: string; name: string; color: string | null }[]): TodayLessonCardChild[] {
  return ks.map((k) => ({ id: k.id, name: k.name, color: k.color }));
}

type ViewMode = "week" | "month";

export default function PlanV2() {
  const { effectiveUserId, isPartner } = usePartner();
  const todayStr = useMemo(() => toDateStr(new Date()), []);
  const isMobile = useIsMobile();

  const [monthStart, setMonthStart] = useState<Date>(() => firstOfMonth(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [childFilter, setChildFilter] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [openDayStr, setOpenDayStr] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [recentlyLandedIds, setRecentlyLandedIds] = useState<Set<string>>(() => new Set());
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{ lessonId: string; fromDateStr: string } | null>(null);
  const recentTimersRef = useRef<Map<string, number>>(new Map());

  // Sensors — activate after 8px of movement so taps still register as clicks.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const { kids, lessons, appointments, vacationBlocks, loading, reload, setLessons } =
    usePlanV2Data({ effectiveUserId, monthStart });

  // Lesson mutation handlers. Pass setLessons for both arrays (PlanV2 has one
  // state; the hook's dual setter model collapses cleanly). setAllLessons is
  // omitted — PlanV2 doesn't track an "all lessons" store.
  const { toggleLesson, deleteLesson, skipLesson } = usePlanLessonActions<PlanV2Lesson>({
    lessons,
    monthLessons: lessons,
    setLessons,
    setMonthLessons: setLessons,
    effectiveUserId,
    onSkipUndo: () => {
      // Drop + reschedule share UndoBar; skip refresh is good enough here.
      reload();
    },
  });

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

  const handleLessonChanged = useCallback(
    (lessonId: string, patch: Partial<TodayLessonCardLesson>) => {
      setLessons((prev) =>
        prev.map((l) => (l.id === lessonId ? { ...l, ...patch } as PlanV2Lesson : l)),
      );
    },
    [setLessons],
  );

  const handleMinutesUpdate = useCallback(
    (id: string, mins: number) => {
      setLessons((prev) =>
        prev.map((l) => (l.id === id ? { ...l, minutes_spent: mins } : l)),
      );
    },
    [setLessons],
  );

  const handleAppointmentToggle = useCallback(
    async (appt: PlanV2Appointment) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        await fetch("/api/appointments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: appt.id, completed: !appt.completed }),
        });
        reload();
      } catch {
        /* surface later — for now a silent retry on next reload */
      }
    },
    [reload],
  );

  // ── Ring state for newly-landed pills ──────────────────────────────────────
  const flagLanded = useCallback((lessonId: string) => {
    setRecentlyLandedIds((prev) => {
      const next = new Set(prev);
      next.add(lessonId);
      return next;
    });
    const prevTimer = recentTimersRef.current.get(lessonId);
    if (prevTimer !== undefined) window.clearTimeout(prevTimer);
    const timer = window.setTimeout(() => {
      setRecentlyLandedIds((prev) => {
        const next = new Set(prev);
        next.delete(lessonId);
        return next;
      });
      recentTimersRef.current.delete(lessonId);
    }, 2500);
    recentTimersRef.current.set(lessonId, timer);
  }, []);

  // ── Move a single lesson to a new date ────────────────────────────────────
  // Shared by drag-drop AND the mobile/desktop reschedule dialog. Handles
  // vacation rejection, weekend warn-but-allow, optimistic state, rollback on
  // DB failure, and the universal undo bar entry.
  const performMove = useCallback(
    async (lessonId: string, fromDateStr: string, toDateStr: string) => {
      if (fromDateStr === toDateStr) return;

      const inVacation = vacationBlocks.some(
        (b) => toDateStr >= b.start_date && toDateStr <= b.end_date,
      );
      if (inVacation) {
        flashNotice("That day is blocked off as a vacation — pick another day.");
        return;
      }

      const source = lessons.find((l) => l.id === lessonId);
      if (!source) return;

      const [ty, tm, td] = toDateStr.split("-").map(Number);
      const toNative = new Date(ty, tm - 1, td).getDay();
      const toIsWeekend = toNative === 0 || toNative === 6;

      const label =
        (source.title && source.title.trim().length > 0)
          ? source.title
          : source.lesson_number
            ? `Lesson ${source.lesson_number}`
            : "Lesson";
      const toLabel = new Date(`${toDateStr}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
      });

      // Optimistic update + ring + haptic.
      setLessons((prev) =>
        prev.map((l) =>
          l.id === lessonId ? { ...l, scheduled_date: toDateStr, date: toDateStr } : l,
        ),
      );
      flagLanded(lessonId);
      hapticTap(20);

      // DB write with try/catch + rollback.
      try {
        const { error } = await supabase
          .from("lessons")
          .update({ scheduled_date: toDateStr, date: toDateStr })
          .eq("id", lessonId);
        if (error) throw error;
      } catch {
        setLessons((prev) =>
          prev.map((l) =>
            l.id === lessonId ? { ...l, scheduled_date: fromDateStr, date: fromDateStr } : l,
          ),
        );
        flashNotice("Couldn't save — check your connection and try again.");
        return;
      }

      // Success path — register the universal undo action and reload for
      // upstream consistency (per Phase 5 safety rule #2).
      const weekendSuffix = toIsWeekend ? " · weekend" : "";
      setUndoAction({
        message: `Moved "${label}" to ${toLabel}${weekendSuffix}`,
        key: `${lessonId}:${toDateStr}:${Date.now()}`,
        onUndo: async () => {
          setLessons((prev) =>
            prev.map((l) =>
              l.id === lessonId
                ? { ...l, scheduled_date: fromDateStr, date: fromDateStr }
                : l,
            ),
          );
          hapticTap(20);
          flagLanded(lessonId);
          try {
            await supabase
              .from("lessons")
              .update({ scheduled_date: fromDateStr, date: fromDateStr })
              .eq("id", lessonId);
          } catch {
            flashNotice("Couldn't undo — check your connection.");
          }
          reload();
        },
      });

      reload();
    },
    [lessons, vacationBlocks, setLessons, reload, flagLanded],
  );

  // ── DnD handlers ───────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
    hapticTap(12);
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = e;
      if (!over) return;
      const aData = active.data.current as { type?: string; lessonId?: string; sourceDateStr?: string } | undefined;
      const oData = over.data.current as { type?: string; dateStr?: string; isVacation?: boolean } | undefined;
      if (aData?.type !== "lesson" || oData?.type !== "day") return;
      if (!aData.lessonId || !aData.sourceDateStr || !oData.dateStr) return;
      if (oData.isVacation) return;
      void performMove(aData.lessonId, aData.sourceDateStr, oData.dateStr);
    },
    [performMove],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  // Look up the currently-dragged lesson for the overlay.
  const activeLesson = useMemo<PlanV2Lesson | null>(() => {
    if (!activeDragId) return null;
    const id = activeDragId.startsWith("lesson:") ? activeDragId.slice("lesson:".length) : activeDragId;
    return lessons.find((l) => l.id === id) ?? null;
  }, [activeDragId, lessons]);

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

            {/* Month grid — wrapped in DndContext on desktop; on mobile the
                grid renders without drag sensors so page scroll isn't hijacked. */}
            <div className="p-3">
              {isMobile ? (
                <MonthGrid
                  monthStart={monthStart}
                  todayStr={todayStr}
                  kids={kids}
                  lessons={filteredLessons}
                  appointments={filteredAppointments}
                  vacationBlocks={vacationBlocks}
                  loading={loading}
                  dndEnabled={false}
                  recentlyLandedIds={recentlyLandedIds}
                  onCellClick={(dateStr) => setOpenDayStr(dateStr)}
                  onLessonClick={(lesson) => {
                    const d = lesson.scheduled_date ?? lesson.date;
                    if (d) setOpenDayStr(d);
                  }}
                  onAppointmentClick={(appt) => setOpenDayStr(appt.instance_date)}
                  onOverflowClick={(dateStr) => setOpenDayStr(dateStr)}
                />
              ) : (
                <DndContext
                  sensors={sensors}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  <MonthGrid
                    monthStart={monthStart}
                    todayStr={todayStr}
                    kids={kids}
                    lessons={filteredLessons}
                    appointments={filteredAppointments}
                    vacationBlocks={vacationBlocks}
                    loading={loading}
                    dndEnabled
                    isDragActive={activeDragId !== null}
                    recentlyLandedIds={recentlyLandedIds}
                    onCellClick={(dateStr) => setOpenDayStr(dateStr)}
                    onLessonClick={(lesson) => {
                      const d = lesson.scheduled_date ?? lesson.date;
                      if (d) setOpenDayStr(d);
                    }}
                    onAppointmentClick={(appt) => setOpenDayStr(appt.instance_date)}
                    onOverflowClick={(dateStr) => setOpenDayStr(dateStr)}
                  />
                  <DragOverlay dropAnimation={null}>
                    {activeLesson ? (() => {
                      const meta = activeLesson.child_id
                        ? { child: kids.find((k) => k.id === activeLesson.child_id), index: kids.findIndex((k) => k.id === activeLesson.child_id) }
                        : null;
                      const color = resolveChildColor(meta?.child ?? null, meta?.index ?? 0);
                      const label = activeLesson.title && activeLesson.title.trim().length > 0
                        ? activeLesson.title
                        : activeLesson.lesson_number
                          ? `Lesson ${activeLesson.lesson_number}`
                          : "Lesson";
                      const initial = meta?.child ? meta.child.name.charAt(0).toUpperCase() : "·";
                      return (
                        <PillShell
                          color={color}
                          initial={initial}
                          subject={activeLesson.subjects?.name ?? null}
                          label={label}
                          done={activeLesson.completed}
                          overlay
                          ariaLabel=""
                        />
                      );
                    })() : null}
                  </DragOverlay>
                </DndContext>
              )}
            </div>
          </div>
        )}

        {/* Day-detail sheet */}
        {openDayStr ? (() => {
          const panelLessons = toTodayLessons(
            lessons.filter((l) => (l.scheduled_date ?? l.date) === openDayStr),
          );
          const panelAppts = appointments.filter((a) => a.instance_date === openDayStr);
          const panelKids = toTodayKids(kids);
          const [y, m, d] = openDayStr.split("-").map(Number);
          const panelDate = new Date(y, m - 1, d);
          return (
            <DayDetailPanelV2
              date={panelDate}
              lessons={panelLessons}
              appointments={panelAppts}
              kids={panelKids}
              isPartner={isPartner}
              variant="sheet"
              onClose={() => setOpenDayStr(null)}
              onToggleLesson={(id, current) => { void toggleLesson(id, current); }}
              onDeleteLesson={(id) => { void deleteLesson(id); }}
              onSkipLesson={(l) => {
                const full = lessons.find((x) => x.id === l.id);
                if (full) void skipLesson(full);
              }}
              onEditLesson={() => flashNotice("Edit lesson opens in a later phase.")}
              onRescheduleLesson={(l) => {
                const full = lessons.find((x) => x.id === l.id);
                const fromDateStr = full?.scheduled_date ?? full?.date ?? null;
                if (!full || !fromDateStr) {
                  flashNotice("This lesson isn't on the calendar yet — edit it from the Plan page.");
                  return;
                }
                setOpenDayStr(null);
                setRescheduleTarget({ lessonId: l.id, fromDateStr });
              }}
              onMinutesUpdate={handleMinutesUpdate}
              onToggleAppointment={handleAppointmentToggle}
              onLessonChanged={handleLessonChanged}
            />
          );
        })() : null}

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

        {/* Reschedule dialog — opened from the DayDetailPanel 3-dot menu.
            Uses the native <input type="date"> picker (opens the OS picker
            on mobile, a calendar popover on desktop). */}
        {rescheduleTarget ? (
          <RescheduleDialog
            lessonId={rescheduleTarget.lessonId}
            fromDateStr={rescheduleTarget.fromDateStr}
            minDateStr={todayStr}
            vacationBlocks={vacationBlocks}
            onCancel={() => setRescheduleTarget(null)}
            onPick={async (toDateStr) => {
              setRescheduleTarget(null);
              await performMove(rescheduleTarget.lessonId, rescheduleTarget.fromDateStr, toDateStr);
            }}
          />
        ) : null}

        {/* Global undo bar */}
        <UndoBar action={undoAction} onDismiss={() => setUndoAction(null)} />
      </div>
    </>
  );
}

// ─── Reschedule dialog ───────────────────────────────────────────────────────

function RescheduleDialog(props: {
  lessonId: string;
  fromDateStr: string;
  minDateStr: string;
  vacationBlocks: { start_date: string; end_date: string }[];
  onCancel: () => void;
  onPick: (toDateStr: string) => void;
}) {
  const { fromDateStr, minDateStr, vacationBlocks, onCancel, onPick } = props;
  const [value, setValue] = useState<string>(fromDateStr);
  const inVacation = vacationBlocks.some(
    (b) => value >= b.start_date && value <= b.end_date,
  );
  const fromLabel = new Date(`${fromDateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]"
        onClick={onCancel}
        aria-hidden
      />
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 pointer-events-none">
        <div
          className="bg-[#fefcf9] rounded-2xl shadow-xl w-full max-w-sm pointer-events-auto overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-5 pt-4 pb-2">
            <div>
              <h2 className="text-base font-bold text-[#2d2926]">Reschedule lesson</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">Currently on {fromLabel}</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel reschedule"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="px-5 pb-5 pt-2 space-y-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">
                New date
              </span>
              <input
                type="date"
                value={value}
                min={minDateStr}
                onChange={(e) => setValue(e.target.value)}
                className="mt-1.5 w-full border border-[#e8e2d9] rounded-xl bg-white px-3 py-2.5 text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
              />
            </label>
            {inVacation ? (
              <p className="text-[11px] text-[#b91c1c]">
                That day is blocked off as a vacation — pick a different day.
              </p>
            ) : null}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 min-h-[44px] text-sm font-medium text-[#7a6f65] bg-[#f4f0e8] rounded-xl hover:bg-[#e8e2d9] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!value || inVacation || value === fromDateStr}
                onClick={() => onPick(value)}
                className="flex-1 min-h-[44px] text-sm font-bold text-white bg-[#2D5A3D] rounded-xl hover:bg-[var(--g-deep)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save new date
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
