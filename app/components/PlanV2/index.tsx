"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import SelectActionBar from "./SelectActionBar";
import DayCellContextMenu from "./DayCellContextMenu";
import AppointmentWizard from "@/app/components/AppointmentWizard";
import { useLiveAnnouncer, SR_ONLY_STYLE } from "./useLiveAnnouncer";
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
  // Context menu — right-click on desktop / cell long-press on mobile.
  const [contextMenu, setContextMenu] = useState<{ dateStr: string; x: number; y: number } | null>(null);
  // Appointment wizard opened from "+ Add appointment" menu item.
  const [apptWizardDate, setApptWizardDate] = useState<string | null>(null);
  // Appointment edit target — set when the Pencil button is tapped on an
  // appointment pill in the day panel.
  const [apptEditTarget, setApptEditTarget] = useState<{
    appt: PlanV2Appointment;
  } | null>(null);
  // Keyboard-nav focused cell. Null = not-yet-focused; MonthGrid's own
  // fallback chooses today (or the first current-month cell) on Tab-focus.
  const [focusedDateStr, setFocusedDateStr] = useState<string | null>(null);
  const recentTimersRef = useRef<Map<string, number>>(new Map());
  const { announce, liveText } = useLiveAnnouncer();

  // Select-mode state — owns the selected set, whether the dark-green toolbar
  // is showing, and whether the user is currently picking a bulk-move target.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [moveTargetMode, setMoveTargetMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Deferred bulk delete — rows are removed from state immediately; DB DELETE
  // fires when the undo window expires. Snapshot lets Undo restore them.
  const pendingBulkDeleteRef = useRef<{ rows: PlanV2Lesson[]; timer: number } | null>(null);

  // Sensors — activate after 8px of movement so taps still register as clicks.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const { kids, lessons, appointments, vacationBlocks, loading, reload, setLessons, setAppointments } =
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
      // Optimistic local flip so the check lands instantly. Rollback on any
      // failure (auth, network, non-2xx response).
      const nextCompleted = !appt.completed;
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === appt.id && a.instance_date === appt.instance_date
            ? { ...a, completed: nextCompleted }
            : a,
        ),
      );
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("no session");
        const res = await fetch("/api/appointments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: appt.id, completed: nextCompleted }),
        });
        if (!res.ok) throw new Error("patch failed");
        reload();
      } catch {
        setAppointments((prev) =>
          prev.map((a) =>
            a.id === appt.id && a.instance_date === appt.instance_date
              ? { ...a, completed: appt.completed }
              : a,
          ),
        );
        flashNotice("Couldn't save — check your connection and try again.");
      }
    },
    [reload, setAppointments],
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

  // ── Select-mode helpers ───────────────────────────────────────────────────

  const enterSelectMode = useCallback((initialLessonId?: string) => {
    setSelectMode(true);
    if (initialLessonId) {
      setSelectedIds(new Set([initialLessonId]));
    }
    hapticTap(20);
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setMoveTargetMode(false);
  }, []);

  const toggleSelect = useCallback((lessonId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  }, []);

  const selectedLessons = useMemo<PlanV2Lesson[]>(
    () => lessons.filter((l) => selectedIds.has(l.id)),
    [lessons, selectedIds],
  );

  // Date breakdown "N from Tue · M from Wed" for the SelectActionBar.
  const selectionDateBreakdown = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const l of selectedLessons) {
      const d = l.scheduled_date ?? l.date;
      if (!d) continue;
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateStr, count]) => ({ dateStr, count }));
  }, [selectedLessons]);

  // Commit any pending bulk delete (run on unmount + before starting a new one).
  const commitPendingBulkDelete = useCallback(async () => {
    const pending = pendingBulkDeleteRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingBulkDeleteRef.current = null;
    const ids = pending.rows.map((r) => r.id);
    try {
      await supabase.from("lessons").delete().in("id", ids);
    } catch {
      /* best-effort on unmount; next loadData will reconcile */
    }
  }, []);

  useEffect(() => {
    return () => {
      // Capture the timer/rows at unmount time; can't await inside cleanup.
      const pending = pendingBulkDeleteRef.current;
      if (pending) {
        window.clearTimeout(pending.timer);
        pendingBulkDeleteRef.current = null;
        const ids = pending.rows.map((r) => r.id);
        // Fire and forget — we're tearing down.
        supabase.from("lessons").delete().in("id", ids).then(() => {}, () => {});
      }
    };
  }, []);

  // ── Bulk: move ────────────────────────────────────────────────────────────

  const performBulkMove = useCallback(async (ids: string[], toDateStr: string) => {
    const inVacation = vacationBlocks.some(
      (b) => toDateStr >= b.start_date && toDateStr <= b.end_date,
    );
    if (inVacation) {
      flashNotice("That day is blocked off as a vacation — pick another day.");
      return;
    }

    const moves: { id: string; from: string }[] = [];
    for (const id of ids) {
      const l = lessons.find((x) => x.id === id);
      if (!l) continue;
      const from = l.scheduled_date ?? l.date;
      if (!from || from === toDateStr) continue;
      moves.push({ id, from });
    }
    if (moves.length === 0) {
      flashNotice("No lessons needed moving — pick a different day.");
      return;
    }

    const [ty, tm, td] = toDateStr.split("-").map(Number);
    const toNative = new Date(ty, tm - 1, td).getDay();
    const toIsWeekend = toNative === 0 || toNative === 6;
    const toLabel = new Date(`${toDateStr}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    });

    setBulkBusy(true);
    const idsSet = new Set(moves.map((m) => m.id));

    // Optimistic batch update.
    setLessons((prev) =>
      prev.map((l) => (idsSet.has(l.id) ? { ...l, scheduled_date: toDateStr, date: toDateStr } : l)),
    );
    moves.forEach((m) => flagLanded(m.id));
    hapticTap(20);

    // Per-item DB writes so partial failures are visible.
    const results = await Promise.allSettled(
      moves.map((m) =>
        supabase
          .from("lessons")
          .update({ scheduled_date: toDateStr, date: toDateStr })
          .eq("id", m.id)
          .then(({ error }) => (error ? Promise.reject(error) : true)),
      ),
    );

    const succeeded: { id: string; from: string }[] = [];
    const failedIds: string[] = [];
    moves.forEach((m, i) => {
      if (results[i].status === "fulfilled") succeeded.push(m);
      else failedIds.push(m.id);
    });

    // Rollback any failures.
    if (failedIds.length > 0) {
      const failedMap = new Map(moves.filter((m) => failedIds.includes(m.id)).map((m) => [m.id, m.from]));
      setLessons((prev) =>
        prev.map((l) => {
          const origFrom = failedMap.get(l.id);
          return origFrom ? { ...l, scheduled_date: origFrom, date: origFrom } : l;
        }),
      );
    }

    // Notice + undo.
    const total = moves.length;
    const weekendSuffix = toIsWeekend ? " · weekend" : "";
    if (succeeded.length > 0) {
      setUndoAction({
        message:
          failedIds.length > 0
            ? `Moved ${succeeded.length} of ${total} to ${toLabel}${weekendSuffix} — ${failedIds.length} couldn't be moved`
            : `Moved ${succeeded.length} lesson${succeeded.length === 1 ? "" : "s"} to ${toLabel}${weekendSuffix}`,
        key: `bulk-move:${Date.now()}`,
        onUndo: async () => {
          const succeededMap = new Map(succeeded.map((m) => [m.id, m.from]));
          setLessons((prev) =>
            prev.map((l) => {
              const from = succeededMap.get(l.id);
              return from ? { ...l, scheduled_date: from, date: from } : l;
            }),
          );
          hapticTap(20);
          // Re-animate each reverted pill so the user sees where their lessons
          // just landed back — mirrors the single-move undo path.
          succeeded.forEach((m) => flagLanded(m.id));
          await Promise.allSettled(
            succeeded.map((m) =>
              supabase.from("lessons").update({ scheduled_date: m.from, date: m.from }).eq("id", m.id),
            ),
          );
          reload();
        },
      });
    } else {
      flashNotice(`Couldn't move ${failedIds.length} lesson${failedIds.length === 1 ? "" : "s"} — check your connection.`);
    }

    reload();
    setBulkBusy(false);
    exitSelectMode();
  }, [lessons, vacationBlocks, setLessons, reload, flagLanded, exitSelectMode]);

  // ── Bulk: mark done ───────────────────────────────────────────────────────

  const performBulkMarkDone = useCallback(async (ids: string[]) => {
    const toComplete = ids.filter((id) => {
      const l = lessons.find((x) => x.id === id);
      return l && !l.completed;
    });
    if (toComplete.length === 0) {
      flashNotice("Those lessons are already done.");
      exitSelectMode();
      return;
    }

    setBulkBusy(true);
    hapticTap(20);

    // Optimistic.
    const completeSet = new Set(toComplete);
    setLessons((prev) =>
      prev.map((l) => (completeSet.has(l.id) ? { ...l, completed: true } : l)),
    );

    const results = await Promise.allSettled(
      toComplete.map((id) =>
        supabase
          .from("lessons")
          .update({ completed: true, completed_at: new Date().toISOString() })
          .eq("id", id)
          .then(({ error }) => (error ? Promise.reject(error) : true)),
      ),
    );

    const succeededIds: string[] = [];
    const failedIds: string[] = [];
    toComplete.forEach((id, i) => {
      if (results[i].status === "fulfilled") succeededIds.push(id);
      else failedIds.push(id);
    });

    // Rollback failed.
    if (failedIds.length > 0) {
      const failedSet = new Set(failedIds);
      setLessons((prev) => prev.map((l) => (failedSet.has(l.id) ? { ...l, completed: false } : l)));
    }

    if (succeededIds.length > 0) {
      setUndoAction({
        message:
          failedIds.length > 0
            ? `Marked ${succeededIds.length} of ${toComplete.length} done — ${failedIds.length} couldn't be marked`
            : `Marked ${succeededIds.length} lesson${succeededIds.length === 1 ? "" : "s"} done`,
        key: `bulk-done:${Date.now()}`,
        onUndo: async () => {
          const sSet = new Set(succeededIds);
          setLessons((prev) =>
            prev.map((l) => (sSet.has(l.id) ? { ...l, completed: false } : l)),
          );
          hapticTap(20);
          await Promise.allSettled(
            succeededIds.map((id) =>
              supabase
                .from("lessons")
                .update({ completed: false, completed_at: null })
                .eq("id", id),
            ),
          );
          reload();
        },
      });
    } else {
      flashNotice(`Couldn't mark ${failedIds.length} lesson${failedIds.length === 1 ? "" : "s"} done.`);
    }

    reload();
    setBulkBusy(false);
    exitSelectMode();
  }, [lessons, setLessons, reload, exitSelectMode]);

  // ── Bulk: skip (clear scheduled_date) ─────────────────────────────────────

  const performBulkSkip = useCallback(async (ids: string[]) => {
    const snap: { id: string; from: string }[] = [];
    for (const id of ids) {
      const l = lessons.find((x) => x.id === id);
      if (!l) continue;
      const from = l.scheduled_date ?? l.date;
      if (!from) continue;
      snap.push({ id, from });
    }
    if (snap.length === 0) {
      flashNotice("Those lessons aren't on the calendar.");
      exitSelectMode();
      return;
    }

    setBulkBusy(true);
    const snapIds = new Set(snap.map((s) => s.id));
    setLessons((prev) =>
      prev.map((l) => (snapIds.has(l.id) ? { ...l, scheduled_date: null, date: null } : l)),
    );
    hapticTap(20);

    const results = await Promise.allSettled(
      snap.map((s) =>
        supabase
          .from("lessons")
          .update({ scheduled_date: null, date: null })
          .eq("id", s.id)
          .then(({ error }) => (error ? Promise.reject(error) : true)),
      ),
    );

    const succeeded: { id: string; from: string }[] = [];
    const failedIds: string[] = [];
    snap.forEach((s, i) => {
      if (results[i].status === "fulfilled") succeeded.push(s);
      else failedIds.push(s.id);
    });

    // Rollback failures.
    if (failedIds.length > 0) {
      const failedMap = new Map(snap.filter((s) => failedIds.includes(s.id)).map((s) => [s.id, s.from]));
      setLessons((prev) =>
        prev.map((l) => {
          const from = failedMap.get(l.id);
          return from ? { ...l, scheduled_date: from, date: from } : l;
        }),
      );
    }

    if (succeeded.length > 0) {
      setUndoAction({
        message:
          failedIds.length > 0
            ? `Skipped ${succeeded.length} of ${snap.length} — ${failedIds.length} couldn't be skipped`
            : `Skipped ${succeeded.length} lesson${succeeded.length === 1 ? "" : "s"}`,
        key: `bulk-skip:${Date.now()}`,
        onUndo: async () => {
          const sMap = new Map(succeeded.map((s) => [s.id, s.from]));
          setLessons((prev) =>
            prev.map((l) => {
              const from = sMap.get(l.id);
              return from ? { ...l, scheduled_date: from, date: from } : l;
            }),
          );
          hapticTap(20);
          // Reappearing pills get the "just-landed" ring so the eye finds
          // where the skipped lessons reattach on the calendar.
          succeeded.forEach((s) => flagLanded(s.id));
          await Promise.allSettled(
            succeeded.map((s) =>
              supabase.from("lessons").update({ scheduled_date: s.from, date: s.from }).eq("id", s.id),
            ),
          );
          reload();
        },
      });
    } else {
      flashNotice(`Couldn't skip ${failedIds.length} lesson${failedIds.length === 1 ? "" : "s"}.`);
    }

    reload();
    setBulkBusy(false);
    exitSelectMode();
  }, [lessons, setLessons, reload, exitSelectMode, flagLanded]);

  // ── Bulk: delete (deferred DB write to undo window) ──────────────────────

  const performBulkDelete = useCallback(async (ids: string[]) => {
    // Commit any prior pending delete before starting a new one — only one
    // undoable batch can sit open at a time (matches 93f9be6 semantics).
    await commitPendingBulkDelete();

    const rows = lessons.filter((l) => ids.includes(l.id));
    if (rows.length === 0) {
      exitSelectMode();
      return;
    }

    const rowIdSet = new Set(rows.map((r) => r.id));
    setLessons((prev) => prev.filter((l) => !rowIdSet.has(l.id)));
    hapticTap(20);

    // Defer the DB delete to the end of the 30s undo window. If the user
    // taps Undo first, the timer is cleared and the rows are restored.
    const timer = window.setTimeout(async () => {
      pendingBulkDeleteRef.current = null;
      try {
        await supabase.from("lessons").delete().in("id", Array.from(rowIdSet));
      } catch {
        /* silent — next reload reconciles */
      }
      reload();
    }, 30_000);
    pendingBulkDeleteRef.current = { rows, timer };

    setUndoAction({
      message: `Deleted ${rows.length} lesson${rows.length === 1 ? "" : "s"}`,
      key: `bulk-delete:${Date.now()}`,
      onUndo: () => {
        const pending = pendingBulkDeleteRef.current;
        if (!pending) return;
        window.clearTimeout(pending.timer);
        const restored = pending.rows;
        pendingBulkDeleteRef.current = null;
        setLessons((prev) => {
          const existing = new Set(prev.map((l) => l.id));
          const needed = restored.filter((l) => !existing.has(l.id));
          return [...prev, ...needed];
        });
        hapticTap(20);
      },
    });

    exitSelectMode();
  }, [lessons, setLessons, reload, exitSelectMode, commitPendingBulkDelete]);

  // ── Day-cell context menu actions ─────────────────────────────────────────
  // Helpers scoped to the day the menu is open for. All actions close the
  // menu first, then run their handler.

  const lessonsOnDate = useCallback(
    (dateStr: string) => lessons.filter((l) => (l.scheduled_date ?? l.date) === dateStr),
    [lessons],
  );

  const handleMenuSelectAll = useCallback((dateStr: string) => {
    setContextMenu(null);
    const ids = lessonsOnDate(dateStr).map((l) => l.id);
    if (ids.length === 0) return;
    setSelectMode(true);
    setSelectedIds(new Set(ids));
    hapticTap(20);
  }, [lessonsOnDate]);

  const handleMenuMoveAll = useCallback((dateStr: string) => {
    setContextMenu(null);
    const ids = lessonsOnDate(dateStr).map((l) => l.id);
    if (ids.length === 0) return;
    setSelectMode(true);
    setSelectedIds(new Set(ids));
    setMoveTargetMode(true);
    hapticTap(20);
  }, [lessonsOnDate]);

  const handleMenuSkipAll = useCallback((dateStr: string) => {
    setContextMenu(null);
    const ids = lessonsOnDate(dateStr).map((l) => l.id);
    if (ids.length === 0) return;
    void performBulkSkip(ids);
  }, [lessonsOnDate, performBulkSkip]);

  const handleMenuOpenDay = useCallback((dateStr: string) => {
    setContextMenu(null);
    setOpenDayStr(dateStr);
  }, []);

  const handleMenuAddLesson = useCallback(() => {
    setContextMenu(null);
    flashNotice("Adding a lesson from Plan lands in a later phase. Use Today or Plan (week view) in the meantime.");
  }, []);

  const handleMenuAddAppointment = useCallback((dateStr: string) => {
    setContextMenu(null);
    setApptWizardDate(dateStr);
  }, []);

  // "Mark as break day" — INSERTs a single-day vacation_block. No automatic
  // lesson shift (that's legacy saveVacationBlock behavior tightly coupled to
  // plan/page.tsx's state); any lessons on that day stay in the DB but the
  // cell hides them while the block exists. Undo removes the block.
  const handleMenuMarkBreak = useCallback(async (dateStr: string) => {
    setContextMenu(null);
    if (!effectiveUserId) return;
    // Optimistic: show the block immediately by writing to local state via reload after insert.
    try {
      const { data, error } = await supabase
        .from("vacation_blocks")
        .insert({
          user_id: effectiveUserId,
          name: "Break",
          start_date: dateStr,
          end_date: dateStr,
        })
        .select("id, name, start_date, end_date")
        .single();
      if (error || !data) {
        flashNotice("Couldn't save — check your connection and try again.");
        return;
      }
      hapticTap(20);
      const insertedId = (data as { id: string }).id;
      const dateLabel = new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
      });
      setUndoAction({
        message: `Marked ${dateLabel} as a break day`,
        key: `mark-break:${insertedId}`,
        onUndo: async () => {
          hapticTap(20);
          try {
            await supabase.from("vacation_blocks").delete().eq("id", insertedId);
          } catch {
            flashNotice("Couldn't undo — check your connection.");
          }
          reload();
        },
      });
      reload();
    } catch {
      flashNotice("Couldn't save — check your connection and try again.");
    }
  }, [effectiveUserId, reload]);

  // Global Escape handler — unwinds the top-most open UI in a predictable
  // order. Also powers keyboard nav #4 in the Phase 9 spec.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (rescheduleTarget) { setRescheduleTarget(null); return; }
      if (apptEditTarget) { setApptEditTarget(null); return; }
      if (openDayStr) { setOpenDayStr(null); return; }
      if (contextMenu) { setContextMenu(null); return; }
      if (moveTargetMode) { setMoveTargetMode(false); return; }
      if (selectMode) { exitSelectMode(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rescheduleTarget, apptEditTarget, openDayStr, contextMenu, moveTargetMode, selectMode, exitSelectMode]);

  // Announce universal-undo messages to screen readers when they appear.
  useEffect(() => {
    if (undoAction?.message) announce(undoAction.message);
  }, [undoAction, announce]);

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
                  onClick={() => (selectMode ? exitSelectMode() : enterSelectMode())}
                  className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                    selectMode
                      ? "bg-[#2D5A3D] text-white hover:bg-[var(--g-deep)]"
                      : "text-[#5C5346] hover:bg-[#f0ede8]"
                  }`}
                >
                  <MousePointerSquareDashed size={13} /> {selectMode ? "Cancel" : "Select"}
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

            {/* Select-mode action bar — shown above the grid whenever the user
                is picking lessons. Replaces the normal filter chip row. */}
            {selectMode ? (
              <SelectActionBar
                count={selectedIds.size}
                dateBreakdown={selectionDateBreakdown}
                inMoveTargetMode={moveTargetMode}
                busy={bulkBusy}
                onMoveTo={() => {
                  if (selectedIds.size === 0) {
                    flashNotice("Select at least one lesson first.");
                    return;
                  }
                  setMoveTargetMode(true);
                }}
                onMarkDone={() => {
                  if (selectedIds.size === 0) {
                    flashNotice("Select at least one lesson first.");
                    return;
                  }
                  void performBulkMarkDone(Array.from(selectedIds));
                }}
                onSkipAll={() => {
                  if (selectedIds.size === 0) {
                    flashNotice("Select at least one lesson first.");
                    return;
                  }
                  void performBulkSkip(Array.from(selectedIds));
                }}
                onDelete={() => {
                  if (selectedIds.size === 0) {
                    flashNotice("Select at least one lesson first.");
                    return;
                  }
                  void performBulkDelete(Array.from(selectedIds));
                }}
                onCancel={exitSelectMode}
                onBackToSelection={() => setMoveTargetMode(false)}
              />
            ) : null}

            {/* Empty-state notice — shown above the grid so the grid itself
                remains keyboard/drop-navigable even when there's nothing to
                render. Distinguishes "truly empty month" from "filters hid
                everything". */}
            {!loading && filteredLessons.length === 0 && filteredAppointments.length === 0 ? (
              <div className="px-4 py-3 border-b border-[#f0ede8] text-center">
                {lessons.length > 0 || appointments.length > 0 ? (
                  <>
                    <p className="text-[13px] font-medium text-[#2d2926]">No lessons match your filters</p>
                    <p className="text-[11px] text-[#7a6f65] mt-0.5">
                      Turn a child filter chip back on to bring lessons back.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-medium text-[#2d2926]">Nothing scheduled this month</p>
                    <p className="text-[11px] text-[#7a6f65] mt-0.5">
                      Head to Add Lesson to start your year.
                    </p>
                  </>
                )}
              </div>
            ) : null}

            {/* Month grid — wrapped in DndContext on desktop; on mobile the
                grid renders without drag sensors so page scroll isn't hijacked.
                Drag is also disabled in select mode + move-target mode so
                gesture intent stays unambiguous. */}
            <div className="p-3">
              {isMobile || selectMode ? (
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
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  moveTargetMode={moveTargetMode}
                  focusedDateStr={focusedDateStr}
                  onFocusedDateChange={setFocusedDateStr}
                  onCellClick={(dateStr) => {
                    if (selectMode) return;
                    setOpenDayStr(dateStr);
                  }}
                  onLessonClick={(lesson) => {
                    if (selectMode) return;
                    const d = lesson.scheduled_date ?? lesson.date;
                    if (d) setOpenDayStr(d);
                  }}
                  onAppointmentClick={(appt) => {
                    if (selectMode) return;
                    setOpenDayStr(appt.instance_date);
                  }}
                  onOverflowClick={(dateStr) => {
                    if (selectMode) return;
                    setOpenDayStr(dateStr);
                  }}
                  onLessonLongPress={(lesson) => {
                    if (!selectMode) enterSelectMode(lesson.id);
                  }}
                  onLessonSelectToggle={(lesson) => toggleSelect(lesson.id)}
                  onMoveTargetPick={(dateStr) => {
                    void performBulkMove(Array.from(selectedIds), dateStr);
                  }}
                  onCellContextMenu={(dateStr, x, y) => {
                    if (selectMode) return;
                    setContextMenu({ dateStr, x, y });
                  }}
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
                    focusedDateStr={focusedDateStr}
                    onFocusedDateChange={setFocusedDateStr}
                    onCellClick={(dateStr) => setOpenDayStr(dateStr)}
                    onLessonClick={(lesson) => {
                      const d = lesson.scheduled_date ?? lesson.date;
                      if (d) setOpenDayStr(d);
                    }}
                    onAppointmentClick={(appt) => setOpenDayStr(appt.instance_date)}
                    onOverflowClick={(dateStr) => setOpenDayStr(dateStr)}
                    onLessonLongPress={(lesson) => enterSelectMode(lesson.id)}
                    onCellContextMenu={(dateStr, x, y) => setContextMenu({ dateStr, x, y })}
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
              onEditAppointment={(appt) => {
                setOpenDayStr(null);
                setApptEditTarget({ appt });
              }}
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

        {/* Day-cell context menu — right-click on desktop, long-press on mobile. */}
        {contextMenu ? (
          <DayCellContextMenu
            dateStr={contextMenu.dateStr}
            lessonCount={lessonsOnDate(contextMenu.dateStr).length}
            x={contextMenu.x}
            y={contextMenu.y}
            onSelectAll={() => handleMenuSelectAll(contextMenu.dateStr)}
            onMoveAll={() => handleMenuMoveAll(contextMenu.dateStr)}
            onSkipAll={() => handleMenuSkipAll(contextMenu.dateStr)}
            onMarkBreak={() => void handleMenuMarkBreak(contextMenu.dateStr)}
            onAddLesson={handleMenuAddLesson}
            onAddAppointment={() => handleMenuAddAppointment(contextMenu.dateStr)}
            onOpenDay={() => handleMenuOpenDay(contextMenu.dateStr)}
            onClose={() => setContextMenu(null)}
          />
        ) : null}

        {/* Appointment wizard — opens for either "+ Add appointment" (initialDate)
            or "Edit" on an existing appointment (editingAppointment + optional
            editingInstanceDate for a recurring instance). */}
        <AppointmentWizard
          isOpen={apptWizardDate !== null || apptEditTarget !== null}
          onClose={() => {
            setApptWizardDate(null);
            setApptEditTarget(null);
          }}
          onSaved={() => {
            setApptWizardDate(null);
            setApptEditTarget(null);
            reload();
          }}
          initialDate={apptWizardDate ?? undefined}
          editingAppointment={
            apptEditTarget
              ? {
                  id: apptEditTarget.appt.id,
                  title: apptEditTarget.appt.title,
                  emoji: apptEditTarget.appt.emoji ?? "📅",
                  date: apptEditTarget.appt.date,
                  time: apptEditTarget.appt.time,
                  duration_minutes: apptEditTarget.appt.duration_minutes,
                  location: apptEditTarget.appt.location,
                  notes: apptEditTarget.appt.notes ?? null,
                  child_ids: apptEditTarget.appt.child_ids,
                  is_recurring: apptEditTarget.appt.is_recurring,
                  recurrence_rule: apptEditTarget.appt.recurrence_rule,
                }
              : null
          }
          editingInstanceDate={
            apptEditTarget && apptEditTarget.appt.is_recurring
              ? apptEditTarget.appt.instance_date
              : undefined
          }
        />

        {/* Global undo bar */}
        <UndoBar action={undoAction} onDismiss={() => setUndoAction(null)} />

        {/* Screen reader live region — polite announcements for the
            biggest actions (drag/drop result, bulk action outcome, undo). */}
        <div role="status" aria-live="polite" aria-atomic="true" style={SR_ONLY_STYLE}>
          {liveText}
        </div>
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
