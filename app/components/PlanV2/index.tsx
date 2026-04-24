"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, MousePointerSquareDashed, X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import MonthGrid from "./MonthGrid";
import WeekStrip from "./WeekStrip";
import DayDetailPanelV2 from "./DayDetailPanel";
import UndoBar, { type UndoAction } from "./UndoBar";
import SelectActionBar from "./SelectActionBar";
import MissedLessonsBanner from "./MissedLessonsBanner";
import CatchUpBanner from "./CatchUpBanner";
import StatsBar, { type StatsMemory } from "./StatsBar";
import CurriculumGroupsPanel, { type CurriculumGoal as PanelGoal } from "./CurriculumGroupsPanel";
import BackfillPanel, { type BackfillEntry } from "./BackfillPanel";
import ActivitiesPanel, { type ActivityRow } from "./ActivitiesPanel";
import ProgressReportDialog from "./ProgressReportDialog";
import { downloadProgressReport, type ReportRangePreset } from "@/lib/progress-report";
import CurriculumWizard, { type CurriculumWizardEditData } from "@/app/components/CurriculumWizard";
import ActivitySetupModal, { type EditableActivity } from "@/app/components/ActivitySetupModal";
import CreateSchoolYearModal from "@/app/components/CreateSchoolYearModal";
import { useSchoolYears } from "@/lib/useSchoolYears";
import { getSeasonalEmoji, getUSHolidaysForYear } from "@/lib/us-holidays";
import PlanPrintDialog, { type PlanPrintMode } from "./PlanPrintDialog";
import DailyPrintSheet from "./DailyPrintSheet";
import WeeklyPrintSheet from "./WeeklyPrintSheet";
import MonthlyPrintSheet from "./MonthlyPrintSheet";
import { canExport } from "@/lib/user-access";
import ShiftForwardModal, { type ShiftMove } from "./ShiftForwardModal";
import PushBackModal, { type PushBackMove } from "./PushBackModal";
import VacationBlockModal, { type VacationBlockExisting, type VacationBlockSave } from "./VacationBlockModal";
import RecentChangesCard from "./RecentChangesCard";
import DayCellContextMenu from "./DayCellContextMenu";
import AddLessonModal, { type AddLessonSubmit } from "./AddLessonModal";
import EditLessonModal, { type EditLessonChanges } from "./EditLessonModal";
import AppointmentWizard, { type AppointmentSavedInfo } from "@/app/components/AppointmentWizard";
import {
  DEFAULT_SCHOOL_DAYS,
  countSchoolDaysInRange,
  nthSchoolDay,
} from "@/lib/school-days";
import { useLiveAnnouncer, SR_ONLY_STYLE } from "./useLiveAnnouncer";
import { usePlanV2Data } from "./usePlanV2Data";
import { usePlanLessonActions } from "./usePlanLessonActions";
import {
  buildOptimisticEventRow,
  filterEventsForDay,
  logPlanEvent,
  PLAN_EVENT_TYPES,
  type PlanEventRow,
  type PlanEventType,
} from "@/lib/audit-log";
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

// Catch-up banner dismissal constants — module-scoped so useEffect/useCallback
// dependency arrays stay stable.
const CATCHUP_DISMISS_KEY = "rooted_planv2_catchup_dismissed_at";
const CATCHUP_DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type ViewMode = "week" | "month";

export default function PlanV2() {
  const { effectiveUserId, isPartner } = usePartner();
  const todayStr = useMemo(() => toDateStr(new Date()), []);
  const isMobile = useIsMobile();

  const [monthStart, setMonthStart] = useState<Date>(() => firstOfMonth(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  // Sunday on or before today — anchor for the Week view strip.
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  });
  const [schoolYearModalOpen, setSchoolYearModalOpen] = useState(false);
  // Print dialog state — null = closed; "selected" mode is what the print
  // sheets key off via body class.
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [activePrintMode, setActivePrintMode] = useState<PlanPrintMode | null>(null);
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

  // ── School-days + catch-up / push-back / vacation modal state ───────────
  const [schoolDays, setSchoolDays] = useState<string[]>(DEFAULT_SCHOOL_DAYS);
  // Paid-feature gating for the print dialog (Week + Month sheets).
  // Mirrors the Year Planner's pattern: trial counts as paid.
  const [isPro, setIsPro] = useState<boolean>(false);
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("school_days, is_pro, trial_started_at")
        .eq("id", effectiveUserId)
        .maybeSingle();
      if (cancelled) return;
      const row = data as
        | { school_days?: string[] | null; is_pro?: boolean | null; trial_started_at?: string | null }
        | null;
      const sd = row?.school_days;
      setSchoolDays(sd && sd.length > 0 ? sd : DEFAULT_SCHOOL_DAYS);
      setIsPro(!!row?.is_pro);
      setTrialStartedAt(row?.trial_started_at ?? null);
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  // Catch-up banner dismissal — kept in localStorage as a 7-day quiet period.
  // Constants live at module scope (see CATCHUP_* above the component) so
  // the effect + useCallback don't trip exhaustive-deps.
  const [catchUpSuppressedUntil, setCatchUpSuppressedUntil] = useState<number>(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CATCHUP_DISMISS_KEY);
      if (!raw) return;
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts)) {
        setCatchUpSuppressedUntil(ts + CATCHUP_DISMISS_WINDOW_MS);
      }
    } catch { /* private-mode / quota — just ignore */ }
  }, []);
  const dismissCatchUp = useCallback(() => {
    const now = Date.now();
    setCatchUpSuppressedUntil(now + CATCHUP_DISMISS_WINDOW_MS);
    try {
      window.localStorage.setItem(CATCHUP_DISMISS_KEY, String(now));
    } catch { /* ignore */ }
  }, []);

  const [shiftForwardOpen, setShiftForwardOpen] = useState(false);
  const [pushBackOpen, setPushBackOpen] = useState(false);

  // Vacation modal — single instance for both create + edit. `existing` is
  // null in create mode; populated in edit mode with the block we clicked.
  const [vacationModalOpen, setVacationModalOpen] = useState(false);
  const [vacationModalInitialDate, setVacationModalInitialDate] = useState<string | null>(null);
  const [vacationModalExisting, setVacationModalExisting] = useState<VacationBlockExisting | null>(null);

  // ── Add + edit lesson state ──────────────────────────────────────────────
  // Modals are local state — a single instance of each is enough because
  // we never open both at once. `addLessonInitialDate` is the pre-filled
  // date for the form; falls back to today when opened from the toolbar.
  const [addLessonOpen, setAddLessonOpen] = useState(false);
  const [addLessonInitialDate, setAddLessonInitialDate] = useState<string>(todayStr);
  const [editLessonTarget, setEditLessonTarget] = useState<PlanV2Lesson | null>(null);

  // Full goal shape — used by the CurriculumGroupsPanel (pace, progress).
  // AddLesson/EditLesson modals read just the dropdown-relevant subset.
  type GoalFull = {
    id: string;
    curriculum_name: string;
    subject_label: string | null;
    child_id: string | null;
    total_lessons: number;
    current_lesson: number;
    target_date: string | null;
    school_days: string[] | null;
    default_minutes: number;
  };
  const [curriculumGoals, setCurriculumGoals] = useState<GoalFull[]>([]);
  const [goalsReloadNonce, setGoalsReloadNonce] = useState(0);

  const reloadGoals = useCallback(() => setGoalsReloadNonce((n) => n + 1), []);

  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("curriculum_goals")
        .select("id, curriculum_name, subject_label, child_id, total_lessons, current_lesson, target_date, school_days, default_minutes")
        .eq("user_id", effectiveUserId)
        .order("created_at");
      if (cancelled) return;
      setCurriculumGoals(((data ?? []) as unknown as GoalFull[]));
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId, goalsReloadNonce]);

  // Activities — used by the ActivitiesPanel below the curriculum list.
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [activitiesReloadNonce, setActivitiesReloadNonce] = useState(0);
  const reloadActivities = useCallback(() => setActivitiesReloadNonce((n) => n + 1), []);
  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("activities")
        .select("id, name, emoji")
        .eq("user_id", effectiveUserId)
        .eq("is_active", true)
        .order("created_at");
      if (cancelled) return;
      setActivities(((data ?? []) as unknown as ActivityRow[]));
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId, activitiesReloadNonce]);

  // Memories (books + field trips) in the visible month — powers StatsBar.
  const [memoriesInRange, setMemoriesInRange] = useState<StatsMemory[]>([]);
  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    (async () => {
      const startStr = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;
      const endDate = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
      const { data } = await supabase
        .from("memories")
        .select("type, date")
        .eq("user_id", effectiveUserId)
        .gte("date", startStr)
        .lte("date", endStr);
      if (cancelled) return;
      setMemoriesInRange(((data ?? []) as unknown as StatsMemory[]));
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId, monthStart]);

  // Curriculum wizard + activity modal + report dialog state.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardEditData, setWizardEditData] = useState<CurriculumWizardEditData | null>(null);
  const [activityEditing, setActivityEditing] = useState<EditableActivity | null>(null);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [openBackfillGoalId, setOpenBackfillGoalId] = useState<string | null>(null);
  const [deleteGoalConfirm, setDeleteGoalConfirm] = useState<{ goal: PanelGoal; lessonCount: number } | null>(null);
  const [deleteActivityConfirm, setDeleteActivityConfirm] = useState<ActivityRow | null>(null);

  // ── Audit trail state ────────────────────────────────────────────────────
  // Loaded once per effectiveUserId. Further events are prepended locally
  // (buildOptimisticEventRow) so the Recent Changes card updates within a
  // frame of the mutation. onLoadMore extends the window in 100-row steps.
  const [planEvents, setPlanEvents] = useState<PlanEventRow[]>([]);
  const [planEventsPages, setPlanEventsPages] = useState(1);
  const [planEventsFullyLoaded, setPlanEventsFullyLoaded] = useState(false);
  const [planEventsLoadingMore, setPlanEventsLoadingMore] = useState(false);

  const loadPlanEvents = useCallback(async (pageCount: number) => {
    if (!effectiveUserId) return;
    const { data, error } = await supabase
      .from("app_events")
      .select("id, type, payload, created_at")
      .eq("user_id", effectiveUserId)
      .in("type", PLAN_EVENT_TYPES as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(pageCount * 100);
    if (error) return;
    const rows = (data ?? []) as PlanEventRow[];
    setPlanEvents(rows);
    setPlanEventsFullyLoaded(rows.length < pageCount * 100);
  }, [effectiveUserId]);

  useEffect(() => {
    setPlanEventsPages(1);
    setPlanEventsFullyLoaded(false);
    void loadPlanEvents(1);
  }, [loadPlanEvents]);

  const loadMorePlanEvents = useCallback(async () => {
    if (planEventsFullyLoaded) return;
    setPlanEventsLoadingMore(true);
    const next = planEventsPages + 1;
    await loadPlanEvents(next);
    setPlanEventsPages(next);
    setPlanEventsLoadingMore(false);
  }, [planEventsFullyLoaded, planEventsPages, loadPlanEvents]);

  /** Append locally + fire-and-forget DB insert. Resolves immediately — the
   * DB write races in the background. Callers never await this. */
  const recordEvent = useCallback(
    (type: PlanEventType, payload: Record<string, unknown>) => {
      const optimistic = buildOptimisticEventRow(type, payload);
      setPlanEvents((prev) => [optimistic, ...prev]);
      // Fire-and-forget. logPlanEvent swallows + warns on failure.
      void logPlanEvent({ userId: effectiveUserId, type, payload });
    },
    [effectiveUserId],
  );

  const { kids, lessons, appointments, vacationBlocks, loading, reload, setLessons, setAppointments } =
    usePlanV2Data({ effectiveUserId, monthStart });

  // School years — drives milestone markers + the "Create next year" CTA.
  const schoolYears = useSchoolYears(effectiveUserId ?? null);

  // US holidays — covered for both the visible month/year and the
  // surrounding ±1 year so the week-view strip near year boundaries shows
  // the right labels without re-fetching.
  const holidaysMap = useMemo(() => {
    const merged = new Map<string, string>();
    const baseYear = (viewMode === "week" ? weekStart : monthStart).getFullYear();
    for (const y of [baseYear - 1, baseYear, baseYear + 1]) {
      const m = getUSHolidaysForYear(y);
      m.forEach((v, k) => merged.set(k, v));
    }
    return merged;
  }, [viewMode, weekStart, monthStart]);

  // Milestone markers — first/last day of any active or upcoming year.
  const milestonesMap = useMemo(() => {
    const m = new Map<string, string>();
    if (schoolYears.upcoming) {
      m.set(schoolYears.upcoming.start_date, `🎒 First day · ${schoolYears.upcoming.name}`);
      m.set(schoolYears.upcoming.end_date, `🎓 Last day · ${schoolYears.upcoming.name}`);
    }
    if (schoolYears.active) {
      // Don't clobber an upcoming-year start that happens to share a date.
      if (!m.has(schoolYears.active.start_date)) {
        m.set(schoolYears.active.start_date, `🎒 First day · ${schoolYears.active.name}`);
      }
      m.set(schoolYears.active.end_date, `🎓 Last day · ${schoolYears.active.name}`);
    }
    return m;
  }, [schoolYears.active, schoolYears.upcoming]);

  // CTA visibility: show when there's no upcoming year AND either there's
  // no active year at all or the active year ends within 60 days.
  const showCreateSchoolYearCTA = useMemo(() => {
    if (schoolYears.loading) return false;
    if (schoolYears.upcoming) return false;
    if (!schoolYears.active) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(`${schoolYears.active.end_date}T00:00:00`);
    const diffDays = Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 60;
  }, [schoolYears.loading, schoolYears.upcoming, schoolYears.active]);

  // Seasonal emoji for the toolbar label — month for Month view, the
  // start-of-week's month for Week view.
  const headerSeasonalEmoji = useMemo(() => {
    const m = (viewMode === "week" ? weekStart : monthStart).getMonth();
    return getSeasonalEmoji(m);
  }, [viewMode, weekStart, monthStart]);

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

  // ── Single-lesson wrappers that fire audit events ───────────────────────
  // Read lesson metadata BEFORE delegating so optimistic deletions don't
  // erase the title/date we need to log. The base hook's async promise is
  // awaited so the DB write lands before we record the event — if the hook
  // fails silently the audit entry still goes out, which is intentional:
  // the user's intent was recorded even if persistence hiccups.
  const toggleLessonWithLog = useCallback(
    async (id: string, current: boolean) => {
      const snap = lessons.find((l) => l.id === id);
      await toggleLesson(id, current);
      if (snap) {
        const title = snap.title && snap.title.trim().length > 0
          ? snap.title
          : snap.lesson_number ? `Lesson ${snap.lesson_number}` : "lesson";
        recordEvent(current ? "lesson.uncompleted" : "lesson.completed", {
          lesson_id: id,
          lesson_title: title,
          date: snap.scheduled_date ?? snap.date ?? null,
          actor: "user",
        });
      }
    },
    [lessons, toggleLesson, recordEvent],
  );

  const deleteLessonWithLog = useCallback(
    async (id: string) => {
      const snap = lessons.find((l) => l.id === id);
      await deleteLesson(id);
      if (snap) {
        const title = snap.title && snap.title.trim().length > 0
          ? snap.title
          : snap.lesson_number ? `Lesson ${snap.lesson_number}` : "lesson";
        recordEvent("lesson.deleted", {
          lesson_id: id,
          lesson_title: title,
          from_date: snap.scheduled_date ?? snap.date ?? null,
          actor: "user",
        });
      }
    },
    [lessons, deleteLesson, recordEvent],
  );

  const skipLessonWithLog = useCallback(
    async (lesson: PlanV2Lesson) => {
      const from = lesson.scheduled_date ?? lesson.date;
      await skipLesson(lesson);
      if (from) {
        const title = lesson.title && lesson.title.trim().length > 0
          ? lesson.title
          : lesson.lesson_number ? `Lesson ${lesson.lesson_number}` : "lesson";
        recordEvent("lesson.skipped", {
          lesson_id: lesson.id,
          lesson_title: title,
          from_date: from,
          actor: "user",
        });
      }
    },
    [skipLesson, recordEvent],
  );

  // ── Submit handlers for Add / Edit lesson modals ─────────────────────────
  // Both paths: optimistic local-state update + audit event + universal undo
  // entry. Undo for an add = DELETE the inserted row; undo for an edit =
  // restore the prior column values. Either way the DB writes are awaited
  // so failures surface to the user (the modal shows the error inline).

  const handleSubmitAddLesson = useCallback(async (values: AddLessonSubmit) => {
    if (!effectiveUserId) throw new Error("Not signed in");
    const { data: inserted, error } = await supabase
      .from("lessons")
      .insert({
        user_id: effectiveUserId,
        child_id: values.child_id,
        curriculum_goal_id: values.curriculum_goal_id,
        title: values.title,
        lesson_number: values.lesson_number,
        minutes_spent: values.minutes_spent,
        hours: values.minutes_spent ? values.minutes_spent / 60 : 0,
        scheduled_date: values.scheduled_date,
        date: values.scheduled_date,
        notes: values.notes,
        completed: false,
      })
      .select("id, title, lesson_number, completed, child_id, scheduled_date, date, curriculum_goal_id, hours, minutes_spent, notes, subjects(name, color)")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Insert failed");

    const row = inserted as unknown as PlanV2Lesson;
    setLessons((prev) => [...prev, row]);
    hapticTap(20);

    recordEvent("lesson.created", {
      lesson_id: row.id,
      lesson_title: row.title ?? "",
      date: values.scheduled_date,
      curriculum_goal_id: values.curriculum_goal_id,
      actor: "user",
    });

    const dateLabel = new Date(`${values.scheduled_date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    });
    setUndoAction({
      message: `Added lesson · ${row.title ?? "Lesson"} on ${dateLabel}`,
      key: `lesson-add:${row.id}`,
      onUndo: async () => {
        setLessons((prev) => prev.filter((l) => l.id !== row.id));
        hapticTap(20);
        try {
          await supabase.from("lessons").delete().eq("id", row.id);
        } catch {
          /* best-effort; next reload reconciles */
        }
        reload();
      },
    });

    reload();
  }, [effectiveUserId, setLessons, recordEvent, reload]);

  const handleSubmitEditLesson = useCallback(async (
    lessonId: string,
    changes: EditLessonChanges,
    originals: EditLessonChanges,
  ) => {
    // Build the DB update payload. `hours` stays in sync with `minutes_spent`
    // because other parts of the app read `hours` for reporting totals.
    const update: Record<string, unknown> = { ...changes };
    if ("minutes_spent" in changes) {
      const m = changes.minutes_spent;
      update.hours = m != null ? m / 60 : 0;
    }
    // Keep the legacy `date` column in step with `scheduled_date` — PlanV2
    // reads both interchangeably elsewhere; a stale `date` would misplace
    // the lesson in any consumer that hasn't migrated.
    if ("scheduled_date" in changes && changes.scheduled_date) {
      update.date = changes.scheduled_date;
    }

    // Optimistic patch so the pill moves/updates immediately.
    setLessons((prev) => prev.map((l) => {
      if (l.id !== lessonId) return l;
      const patched: PlanV2Lesson = { ...l };
      if (changes.title !== undefined) patched.title = changes.title;
      if (changes.lesson_number !== undefined) patched.lesson_number = changes.lesson_number;
      if (changes.minutes_spent !== undefined) {
        patched.minutes_spent = changes.minutes_spent;
        patched.hours = changes.minutes_spent != null ? changes.minutes_spent / 60 : 0;
      }
      if (changes.scheduled_date !== undefined) {
        patched.scheduled_date = changes.scheduled_date;
        patched.date = changes.scheduled_date;
      }
      if (changes.curriculum_goal_id !== undefined) patched.curriculum_goal_id = changes.curriculum_goal_id;
      if (changes.child_id !== undefined) patched.child_id = changes.child_id;
      return patched;
    }));

    const { error } = await supabase.from("lessons").update(update).eq("id", lessonId);
    if (error) {
      // Roll back the optimistic patch by reloading from DB.
      reload();
      throw new Error(error.message);
    }

    // Build the changes diff payload for the audit event — {from, to} per key.
    const changesForLog: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(changes) as (keyof EditLessonChanges)[]) {
      changesForLog[key] = { from: originals[key], to: changes[key] };
    }
    const snap = lessons.find((l) => l.id === lessonId);
    const titleForLog =
      (changes.title as string | undefined) ??
      snap?.title ??
      "lesson";
    recordEvent("lesson.updated", {
      lesson_id: lessonId,
      lesson_title: titleForLog,
      changes: changesForLog,
      actor: "user",
    });

    setUndoAction({
      message: `Edited ${titleForLog}`,
      key: `lesson-edit:${lessonId}:${Date.now()}`,
      onUndo: async () => {
        // Restore originals both locally and in DB. Only touch the fields
        // that actually moved so we don't clobber unrelated columns.
        setLessons((prev) => prev.map((l) => {
          if (l.id !== lessonId) return l;
          const patched: PlanV2Lesson = { ...l };
          if (originals.title !== undefined) patched.title = (originals.title ?? "") as string;
          if (originals.lesson_number !== undefined) patched.lesson_number = originals.lesson_number as number | null;
          if (originals.minutes_spent !== undefined) {
            patched.minutes_spent = originals.minutes_spent as number | null;
            patched.hours = originals.minutes_spent != null ? (originals.minutes_spent as number) / 60 : 0;
          }
          if (originals.scheduled_date !== undefined) {
            patched.scheduled_date = originals.scheduled_date as string;
            patched.date = originals.scheduled_date as string;
          }
          if (originals.curriculum_goal_id !== undefined) patched.curriculum_goal_id = originals.curriculum_goal_id as string | null;
          if (originals.child_id !== undefined) patched.child_id = (originals.child_id ?? null) as string | null;
          return patched;
        }));

        const undoUpdate: Record<string, unknown> = {};
        if (originals.title !== undefined) undoUpdate.title = originals.title;
        if (originals.lesson_number !== undefined) undoUpdate.lesson_number = originals.lesson_number;
        if (originals.minutes_spent !== undefined) {
          undoUpdate.minutes_spent = originals.minutes_spent;
          undoUpdate.hours = originals.minutes_spent != null ? (originals.minutes_spent as number) / 60 : 0;
        }
        if (originals.scheduled_date !== undefined) {
          undoUpdate.scheduled_date = originals.scheduled_date;
          undoUpdate.date = originals.scheduled_date;
        }
        if (originals.curriculum_goal_id !== undefined) undoUpdate.curriculum_goal_id = originals.curriculum_goal_id;
        if (originals.child_id !== undefined) undoUpdate.child_id = originals.child_id;

        try {
          await supabase.from("lessons").update(undoUpdate).eq("id", lessonId);
        } catch {
          /* best-effort; reload reconciles */
        }
        reload();
      },
    });
  }, [lessons, setLessons, recordEvent, reload]);

  // Fired when a lesson's notes have been auto-saved by the day panel. The
  // panel doesn't know about PLAN_EVENT_TYPES, so it just passes the id +
  // new length and we log the audit entry here.
  const handleLessonNotesUpdated = useCallback(
    (lessonId: string, noteLength: number) => {
      const snap = lessons.find((l) => l.id === lessonId);
      const title =
        snap?.title && snap.title.trim().length > 0
          ? snap.title
          : snap?.lesson_number ? `Lesson ${snap.lesson_number}` : "lesson";
      recordEvent("lesson.notes_updated", {
        lesson_id: lessonId,
        lesson_title: title,
        date: snap?.scheduled_date ?? snap?.date ?? null,
        note_length: noteLength,
        actor: "user",
      });
    },
    [lessons, recordEvent],
  );

  // ── Curriculum wizard + activity + report + backfill handlers ───────────
  // Each compares pre/post counts to figure out create-vs-edit on save (the
  // wizard's onSaved is fire-and-forget — we don't get a kind back). We
  // refetch goals, then audit the appropriate event.
  const handleWizardOpenCreate = useCallback(() => {
    setWizardEditData(null);
    setWizardOpen(true);
  }, []);

  const handleWizardOpenEdit = useCallback((goal: PanelGoal) => {
    setWizardEditData({
      goalId: goal.id,
      childId: goal.child_id ?? "",
      curricName: goal.curriculum_name,
      subjectLabel: goal.subject_label,
      totalLessons: goal.total_lessons,
      currentLesson: goal.current_lesson,
      targetDate: goal.target_date ?? "",
      schoolDays: goal.school_days ?? ["Mon", "Tue", "Wed", "Thu", "Fri"],
    });
    setWizardOpen(true);
  }, []);

  const wizardWasEdit = wizardEditData !== null;
  const handleWizardSaved = useCallback(async () => {
    // Snapshot the prior goal id set so we can detect new vs updated rows
    // by diffing after the refetch lands.
    const priorIds = new Set(curriculumGoals.map((g) => g.id));
    const editingGoalId = wizardEditData?.goalId;
    setWizardOpen(false);
    setWizardEditData(null);
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from("curriculum_goals")
      .select("id, curriculum_name, total_lessons, child_id")
      .eq("user_id", effectiveUserId);
    const after = ((data ?? []) as { id: string; curriculum_name: string; total_lessons: number; child_id: string | null }[]);
    if (wizardWasEdit && editingGoalId) {
      const updated = after.find((g) => g.id === editingGoalId);
      if (updated) {
        recordEvent("curriculum_goal.updated", {
          goal_id: updated.id,
          curriculum_name: updated.curriculum_name,
          // We don't have a per-field diff post-hoc; record the wizard
          // touched the goal (1 logical change). The Recent Changes card
          // collapses to "Edited curriculum X" without a count.
          changed_field_count: 0,
        });
      }
    } else {
      const created = after.find((g) => !priorIds.has(g.id));
      if (created) {
        recordEvent("curriculum_goal.created", {
          goal_id: created.id,
          curriculum_name: created.curriculum_name,
          total_lessons: created.total_lessons,
          child_id: created.child_id,
        });
      }
    }
    reloadGoals();
    reload();
  }, [effectiveUserId, wizardEditData, wizardWasEdit, curriculumGoals, recordEvent, reload, reloadGoals]);

  const handleConfirmDeleteGoal = useCallback(async () => {
    if (!deleteGoalConfirm) return;
    const { goal } = deleteGoalConfirm;
    setDeleteGoalConfirm(null);
    try {
      // Match legacy: delete the goal AND its lessons. Lessons cascade is
      // not enabled in the schema, so we do it explicitly.
      await supabase.from("lessons").delete().eq("curriculum_goal_id", goal.id);
      await supabase.from("curriculum_goals").delete().eq("id", goal.id);
    } catch {
      flashNotice("Couldn't delete curriculum — try again.");
      return;
    }
    recordEvent("curriculum_goal.deleted", {
      goal_id: goal.id,
      curriculum_name: goal.curriculum_name,
    });
    setOpenBackfillGoalId((id) => (id === goal.id ? null : id));
    reloadGoals();
    reload();
  }, [deleteGoalConfirm, recordEvent, reloadGoals, reload]);

  const handleActivityOpenCreate = useCallback(() => {
    setActivityEditing(null);
    setActivityModalOpen(true);
  }, []);

  const handleActivityOpenEdit = useCallback(async (activity: ActivityRow) => {
    if (!effectiveUserId) return;
    // Pull the full row before opening so the modal has all fields.
    const { data } = await supabase
      .from("activities")
      .select("id, name, emoji, frequency, days, duration_minutes, scheduled_start_time, child_ids, location")
      .eq("id", activity.id)
      .maybeSingle();
    if (!data) return;
    setActivityEditing(data as unknown as EditableActivity);
    setActivityModalOpen(true);
  }, [effectiveUserId]);

  const handleActivitySaved = useCallback(async () => {
    const priorIds = new Set(activities.map((a) => a.id));
    const editingId = activityEditing?.id;
    setActivityModalOpen(false);
    setActivityEditing(null);
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from("activities")
      .select("id, name, emoji")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true);
    const after = ((data ?? []) as ActivityRow[]);
    if (editingId) {
      const updated = after.find((a) => a.id === editingId);
      if (updated) {
        recordEvent("activity.updated", {
          activity_id: updated.id,
          name: updated.name,
          emoji: updated.emoji,
        });
      }
    } else {
      const created = after.find((a) => !priorIds.has(a.id));
      if (created) {
        recordEvent("activity.created", {
          activity_id: created.id,
          name: created.name,
          emoji: created.emoji,
        });
      }
    }
    reloadActivities();
  }, [effectiveUserId, activities, activityEditing, recordEvent, reloadActivities]);

  const handleConfirmDeleteActivity = useCallback(async () => {
    if (!deleteActivityConfirm) return;
    const a = deleteActivityConfirm;
    setDeleteActivityConfirm(null);
    try {
      // Soft-delete to match legacy (is_active = false).
      await supabase.from("activities").update({ is_active: false }).eq("id", a.id);
    } catch {
      flashNotice("Couldn't delete activity — try again.");
      return;
    }
    recordEvent("activity.deleted", {
      activity_id: a.id,
      name: a.name,
      emoji: a.emoji,
    });
    reloadActivities();
  }, [deleteActivityConfirm, recordEvent, reloadActivities]);

  const handleBackfillSubmit = useCallback(async (
    goalId: string,
    entries: BackfillEntry[],
  ): Promise<void> => {
    if (!effectiveUserId) throw new Error("Not signed in");
    const goal = curriculumGoals.find((g) => g.id === goalId);
    const childId = goal?.child_id ?? null;
    const insertRows = entries.map((e) => ({
      user_id: effectiveUserId,
      child_id: childId,
      curriculum_goal_id: goalId,
      title: `${goal?.curriculum_name ?? "Lesson"} — backfill`,
      scheduled_date: e.date,
      date: e.date,
      completed: true,
      completed_at: new Date(`${e.date}T12:00:00`).toISOString(),
      minutes_spent: e.minutes,
      hours: e.minutes / 60,
      notes: e.notes,
      is_backfill: true,
    }));
    const { data: inserted, error } = await supabase
      .from("lessons")
      .insert(insertRows)
      .select("id, title, scheduled_date");
    if (error) throw new Error(error.message);
    const rows = (inserted ?? []) as { id: string; title: string | null; scheduled_date: string | null }[];
    for (const r of rows) {
      recordEvent("lesson.created", {
        lesson_id: r.id,
        lesson_title: r.title ?? "",
        date: r.scheduled_date ?? "",
        curriculum_goal_id: goalId,
        actor: "backfill",
      });
    }
    reload();
  }, [effectiveUserId, curriculumGoals, recordEvent, reload]);

  const handleGenerateReport = useCallback(async (opts: {
    childId: string | null;
    range: ReportRangePreset;
    customStart?: string;
    customEnd?: string;
    includeActivities: boolean;
  }) => {
    if (!effectiveUserId) throw new Error("Not signed in");
    const { data: prof } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", effectiveUserId)
      .maybeSingle();
    const familyName = (prof as { display_name?: string } | null)?.display_name || "Family Academy";
    await downloadProgressReport({
      userId: effectiveUserId,
      familyName,
      children: kids.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      childId: opts.childId,
      range: opts.range,
      customStart: opts.customStart,
      customEnd: opts.customEnd,
      includeActivities: opts.includeActivities,
    });
  }, [effectiveUserId, kids]);

  // ── Print handler — sets body class, calls window.print(), cleans up ────
  // The print sheets render off-screen always; @media print + the body
  // class flips visibility for exactly one sheet.
  const canPrintPaid = canExport({ is_pro: isPro, trial_started_at: trialStartedAt });
  const handlePickPrintMode = useCallback((mode: PlanPrintMode) => {
    if ((mode === "weekly" || mode === "monthly") && !canPrintPaid) {
      // The dialog renders these tiles as Links to /upgrade for free
      // users, so onPick should never fire — but defensive belt+braces.
      window.location.href = "/upgrade";
      return;
    }
    setPrintDialogOpen(false);
    setActivePrintMode(mode);
    const cls = `print-mode-${mode}`;
    document.body.classList.add(cls);
    const cleanup = () => {
      document.body.classList.remove(cls);
      setActivePrintMode(null);
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // Defer to next frame so React has flushed the activePrintMode-driven
    // re-render before the print preview snapshots the DOM.
    window.requestAnimationFrame(() => window.print());
  }, [canPrintPaid]);

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

  // Missed = scheduled_date before today AND not completed. Uses filteredLessons
  // so the banner respects the active child filter chips (Amanda grades one
  // child at a time and doesn't want bulk actions to leak across kids).
  const missedLessonsInView = useMemo<PlanV2Lesson[]>(() => {
    return filteredLessons
      .filter((l) => {
        const d = l.scheduled_date ?? l.date;
        return !!d && d < todayStr && !l.completed;
      })
      .sort((a, b) =>
        ((a.scheduled_date ?? a.date) ?? "").localeCompare((b.scheduled_date ?? b.date) ?? ""),
      );
  }, [filteredLessons, todayStr]);

  // Future lessons (>= today, incomplete) — needed by the push-back modal.
  // The calendar load window limits this to the visible month, but for the
  // push-back math we want EVERY future lesson regardless of month; see
  // below where we lazily load the wider set at the moment push-back fires.
  const futureLessonsInView = useMemo<PlanV2Lesson[]>(() => {
    return filteredLessons
      .filter((l) => {
        const d = l.scheduled_date ?? l.date;
        return !!d && d >= todayStr && !l.completed;
      })
      .sort((a, b) =>
        ((a.scheduled_date ?? a.date) ?? "").localeCompare((b.scheduled_date ?? b.date) ?? ""),
      );
  }, [filteredLessons, todayStr]);

  // Distinct subject names in view — for StatsBar.
  const subjectCountInView = useMemo(() => {
    const s = new Set<string>();
    for (const l of filteredLessons) {
      const n = l.subjects?.name;
      if (n) s.add(n);
    }
    return s.size;
  }, [filteredLessons]);

  // Catch-up threshold: 5+ past incomplete spanning 2+ distinct days AND
  // the 7-day dismissal window has elapsed. Dismissal count doesn't scope
  // to child filter — if the user is behind with ANY child filter off, we
  // still respect the pause.
  const showCatchUpBanner = useMemo(() => {
    if (Date.now() < catchUpSuppressedUntil) return false;
    if (missedLessonsInView.length < 5) return false;
    const distinctDates = new Set<string>();
    for (const l of missedLessonsInView) {
      const d = l.scheduled_date ?? l.date;
      if (d) distinctDates.add(d);
      if (distinctDates.size >= 2) break;
    }
    return distinctDates.size >= 2;
  }, [missedLessonsInView, catchUpSuppressedUntil]);

  function prevMonth() {
    if (viewMode === "week") {
      setWeekStart((d) => {
        const next = new Date(d);
        next.setDate(next.getDate() - 7);
        // Keep monthStart in sync so the loaded data window slides too.
        setMonthStart(firstOfMonth(next));
        return next;
      });
      return;
    }
    setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  function nextMonth() {
    if (viewMode === "week") {
      setWeekStart((d) => {
        const next = new Date(d);
        next.setDate(next.getDate() + 7);
        setMonthStart(firstOfMonth(next));
        return next;
      });
      return;
    }
    setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  function jumpToToday() {
    const now = new Date();
    if (viewMode === "week") {
      const sun = new Date(now);
      sun.setHours(0, 0, 0, 0);
      sun.setDate(sun.getDate() - sun.getDay());
      setWeekStart(sun);
    }
    setMonthStart(firstOfMonth(now));
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
    async (lessonId: string, fromDateStr: string, toDateStr: string, actor: "user" | "drag" = "user") => {
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

      // Record the move. Single events (actor user/drag) go through
      // lesson.moved — bulk paths use their own lesson.bulk_action.
      recordEvent("lesson.moved", {
        lesson_id: lessonId,
        lesson_title: label,
        from_date: fromDateStr,
        to_date: toDateStr,
        actor,
      });

      reload();
    },
    [lessons, vacationBlocks, setLessons, reload, flagLanded, recordEvent],
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
      void performMove(aData.lessonId, aData.sourceDateStr, oData.dateStr, "drag");
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

    recordEvent("lesson.bulk_action", {
      action: "move",
      count: moves.length,
      lesson_ids: moves.map((m) => m.id),
      from_dates: moves.map((m) => m.from),
      to_date: toDateStr,
      succeeded: succeeded.length,
      failed: failedIds.length,
    });

    reload();
    setBulkBusy(false);
    exitSelectMode();
  }, [lessons, vacationBlocks, setLessons, reload, flagLanded, exitSelectMode, recordEvent]);

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

    const fromDatesForLog = toComplete
      .map((id) => {
        const l = lessons.find((x) => x.id === id);
        return l?.scheduled_date ?? l?.date ?? null;
      })
      .filter((d): d is string => !!d);
    recordEvent("lesson.bulk_action", {
      action: "mark_done",
      count: toComplete.length,
      lesson_ids: toComplete,
      from_dates: fromDatesForLog,
      succeeded: succeededIds.length,
      failed: failedIds.length,
    });

    reload();
    setBulkBusy(false);
    exitSelectMode();
  }, [lessons, setLessons, reload, exitSelectMode, recordEvent]);

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

    recordEvent("lesson.bulk_action", {
      action: "skip",
      count: snap.length,
      lesson_ids: snap.map((s) => s.id),
      from_dates: snap.map((s) => s.from),
      succeeded: succeeded.length,
      failed: failedIds.length,
    });

    reload();
    setBulkBusy(false);
    exitSelectMode();
  }, [lessons, setLessons, reload, exitSelectMode, flagLanded, recordEvent]);

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

    // Log on initiation. The actual DB delete runs 30s later unless the
    // user taps Undo — the audit trail intentionally records intent, not
    // the eventual DB outcome, which is more useful for "what did I just
    // do?" than "did the write finally commit?".
    recordEvent("lesson.bulk_action", {
      action: "delete",
      count: rows.length,
      lesson_ids: rows.map((r) => r.id),
      from_dates: rows
        .map((r) => r.scheduled_date ?? r.date ?? null)
        .filter((d): d is string => !!d),
      succeeded: rows.length,
      failed: 0,
    });

    exitSelectMode();
  }, [lessons, setLessons, reload, exitSelectMode, commitPendingBulkDelete, recordEvent]);

  // ── Catch-up + push-back handlers ────────────────────────────────────────
  // Each of these owns: pre-mutation snapshot, batch UPDATE with
  // partial-failure tolerance, audit event, and universal-undo registration.
  // Undo restores each lesson's prior scheduled_date by id.

  const batchUpdateScheduledDates = useCallback(
    async (pairs: { id: string; date: string }[]): Promise<{ succeededIds: Set<string>; failedIds: Set<string> }> => {
      const succeededIds = new Set<string>();
      const failedIds = new Set<string>();
      // Chunk of 20 is the same step legacy uses — a balance between
      // Postgres round-trip count and Supabase PostgREST row-limit quirks.
      for (let i = 0; i < pairs.length; i += 20) {
        const slice = pairs.slice(i, i + 20);
        const results = await Promise.allSettled(
          slice.map((p) =>
            supabase
              .from("lessons")
              .update({ scheduled_date: p.date, date: p.date })
              .eq("id", p.id)
              .then(({ error }) => (error ? Promise.reject(error) : true)),
          ),
        );
        results.forEach((r, idx) => {
          if (r.status === "fulfilled") succeededIds.add(slice[idx].id);
          else failedIds.add(slice[idx].id);
        });
      }
      return { succeededIds, failedIds };
    },
    [],
  );

  const handleCatchUpShiftConfirm = useCallback(async (moves: ShiftMove[]) => {
    if (moves.length === 0) return;
    setBulkBusy(true);

    // Optimistic local update.
    const movesById = new Map(moves.map((m) => [m.lesson.id, m]));
    setLessons((prev) =>
      prev.map((l) => {
        const m = movesById.get(l.id);
        return m ? { ...l, scheduled_date: m.toDate, date: m.toDate } : l;
      }),
    );
    moves.forEach((m) => flagLanded(m.lesson.id));
    hapticTap(20);

    const pairs = moves.map((m) => ({ id: m.lesson.id, date: m.toDate }));
    const { succeededIds, failedIds } = await batchUpdateScheduledDates(pairs);
    const succeeded = moves.filter((m) => succeededIds.has(m.lesson.id));

    // Rollback any failures locally.
    if (failedIds.size > 0) {
      setLessons((prev) =>
        prev.map((l) => {
          const m = movesById.get(l.id);
          if (!m || !failedIds.has(l.id)) return l;
          return { ...l, scheduled_date: m.fromDate, date: m.fromDate };
        }),
      );
    }

    recordEvent("lesson.bulk_action", {
      action: "catch_up_shift",
      count: moves.length,
      lesson_ids: moves.map((m) => m.lesson.id),
      from_dates: moves.map((m) => m.fromDate),
      to_dates: moves.map((m) => m.toDate),
      succeeded: succeededIds.size,
      failed: failedIds.size,
    });

    if (succeeded.length > 0) {
      setUndoAction({
        message:
          failedIds.size > 0
            ? `Shifted ${succeeded.length} of ${moves.length} forward — ${failedIds.size} couldn't move`
            : `Shifted ${succeeded.length} lesson${succeeded.length === 1 ? "" : "s"} forward`,
        key: `catch-up:${Date.now()}`,
        onUndo: async () => {
          setLessons((prev) =>
            prev.map((l) => {
              const m = movesById.get(l.id);
              if (!m || !succeededIds.has(l.id)) return l;
              return { ...l, scheduled_date: m.fromDate, date: m.fromDate };
            }),
          );
          hapticTap(20);
          succeeded.forEach((m) => flagLanded(m.lesson.id));
          await batchUpdateScheduledDates(
            succeeded.map((m) => ({ id: m.lesson.id, date: m.fromDate })),
          );
          reload();
        },
      });
    } else {
      flashNotice(`Couldn't shift ${failedIds.size} lesson${failedIds.size === 1 ? "" : "s"}.`);
    }

    reload();
    setBulkBusy(false);
  }, [setLessons, flagLanded, batchUpdateScheduledDates, recordEvent, reload]);

  const handlePushBackConfirm = useCallback(async (args: {
    futureMoves: PushBackMove[];
    missedMoves: PushBackMove[];
    shiftDays: number;
  }) => {
    const { futureMoves, missedMoves, shiftDays } = args;
    if (futureMoves.length === 0 && missedMoves.length === 0) return;
    setBulkBusy(true);

    const allMoves = [...futureMoves, ...missedMoves];
    const movesById = new Map(allMoves.map((m) => [m.lesson.id, m]));

    // Optimistic local apply first — future + missed happen together.
    setLessons((prev) =>
      prev.map((l) => {
        const m = movesById.get(l.id);
        return m ? { ...l, scheduled_date: m.toDate, date: m.toDate } : l;
      }),
    );
    allMoves.forEach((m) => flagLanded(m.lesson.id));
    hapticTap(20);

    // Future first, missed second. If future fails we still try missed —
    // they target vacated slots regardless and can be undone as a unit.
    const pairs = allMoves.map((m) => ({ id: m.lesson.id, date: m.toDate }));
    const { succeededIds, failedIds } = await batchUpdateScheduledDates(pairs);
    const futureSucceeded = futureMoves.filter((m) => succeededIds.has(m.lesson.id));
    const missedSucceeded = missedMoves.filter((m) => succeededIds.has(m.lesson.id));

    // Roll back any failures locally.
    if (failedIds.size > 0) {
      setLessons((prev) =>
        prev.map((l) => {
          if (!failedIds.has(l.id)) return l;
          const m = movesById.get(l.id);
          if (!m) return l;
          return { ...l, scheduled_date: m.fromDate, date: m.fromDate };
        }),
      );
    }

    // Two distinct audit events so the Recent Changes card summarizes
    // each half of the rebalance independently.
    if (futureMoves.length > 0) {
      recordEvent("lesson.bulk_action", {
        action: "push_back_future",
        count: futureMoves.length,
        lesson_ids: futureMoves.map((m) => m.lesson.id),
        from_dates: futureMoves.map((m) => m.fromDate),
        to_dates: futureMoves.map((m) => m.toDate),
        school_days_shifted: shiftDays,
        succeeded: futureSucceeded.length,
        failed: futureMoves.length - futureSucceeded.length,
      });
    }
    if (missedMoves.length > 0) {
      recordEvent("lesson.bulk_action", {
        action: "push_back_missed_fit",
        count: missedMoves.length,
        lesson_ids: missedMoves.map((m) => m.lesson.id),
        from_dates: missedMoves.map((m) => m.fromDate),
        to_dates: missedMoves.map((m) => m.toDate),
        succeeded: missedSucceeded.length,
        failed: missedMoves.length - missedSucceeded.length,
      });
    }

    const totalSucceeded = succeededIds.size;
    if (totalSucceeded > 0) {
      const allSucceeded = allMoves.filter((m) => succeededIds.has(m.lesson.id));
      setUndoAction({
        message: `Pushed schedule back by ${shiftDays} school day${shiftDays === 1 ? "" : "s"}`,
        key: `push-back:${Date.now()}`,
        onUndo: async () => {
          setLessons((prev) =>
            prev.map((l) => {
              const m = movesById.get(l.id);
              if (!m || !succeededIds.has(l.id)) return l;
              return { ...l, scheduled_date: m.fromDate, date: m.fromDate };
            }),
          );
          hapticTap(20);
          allSucceeded.forEach((m) => flagLanded(m.lesson.id));
          await batchUpdateScheduledDates(
            allSucceeded.map((m) => ({ id: m.lesson.id, date: m.fromDate })),
          );
          reload();
        },
      });
    } else {
      flashNotice("Couldn't push the schedule back — check your connection.");
    }

    reload();
    setBulkBusy(false);
  }, [setLessons, flagLanded, batchUpdateScheduledDates, recordEvent, reload]);

  // ── Vacation block modal handlers ────────────────────────────────────────

  const openVacationModalCreate = useCallback((initialDate?: string) => {
    setVacationModalInitialDate(initialDate ?? null);
    setVacationModalExisting(null);
    setVacationModalOpen(true);
  }, []);

  const openVacationModalEdit = useCallback((block: VacationBlockExisting) => {
    setVacationModalInitialDate(null);
    setVacationModalExisting(block);
    setVacationModalOpen(true);
  }, []);

  const handleVacationSave = useCallback(async (values: VacationBlockSave) => {
    if (!effectiveUserId) throw new Error("Not signed in");

    if (vacationModalExisting) {
      // Edit: simple UPDATE. No shift on edit (see VacationBlockModal docs).
      const { error } = await supabase
        .from("vacation_blocks")
        .update({
          name: values.name,
          start_date: values.start_date,
          end_date: values.end_date,
        })
        .eq("id", vacationModalExisting.id);
      if (error) throw new Error(error.message);
      reload();
      return;
    }

    // Create path
    const { data: inserted, error } = await supabase
      .from("vacation_blocks")
      .insert({
        user_id: effectiveUserId,
        name: values.name,
        start_date: values.start_date,
        end_date: values.end_date,
      })
      .select("id, name, start_date, end_date")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Insert failed");
    const newId = (inserted as { id: string }).id;

    let shiftApplied = false;
    const shiftPairs: { id: string; date: string; fromDate: string }[] = [];
    if (values.apply_shift) {
      // How many teaching days does the break span? That's the forward shift.
      const shiftDays = countSchoolDaysInRange(
        values.start_date,
        values.end_date,
        schoolDays,
        vacationBlocks.filter((b) => b.id !== newId), // exclude the just-inserted block
      );
      if (shiftDays > 0) {
        const { data: affected } = await supabase
          .from("lessons")
          .select("id, scheduled_date, date")
          .eq("user_id", effectiveUserId)
          .eq("completed", false)
          .gte("scheduled_date", values.start_date);
        const rows = (affected ?? []) as { id: string; scheduled_date: string | null; date: string | null }[];
        const blocksIncludingNew = [
          ...vacationBlocks,
          { id: newId, name: values.name, start_date: values.start_date, end_date: values.end_date },
        ];
        for (const l of rows) {
          const orig = l.scheduled_date ?? l.date ?? values.start_date;
          const next = nthSchoolDay(orig, schoolDays, shiftDays, blocksIncludingNew);
          shiftPairs.push({ id: l.id, date: next, fromDate: orig });
        }
        if (shiftPairs.length > 0) {
          await batchUpdateScheduledDates(
            shiftPairs.map((p) => ({ id: p.id, date: p.date })),
          );
          shiftApplied = true;
        }
      }
    }

    recordEvent("vacation_block.created", {
      vacation_block_id: newId,
      name: values.name,
      start_date: values.start_date,
      end_date: values.end_date,
      shift_applied: shiftApplied,
    });

    const rangeLabel =
      values.start_date === values.end_date
        ? new Date(`${values.start_date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : `${new Date(`${values.start_date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(`${values.end_date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    setUndoAction({
      message: shiftApplied
        ? `Added break: ${values.name} (${rangeLabel}) · lessons shifted`
        : `Added break: ${values.name} (${rangeLabel})`,
      key: `vac-create:${newId}`,
      onUndo: async () => {
        try {
          await supabase.from("vacation_blocks").delete().eq("id", newId);
        } catch { /* best-effort */ }
        if (shiftPairs.length > 0) {
          await batchUpdateScheduledDates(
            shiftPairs.map((p) => ({ id: p.id, date: p.fromDate })),
          );
        }
        recordEvent("vacation_block.deleted", {
          vacation_block_id: newId,
          name: values.name,
          start_date: values.start_date,
          end_date: values.end_date,
          shift_applied: shiftApplied,
        });
        reload();
      },
    });

    reload();
  }, [effectiveUserId, schoolDays, vacationBlocks, vacationModalExisting, batchUpdateScheduledDates, recordEvent, reload]);

  const handleVacationDelete = useCallback(async (shiftBack: boolean) => {
    if (!vacationModalExisting) return;
    const { id, name, start_date, end_date, shift_applied } = vacationModalExisting;

    // Capture any shift-back pairs first (while the block still exists
    // in memory, so nthSchoolDay doesn't un-skip days it was skipping).
    const shiftBackPairs: { id: string; date: string; fromDate: string }[] = [];
    if (shiftBack && shift_applied && effectiveUserId) {
      const shiftDays = countSchoolDaysInRange(
        start_date,
        end_date,
        schoolDays,
        vacationBlocks.filter((b) => b.id !== id),
      );
      if (shiftDays > 0) {
        const { data: affected } = await supabase
          .from("lessons")
          .select("id, scheduled_date, date")
          .eq("user_id", effectiveUserId)
          .eq("completed", false)
          .gte("scheduled_date", start_date);
        const rows = (affected ?? []) as { id: string; scheduled_date: string | null; date: string | null }[];
        const blocksWithout = vacationBlocks.filter((b) => b.id !== id);
        // Shift back = the inverse: find each lesson's scheduled_date,
        // walk BACKWARD by shiftDays teaching days. We don't have a
        // previousSchoolDay helper here — easy to derive by scanning
        // one day at a time.
        for (const l of rows) {
          const orig = l.scheduled_date ?? l.date;
          if (!orig) continue;
          const cursor = new Date(`${orig}T12:00:00`);
          let found = 0;
          let iters = 0;
          while (found < shiftDays && iters < 365) {
            cursor.setDate(cursor.getDate() - 1);
            const s = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
            const dayIdx = cursor.getDay();
            const dayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dayIdx];
            const isSchool = schoolDays.includes(dayName);
            const inVac = blocksWithout.some((b) => s >= b.start_date && s <= b.end_date);
            if (isSchool && !inVac) found++;
            iters++;
            if (found === shiftDays) {
              shiftBackPairs.push({ id: l.id, date: s, fromDate: orig });
              break;
            }
          }
        }
      }
    }

    const { error } = await supabase.from("vacation_blocks").delete().eq("id", id);
    if (error) throw new Error(error.message);

    if (shiftBackPairs.length > 0) {
      await batchUpdateScheduledDates(
        shiftBackPairs.map((p) => ({ id: p.id, date: p.date })),
      );
    }

    recordEvent("vacation_block.deleted", {
      vacation_block_id: id,
      name,
      start_date,
      end_date,
      shift_applied: !!shift_applied,
    });

    setUndoAction({
      message: `Deleted break: ${name}`,
      key: `vac-delete:${id}`,
      onUndo: async () => {
        // Re-insert the block + re-apply forward shift pairs (reverses
        // the shift-back, if any). We insert without the original id
        // since Postgres won't accept it back — a fresh id is fine
        // because audit rows are pinned to the original id.
        try {
          await supabase.from("vacation_blocks").insert({
            user_id: effectiveUserId,
            name,
            start_date,
            end_date,
          });
        } catch { /* best-effort */ }
        if (shiftBackPairs.length > 0) {
          await batchUpdateScheduledDates(
            shiftBackPairs.map((p) => ({ id: p.id, date: p.fromDate })),
          );
        }
        reload();
      },
    });

    reload();
  }, [effectiveUserId, schoolDays, vacationBlocks, vacationModalExisting, batchUpdateScheduledDates, recordEvent, reload]);

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

  const handleMenuAddLesson = useCallback((dateStr?: string) => {
    setContextMenu(null);
    setAddLessonInitialDate(dateStr ?? todayStr);
    setAddLessonOpen(true);
  }, [todayStr]);

  const handleMenuAddAppointment = useCallback((dateStr: string) => {
    setContextMenu(null);
    setApptWizardDate(dateStr);
  }, []);

  // "Mark as break day" — opens the full vacation block modal. If the
  // clicked date is already inside an existing block we enter edit mode
  // on that block; otherwise we enter create mode pre-seeded to the date.
  const handleMenuMarkBreak = useCallback((dateStr: string) => {
    setContextMenu(null);
    const existing = vacationBlocks.find(
      (b) => dateStr >= b.start_date && dateStr <= b.end_date,
    );
    if (existing) {
      openVacationModalEdit({
        id: existing.id,
        name: existing.name,
        start_date: existing.start_date,
        end_date: existing.end_date,
      });
    } else {
      openVacationModalCreate(dateStr);
    }
  }, [vacationBlocks, openVacationModalCreate, openVacationModalEdit]);

  // Legacy single-day insert path — retained under a new name in case we
  // want to bring it back from the keyboard shortcut later. Currently
  // unreachable; the context menu uses the modal-driven flow above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMenuMarkBreakLegacy = useCallback(async (dateStr: string) => {
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
          recordEvent("vacation_block.deleted", {
            vacation_block_id: insertedId,
            name: "Break",
            start_date: dateStr,
            end_date: dateStr,
          });
          reload();
        },
      });
      recordEvent("vacation_block.created", {
        vacation_block_id: insertedId,
        name: "Break",
        start_date: dateStr,
        end_date: dateStr,
      });
      reload();
    } catch {
      flashNotice("Couldn't save — check your connection and try again.");
    }
  }, [effectiveUserId, reload, recordEvent]);

  // Global Escape handler — unwinds the top-most open UI in a predictable
  // order. Also powers keyboard nav #4 in the Phase 9 spec.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (printDialogOpen) { setPrintDialogOpen(false); return; }
      if (schoolYearModalOpen) { setSchoolYearModalOpen(false); return; }
      if (deleteGoalConfirm) { setDeleteGoalConfirm(null); return; }
      if (deleteActivityConfirm) { setDeleteActivityConfirm(null); return; }
      if (reportDialogOpen) { setReportDialogOpen(false); return; }
      if (activityModalOpen) { setActivityModalOpen(false); setActivityEditing(null); return; }
      if (wizardOpen) { setWizardOpen(false); setWizardEditData(null); return; }
      if (vacationModalOpen) { setVacationModalOpen(false); return; }
      if (pushBackOpen) { setPushBackOpen(false); return; }
      if (shiftForwardOpen) { setShiftForwardOpen(false); return; }
      if (addLessonOpen) { setAddLessonOpen(false); return; }
      if (editLessonTarget) { setEditLessonTarget(null); return; }
      if (rescheduleTarget) { setRescheduleTarget(null); return; }
      if (apptEditTarget) { setApptEditTarget(null); return; }
      if (openDayStr) { setOpenDayStr(null); return; }
      if (contextMenu) { setContextMenu(null); return; }
      if (moveTargetMode) { setMoveTargetMode(false); return; }
      if (selectMode) { exitSelectMode(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [printDialogOpen, schoolYearModalOpen, deleteGoalConfirm, deleteActivityConfirm, reportDialogOpen, activityModalOpen, wizardOpen, vacationModalOpen, pushBackOpen, shiftForwardOpen, addLessonOpen, editLessonTarget, rescheduleTarget, apptEditTarget, openDayStr, contextMenu, moveTargetMode, selectMode, exitSelectMode]);

  // Announce universal-undo messages to screen readers when they appear.
  useEffect(() => {
    if (undoAction?.message) announce(undoAction.message);
  }, [undoAction, announce]);

  const viewingCurrentMonth =
    viewMode === "week"
      ? (() => {
          const now = new Date(); now.setHours(0, 0, 0, 0);
          const sun = new Date(now);
          sun.setDate(sun.getDate() - sun.getDay());
          return weekStart.getFullYear() === sun.getFullYear() &&
                 weekStart.getMonth() === sun.getMonth() &&
                 weekStart.getDate() === sun.getDate();
        })()
      : (monthStart.getFullYear() === new Date().getFullYear() &&
         monthStart.getMonth() === new Date().getMonth());

  const monthLabel = (() => {
    if (viewMode === "week") {
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 6);
      const sameMonth = end.getMonth() === weekStart.getMonth();
      const startStr = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const endStr = sameMonth
        ? end.toLocaleDateString("en-US", { day: "numeric" })
        : end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `${startStr} – ${endStr}, ${weekStart.getFullYear()}`;
    }
    return monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  })();
  const monthLabelWithEmoji = `${headerSeasonalEmoji} ${monthLabel}`;

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

        {/* Stats bar — viewport totals (lessons, hours, subjects, books,
            field trips). Updates as the month/child filter changes. */}
        {!loading ? (
          <StatsBar
            lessonsInView={filteredLessons}
            memoriesInRange={memoriesInRange}
            subjectCount={subjectCountInView}
          />
        ) : null}

        {/* Catch-up banner — above MissedLessonsBanner when the user has a
            meaningful backlog (5+ across 2+ days) and hasn't dismissed it
            within the last 7 days. Handles bulk "shift everything" flows;
            MissedLessonsBanner handles per-row and select-all flows. */}
        {!loading && showCatchUpBanner ? (
          <CatchUpBanner
            count={missedLessonsInView.length}
            onShiftForward={() => setShiftForwardOpen(true)}
            onPushBack={() => setPushBackOpen(true)}
            onDismiss={dismissCatchUp}
          />
        ) : null}

        {/* Missed-lessons banner — above the calendar card so partners who
            grade after the fact can bulk-close the backlog in two clicks.
            Per-row Reschedule opens the same RescheduleDialog used by the day
            panel; "Mark all done" calls performBulkMarkDone which fires the
            universal undo bar; "Select all" enters the existing multi-select
            mode with the banner items pre-selected. */}
        {!loading ? (
          <MissedLessonsBanner
            missedLessons={missedLessonsInView}
            busy={bulkBusy}
            onMarkAllDone={() => {
              const ids = missedLessonsInView.map((l) => l.id);
              if (ids.length === 0) return;
              void performBulkMarkDone(ids);
            }}
            onSelectAll={() => {
              const ids = missedLessonsInView.map((l) => l.id);
              if (ids.length === 0) return;
              setSelectMode(true);
              setSelectedIds(new Set(ids));
              setMoveTargetMode(false);
              hapticTap(20);
            }}
            onReschedule={(lesson) => {
              const fromDateStr = lesson.scheduled_date ?? lesson.date ?? null;
              if (!fromDateStr) {
                flashNotice("This lesson isn't on the calendar yet — edit it from the Plan page.");
                return;
              }
              setRescheduleTarget({ lessonId: lesson.id, fromDateStr });
            }}
          />
        ) : null}

        {(
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
                <span className="text-[13px] font-semibold text-[#2D2A26] min-w-[140px] text-center">
                  {monthLabelWithEmoji}
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

              {showCreateSchoolYearCTA ? (
                <button
                  type="button"
                  onClick={() => setSchoolYearModalOpen(true)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#fef9e8] text-[#7a4a1a] border border-[#f0dda8] hover:bg-[#fef0d6] transition-colors"
                >
                  🎒 Create next school year
                </button>
              ) : null}

              <div className="flex-1" />

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setAddLessonInitialDate(todayStr); setAddLessonOpen(true); }}
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
                  onClick={() => openVacationModalCreate()}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-[#a07000] hover:bg-[#fef9e8] transition-colors"
                >
                  <Plus size={13} /> Break
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
                <button
                  type="button"
                  onClick={() => setReportDialogOpen(true)}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-[#5C5346] hover:bg-[#f0ede8] transition-colors"
                >
                  📄 Report
                </button>
                <button
                  type="button"
                  onClick={() => setPrintDialogOpen(true)}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-[#5C5346] hover:bg-[#f0ede8] transition-colors"
                >
                  🖨️ Print
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
                viewMode === "week" ? (
                  <WeekStrip
                    weekStart={weekStart}
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
                    onCellClick={(dateStr) => { if (!selectMode) setOpenDayStr(dateStr); }}
                    onLessonClick={(lesson) => {
                      if (selectMode) return;
                      const d = lesson.scheduled_date ?? lesson.date;
                      if (d) setOpenDayStr(d);
                    }}
                    onAppointmentClick={(appt) => { if (!selectMode) setOpenDayStr(appt.instance_date); }}
                    onOverflowClick={(dateStr) => { if (!selectMode) setOpenDayStr(dateStr); }}
                    onLessonLongPress={(lesson) => { if (!selectMode) enterSelectMode(lesson.id); }}
                    onLessonSelectToggle={(lesson) => toggleSelect(lesson.id)}
                    onMoveTargetPick={(dateStr) => { void performBulkMove(Array.from(selectedIds), dateStr); }}
                    onCellContextMenu={(dateStr, x, y) => { if (!selectMode) setContextMenu({ dateStr, x, y }); }}
                    holidays={holidaysMap}
                    milestones={milestonesMap}
                  />
                ) : (
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
                  holidays={holidaysMap}
                  milestones={milestonesMap}
                />
                )
              ) : (
                <DndContext
                  sensors={sensors}
                  // Switch from the default `rectIntersection` to
                  // `pointerWithin`. The default tests whether the
                  // DragOverlay's rect intersects each droppable's rect; with
                  // Week-view cells at 160px tall, that intersection becomes
                  // intermittent because the overlay's small pill ghost
                  // doesn't always cross enough of the larger droppable to
                  // register as "over". `pointerWithin` instead checks the
                  // cursor position itself — drop target = the cell under
                  // the cursor — which behaves identically in Month view
                  // (the cursor is over a cell when the ghost is too) and
                  // reliably in Week view regardless of cell size.
                  collisionDetection={pointerWithin}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  {viewMode === "week" ? (
                    <WeekStrip
                      weekStart={weekStart}
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
                      holidays={holidaysMap}
                      milestones={milestonesMap}
                    />
                  ) : (
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
                    holidays={holidaysMap}
                    milestones={milestonesMap}
                  />
                  )}
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

        {/* Recent changes audit card — lives under the calendar; the day
            detail panel is a fixed-position sheet so placement order here
            doesn't disturb it. */}
        {/* Curriculum panel — pace + progress + per-goal actions + backfill */}
        <CurriculumGroupsPanel
          goals={curriculumGoals}
          lessons={lessons}
          kids={kids}
          vacationBlocks={vacationBlocks}
          onCreate={handleWizardOpenCreate}
          onEdit={handleWizardOpenEdit}
          onDelete={(goal, count) => setDeleteGoalConfirm({ goal, lessonCount: count })}
          onToggleLesson={(id, current) => { void toggleLessonWithLog(id, current); }}
          onEditLesson={(l) => setEditLessonTarget(l)}
          onRescheduleLesson={(l) => {
            const fromDateStr = l.scheduled_date ?? l.date ?? null;
            if (!fromDateStr) {
              flashNotice("This lesson isn't scheduled — edit it from the Plan page.");
              return;
            }
            setRescheduleTarget({ lessonId: l.id, fromDateStr });
          }}
          onSkipLesson={(l) => { void skipLessonWithLog(l); }}
          onDeleteLesson={(l) => { void deleteLessonWithLog(l.id); }}
          onOpenBackfill={(g) => setOpenBackfillGoalId((id) => (id === g.id ? null : g.id))}
          openBackfillGoalId={openBackfillGoalId}
          renderBackfillPanel={(g) => (
            <BackfillPanel
              goalId={g.id}
              defaultMinutes={curriculumGoals.find((cg) => cg.id === g.id)?.default_minutes ?? 30}
              goalLessons={lessons.filter((l) => l.curriculum_goal_id === g.id)}
              schoolDays={schoolDays}
              vacationBlocks={vacationBlocks}
              onSubmit={(entries) => handleBackfillSubmit(g.id, entries)}
              onClose={() => setOpenBackfillGoalId(null)}
            />
          )}
        />

        {/* Activities panel — anything outside the curriculum (co-op, music…) */}
        <ActivitiesPanel
          activities={activities}
          onCreate={handleActivityOpenCreate}
          onEdit={handleActivityOpenEdit}
          onDelete={(a) => setDeleteActivityConfirm(a)}
        />

        <RecentChangesCard
          events={planEvents}
          onLoadMore={loadMorePlanEvents}
          loadingMore={planEventsLoadingMore}
          fullyLoaded={planEventsFullyLoaded}
        />

        {/* Day-detail sheet */}
        {openDayStr ? (() => {
          const panelLessons = toTodayLessons(
            lessons.filter((l) => (l.scheduled_date ?? l.date) === openDayStr),
          );
          const panelAppts = appointments.filter((a) => a.instance_date === openDayStr);
          const panelKids = toTodayKids(kids);
          const [y, m, d] = openDayStr.split("-").map(Number);
          const panelDate = new Date(y, m - 1, d);
          const dayEvents = filterEventsForDay(planEvents, openDayStr);
          return (
            <DayDetailPanelV2
              date={panelDate}
              lessons={panelLessons}
              appointments={panelAppts}
              kids={panelKids}
              isPartner={isPartner}
              variant="sheet"
              onClose={() => setOpenDayStr(null)}
              onToggleLesson={(id, current) => { void toggleLessonWithLog(id, current); }}
              onDeleteLesson={(id) => { void deleteLessonWithLog(id); }}
              onSkipLesson={(l) => {
                const full = lessons.find((x) => x.id === l.id);
                if (full) void skipLessonWithLog(full);
              }}
              onEditLesson={(l) => {
                const full = lessons.find((x) => x.id === l.id);
                if (!full) return;
                setOpenDayStr(null);
                setEditLessonTarget(full);
              }}
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
              onNotesUpdated={handleLessonNotesUpdated}
              dayEvents={dayEvents}
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
            onAddLesson={() => handleMenuAddLesson(contextMenu.dateStr)}
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
          onSaved={(info?: AppointmentSavedInfo) => {
            setApptWizardDate(null);
            setApptEditTarget(null);
            if (info?.id && info.title) {
              if (info.kind === "create" && info.date) {
                recordEvent("appointment.created", {
                  appointment_id: info.id,
                  title: info.title,
                  date: info.date,
                });
              } else if (info.kind === "update") {
                recordEvent("appointment.updated", {
                  appointment_id: info.id,
                  title: info.title,
                  changes: { date: info.date ?? null },
                });
              } else if (info.kind === "delete" && info.date) {
                recordEvent("appointment.deleted", {
                  appointment_id: info.id,
                  title: info.title,
                  date: info.date,
                });
              }
            }
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

        {/* Add lesson modal — opened from "+ Lesson" toolbar + day-cell
            context menu. Goal list is filtered per child inside the modal. */}
        <AddLessonModal
          isOpen={addLessonOpen}
          initialDate={addLessonInitialDate}
          childrenList={kids}
          goals={curriculumGoals}
          onClose={() => setAddLessonOpen(false)}
          onSubmit={handleSubmitAddLesson}
        />

        {/* Edit lesson modal — opened from the day-panel 3-dot "Edit" action. */}
        <EditLessonModal
          isOpen={editLessonTarget !== null}
          lesson={editLessonTarget}
          childrenList={kids}
          goals={curriculumGoals}
          onClose={() => setEditLessonTarget(null)}
          onSubmit={handleSubmitEditLesson}
        />

        {/* Catch-up modals + vacation modal */}
        <ShiftForwardModal
          isOpen={shiftForwardOpen}
          missed={missedLessonsInView}
          schoolDays={schoolDays}
          vacationBlocks={vacationBlocks}
          onClose={() => setShiftForwardOpen(false)}
          onConfirm={handleCatchUpShiftConfirm}
        />
        <PushBackModal
          isOpen={pushBackOpen}
          missed={missedLessonsInView}
          futureLessons={futureLessonsInView}
          schoolDays={schoolDays}
          vacationBlocks={vacationBlocks}
          onClose={() => setPushBackOpen(false)}
          onConfirm={handlePushBackConfirm}
        />
        <VacationBlockModal
          isOpen={vacationModalOpen}
          mode={vacationModalExisting ? "edit" : "create"}
          initialStartDate={vacationModalInitialDate ?? undefined}
          existing={vacationModalExisting}
          onClose={() => {
            setVacationModalOpen(false);
            setVacationModalExisting(null);
            setVacationModalInitialDate(null);
          }}
          onSave={handleVacationSave}
          onDelete={vacationModalExisting ? handleVacationDelete : undefined}
        />

        {/* Curriculum wizard — create + edit. Shared with the legacy page. */}
        {wizardOpen ? (
          <CurriculumWizard
            mode={wizardEditData ? "edit" : "create"}
            editData={wizardEditData ?? undefined}
            onClose={() => { setWizardOpen(false); setWizardEditData(null); }}
            onSaved={handleWizardSaved}
            showToast={flashNotice}
          />
        ) : null}

        {/* Activity setup modal — create + edit. */}
        {activityModalOpen ? (
          <ActivitySetupModal
            editingActivity={activityEditing}
            onClose={() => { setActivityModalOpen(false); setActivityEditing(null); }}
            onSaved={handleActivitySaved}
          />
        ) : null}

        {/* Progress report dialog */}
        <ProgressReportDialog
          isOpen={reportDialogOpen}
          kids={kids}
          onClose={() => setReportDialogOpen(false)}
          onGenerate={handleGenerateReport}
        />

        {/* Plan print dialog (Daily/Week/Month) */}
        <PlanPrintDialog
          isOpen={printDialogOpen}
          canPrintPaid={canPrintPaid}
          onClose={() => setPrintDialogOpen(false)}
          onPick={handlePickPrintMode}
        />

        {/* Print sheets — always rendered in DOM, hidden on screen via the
            scoped @media-not-print rule below. The body class
            `print-mode-{daily|weekly|monthly}` flips the visibility of
            exactly one sheet at print time via @media print rules. */}
        {(() => {
          const todayDate = new Date();
          const todayKey = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
          const allKidsSelected = childFilter.size === 0 || childFilter.size === kids.length;
          const filteredKids = allKidsSelected ? kids : kids.filter((k) => childFilter.has(k.id));
          const childLabel = filteredKids.length === 1
            ? `${filteredKids[0].name}'s Plan`
            : "All Kids";

          // Today-scoped lists for the Daily sheet.
          const todayLessons = filteredLessons.filter((l) => (l.scheduled_date ?? l.date) === todayKey);
          const todayAppts = filteredAppointments.filter((a) => a.instance_date === todayKey);

          // Week-scoped lists for the Weekly sheet — relative to the
          // calendar's weekStart (so user can navigate to a future week
          // and print that week).
          const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
          const weekStartKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
          const weekEndKey = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, "0")}-${String(weekEnd.getDate()).padStart(2, "0")}`;
          const weekLessons = filteredLessons.filter((l) => {
            const d = l.scheduled_date ?? l.date;
            return !!d && d >= weekStartKey && d <= weekEndKey;
          });
          const weekAppts = filteredAppointments.filter((a) =>
            a.instance_date >= weekStartKey && a.instance_date <= weekEndKey,
          );

          return (
            <div className="plan-print-host">
              {activePrintMode === "daily" ? (
                <DailyPrintSheet
                  date={todayDate}
                  childLabel={childLabel}
                  lessons={todayLessons}
                  appointments={todayAppts}
                  kids={filteredKids}
                />
              ) : null}
              {activePrintMode === "weekly" ? (
                <WeeklyPrintSheet
                  weekStart={weekStart}
                  childLabel={childLabel}
                  lessons={weekLessons}
                  appointments={weekAppts}
                  kids={filteredKids}
                />
              ) : null}
              {activePrintMode === "monthly" ? (
                <MonthlyPrintSheet
                  monthStart={monthStart}
                  childLabel={childLabel}
                  lessons={filteredLessons}
                  appointments={filteredAppointments}
                  vacationBlocks={vacationBlocks}
                  kids={filteredKids}
                />
              ) : null}
            </div>
          );
        })()}

        {/* Print isolation + @page rules. Lives in the page so the @page
            rule only applies while a print mode is active, leaving other
            printables (Year Planner / Yearbook PDF) unaffected. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
/* Off-screen on screen — only the sheet for the active print mode shows
   when the matching body class is present. */
.plan-print-host { display: none; }

@media print {
  body.print-mode-daily,
  body.print-mode-weekly,
  body.print-mode-monthly { background: #FAF7F0 !important; }

  body.print-mode-daily .plan-print-host,
  body.print-mode-weekly .plan-print-host,
  body.print-mode-monthly .plan-print-host { display: block; }

  body.print-mode-daily *,
  body.print-mode-weekly *,
  body.print-mode-monthly * { visibility: hidden !important; }
  body.print-mode-daily .plan-print-sheet,
  body.print-mode-daily .plan-print-sheet *,
  body.print-mode-weekly .plan-print-sheet,
  body.print-mode-weekly .plan-print-sheet *,
  body.print-mode-monthly .plan-print-sheet,
  body.print-mode-monthly .plan-print-sheet * { visibility: visible !important; }

  body.print-mode-daily .plan-print-sheet,
  body.print-mode-weekly .plan-print-sheet,
  body.print-mode-monthly .plan-print-sheet {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    margin: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
  body.print-mode-daily .plan-print-sheet *,
  body.print-mode-weekly .plan-print-sheet *,
  body.print-mode-monthly .plan-print-sheet * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Page orientation — portrait for daily, landscape for week/month. The
     @page rule is global per-document so the active body class drives which
     orientation the printer uses. The unused selectors below carry no
     state on a given print, so only one set of @page rules applies. */
  body.print-mode-daily { /* portrait */ }
  body.print-mode-weekly,
  body.print-mode-monthly { /* landscape — declared on @page below */ }
}

@media print {
  @page { size: letter; margin: 0.3in; }
}
@media print {
  body.print-mode-weekly,
  body.print-mode-monthly {
    /* landscape via inline style override below */
  }
}
`,
          }}
        />

        {/* When weekly/monthly is active, switch @page to landscape via an
            inline injected rule — keeps the daily portrait default working
            without conditionally regenerating the static stylesheet. */}
        {activePrintMode === "weekly" || activePrintMode === "monthly" ? (
          <style
            dangerouslySetInnerHTML={{
              __html: `@media print { @page { size: letter landscape; margin: 0.3in; } }`,
            }}
          />
        ) : null}

        {/* Create School Year modal — opened from the toolbar CTA when the
            user has no upcoming year (or the current year ends within 60d). */}
        {schoolYearModalOpen && effectiveUserId ? (
          <CreateSchoolYearModal
            userId={effectiveUserId}
            activeYearName={schoolYears.active?.name}
            onClose={() => setSchoolYearModalOpen(false)}
            onCreated={async () => {
              await schoolYears.reload();
              // The hook just refreshed; the upcoming row is what we just
              // inserted. Audit-log it (best-effort lookup by latest start
              // date so we capture the right row).
              const { data } = await supabase
                .from("school_years")
                .select("id, name, start_date, end_date")
                .eq("user_id", effectiveUserId)
                .eq("status", "upcoming")
                .order("start_date", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (data) {
                const row = data as { id: string; name: string; start_date: string; end_date: string };
                recordEvent("school_year.created", {
                  school_year_id: row.id,
                  name: row.name,
                  start_date: row.start_date,
                  end_date: row.end_date,
                });
              }
            }}
          />
        ) : null}

        {/* Curriculum delete confirm */}
        {deleteGoalConfirm ? (
          <ConfirmDialog
            title={`Delete ${deleteGoalConfirm.goal.curriculum_name}?`}
            body={`This removes the goal and ${deleteGoalConfirm.lessonCount} lesson${deleteGoalConfirm.lessonCount === 1 ? "" : "s"} tied to it. Memories and activities are unaffected.`}
            confirmLabel="Delete curriculum"
            destructive
            onCancel={() => setDeleteGoalConfirm(null)}
            onConfirm={handleConfirmDeleteGoal}
          />
        ) : null}

        {/* Activity delete confirm */}
        {deleteActivityConfirm ? (
          <ConfirmDialog
            title={`Delete ${deleteActivityConfirm.name}?`}
            body="The activity is hidden from your plan. Past logs stay in your records."
            confirmLabel="Delete activity"
            destructive
            onCancel={() => setDeleteActivityConfirm(null)}
            onConfirm={handleConfirmDeleteActivity}
          />
        ) : null}

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

// Lightweight inline confirm dialog used by the goal + activity delete flows.
// Mirrors the look-and-feel of RescheduleDialog so the visual language stays
// consistent across modals.
function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { title, body, confirmLabel, destructive, onCancel, onConfirm } = props;
  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]" onClick={onCancel} aria-hidden />
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 pointer-events-none">
        <div
          className="bg-[#fefcf9] rounded-2xl shadow-xl w-full max-w-sm pointer-events-auto overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-5 pt-4 pb-2">
            <h2 className="text-base font-bold text-[#2d2926]">{title}</h2>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel"
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <p className="px-5 pb-4 text-sm text-[#5c5346] leading-relaxed">{body}</p>
          <div className="flex items-center gap-2 px-5 pb-5">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 min-h-[44px] text-sm font-medium text-[#7a6f65] bg-[#f4f0e8] rounded-xl hover:bg-[#e8e2d9] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              className="flex-1 min-h-[44px] text-sm font-bold text-white rounded-xl transition-colors"
              style={{ backgroundColor: destructive ? "#b91c1c" : "#2D5A3D" }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

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
