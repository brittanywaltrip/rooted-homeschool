"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, X, Pencil, Calendar } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import CurriculumWizard, { type CurriculumWizardEditData } from "@/app/components/CurriculumWizard";
import ActivitySetupModal, { type EditableActivity } from "@/app/components/ActivitySetupModal";
import CreateSchoolYearModal from "@/app/components/CreateSchoolYearModal";
import AppointmentWizard, { type EditableAppointment } from "@/app/components/AppointmentWizard";
import Toast from "@/components/Toast";
import { posthog } from "@/lib/posthog";
import { capitalizeChildNames } from "@/lib/utils";
import { useSchoolYears } from "@/lib/useSchoolYears";
import { onLogAction } from "@/app/lib/onLogAction";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child   = { id: string; name: string; color: string | null };
type Subject = { id: string; name: string; color: string | null };
type CurriculumGoal = {
  id: string;
  curriculum_name: string;
  subject_label: string | null;
  child_id: string | null;
  total_lessons: number | null;
  current_lesson: number | null;
  target_date: string | null;
  school_days: string[] | null;
  created_at: string | null;
  default_minutes?: number | null;
  scheduled_start_time?: string | null;
  icon_emoji?: string | null;
};
type Lesson  = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string | null;
  hours: number | null;
  minutes_spent: number | null;
  date: string | null;
  scheduled_date: string | null;
  subjects: { name: string; color: string | null } | null;
  goal_id?: string | null;
  curriculum_goal_id?: string | null;
  notes?: string | null;
};
type CurriculumGroup = {
  key: string;
  curricName: string;
  childId: string | null;
  subjectName: string | null;
  totalCount: number;
  remainingCount: number;
  lessonIds: string[];
  goalId: string | null;
  goalData: CurriculumGoal | null;
};
type VacationBlock = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};
type Activity = {
  id: string;
  name: string;
  emoji: string;
  frequency: "weekly" | "biweekly" | "monthly";
  days: number[];
  duration_minutes: number;
  scheduled_start_time: string | null;
  child_ids: string[];
  is_active: boolean;
  location: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CURRICULUM_RE = /^(.+) — Lesson \d+$/;

// ─── US Holidays ─────────────────────────────────────────────────────────────

function nthDayOfMonth(year: number, month: number, dayOfWeek: number, nth: number): number {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dt.getDay() === dayOfWeek) {
      count++;
      if (count === nth) return d;
    }
  }
  return 1;
}

function lastDayOfMonth(year: number, month: number, dayOfWeek: number): number {
  let last = 1;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dt.getDay() === dayOfWeek) last = d;
  }
  return last;
}

/** Compute Easter Sunday via the Anonymous Gregorian algorithm */
function computeEaster(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function getUSHolidays(year: number): Record<string, string> {
  const fmt = (m: number, d: number) => `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const easter = computeEaster(year);
  return {
    // Fixed-date holidays
    [fmt(0, 1)]:   "\uD83C\uDF89 New Year\u2019s Day",
    [fmt(1, 2)]:   "\uD83E\uDDAB Groundhog Day",
    [fmt(1, 14)]:  "\uD83D\uDC95 Valentine\u2019s Day",
    [fmt(2, 17)]:  "\u2618\uFE0F St. Patrick\u2019s Day",
    [fmt(3, 22)]:  "\uD83C\uDF0E Earth Day",
    [fmt(4, 5)]:   "\uD83C\uDF8A Cinco de Mayo",
    [fmt(5, 19)]:  "\u270A Juneteenth",
    [fmt(6, 4)]:   "\uD83C\uDDFA\uD83C\uDDF8 4th of July",
    [fmt(9, 31)]:  "\uD83C\uDF83 Halloween",
    [fmt(10, 11)]: "\uD83C\uDDFA\uD83C\uDDF8 Veterans Day",
    [fmt(11, 25)]: "\uD83C\uDF84 Christmas",
    [fmt(11, 31)]: "\uD83C\uDF86 New Year\u2019s Eve",

    // Dynamically computed moving holidays
    [fmt(0, nthDayOfMonth(year, 0, 1, 3))]:  "\u270A MLK Day",
    [fmt(1, nthDayOfMonth(year, 1, 1, 3))]:  "\uD83C\uDDFA\uD83C\uDDF8 Presidents\u2019 Day",
    [fmt(easter.month, easter.day)]:          "\uD83D\uDC23 Easter",
    [fmt(4, nthDayOfMonth(year, 4, 0, 2))]:  "\uD83D\uDC90 Mother\u2019s Day",
    [fmt(4, lastDayOfMonth(year, 4, 1))]:     "\uD83C\uDDFA\uD83C\uDDF8 Memorial Day",
    [fmt(5, nthDayOfMonth(year, 5, 0, 3))]:  "\uD83D\uDC54 Father\u2019s Day",
    [fmt(8, nthDayOfMonth(year, 8, 1, 1))]:  "\uD83D\uDCDA Labor Day",
    [fmt(10, nthDayOfMonth(year, 10, 4, 4))]: "\uD83E\uDD83 Thanksgiving",
  };
}

function getSeasonalEmoji(month: number): string {
  if (month >= 2 && month <= 4) return " \u{1F337}";   // Mar–May → flower
  if (month >= 5 && month <= 7) return " \u2600\uFE0F"; // Jun–Aug → sun
  if (month >= 8 && month <= 10) return " \u{1F342}";  // Sep–Nov → leaf
  return " \u2744\uFE0F";                               // Dec–Feb → snowflake
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMondayOf(d: Date): Date {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const start = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end   = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${start} – ${end}`;
}

function countWeekdays(start: Date, end: Date): number {
  let count = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endMs = new Date(end);
  endMs.setHours(0, 0, 0, 0);
  while (cursor <= endMs) {
    const d = cursor.getDay();
    if (d !== 0 && d !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function addWeekdays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const d = result.getDay();
    if (d !== 0 && d !== 6) added++;
  }
  return result;
}

function isDateInBlocks(dateStr: string, blocks: { start_date: string; end_date: string }[]): boolean {
  return blocks.some((b) => dateStr >= b.start_date && dateStr <= b.end_date);
}

function getVacationName(dateStr: string, blocks: VacationBlock[]): string | null {
  const b = blocks.find((b) => dateStr >= b.start_date && dateStr <= b.end_date);
  return b?.name ?? null;
}

function calcPaceStatus(
  remainingCount: number,
  targetDate: string | null,
  schoolDays: string[] | null,
): { label: string; color: string; bg: string } | null {
  if (!targetDate || !schoolDays || schoolDays.length === 0) return null;
  if (remainingCount === 0) return { label: "✓ Complete", color: "var(--g-deep)", bg: "#e8f0e9" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate + "T00:00:00");
  if (target < today) return { label: "⚠ Past deadline", color: "#b91c1c", bg: "#fef2f2" };
  const dayNums = new Set(schoolDays.map((d) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(d)).filter((n) => n >= 0));
  let futureDays = 0;
  const cursor = new Date(today);
  let safety = 0;
  while (cursor <= target && safety < 1000) {
    if (dayNums.has(cursor.getDay())) futureDays++;
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }
  if (futureDays >= remainingCount) return { label: "✓ On pace", color: "var(--g-deep)", bg: "#e8f0e9" };
  const extraNeeded = remainingCount - futureDays;
  let extraFound = 0;
  const futureCursor = new Date(target);
  futureCursor.setDate(futureCursor.getDate() + 1);
  let calendarDaysExtra = 0;
  let safety2 = 0;
  while (extraFound < extraNeeded && safety2 < 500) {
    if (dayNums.has(futureCursor.getDay())) extraFound++;
    futureCursor.setDate(futureCursor.getDate() + 1);
    calendarDaysExtra++;
    safety2++;
  }
  if (calendarDaysExtra <= 14) return { label: "⚡ Slightly behind", color: "#7a4a1a", bg: "#fef9e8" };
  return { label: "⚠ Behind pace", color: "#b91c1c", bg: "#fef2f2" };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const { isPartner, effectiveUserId } = usePartner();
  const router = useRouter();
  const searchParams = useSearchParams();
  const todayMidnight = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  const todayStr = toDateStr(todayMidnight);

  const [weekStart,    setWeekStart]    = useState(() => getMondayOf(new Date()));
  const [viewMode,     setViewMode]     = useState<"week" | "month">("week");
  const [monthStart,   setMonthStart]   = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [monthLessons, setMonthLessons] = useState<Lesson[]>([]);
  type MonthAppt = { id: string; title: string; emoji: string; date: string; time: string | null; duration_minutes: number; location: string | null; notes: string | null; child_ids: string[]; completed: boolean; instance_date: string; is_recurring: boolean; recurrence_rule: { frequency: string; days: number[] } | null };
  const [monthAppts, setMonthAppts] = useState<MonthAppt[]>([]);
  const [lessons,          setLessons]          = useState<Lesson[]>([]);
  const [children,         setChildren]         = useState<Child[]>([]);
  const [selectedChild,    setSelectedChild]    = useState<string | null>(null);
  const [subjects,         setSubjects]         = useState<Subject[]>([]);
  const [curriculumGoals,  setCurriculumGoals]  = useState<CurriculumGoal[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [allLessons,       setAllLessons]       = useState<Lesson[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>(todayStr);

  // ── Mobile calendar collapse ─────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);
  const dayDetailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ── Lesson notes ─────────────────────────────────────────────────────────
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Edit modal ────────────────────────────────────────────────────────────
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [editTitle,     setEditTitle]     = useState("");
  const [editSubject,   setEditSubject]   = useState("");
  const [editHours,     setEditHours]     = useState("");
  const [editChildId,   setEditChildId]   = useState("");
  const [savingEdit,    setSavingEdit]    = useState(false);

  // ── Curriculum management ─────────────────────────────────────────────────
  const [showCreateWizard,  setShowCreateWizard]  = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [reportChildId, setReportChildId] = useState<string>("");
  useEffect(() => { if (children.length > 0 && !reportChildId) setReportChildId(children[0].id); }, [children]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reportRange, setReportRange] = useState<string>("full");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [includeActivities, setIncludeActivities] = useState(true);
  const [planType, setPlanType] = useState<string | null>(null);
  const previewFree = typeof window !== 'undefined' && window.location.search.includes('previewFree=true');
  const isFreeUser = !planType || planType === "free" || previewFree;

  // ── School year support ─────────────────────────────────────────────────────
  const schoolYears = useSchoolYears(effectiveUserId || null);
  const [yearView, setYearView] = useState<"this" | "next">("this");
  const [showCreateYear, setShowCreateYear] = useState(false);
  const activeYearId = schoolYears.active?.id ?? null;
  const upcomingYearId = schoolYears.upcoming?.id ?? null;
  const viewingYearId = yearView === "next" ? upcomingYearId : activeYearId;

  // School year milestone dates for calendar indicators
  const schoolYearMilestones: Record<string, string> = {};
  if (schoolYears.upcoming) {
    schoolYearMilestones[schoolYears.upcoming.start_date] = `🌱 ${schoolYears.upcoming.name} starts`;
    schoolYearMilestones[schoolYears.upcoming.end_date] = `🎓 ${schoolYears.upcoming.name} ends`;
  }
  if (schoolYears.active) {
    schoolYearMilestones[schoolYears.active.end_date] = `🎓 ${schoolYears.active.name} ends`;
    if (!schoolYearMilestones[schoolYears.active.start_date]) {
      schoolYearMilestones[schoolYears.active.start_date] = `🌱 ${schoolYears.active.name} starts`;
    }
  }

  // Jump calendar to the relevant school year's start date when switching tabs
  useEffect(() => {
    if (yearView === "next" && schoolYears.upcoming?.start_date) {
      const startDate = new Date(schoolYears.upcoming.start_date + "T00:00:00");
      setWeekStart(getMondayOf(startDate));
      const monthOf = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      monthOf.setHours(0, 0, 0, 0);
      setMonthStart(monthOf);
      setSelectedDay(schoolYears.upcoming.start_date);
    } else if (yearView === "this") {
      const now = new Date();
      setWeekStart(getMondayOf(now));
      const monthOf = new Date(now.getFullYear(), now.getMonth(), 1);
      monthOf.setHours(0, 0, 0, 0);
      setMonthStart(monthOf);
      setSelectedDay(toDateStr(now));
    }
  }, [yearView, schoolYears.upcoming?.start_date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.title = "Plan · Rooted"; posthog.capture('page_viewed', { page: 'plan' }); }, []);

  useEffect(() => {
    if (searchParams.get("openWizard") === "true") {
      setShowCreateWizard(true);
      router.replace("/dashboard/plan");
    }
  }, [searchParams, router]);
  const [editWizardData,    setEditWizardData]    = useState<CurriculumWizardEditData | null>(null);
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<CurriculumGroup | null>(null);
  const [planToastMsg, setPlanToastMsg] = useState<string | null>(null);

  // ── Backfill editing ─────────────────────────────────────────────────────
  const [expandedBackfill, setExpandedBackfill] = useState<string | null>(null);
  const [backfillLessons, setBackfillLessons] = useState<Record<string, { id: string; title: string; date: string; lesson_number: number; minutes_spent: number | null }[]>>({});
  const [backfillEdits, setBackfillEdits] = useState<Record<string, number>>({});
  const [savingBackfillId, setSavingBackfillId] = useState<string | null>(null);

  // ── Plan tip banner ───────────────────────────────────────────────────────
  const [onboarded,    setOnboarded]    = useState(false);

  // ── Vacation blocks ───────────────────────────────────────────────────────
  const [vacationBlocks,   setVacationBlocks]   = useState<VacationBlock[]>([]);
  const [showVacModal,     setShowVacModal]     = useState(false);
  const [vacName,          setVacName]          = useState("");
  const [vacStart,         setVacStart]         = useState("");
  const [vacEnd,           setVacEnd]           = useState("");
  const [vacReschedule,    setVacReschedule]    = useState<"shift" | "leave">("shift");
  const [savingVac,        setSavingVac]        = useState(false);
  const [profileSchoolDays, setProfileSchoolDays] = useState<string[]>([]);
  const [expandedCurricMenu, setExpandedCurricMenu] = useState<string | null>(null);
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());

  // ── Activities ─────────────────────────────────────────────────────────────
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<EditableActivity | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);

  // ── Month day popover ─────────────────────────────────────────────────────

  // ── Edit time state ─────────────────────────────────────────────────────
  const [editTimeId, setEditTimeId] = useState<string | null>(null);
  const [editTimeValue, setEditTimeValue] = useState("");

  // ── Reschedule state (Plan page) ─────────────────────────────────────────
  const [planRescheduleLesson, setPlanRescheduleLesson] = useState<Lesson | null>(null);
  const [planReschedulePicker, setPlanReschedulePicker] = useState(false);
  const [planReschedulePickerDate, setPlanReschedulePickerDate] = useState("");
  const [planRescheduleUndo, setPlanRescheduleUndo] = useState<{ message: string; undoData: { lessonId: string; date: string }[] } | null>(null);
  const planRescheduleUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [planPickerConfirmDate, setPlanPickerConfirmDate] = useState<string | null>(null);
  const [planPickerConflictCount, setPlanPickerConflictCount] = useState(0);

  // ── Day-detail inline actions (appointments) ─────────────────────────────
  const [editingAppt, setEditingAppt] = useState<EditableAppointment | null>(null);
  const [showApptCreate, setShowApptCreate] = useState(false);
  const [reschedulingApptId, setReschedulingApptId] = useState<string | null>(null);
  const [reschedulingApptDate, setReschedulingApptDate] = useState<string>("");
  const [apptUndo, setApptUndo] = useState<{ message: string; restore: () => Promise<void> } | null>(null);
  const apptUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const isCurrentWeek = toDateStr(weekStart) === toDateStr(getMondayOf(new Date()));

  // ── Load backfill lessons for a goal ────────────────────────────────────────
  const loadBackfillLessons = useCallback(async (goalId: string) => {
    const { data } = await supabase
      .from("lessons")
      .select("id, title, date, lesson_number, minutes_spent")
      .eq("curriculum_goal_id", goalId)
      .eq("is_backfill", true)
      .order("lesson_number");
    if (data) {
      setBackfillLessons(prev => ({ ...prev, [goalId]: data as { id: string; title: string; date: string; lesson_number: number; minutes_spent: number | null }[] }));
    }
  }, []);

  const saveBackfillHours = useCallback(async (lessonId: string, minutes: number) => {
    setSavingBackfillId(lessonId);
    await supabase.from("lessons").update({ minutes_spent: minutes, hours: minutes / 60 }).eq("id", lessonId);
    setSavingBackfillId(null);
  }, []);

  // ── Load week view ─────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const ws = new Date(weekStart), we = new Date(weekStart);
    we.setDate(we.getDate() + 6);
    const s = toDateStr(ws), e = toDateStr(we);
    const [{ data: profile }, { data: kids }, { data: subs }, { data: goals }, { data: bySched }, { data: byDate }] = await Promise.all([
      supabase.from("profiles").select("onboarded, school_days, plan_type").eq("id", effectiveUserId).maybeSingle(),
      supabase.from("children").select("id, name, color").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase.from("subjects").select("id, name, color").eq("user_id", effectiveUserId).order("name"),
      supabase.from("curriculum_goals").select("id, curriculum_name, subject_label, child_id, total_lessons, current_lesson, target_date, school_days, created_at, default_minutes, scheduled_start_time, school_year_id, icon_emoji").eq("user_id", effectiveUserId).order("created_at"),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, notes, subjects(name, color)")
        .eq("user_id", effectiveUserId).gte("scheduled_date", s).lte("scheduled_date", e),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, notes, subjects(name, color)")
        .eq("user_id", effectiveUserId).is("scheduled_date", null).gte("date", s).lte("date", e),
    ]);
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? false);
    setProfileSchoolDays((profile as { school_days?: string[] } | null)?.school_days ?? []);
    setPlanType((profile as { plan_type?: string } | null)?.plan_type ?? null);
    setChildren(capitalizeChildNames(kids ?? []));
    setSubjects((subs as Subject[]) ?? []);
    setCurriculumGoals((goals as unknown as CurriculumGoal[]) ?? []);
    setLessons([...((bySched as unknown as Lesson[]) ?? []), ...((byDate as unknown as Lesson[]) ?? [])]);
    setLoading(false);
  }, [weekStart, effectiveUserId]);

  // ── Load all lessons (for curriculum management) ───────────────────────────

  const loadAllLessons = useCallback(async () => {
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from("lessons")
      .select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, notes, subjects(name, color)")
      .eq("user_id", effectiveUserId);
    setAllLessons((data as unknown as Lesson[]) ?? []);
  }, [effectiveUserId]);

  const loadVacationBlocks = useCallback(async () => {
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from("vacation_blocks")
      .select("id, name, start_date, end_date")
      .eq("user_id", effectiveUserId)
      .order("start_date");
    setVacationBlocks((data as VacationBlock[]) ?? []);
  }, [effectiveUserId]);

  const loadActivities = useCallback(async () => {
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from("activities")
      .select("id, name, emoji, frequency, days, duration_minutes, scheduled_start_time, child_ids, is_active, location")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true)
      .order("created_at");
    setActivities((data as Activity[]) ?? []);
  }, [effectiveUserId]);

  const loadMonthData = useCallback(async () => {
    if (!effectiveUserId) return;
    const ms = new Date(monthStart);
    const me = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const s = toDateStr(ms), e = toDateStr(me);
    const [{ data: bySched }, { data: byDate }] = await Promise.all([
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, notes, subjects(name, color)")
        .eq("user_id", effectiveUserId).gte("scheduled_date", s).lte("scheduled_date", e),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, notes, subjects(name, color)")
        .eq("user_id", effectiveUserId).is("scheduled_date", null).gte("date", s).lte("date", e),
    ]);
    setMonthLessons([...((bySched as unknown as Lesson[]) ?? []), ...((byDate as unknown as Lesson[]) ?? [])]);

    // Fetch appointments for the month
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const res = await fetch(`/api/appointments?date=${s}&end=${e}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) setMonthAppts(await res.json());
      }
    } catch { /* non-critical */ }
  }, [monthStart, effectiveUserId]);

  useEffect(() => { loadData(); },           [loadData]);
  useEffect(() => { loadAllLessons(); },     [loadAllLessons]);
  useEffect(() => { loadVacationBlocks(); }, [loadVacationBlocks]);
  useEffect(() => { loadActivities(); },     [loadActivities]);

  // Re-fetch when children are edited in Settings
  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener("rooted:children-updated", handler);
    return () => window.removeEventListener("rooted:children-updated", handler);
  }, [loadData]);
  useEffect(() => { if (viewMode === "month") loadMonthData(); }, [viewMode, loadMonthData]);

  // ── Week navigation ───────────────────────────────────────────────────────

  function prevWeek() { setCalendarCollapsed(false); setWeekStart((d) => getMondayOf(new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000))); }
  function nextWeek() { setCalendarCollapsed(false); setWeekStart((d) => getMondayOf(new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000))); }

  // ── Month navigation ──────────────────────────────────────────────────────

  function prevMonth() { setCalendarCollapsed(false); setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setCalendarCollapsed(false); setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }

  // ── Day selection (collapses calendar + scrolls to detail on mobile) ─────

  function selectDay(key: string) {
    setSelectedDay(key);
    if (isMobile) setCalendarCollapsed(true);
    // Wait for the collapse + day-detail re-render to commit before measuring,
    // otherwise scrollIntoView lands on the pre-collapse position and overshoots.
    setTimeout(() => {
      dayDetailRef.current?.scrollIntoView({
        behavior: "smooth",
        block: isMobile ? "start" : "nearest",
      });
    }, 80);
  }

  // ── Lesson note helpers ───────────────────────────────────────────────────

  function startEditingNote(lessonId: string, currentNotes: string | null | undefined) {
    setEditingNoteId(lessonId);
    setEditingNoteText(currentNotes ?? "");
    setNoteSaveState("idle");
    if (noteSaveTimerRef.current) { clearTimeout(noteSaveTimerRef.current); noteSaveTimerRef.current = null; }
    setTimeout(() => noteTextareaRef.current?.focus(), 0);
  }

  function cancelEditingNote() {
    setEditingNoteId(null);
    setEditingNoteText("");
    setNoteSaveState("idle");
    if (noteSaveTimerRef.current) { clearTimeout(noteSaveTimerRef.current); noteSaveTimerRef.current = null; }
  }

  async function saveNote(lessonId: string) {
    if (noteSaveState === "saving") return;
    const trimmed = editingNoteText.trim();
    const value = trimmed.length > 0 ? trimmed : null;
    setNoteSaveState("saving");
    const { error } = await supabase.from("lessons").update({ notes: value }).eq("id", lessonId);
    if (error) {
      setNoteSaveState("error");
      if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = setTimeout(() => setNoteSaveState("idle"), 2500);
      return;
    }
    const updateFn = (l: Lesson) => l.id === lessonId ? { ...l, notes: value } : l;
    setLessons(prev => prev.map(updateFn));
    setMonthLessons(prev => prev.map(updateFn));
    setAllLessons(prev => prev.map(updateFn as any));
    setNoteSaveState("saved");
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    noteSaveTimerRef.current = setTimeout(() => {
      setEditingNoteId(null);
      setEditingNoteText("");
      setNoteSaveState("idle");
      noteSaveTimerRef.current = null;
    }, 1500);
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  async function toggleLesson(id: string, current: boolean) {
    setLessons((prev) => prev.map((l) => l.id === id ? { ...l, completed: !current } : l));
    setMonthLessons((prev) => prev.map((l) => l.id === id ? { ...l, completed: !current } : l));
    await supabase.from("lessons").update({ completed: !current }).eq("id", id);
    // Fire streak + badge check on completion (not on uncheck)
    if (!current && effectiveUserId) {
      const lesson = lessons.find(l => l.id === id);
      onLogAction({ userId: effectiveUserId, childId: lesson?.child_id ?? undefined, actionType: "lesson" });
    }
  }

  // ── Edit lesson ───────────────────────────────────────────────────────────

  function openEdit(lesson: Lesson) {
    setEditingLesson(lesson);
    setEditTitle(lesson.title);
    setEditSubject(lesson.subjects?.name ?? "");
    setEditHours(lesson.hours != null ? String(lesson.hours) : "");
    setEditChildId(lesson.child_id ?? "");
  }

  async function saveEdit() {
    if (!editingLesson || !editTitle.trim()) return;
    setSavingEdit(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingEdit(false); return; }
    let subjectId: string | null = null;
    if (editSubject.trim()) {
      const existing = subjects.find((s) => s.name.toLowerCase() === editSubject.trim().toLowerCase());
      if (existing) { subjectId = existing.id; }
      else {
        const { data: ns } = await supabase.from("subjects").insert({ user_id: user.id, name: editSubject.trim() }).select("id, name, color").single();
        if (ns) { setSubjects((p) => [...p, ns as Subject]); subjectId = ns.id; }
      }
    }
    await supabase.from("lessons").update({ title: editTitle.trim(), subject_id: subjectId, hours: editHours ? parseFloat(editHours) : null, child_id: editChildId || null }).eq("id", editingLesson.id);
    setLessons((prev) => prev.map((l) => {
      if (l.id !== editingLesson.id) return l;
      return { ...l, title: editTitle.trim(), subjects: editSubject.trim() ? { name: editSubject.trim(), color: l.subjects?.color ?? null } : null, hours: editHours ? parseFloat(editHours) : null, child_id: editChildId || l.child_id };
    }));
    setSavingEdit(false); setEditingLesson(null);
  }

  // ── Save edited time ───────────────────────────────────────────────────────

  async function saveEditTime() {
    if (!editTimeId) return;
    const mins = parseInt(editTimeValue) || 0;
    const value = mins > 0 ? mins : null;
    setLessons((prev) => prev.map((l) => l.id === editTimeId ? { ...l, minutes_spent: value } : l));
    setMonthLessons((prev) => prev.map((l) => l.id === editTimeId ? { ...l, minutes_spent: value } : l));
    await supabase.from("lessons").update({ minutes_spent: value }).eq("id", editTimeId);
    setEditTimeId(null);
  }

  function openEditTime(lesson: Lesson) {
    const goal = lesson.curriculum_goal_id ? curriculumGoals.find(g => g.id === lesson.curriculum_goal_id) : null;
    const prefill = lesson.minutes_spent ?? goal?.default_minutes ?? 30;
    setEditTimeId(lesson.id);
    setEditTimeValue(String(prefill));
  }

  // ── Delete single lesson ───────────────────────────────────────────────────

  async function deleteLesson(id: string) {
    setLessons((p) => p.filter((l) => l.id !== id));
    await supabase.from("lessons").delete().eq("id", id);
  }

  // ── Curriculum management ─────────────────────────────────────────────────

  async function deleteCurriculumGroup(group: CurriculumGroup) {
    const ids = group.lessonIds;
    for (let i = 0; i < ids.length; i += 100) {
      await supabase.from("lessons").delete().in("id", ids.slice(i, i + 100));
    }
    if (group.goalId) {
      await supabase.from("curriculum_goals").delete().eq("id", group.goalId);
      setCurriculumGoals((p) => p.filter((g) => g.id !== group.goalId));
    }
    setAllLessons((p) => p.filter((l) => !ids.includes(l.id)));
    setLessons((p) => p.filter((l) => !ids.includes(l.id)));
    setDeleteConfirmGroup(null);
  }

  // ── Vacation blocks ───────────────────────────────────────────────────────

  async function saveVacationBlock() {
    if (!vacName.trim() || !vacStart || !vacEnd || vacStart > vacEnd) return;
    setSavingVac(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingVac(false); return; }

    const { data: block, error } = await supabase
      .from("vacation_blocks")
      .insert({ user_id: user.id, name: vacName.trim(), start_date: vacStart, end_date: vacEnd })
      .select("id, name, start_date, end_date")
      .single();
    if (error || !block) { setSavingVac(false); return; }
    setVacationBlocks((p) => [...p, block as VacationBlock]);

    if (vacReschedule === "shift") {
      const startD = new Date(vacStart + "T00:00:00");
      const endD   = new Date(vacEnd   + "T00:00:00");
      const shiftDays = countWeekdays(startD, endD);
      if (shiftDays > 0) {
        const { data: affected } = await supabase
          .from("lessons")
          .select("id, scheduled_date, date")
          .eq("user_id", user.id)
          .eq("completed", false)
          .gte("scheduled_date", vacStart);
        if (affected && affected.length > 0) {
          const updates = (affected as { id: string; scheduled_date: string | null; date: string | null }[]).map((l) => {
            const orig = new Date((l.scheduled_date ?? l.date ?? vacStart) + "T00:00:00");
            const newD = addWeekdays(orig, shiftDays);
            return { id: l.id, date: toDateStr(newD) };
          });
          for (let i = 0; i < updates.length; i += 20) {
            await Promise.all(
              updates.slice(i, i + 20).map(({ id, date }) =>
                supabase.from("lessons").update({ scheduled_date: date, date }).eq("id", id)
              )
            );
          }
          loadData();
          loadAllLessons();
        }
      }
    }

    setSavingVac(false);
    setShowVacModal(false);
    setVacName(""); setVacStart(""); setVacEnd(""); setVacReschedule("shift");
  }

  async function deleteVacationBlock(id: string) {
    setVacationBlocks((p) => p.filter((b) => b.id !== id));
    await supabase.from("vacation_blocks").delete().eq("id", id);
  }

  // ── Delete activity ────────────────────────────────────────────────────
  async function deleteActivity(id: string) {
    setActivities((p) => p.filter((a) => a.id !== id));
    await supabase.from("activities").update({ is_active: false }).eq("id", id);
  }

  // ── Missed lessons (needed by reschedule functions) ─────────────────────
  const missedLessons = allLessons
    .filter(l => {
      const d = l.scheduled_date ?? l.date;
      return d && d < todayStr && !l.completed;
    })
    .sort((a, b) => ((a.scheduled_date ?? a.date) ?? "").localeCompare((b.scheduled_date ?? b.date) ?? ""));

  // ── Reschedule functions (Plan page — anchor-aware) ──────────────────────

  function openPlanReschedule(lesson: Lesson) {
    setPlanRescheduleLesson(lesson);
    setPlanReschedulePicker(false);
    setPlanReschedulePickerDate("");
    setPlanPickerConfirmDate(null);
    setPlanPickerConflictCount(0);
  }

  function showPlanRescheduleUndo(message: string, undoData: { lessonId: string; date: string }[]) {
    if (planRescheduleUndoTimer.current) clearTimeout(planRescheduleUndoTimer.current);
    setPlanRescheduleUndo({ message, undoData });
    planRescheduleUndoTimer.current = setTimeout(() => setPlanRescheduleUndo(null), 8000);
  }

  async function undoPlanReschedule() {
    if (!planRescheduleUndo) return;
    for (let i = 0; i < planRescheduleUndo.undoData.length; i += 20) {
      await Promise.all(
        planRescheduleUndo.undoData.slice(i, i + 20).map(({ lessonId, date }) =>
          supabase.from("lessons").update({ scheduled_date: date, date }).eq("id", lessonId)
        )
      );
    }
    setPlanRescheduleUndo(null);
    if (planRescheduleUndoTimer.current) clearTimeout(planRescheduleUndoTimer.current);
    loadData(); loadAllLessons();
  }

  // ── Skip lesson (clears scheduled date; undo restores) ───────────────────
  async function skipPlanLesson(lesson: Lesson) {
    const originalDate = lesson.scheduled_date ?? lesson.date;
    if (!originalDate) return;
    const clear = (l: Lesson) => l.id === lesson.id ? { ...l, scheduled_date: null, date: null } : l;
    setLessons(prev => prev.map(clear));
    setMonthLessons(prev => prev.map(clear));
    setAllLessons(prev => prev.map(clear));
    await supabase.from("lessons").update({ scheduled_date: null, date: null }).eq("id", lesson.id);
    showPlanRescheduleUndo("Lesson skipped · Undo", [{ lessonId: lesson.id, date: originalDate }]);
  }

  // ── Appointment actions (one-off only) ───────────────────────────────────
  function showApptUndo(message: string, restore: () => Promise<void>) {
    if (apptUndoTimer.current) clearTimeout(apptUndoTimer.current);
    setApptUndo({ message, restore });
    apptUndoTimer.current = setTimeout(() => setApptUndo(null), 5000);
  }

  async function authedFetch(path: string, init: RequestInit = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  async function skipAppt(a: MonthAppt) {
    if (a.is_recurring) return;
    // Capture the full row so we can restore on undo
    const snapshot = { ...a };
    setMonthAppts(prev => prev.filter(x => x.id !== a.id));
    const res = await authedFetch("/api/appointments", {
      method: "DELETE",
      body: JSON.stringify({ id: a.id }),
    });
    if (!res.ok) { loadMonthData(); return; }
    const label = new Date(a.instance_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    showApptUndo(`Skipped · ${a.title} on ${label} · Undo`, async () => {
      await authedFetch("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          title: snapshot.title,
          emoji: snapshot.emoji,
          date: snapshot.date,
          time: snapshot.time,
          duration_minutes: snapshot.duration_minutes,
          location: snapshot.location,
          notes: snapshot.notes,
          child_ids: snapshot.child_ids,
          is_recurring: false,
          recurrence_rule: null,
        }),
      });
      loadMonthData();
    });
  }

  async function rescheduleAppt(a: MonthAppt, newDate: string) {
    if (a.is_recurring || !newDate || newDate === a.date) {
      setReschedulingApptId(null);
      return;
    }
    const originalDate = a.date;
    setMonthAppts(prev => prev.map(x => x.id === a.id ? { ...x, date: newDate, instance_date: newDate } : x));
    setReschedulingApptId(null);
    const res = await authedFetch("/api/appointments", {
      method: "PATCH",
      body: JSON.stringify({ id: a.id, date: newDate }),
    });
    if (!res.ok) { loadMonthData(); return; }
    const label = new Date(newDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    showApptUndo(`Moved to ${label} · Undo`, async () => {
      await authedFetch("/api/appointments", {
        method: "PATCH",
        body: JSON.stringify({ id: a.id, date: originalDate }),
      });
      loadMonthData();
    });
    // Jump selected day to the new date so the user sees the move
    setSelectedDay(newDate);
  }

  function openEditAppt(a: MonthAppt) {
    setEditingAppt({
      id: a.id,
      title: a.title,
      emoji: a.emoji,
      date: a.date,
      time: a.time,
      duration_minutes: a.duration_minutes,
      location: a.location,
      notes: a.notes,
      child_ids: a.child_ids,
      is_recurring: a.is_recurring,
      recurrence_rule: a.recurrence_rule,
    });
  }

  async function planRescheduleMoveTo(targetDate: string, force = false) {
    if (!planRescheduleLesson) return;

    // Check for existing lessons on target date (conflict confirmation for Pick a Day)
    if (!force) {
      const existingCount = allLessons.filter(l => {
        const d = l.scheduled_date ?? l.date;
        return d === targetDate && l.id !== planRescheduleLesson.id;
      }).length;
      if (existingCount > 0) {
        setPlanPickerConfirmDate(targetDate);
        setPlanPickerConflictCount(existingCount);
        return;
      }
    }

    const originalDate = planRescheduleLesson.scheduled_date ?? planRescheduleLesson.date ?? todayStr;
    await supabase.from("lessons").update({ scheduled_date: targetDate, date: targetDate }).eq("id", planRescheduleLesson.id);
    setAllLessons(prev => prev.map(l => l.id === planRescheduleLesson.id ? { ...l, scheduled_date: targetDate, date: targetDate } : l));
    setLessons(prev => prev.filter(l => l.id !== planRescheduleLesson.id));
    setPlanRescheduleLesson(null);
    setPlanPickerConfirmDate(null);
    const label = new Date(targetDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    showPlanRescheduleUndo(`Lesson moved to ${label} · Undo`, [{ lessonId: planRescheduleLesson.id, date: originalDate }]);
    loadData(); loadAllLessons();
  }

  function getSchoolDaysForLesson(lesson: Lesson): string[] {
    if (lesson.curriculum_goal_id) {
      const goal = curriculumGoals.find(g => g.id === lesson.curriculum_goal_id);
      if (goal?.school_days && goal.school_days.length > 0) return goal.school_days;
    }
    return profileSchoolDays.length > 0 ? profileSchoolDays : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  }

  /** Returns the Nth school day from afterDate (1-indexed: N=1 → next school day). */
  function nthSchoolDay(afterDate: string, schoolDays: string[], n: number): string {
    const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const activeDays = new Set(schoolDays.map(d => dayMap[d] ?? -1));
    const cursor = new Date(afterDate + "T12:00:00");
    let found = 0;
    for (let i = 0; i < 365; i++) {
      cursor.setDate(cursor.getDate() + 1);
      if (activeDays.has((cursor.getDay() + 6) % 7)) {
        found++;
        if (found === n) return toDateStr(cursor);
      }
    }
    return toDateStr(cursor);
  }

  function isSchoolDayDate(dateStr: string, schoolDays: string[]): boolean {
    const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const activeDays = new Set(schoolDays.map(d => dayMap[d] ?? -1));
    const d = new Date(dateStr + "T12:00:00");
    return activeDays.has((d.getDay() + 6) % 7);
  }

  /** OPTION 1 — Add to my next school day(s). Places missed lessons sequentially. */
  async function planAddToNextSchoolDays() {
    const target = missedLessons.length > 0 ? missedLessons : (planRescheduleLesson ? [planRescheduleLesson] : []);
    if (target.length === 0) return;

    const undoData = target.map(l => ({
      lessonId: l.id,
      date: l.scheduled_date ?? l.date ?? todayStr,
    }));

    const updates: { id: string; newDate: string }[] = [];
    for (let i = 0; i < target.length; i++) {
      const schoolDays = getSchoolDaysForLesson(target[i]);
      const targetDate = nthSchoolDay(todayStr, schoolDays, i + 1);
      updates.push({ id: target[i].id, newDate: targetDate });
    }

    for (let i = 0; i < updates.length; i += 20) {
      await Promise.all(
        updates.slice(i, i + 20).map(({ id, newDate }) =>
          supabase.from("lessons").update({ scheduled_date: newDate, date: newDate }).eq("id", id)
        )
      );
    }

    setPlanRescheduleLesson(null);
    const n = updates.length;
    showPlanRescheduleUndo(`${n} lesson${n !== 1 ? "s" : ""} added to upcoming school days · Undo`, undoData);
    loadData(); loadAllLessons();
  }

  /** OPTION 2 — Push schedule back N school days, fit missed lessons into vacated slots. */
  async function planPushBackNDays() {
    const n = missedLessons.length;
    if (n === 0) return;

    // Collect all future uncompleted lessons across all curricula from today forward
    const { data: futureRows } = await supabase.from("lessons")
      .select("id, scheduled_date, curriculum_goal_id")
      .eq("user_id", effectiveUserId!)
      .eq("completed", false)
      .gte("scheduled_date", todayStr)
      .order("scheduled_date", { ascending: true });
    const futureLessons = (futureRows ?? []) as { id: string; scheduled_date: string; curriculum_goal_id: string | null }[];

    // Build undo data for everything: missed + future
    const undoData = [
      ...missedLessons.map(l => ({ lessonId: l.id, date: l.scheduled_date ?? l.date ?? todayStr })),
      ...futureLessons.map(l => ({ lessonId: l.id, date: l.scheduled_date })),
    ];

    // Shift each future lesson forward by N school days
    const futureUpdates: { id: string; newDate: string }[] = [];
    for (const lesson of futureLessons) {
      const schoolDays = (() => {
        if (lesson.curriculum_goal_id) {
          const goal = curriculumGoals.find(g => g.id === lesson.curriculum_goal_id);
          if (goal?.school_days?.length) return goal.school_days;
        }
        return profileSchoolDays.length > 0 ? profileSchoolDays : ["Mon", "Tue", "Wed", "Thu", "Fri"];
      })();
      const newDate = nthSchoolDay(lesson.scheduled_date, schoolDays, n);
      futureUpdates.push({ id: lesson.id, newDate });
    }

    // Place each missed lesson into the N vacated slots (sequential school days from today)
    const missedUpdates: { id: string; newDate: string }[] = [];
    for (let i = 0; i < n; i++) {
      const schoolDays = getSchoolDaysForLesson(missedLessons[i]);
      const slot = nthSchoolDay(todayStr, schoolDays, i + 1);
      missedUpdates.push({ id: missedLessons[i].id, newDate: slot });
    }

    const allUpdates = [...futureUpdates, ...missedUpdates];
    for (let i = 0; i < allUpdates.length; i += 20) {
      await Promise.all(
        allUpdates.slice(i, i + 20).map(({ id, newDate }) =>
          supabase.from("lessons").update({ scheduled_date: newDate, date: newDate }).eq("id", id)
        )
      );
    }

    setPlanRescheduleLesson(null);
    showPlanRescheduleUndo(`Schedule pushed back ${n} day${n !== 1 ? "s" : ""} · Undo`, undoData);
    loadData(); loadAllLessons();
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const lessonsByDay = weekDays.reduce<Record<string, Lesson[]>>((acc, day) => {
    const key = toDateStr(day);
    acc[key] = lessons.filter((l) => (l.scheduled_date ?? l.date) === key);
    return acc;
  }, {});

  // Month lesson map
  const monthLessonMap: Record<string, Lesson[]> = {};
  monthLessons.forEach((l) => {
    const key = l.scheduled_date ?? l.date ?? "";
    if (!monthLessonMap[key]) monthLessonMap[key] = [];
    monthLessonMap[key].push(l);
  });

  // Month appointment map
  const monthApptMap: Record<string, MonthAppt[]> = {};
  monthAppts.forEach((a) => {
    const key = a.instance_date;
    if (!monthApptMap[key]) monthApptMap[key] = [];
    monthApptMap[key].push(a);
  });

  // Lessons for the selected day (works for both week and month views)
  const selectedDayLessons: Lesson[] = (() => {
    if (viewMode === "week") return lessonsByDay[selectedDay] ?? [];
    return monthLessonMap[selectedDay] ?? [];
  })();

  // ── Year-scoped data ─────────────────────────────────────────────────────
  const yearScopedGoals = curriculumGoals.filter(g => {
    const gYearId = (g as unknown as { school_year_id?: string }).school_year_id;
    if (yearView === "next") return gYearId === upcomingYearId;
    return !gYearId || gYearId === activeYearId; // null = active year (pre-migration)
  });
  const yearScopedLessons = allLessons.filter(l => {
    const goalId = l.curriculum_goal_id;
    if (!goalId) return yearView === "this"; // unlinked lessons → this year
    const goal = curriculumGoals.find(g => g.id === goalId);
    const gYearId = (goal as unknown as { school_year_id?: string } | undefined)?.school_year_id;
    if (yearView === "next") return gYearId === upcomingYearId;
    return !gYearId || gYearId === activeYearId;
  });
  const yearScopedActivities = activities.filter(a => {
    const aYearId = (a as unknown as { school_year_id?: string }).school_year_id;
    if (yearView === "next") return aYearId === upcomingYearId;
    return !aYearId || aYearId === activeYearId;
  });

  // Curriculum groups from allLessons (year-scoped)
  const curricGroups: CurriculumGroup[] = (() => {
    const map = new Map<string, CurriculumGroup>();
    for (const l of yearScopedLessons) {
      const match = CURRICULUM_RE.exec(l.title);
      if (!match) continue;
      const cName = match[1];
      const key = l.curriculum_goal_id ?? `${cName}||${l.child_id ?? ""}`;
      if (!map.has(key)) {
        const goal = l.curriculum_goal_id
          ? curriculumGoals.find((g) => g.id === l.curriculum_goal_id)
          : curriculumGoals.find((g) => g.curriculum_name === cName && g.child_id === l.child_id);
        map.set(key, { key, curricName: cName, childId: l.child_id, subjectName: l.subjects?.name ?? null, totalCount: 0, remainingCount: 0, lessonIds: [], goalId: goal?.id ?? null, goalData: goal ?? null });
      }
      const g = map.get(key)!;
      g.totalCount++;
      if (!l.completed) g.remainingCount++;
      g.lessonIds.push(l.id);
    }
    return Array.from(map.values()).sort((a, b) => a.curricName.localeCompare(b.curricName));
  })();

  // Expand all curriculum groups by default on first load
  const curricKeysRef = useRef(false);
  useEffect(() => {
    if (!curricKeysRef.current && curricGroups.length > 0) {
      curricKeysRef.current = true;
      setExpandedCourses(new Set(curricGroups.map(g => g.key)));
    }
  }, [curricGroups]);

  // Catch-up: uncompleted lessons before today this week
  const pastIncompleteLessons = lessons.filter(l => {
    const d = l.scheduled_date ?? l.date;
    return d && d < todayStr && !l.completed;
  });
  const hasCatchUp = pastIncompleteLessons.length > 0;

  // ── Vacation modal derived ────────────────────────────────────────────────
  const vacDays = vacStart && vacEnd && vacEnd >= vacStart
    ? Math.round((new Date(vacEnd + "T00:00:00").getTime() - new Date(vacStart + "T00:00:00").getTime()) / 86400000) + 1
    : 0;
  const vacStartLabel = vacStart ? new Date(vacStart + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const vacEndLabel   = vacEnd   ? new Date(vacEnd   + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const vacCanSave    = !!(vacName.trim() && vacStart && vacEnd);

  // ── Day panel helpers ─────────────────────────────────────────────────────

  const selectedDate = new Date(selectedDay + "T00:00:00");
  const isSelectedVacation = isDateInBlocks(selectedDay, vacationBlocks);
  const selectedVacName = getVacationName(selectedDay, vacationBlocks);
  const isSelectedWeekend = selectedDate.getDay() === 0 || selectedDate.getDay() === 6;
  const isSelectedPast = selectedDay < todayStr;
  const selectedDateLabel = selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  // Group selected day lessons by child
  const lessonsByChild: { child: Child | null; lessons: Lesson[] }[] = (() => {
    const map = new Map<string, Lesson[]>();
    for (const l of selectedDayLessons) {
      const key = l.child_id ?? "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return Array.from(map.entries()).map(([key, lsns]) => ({
      child: key === "__none__" ? null : children.find(c => c.id === key) ?? null,
      lessons: lsns,
    }));
  })();

  const selectedDayDone = selectedDayLessons.filter(l => l.completed).length;
  const selectedDayTotal = selectedDayLessons.length;

  // ── Report download ──────────────────────────────────────────────────────

  async function downloadReport() {
    if (!effectiveUserId) return;
    setDownloadingReport(true);
    console.log("[Report v4] downloadReport called - using jsPDF direct drawing, NO html2canvas");
    try {
      const { jsPDF } = await import("jspdf");
      const { generateProgressReport, fmtMins } = await import("@/lib/pdf");

      const { data: prof } = await supabase.from("profiles").select("display_name").eq("id", effectiveUserId).maybeSingle();
      const familyName = (prof as { display_name?: string } | null)?.display_name || "Family Academy";
      const now = new Date();
      const yr = now.getMonth() >= 6 ? `${now.getFullYear()}–${now.getFullYear() + 1}` : `${now.getFullYear() - 1}–${now.getFullYear()}`;
      const dateGen = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      type LR = { child_id: string; title: string; completed: boolean; minutes_spent: number | null; scheduled_date: string | null; date: string | null; curriculum_goal_id: string | null; subjects: { name: string } | null; is_backfill?: boolean };
      type MR = { child_id: string | null; type: string; title: string | null; date: string; duration_minutes: number | null };
      type GR = { id: string; default_minutes: number };
      type AL = { activity_id: string; date: string; minutes_spent: number | null; completed: boolean; is_backfill?: boolean };
      type ACT = { id: string; name: string; emoji: string; child_ids: string[] | null };

      const [{ data: lr }, { data: mr }, { data: gr }, { data: al }, { data: acts }] = await Promise.all([
        supabase.from("lessons").select("child_id, title, completed, minutes_spent, scheduled_date, date, curriculum_goal_id, subjects(name), is_backfill").eq("user_id", effectiveUserId),
        supabase.from("memories").select("child_id, type, title, date, duration_minutes").eq("user_id", effectiveUserId),
        supabase.from("curriculum_goals").select("id, default_minutes").eq("user_id", effectiveUserId),
        supabase.from("activity_logs").select("activity_id, date, minutes_spent, completed, is_backfill").eq("user_id", effectiveUserId).eq("completed", true),
        supabase.from("activities").select("id, name, emoji, child_ids").eq("user_id", effectiveUserId),
      ]);

      let allLessons = (lr || []) as unknown as LR[];
      let allMemories = (mr || []) as unknown as MR[];
      let allActivityLogs = (al || []) as unknown as AL[];
      const activityMap: Record<string, ACT> = {};
      for (const a of ((acts || []) as unknown as ACT[])) activityMap[a.id] = a;
      const gdm: Record<string, number> = {};
      for (const g of ((gr || []) as unknown as GR[])) gdm[g.id] = g.default_minutes ?? 30;

      function lm(l: LR): { m: number; e: boolean } { if (l.minutes_spent != null) return { m: l.minutes_spent, e: false }; if (l.curriculum_goal_id && gdm[l.curriculum_goal_id]) return { m: gdm[l.curriculum_goal_id], e: true }; return { m: 30, e: true }; }
      function ld(l: LR) { return l.scheduled_date || l.date || ""; }

      // ── Date range filtering ──────────────────────────────────
      const now2 = new Date();
      const schoolYearStart = now2.getMonth() >= 7 ? now2.getFullYear() : now2.getFullYear() - 1;
      let rangeStart = "";
      let rangeEnd = "";
      let dateRangeLabel = "";

      if (reportRange === "q1") {
        rangeStart = `${schoolYearStart}-09-01`;
        rangeEnd = `${schoolYearStart}-11-30`;
        dateRangeLabel = `Q1 Report: September \u2013 November ${schoolYearStart}`;
      } else if (reportRange === "q2") {
        rangeStart = `${schoolYearStart}-12-01`;
        rangeEnd = `${schoolYearStart + 1}-02-28`;
        dateRangeLabel = `Q2 Report: December ${schoolYearStart} \u2013 February ${schoolYearStart + 1}`;
      } else if (reportRange === "q3") {
        rangeStart = `${schoolYearStart + 1}-03-01`;
        rangeEnd = `${schoolYearStart + 1}-05-31`;
        dateRangeLabel = `Q3 Report: March \u2013 May ${schoolYearStart + 1}`;
      } else if (reportRange === "q4") {
        rangeStart = `${schoolYearStart + 1}-06-01`;
        rangeEnd = `${schoolYearStart + 1}-08-31`;
        dateRangeLabel = `Q4 Report: June \u2013 August ${schoolYearStart + 1}`;
      } else if (reportRange === "custom" && reportStartDate && reportEndDate) {
        rangeStart = reportStartDate;
        rangeEnd = reportEndDate;
        const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        dateRangeLabel = `${fmt(rangeStart)} \u2013 ${fmt(rangeEnd)}`;
      }

      if (rangeStart && rangeEnd) {
        allLessons = allLessons.filter(l => {
          const d = l.scheduled_date || l.date || "";
          return d >= rangeStart && d <= rangeEnd;
        });
        allMemories = allMemories.filter(m => m.date >= rangeStart && m.date <= rangeEnd);
        allActivityLogs = allActivityLogs.filter(a => a.date >= rangeStart && a.date <= rangeEnd);
      }

      const lessons = allLessons;
      const memories = allMemories;
      const activityLogs = includeActivities ? allActivityLogs : [];

      const done = lessons.filter(l => l.completed);
      const tLM = done.reduce((s, l) => s + lm(l).m, 0);
      const mM = memories.filter(m => m.duration_minutes).reduce((s, m) => s + (m.duration_minutes || 0), 0);
      const actM = activityLogs.reduce((s, a) => s + (a.minutes_spent || 0), 0);
      const books = memories.filter(m => m.type === "book");
      const trips = memories.filter(m => ["field_trip", "project", "activity"].includes(m.type));
      // School days: any day with a lesson OR an activity
      const lessonDays = new Set(done.map(l => ld(l)).filter(Boolean));
      const activityDays = new Set(activityLogs.map(a => a.date));
      const allSchoolDays = new Set([...lessonDays, ...activityDays]);
      const sDays = allSchoolDays.size;
      // Backfill hours
      const backfillMins = done.filter(l => l.is_backfill).reduce((s, l) => s + lm(l).m, 0)
        + activityLogs.filter(a => a.is_backfill).reduce((s, a) => s + (a.minutes_spent || 0), 0);

      const selectedChild = children.find(c => c.id === reportChildId);
      if (!selectedChild) {
        alert("Please select a child for the report.");
        setDownloadingReport(false);
        return;
      }
      const reportChildren = [selectedChild];
      const isPerChild = true;

      // Filter lessons/memories/activities to selected child when per-child
      const scopedDone = done.filter(l => l.child_id === reportChildId);
      const scopedMemories = memories.filter(m => m.child_id === reportChildId || m.child_id === null);
      const scopedActivityLogs = activityLogs.filter(a => {
        const act = activityMap[a.activity_id];
        return act?.child_ids?.includes(reportChildId);
      });

      // Recalculate summary for scoped data
      const scopedTLM = scopedDone.reduce((s, l) => s + lm(l).m, 0);
      const scopedActM = scopedActivityLogs.reduce((s, a) => s + (a.minutes_spent || 0), 0);
      const scopedMM = scopedMemories.filter(m => m.duration_minutes).reduce((s, m) => s + (m.duration_minutes || 0), 0);
      const scopedBooks = scopedMemories.filter(m => m.type === "book");
      const scopedTrips = scopedMemories.filter(m => ["field_trip", "project", "activity"].includes(m.type));
      const scopedLessonDays = new Set(scopedDone.map(l => ld(l)).filter(Boolean));
      const scopedActDays = new Set(scopedActivityLogs.map(a => a.date));
      const scopedSDays = new Set([...scopedLessonDays, ...scopedActDays]).size;

      const childReport = reportChildren.map(c => {
        const cl = done.filter(l => l.child_id === c.id);
        const cm = cl.reduce((s, l) => s + lm(l).m, 0);
        // Activities for this child
        const childActs = activityLogs.filter(a => { const act = activityMap[a.activity_id]; return act?.child_ids?.includes(c.id); });
        const childActM = childActs.reduce((s, a) => s + (a.minutes_spent || 0), 0);
        // School days: lessons + activities
        const childLessonDays = new Set(cl.map(l => ld(l)).filter(Boolean));
        const childActDays = new Set(childActs.map(a => a.date));
        const cd = new Set([...childLessonDays, ...childActDays]).size;
        const sa: Record<string, { n: number; m: number; e: boolean }> = {};
        for (const l of cl) { const nm = l.subjects?.name || "General"; if (!sa[nm]) sa[nm] = { n: 0, m: 0, e: false }; sa[nm].n++; const r = lm(l); sa[nm].m += r.m; if (r.e) sa[nm].e = true; }
        // Group activities
        const actGroups: Record<string, { name: string; emoji: string; sessions: number; mins: number }> = {};
        for (const a of childActs) {
          const act = activityMap[a.activity_id];
          if (!act) continue;
          if (!actGroups[a.activity_id]) actGroups[a.activity_id] = { name: act.name, emoji: act.emoji, sessions: 0, mins: 0 };
          actGroups[a.activity_id].sessions++;
          actGroups[a.activity_id].mins += a.minutes_spent || 0;
        }
        return {
          name: c.name,
          totalHours: fmtMins(cm + childActM),
          totalLessons: cl.length,
          schoolDays: cd,
          subjects: Object.entries(sa).map(([n, d]) => ({ name: n, count: d.n, hours: fmtMins(d.m), estimated: d.e })).sort((a, b) => b.count - a.count),
          activities: Object.values(actGroups).map(g => ({ name: g.name, emoji: g.emoji, sessions: g.sessions, hours: fmtMins(g.mins) })).sort((a, b) => b.sessions - a.sessions),
          books: memories.filter(m => m.type === "book" && (m.child_id === c.id || m.child_id === null)).map(m => m.title || "Untitled"),
          fieldTrips: memories.filter(m => ["field_trip","project","activity"].includes(m.type) && (m.child_id === c.id || m.child_id === null)).map(m => ({ title: m.title || "Untitled", duration: m.duration_minutes })),
          wins: memories.filter(m => ["win","quote"].includes(m.type) && (m.child_id === c.id || m.child_id === null)).map(m => m.title || "Untitled"),
          badges: [],
        };
      });

      // Build child name lookup for daily log
      const childNameMap: Record<string, string> = {};
      for (const c of children) childNameMap[c.id] = c.name;

      // Daily log — scoped to selected child when per-child
      const logMap: Record<string, { childName: string; subject: string; description: string; minutes: number; type: string; estimated: boolean }[]> = {};
      for (const l of scopedDone) { const d = ld(l); if (!d) continue; if (!logMap[d]) logMap[d] = []; const r = lm(l); logMap[d].push({ childName: childNameMap[l.child_id] || "", subject: l.subjects?.name || "General", description: l.is_backfill ? `${l.title || "Lesson"} (imported)` : (l.title || "Lesson"), minutes: r.m, type: l.is_backfill ? "Imported" : "Lesson", estimated: r.e }); }
      for (const m of scopedMemories) { if (!m.duration_minutes || !["field_trip","project","activity","win"].includes(m.type)) continue; if (!logMap[m.date]) logMap[m.date] = []; logMap[m.date].push({ childName: m.child_id ? (childNameMap[m.child_id] || "") : "", subject: m.type === "win" ? "Win" : "Field Trip", description: m.title || "Activity", minutes: m.duration_minutes, type: "Activity", estimated: false }); }
      for (const a of scopedActivityLogs) { const act = activityMap[a.activity_id]; if (!act || !a.minutes_spent) continue; if (!logMap[a.date]) logMap[a.date] = []; const childNames = (act.child_ids || []).map(id => childNameMap[id] || "").filter(Boolean).join(", "); logMap[a.date].push({ childName: childNames, subject: act.name, description: `${act.emoji} ${act.name}${a.is_backfill ? " (imported)" : ""}`, minutes: a.minutes_spent, type: "Activity", estimated: false }); }
      const dailyLog = Object.entries(logMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => ({
        dateLabel: new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        entries,
      }));

      const reportTitle = isPerChild && selectedChild
        ? `${selectedChild.name} - ${familyName}`
        : familyName;

      console.log("[Report v5] Data ready:", JSON.stringify({ reportTitle, yr, children: childReport.length, lessons: scopedDone.length, memories: scopedMemories.length, dailyLogDays: dailyLog.length }));
      const doc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
      generateProgressReport(doc, {
        familyName: reportTitle, schoolYear: dateRangeLabel || yr, dateGenerated: dateGen, showWatermark: true,
        summary: {
          totalHours: fmtMins(scopedTLM + scopedActM + scopedMM),
          curriculumHours: fmtMins(scopedTLM),
          activityHours: scopedActM > 0 ? fmtMins(scopedActM) : undefined,
          schoolDays: scopedSDays, lessons: scopedDone.length, books: scopedBooks.length, trips: scopedTrips.length, memories: scopedMemories.length,
        },
        children: childReport,
        dailyLog,
        showChildColumn: !isPerChild,
        backfillHours: backfillMins,
      });
      const slugify = (s: string) => s.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
      const fileSlug = isPerChild && selectedChild
        ? `${slugify(selectedChild.name)}-${slugify(familyName)}`
        : slugify(familyName);
      doc.save(`${fileSlug}-progress-report-${yr.replace(/[^\d]/g, "-")}.pdf`);
      console.log("[Report v4] PDF saved successfully");
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("[Report v4] FAILED:", err.message, err.stack);
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloadingReport(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    {/* ── Hero Header ──────────────────────────────────── */}
    <PageHero overline="Your Curriculum" title="Plan" subtitle="Your lessons, your pace." />
    <div className="px-4 pt-5 pb-7 space-y-4 max-w-5xl" style={{ background: "#F8F7F4" }}>

      {/* ── Year toggle (when upcoming year exists) ────────── */}
      {!schoolYears.loading && schoolYears.upcoming && (
        <div className="flex gap-2">
          <button
            onClick={() => setYearView("this")}
            className="text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            style={{
              background: yearView === "this" ? "#2D5A3D" : "white",
              color: yearView === "this" ? "white" : "#8B7E74",
              border: yearView === "this" ? "none" : "1px solid #e8e5e0",
            }}
          >
            This Year
          </button>
          <button
            onClick={() => setYearView("next")}
            className="text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            style={{
              background: yearView === "next" ? "#2D5A3D" : "white",
              color: yearView === "next" ? "white" : "#8B7E74",
              border: yearView === "next" ? "none" : "1px solid #e8e5e0",
            }}
          >
            Next Year
          </button>
        </div>
      )}

      {/* ── Plan Next Year prompt (no upcoming year yet) ──── */}
      {!schoolYears.loading && schoolYears.active && !schoolYears.upcoming && yearView === "this" && (
        <button
          onClick={() => setShowCreateYear(true)}
          className="w-full bg-white border border-[#e8e5e0] rounded-2xl p-4 flex items-start gap-3 text-left hover:bg-[#faf9f7] transition-colors"
        >
          <span className="text-xl shrink-0">🌱</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-[#2D2A26]">Plan Next Year</p>
            <p className="text-[11px] text-[#8B7E74] mt-0.5">Start setting up your curriculum for next year — your current year stays untouched.</p>
          </div>
          <ChevronRight size={16} className="text-[#8B7E74] shrink-0 mt-0.5" />
        </button>
      )}

      {/* ── Catch-up banner ──────────────────────────────── */}
      {!loading && hasCatchUp && (
        <div style={{ background: "#FFFBF0", border: "0.5px solid #E8D58A", borderRadius: 12, padding: "11px 13px", display: "flex", gap: 10 }}>
          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>📋</span>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#7a5000" }}>You have lessons from earlier this week</p>
            <p style={{ fontSize: 10, color: "#a07000", marginTop: 2 }}>Tap any past day to check off what you covered.</p>
          </div>
        </div>
      )}

      {/* ── Calendar card (toggle + nav + grid) ──────────── */}
      <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden">
        {/* Toggle row */}
        <div className="flex gap-2 p-4 pb-3">
          <button
            onClick={() => { setViewMode("week"); setCalendarCollapsed(false); }}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              viewMode === "week"
                ? "bg-[#2D5A3D] text-white"
                : "bg-[#F8F7F4] text-[#5C5346] border border-[#e8e5e0]"
            }`}
          >
            Week
          </button>
          <button
            onClick={() => { setViewMode("month"); setCalendarCollapsed(false); }}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              viewMode === "month"
                ? "bg-[#2D5A3D] text-white"
                : "bg-[#F8F7F4] text-[#5C5346] border border-[#e8e5e0]"
            }`}
          >
            Month
          </button>
        </div>

      {/* ── Missed lessons banner ────────────────────────── */}
      {!loading && missedLessons.length > 0 && (
        <div style={{ background: "#fffbf0", border: "1px solid #f0dda8", borderRadius: 14, padding: "14px 16px", marginBottom: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#7a4a1a", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span>⚠️</span> You have {missedLessons.length} missed lesson{missedLessons.length !== 1 ? "s" : ""}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {missedLessons.slice(0, 10).map(lesson => {
              const d = new Date((lesson.scheduled_date ?? lesson.date ?? "") + "T00:00:00");
              const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              const subjectLabel = lesson.subjects?.name ?? "General";
              return (
                <div key={lesson.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "white", borderRadius: 10, padding: "8px 12px", border: "0.5px solid #f0dda8" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: "#2d2926", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {dateLabel} · {lesson.title}
                    </p>
                    <p style={{ fontSize: 10, color: "#9a8e84", margin: "1px 0 0" }}>{subjectLabel}</p>
                  </div>
                  <button
                    onClick={() => openPlanReschedule(lesson)}
                    style={{ fontSize: 11, fontWeight: 600, color: "#7a4a1a", background: "#fef9e8", border: "1px solid #f0dda8", borderRadius: 8, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    Reschedule
                  </button>
                </div>
              );
            })}
            {missedLessons.length > 10 && (
              <p style={{ fontSize: 11, color: "#9a8e84", textAlign: "center", margin: "2px 0 0" }}>
                + {missedLessons.length - 10} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          SECTION 2A — WEEK VIEW (inside calendar card)
      ══════════════════════════════════════════════════ */}
      {viewMode === "week" && !loading && (
        <div className="px-4 pb-4">
          {/* Week navigation */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 10 }}>
            <button onClick={prevWeek} className="p-1 text-[#5c7f63] hover:text-[#2D5A3D] transition-colors" style={{ background: "none", border: "none", cursor: "pointer" }}>
              <ChevronLeft size={18} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#2d2926" }}>
              {formatWeekRange(weekStart)}
            </span>
            <button onClick={nextWeek} className="p-1 text-[#5c7f63] hover:text-[#2D5A3D] transition-colors" style={{ background: "none", border: "none", cursor: "pointer" }}>
              <ChevronRight size={18} />
            </button>
          </div>

          {/* 7-day strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
            {weekDays.map((day) => {
              const key = toDateStr(day);
              const isToday = key === todayStr;
              const isPast = day < todayMidnight && !isToday;
              const isSelected = key === selectedDay;
              const isVacation = isDateInBlocks(key, vacationBlocks);
              const dayLessons = lessonsByDay[key] ?? [];
              const hasLessons = dayLessons.length > 0;
              // Unique children with lessons this day
              const dayChildIds = [...new Set(dayLessons.map(l => l.child_id).filter(Boolean))];
              const dayChildren = dayChildIds.map(id => children.find(c => c.id === id)).filter(Boolean) as Child[];

              let bg = "transparent";
              let border = "none";
              let opacity = 1;

              if (isToday) {
                bg = "#2D5A3D";
                if (isVacation) border = "2px solid #f0c878";
                else if (isSelected) border = "2px solid rgba(255,255,255,0.6)";
              } else if (isSelected) {
                bg = isVacation ? "#fff4e0" : "#f4faf0";
                border = "1.5px solid var(--g-brand)";
              } else if (isVacation) {
                bg = "#fff8f0";
                border = "0.5px solid #f0c878";
              } else if (hasLessons) {
                bg = "white";
                border = "0.5px solid #e8e0d4";
              }
              if (isPast && hasLessons && !isSelected && !isToday) opacity = 0.6;
              const isMilestone = !!schoolYearMilestones[key];

              return (
                <button
                  key={key}
                  onClick={() => selectDay(key)}
                  style={{
                    borderRadius: 12, padding: "7px 4px", display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 3, cursor: "pointer", background: bg, border,
                    opacity,
                    ...(isMilestone && !isToday ? { borderLeft: "3px solid #2D5A3D" } : {}),
                  }}
                >
                  <span style={{
                    fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em",
                    color: isToday ? "rgba(255,255,255,0.7)" : "#b5aca4", fontWeight: 600,
                  }}>
                    {DAY_LABELS[(day.getDay() + 6) % 7]}
                  </span>
                  <span style={{
                    fontSize: 16, fontWeight: 700,
                    color: isToday ? "white" : "#2d2926",
                  }}>
                    {day.getDate()}
                  </span>
                  {/* Dots or vacation */}
                  <div style={{ display: "flex", gap: 3, minHeight: 5, alignItems: "center" }}>
                    {isVacation ? (
                      <span style={{ fontSize: 10 }}>🌴</span>
                    ) : dayChildren.length > 0 ? (
                      dayChildren.map(c => (
                        <span key={c.id} style={{
                          width: 5, height: 5, borderRadius: "50%", display: "inline-block",
                          backgroundColor: isToday ? "rgba(255,255,255,0.5)" : (c.color ?? "#5c7f63"),
                        }} />
                      ))
                    ) : null}
                  </div>
                  {isMilestone && (
                    <span style={{
                      fontSize: 7, fontWeight: 700,
                      color: isToday ? "rgba(255,255,255,0.85)" : "#2D5A3D",
                      marginTop: 1, textAlign: "center", lineHeight: 1.1,
                    }}>
                      {schoolYearMilestones[key].split(" ")[0]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          SECTION 2B — MONTH VIEW (inside calendar card)
      ══════════════════════════════════════════════════ */}
      {viewMode === "month" && !loading && (
        <div className="px-4 pb-4">
          {/* Month navigation */}
          <div className="flex items-center justify-center gap-3 mb-3">
            <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center text-[#5c7f63] hover:text-[#2D5A3D] transition-colors rounded-lg hover:bg-[#f0ede8]">
              <ChevronLeft size={18} />
            </button>
            <span className="text-[15px] font-semibold text-[#2D2A26]">
              {monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}{getSeasonalEmoji(monthStart.getMonth())}
            </span>
            <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center text-[#5c7f63] hover:text-[#2D5A3D] transition-colors rounded-lg hover:bg-[#f0ede8]">
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 pb-2">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="text-center text-[11px] font-medium uppercase text-[#8B7E74]">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {(() => {
            const year = monthStart.getFullYear();
            const month = monthStart.getMonth();
            const firstDay = new Date(year, month, 1);
            const startOffset = firstDay.getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const cells: (Date | null)[] = [
              ...Array(startOffset).fill(null),
              ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
            ];
            while (cells.length % 7 !== 0) cells.push(null);

            // On mobile when collapsed, show only the week row containing the selected day
            const showCollapsedWeek = isMobile && calendarCollapsed;
            let visibleCells = cells;
            if (showCollapsedWeek) {
              const selIdx = cells.findIndex((c) => c && toDateStr(c) === selectedDay);
              if (selIdx >= 0) {
                const rowStart = Math.floor(selIdx / 7) * 7;
                visibleCells = cells.slice(rowStart, rowStart + 7);
              }
            }

            const holidays = getUSHolidays(year);

            // Count activities per day (based on which weekdays they're scheduled)
            const activityCountForDay = (dateStr: string): number => {
              const d = new Date(dateStr + "T12:00:00");
              // activities.days uses 0=Mon, 1=Tue, ..., 6=Sun
              const dayIdx = (d.getDay() + 6) % 7;
              return activities.filter(a => a.is_active && a.days.includes(dayIdx)).length;
            };

            // Compute lightest week
            const weekCounts: { start: Date; end: Date; count: number }[] = [];
            {
              // Find all Mondays in the month
              const cursor = new Date(year, month, 1);
              while (cursor.getMonth() === month) {
                if (cursor.getDay() === 1) { // Monday
                  const weekStart = new Date(cursor);
                  const weekEnd = new Date(cursor);
                  weekEnd.setDate(weekEnd.getDate() + 4); // Friday
                  let count = 0;
                  for (let dd = new Date(weekStart); dd <= weekEnd && dd.getMonth() === month; dd.setDate(dd.getDate() + 1)) {
                    const k = toDateStr(dd);
                    count += (monthLessonMap[k] ?? []).length + activityCountForDay(k) + (monthApptMap[k] ?? []).length;
                  }
                  weekCounts.push({ start: weekStart, end: weekEnd, count });
                }
                cursor.setDate(cursor.getDate() + 1);
              }
            }
            const lightestWeek = weekCounts.length > 0 ? weekCounts.reduce((a, b) => a.count <= b.count ? a : b) : null;

            // First day of each vacation block for label
            const vacStartDates = new Set(vacationBlocks.map(b => b.start_date));

            // Build event pill items per day
            type PillItem = { name: string; emoji: string; type: "lesson" | "appt"; time?: string };
            const dayPillsMap: Record<string, PillItem[]> = {};
            for (const [dateKey, lessons] of Object.entries(monthLessonMap)) {
              const pills: PillItem[] = [];
              const seen = new Set<string>();
              for (const l of lessons) {
                const goal = l.curriculum_goal_id ? curriculumGoals.find(g => g.id === l.curriculum_goal_id) : null;
                const name = goal?.curriculum_name ?? l.title.split(" — ")[0] ?? "Lesson";
                if (seen.has(name)) continue;
                seen.add(name);
                pills.push({ name, emoji: goal?.icon_emoji ?? "📚", type: "lesson" });
              }
              dayPillsMap[dateKey] = pills;
            }
            for (const [dateKey, appts] of Object.entries(monthApptMap)) {
              if (!dayPillsMap[dateKey]) dayPillsMap[dateKey] = [];
              for (const a of appts) {
                let timeStr: string | undefined;
                if (a.time) { const [h, m] = a.time.split(":").map(Number); timeStr = `${h % 12 || 12}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "PM" : "AM"}`; }
                dayPillsMap[dateKey].push({ name: a.title, emoji: a.emoji || "📅", type: "appt", time: timeStr });
              }
            }

            // Vacation streak detection
            const openStreaks: number[][] = [];
            let currentStreak: number[] = [];
            for (let d = 1; d <= daysInMonth; d++) {
              const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const items = dayPillsMap[ds] ?? [];
              const isVac = isDateInBlocks(ds, vacationBlocks);
              if (items.length === 0 && !isVac && activityCountForDay(ds) === 0) {
                currentStreak.push(d);
              } else {
                if (currentStreak.length >= 3) openStreaks.push([...currentStreak]);
                currentStreak = [];
              }
            }
            if (currentStreak.length >= 3) openStreaks.push([...currentStreak]);

            const selfCareSuggestions = [
              "Do absolutely nothing. You\u2019ve earned it.",
              "Self care day \u2014 no lessons, no guilt.",
              "Finally start that hobby you keep putting off.",
              "Make yourself a cup of tea and just sit.",
              "Organize that one thing that\u2019s been bugging you.",
              "Read a book. A real one. For you.",
              "Pajama day. The kids will love it too.",
              "Bake something with the kids \u2014 or without them.",
              "Take a drive. No destination needed.",
              "Catch up with a friend you\u2019ve been meaning to call.",
              "Get outside. Even 20 minutes counts.",
              "Do something creative \u2014 just for fun, not for school.",
            ];

            // Month stats
            const monthLessonTotal = Object.values(monthLessonMap).reduce((s, arr) => s + arr.length, 0);
            const monthApptTotal = Object.values(monthApptMap).reduce((s, arr) => s + arr.length, 0);
            let monthOpenDays = 0;
            for (let d = 1; d <= daysInMonth; d++) {
              const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              if ((dayPillsMap[ds] ?? []).length === 0 && activityCountForDay(ds) === 0 && !isDateInBlocks(ds, vacationBlocks)) monthOpenDays++;
            }

            // Set of open-streak days for styling
            const openStreakDays = new Set<number>();
            for (const streak of openStreaks) for (const d of streak) openStreakDays.add(d);

            return (
              <>
              {/* Month stats */}
              <p className="text-center text-[13px] text-[#8a8580] -mt-1 mb-2">
                {monthLessonTotal} lesson{monthLessonTotal !== 1 ? "s" : ""} · {monthApptTotal} appointment{monthApptTotal !== 1 ? "s" : ""} · {monthOpenDays} open day{monthOpenDays !== 1 ? "s" : ""}
              </p>
              <div className="grid grid-cols-7 gap-[3px]">
                {visibleCells.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} className="min-h-[78px]" />;
                  const key = toDateStr(day);
                  const isToday = key === todayStr;
                  const isPast = day < todayMidnight && !isToday;
                  const isSelected = key === selectedDay;
                  const isVacation = isDateInBlocks(key, vacationBlocks);
                  const actCount = activityCountForDay(key);
                  const holiday = holidays[key];
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const pills = dayPillsMap[key] ?? [];
                  const allItems = pills.length + actCount;
                  const isOpenStreak = openStreakDays.has(day.getDate());

                  let cellBg = "";
                  let cellBorder = "";
                  if (isToday) {
                    cellBg = "bg-[#2D5A3D]";
                    if (isSelected) cellBorder = "ring-2 ring-white/60";
                  } else if (isSelected) {
                    cellBg = isVacation ? "bg-[#fef3e0]" : "bg-[#f0faf3]";
                    cellBorder = "ring-2 ring-[#2D5A3D]";
                  } else if (isVacation) {
                    cellBg = "bg-[#fef3e0]";
                    cellBorder = "border border-[#f0c878]";
                  } else if (isOpenStreak) {
                    cellBg = "bg-[#fef9f0]";
                  } else if (allItems === 0 && !holiday) {
                    cellBg = "bg-[#fafaf8]";
                  }

                  return (
                    <div key={key} className="relative">
                      <button
                        onClick={() => selectDay(key)}
                        className={`w-full min-h-[78px] rounded-xl flex flex-col items-center justify-start p-1 cursor-pointer transition-colors ${cellBg} ${cellBorder}`}
                        style={{ opacity: isPast ? 0.75 : 1 }}
                      >
                        {/* Date number */}
                        {isToday ? (
                          <span className="bg-[#2D5A3D] text-white rounded-full w-6 h-6 inline-flex items-center justify-center text-[13px] font-medium">{day.getDate()}</span>
                        ) : (
                          <span className={`text-[13px] leading-none ${
                            allItems > 0 ? "font-medium text-[#2D2A26]"
                            : isWeekend ? "font-medium text-[#c4beb6]"
                            : "font-medium text-[#c4beb6]"
                          }`}>{day.getDate()}</span>
                        )}
                        {/* Event pills */}
                        <div className="flex flex-col gap-[1px] mt-0.5 w-full">
                          {isVacation ? (
                            <span className="text-[8px] text-center">🌴</span>
                          ) : isOpenStreak && allItems === 0 ? (
                            <span className="text-[8px] text-center opacity-40">☀️</span>
                          ) : holiday && allItems === 0 ? (
                            <span className="text-[8px] text-center">{holiday.split(" ")[0]}</span>
                          ) : (
                            <>
                              {pills.slice(0, 3).map((p, pi) => (
                                <span key={pi}
                                  className={`text-[8px] font-medium px-1 py-[1.5px] rounded leading-tight truncate ${
                                    p.type === "lesson" ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#ede9fe] text-[#6d28d9]"
                                  }`}
                                  style={{ letterSpacing: "0.1px" }}>
                                  {p.emoji} {p.name}
                                </span>
                              ))}
                              {pills.length > 3 && (
                                <span className="text-[7.5px] text-[#999] text-center font-medium">+{pills.length - 3}</span>
                              )}
                            </>
                          )}
                          {schoolYearMilestones[key] && !isVacation && (
                            <span className="text-[7px] font-medium text-[#2D5A3D] text-center leading-tight">{schoolYearMilestones[key].split(" ")[0]}</span>
                          )}
                        </div>
                      </button>

                    </div>
                  );
                })}
              </div>

              {/* Compact open-week hint — show only the longest streak, inline */}
              {!showCollapsedWeek && openStreaks.length > 0 && (() => {
                const longest = openStreaks.reduce((a, b) => b.length > a.length ? b : a);
                const mName = monthStart.toLocaleDateString("en-US", { month: "short" });
                return (
                  <p className="mt-2 text-xs text-[#b45309] text-center">
                    🌴 {mName} {longest[0]}–{longest[longest.length - 1]} is wide open ({longest.length} days free)
                  </p>
                );
              })()}

              {/* Expand-back control (mobile, collapsed) */}
              {showCollapsedWeek && (
                <button
                  onClick={() => setCalendarCollapsed(false)}
                  className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-[12px] font-medium text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors"
                  aria-label="Show full calendar"
                >
                  <ChevronDown size={14} /> Show full calendar
                </button>
              )}
              </>
            );
          })()}
        </div>
      )}
      {/* Close calendar card */}
      </div>

      {/* Scroll anchor for mobile: lands here when a date is tapped */}
      <div ref={dayDetailRef} aria-hidden="true" style={{ scrollMarginTop: 16 }} />

      {/* School year milestone banner for selected day */}
      {schoolYearMilestones[selectedDay] && (
        <div className="bg-[#f0f7f2] border border-[#c5dbc9] rounded-xl px-3 py-2 mb-1">
          <p className="text-sm font-semibold text-[#2D5A3D]">{schoolYearMilestones[selectedDay]}</p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          SECTION — SELECTED DAY ITEMS (lessons + appointments)
      ══════════════════════════════════════════════════ */}
      {(() => {
        const selLessons = viewMode === "month" ? (monthLessonMap[selectedDay] ?? []) : (lessonsByDay[selectedDay] ?? []);
        const selAppts = monthApptMap[selectedDay] ?? [];
        const selDate = new Date(selectedDay + "T00:00:00");
        const selDateLabel = selDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
        const selIsVacation = isDateInBlocks(selectedDay, vacationBlocks);
        const selVacName = getVacationName(selectedDay, vacationBlocks);

        const dayHeader = (
          <div className="flex items-center justify-between gap-2 pl-1 mb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74]">{selDateLabel}</p>
            {!isPartner && !selIsVacation && (
              <button
                onClick={() => { setVacName(""); setVacStart(selectedDay); setVacEnd(selectedDay); setVacReschedule("leave"); setShowVacModal(true); }}
                className="text-[11px] font-medium text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors min-h-[32px] px-1"
              >
                Mark as break →
              </button>
            )}
          </div>
        );

        if (selLessons.length === 0 && selAppts.length === 0) {
          return (
            <div className="mb-3">
              {dayHeader}
              <div className="rounded-xl text-center" style={{ background: "#F8F7F4", border: "1px solid #e5e0d8", padding: 24 }}>
                {selIsVacation ? (
                  <p className="text-sm text-[#7a5000]">🌴 {selVacName ?? "Break"} — enjoy the time off!</p>
                ) : (
                  <p className="text-sm text-[#5C5346]">☀️ Nothing scheduled — enjoy the day!</p>
                )}
                {!isPartner && (
                  <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowCreateWizard(true)}
                      className="min-h-[36px] text-[12px] font-medium text-[#2D5A3D] rounded-full px-3.5 py-1.5 hover:bg-[#f0f7f1] transition-colors"
                      style={{ background: "white", border: "1px solid #2D5A3D" }}
                    >
                      + Add lesson
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowApptCreate(true)}
                      className="min-h-[36px] text-[12px] font-medium text-[#2D5A3D] rounded-full px-3.5 py-1.5 hover:bg-[#f0f7f1] transition-colors"
                      style={{ background: "white", border: "1px solid #2D5A3D" }}
                    >
                      + Appt
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        }
        return (
          <div className="mb-3 space-y-2">
            {dayHeader}
            {selIsVacation && selVacName && (
              <p className="text-[11px] text-[#7a5000] pl-1">🌴 {selVacName}</p>
            )}
            {selLessons.map((l) => {
              const goal = l.curriculum_goal_id ? curriculumGoals.find(g => g.id === l.curriculum_goal_id) : null;
              return (
                <div key={l.id} className="rounded-xl" style={{ background: "linear-gradient(to bottom right, #eefbf0, #e0f8e6)", border: "1px solid #cef0d4" }}>
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-xl shrink-0">{goal?.icon_emoji ?? "📚"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-[#2d2926] truncate">{goal?.curriculum_name ?? l.title}</span>
                        <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 bg-[#dcfce7] text-[#15803d]">Lesson</span>
                      </div>
                      {l.subjects?.name && <p className="text-xs text-[#7a6f65] mt-0.5">{l.subjects.name}{l.child_id ? ` · ${children.find(c => c.id === l.child_id)?.name ?? ""}` : ""}</p>}
                      {/* Note preview (collapsed) */}
                      {editingNoteId !== l.id && l.notes && (
                        <p className="text-[11px] text-[#6b6560] italic mt-1 line-clamp-1">{l.notes}</p>
                      )}
                    </div>
                  </div>
                  {/* Note editing / display */}
                  {!isPartner && (
                    <div className="px-4 pb-2.5">
                      {editingNoteId === l.id ? (
                        <div>
                          <textarea
                            ref={noteTextareaRef}
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                            placeholder="Prep items, extra activities, reminders..."
                            className="w-full min-h-[52px] max-h-[100px] rounded-lg border border-[#cef0d4] bg-white p-2 text-[12px] text-[#3c3a37] resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/30"
                          />
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              onClick={() => saveNote(l.id)}
                              disabled={noteSaveState === "saving" || noteSaveState === "saved"}
                              aria-live="polite"
                              className={`min-h-[44px] min-w-[88px] text-white text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors ${
                                noteSaveState === "saved" ? "bg-[#5c7f63]" :
                                noteSaveState === "error" ? "bg-[#b91c1c]" :
                                noteSaveState === "saving" ? "bg-[#2D5A3D] opacity-70" :
                                "bg-[#2D5A3D] hover:bg-[var(--g-deep)]"
                              }`}
                            >
                              {noteSaveState === "saving" ? "Saving…" :
                               noteSaveState === "saved" ? "Saved ✓" :
                               noteSaveState === "error" ? "Try again" :
                               "Save"}
                            </button>
                            <button
                              onClick={cancelEditingNote}
                              disabled={noteSaveState === "saving"}
                              className="min-h-[44px] text-[13px] text-[#8a8580] font-medium px-3 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            {noteSaveState === "error" && (
                              <span className="text-[11px] text-[#b91c1c]">Couldn&apos;t save — try again</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 flex-wrap">
                          {l.notes ? (
                            <button
                              onClick={() => startEditingNote(l.id, l.notes)}
                              aria-label="Edit note"
                              className="flex items-center gap-1.5 min-h-[44px] min-w-[44px] -ml-1 px-2 text-[13px] text-[#2D5A3D] font-medium"
                            >
                              <Pencil size={14} /> Edit note
                            </button>
                          ) : (
                            <button
                              onClick={() => startEditingNote(l.id, null)}
                              aria-label="Add a note"
                              className="inline-flex items-center min-h-[44px] min-w-[44px] -ml-1 px-2 text-[13px] text-[#5c7f63] font-medium hover:text-[#2D5A3D] transition-colors"
                            >
                              + Add a note
                            </button>
                          )}
                          <span aria-hidden="true" className="text-[#cfc9c0] select-none">·</span>
                          <button
                            onClick={() => skipPlanLesson(l)}
                            aria-label="Skip this lesson"
                            className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] text-[#8a8580] font-medium hover:text-[#2d2926] transition-colors"
                          >
                            <X size={14} /> Skip
                          </button>
                          <button
                            onClick={() => openPlanReschedule(l)}
                            aria-label="Reschedule this lesson"
                            className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] text-[#2D5A3D] font-medium hover:text-[var(--g-deep)] transition-colors"
                          >
                            <Calendar size={14} /> Reschedule
                          </button>
                          <button
                            onClick={() => openEdit(l)}
                            aria-label="Edit this lesson"
                            className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] text-[#2D5A3D] font-medium hover:text-[var(--g-deep)] transition-colors"
                          >
                            <Pencil size={14} /> Edit
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {selAppts.map((a) => (
              <div key={`${a.id}-${a.instance_date}`} className={`rounded-xl ${a.completed ? "opacity-50" : ""}`} style={{ background: "linear-gradient(to bottom right, #f5f0ff, #ede5ff)", border: "1px solid #e8deff" }}>
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xl shrink-0">{a.emoji || "📅"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[14px] font-medium truncate ${a.completed ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>{a.title}</span>
                      <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 bg-[#ede9fe] text-[#6d28d9]">Appt</span>
                      {a.is_recurring && (
                        <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 bg-[#ede9fe] text-[#6d28d9]">Recurring</span>
                      )}
                    </div>
                    <p className="text-xs text-[#7a6f65] mt-0.5">
                      {a.time ? (() => { const [h, m] = a.time!.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; })() : "All day"}
                      {a.location && <span className="text-[#b5aca4]"> · 📍 {a.location}</span>}
                    </p>
                  </div>
                </div>
                {!isPartner && (
                  <div className="px-4 pb-2.5">
                    {reschedulingApptId === a.id && !a.is_recurring ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="date"
                          min={todayStr}
                          value={reschedulingApptDate}
                          onChange={(e) => setReschedulingApptDate(e.target.value)}
                          className="text-sm border border-[#e8e2d9] rounded-lg px-3 py-2 bg-white text-[#2d2926] min-h-[44px]"
                        />
                        <button
                          onClick={() => rescheduleAppt(a, reschedulingApptDate)}
                          disabled={!reschedulingApptDate || reschedulingApptDate === a.date}
                          className="min-h-[44px] px-4 bg-[#2D5A3D] hover:bg-[var(--g-deep)] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors"
                        >
                          Move
                        </button>
                        <button
                          onClick={() => setReschedulingApptId(null)}
                          className="min-h-[44px] text-[13px] text-[#8a8580] font-medium px-3"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 flex-wrap">
                        {a.is_recurring ? (
                          <button
                            onClick={() => openEditAppt(a)}
                            aria-label="Edit appointment series"
                            className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] text-[#6d28d9] font-medium hover:text-[#5b21b6] transition-colors"
                          >
                            <Pencil size={14} /> Edit series
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => skipAppt(a)}
                              aria-label="Skip this appointment"
                              className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] text-[#8a8580] font-medium hover:text-[#2d2926] transition-colors"
                            >
                              <X size={14} /> Skip
                            </button>
                            <button
                              onClick={() => { setReschedulingApptId(a.id); setReschedulingApptDate(a.date); }}
                              aria-label="Reschedule this appointment"
                              className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] text-[#6d28d9] font-medium hover:text-[#5b21b6] transition-colors"
                            >
                              <Calendar size={14} /> Reschedule
                            </button>
                            <button
                              onClick={() => openEditAppt(a)}
                              aria-label="Edit this appointment"
                              className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 text-[13px] text-[#6d28d9] font-medium hover:text-[#5b21b6] transition-colors"
                            >
                              <Pencil size={14} /> Edit
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════
          SECTION — CURRICULUM
      ══════════════════════════════════════════════════ */}
      {!isPartner && !loading && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2 pl-1">
            Curriculum
          </p>
          {curricGroups.length === 0 && yearView === "next" && (
            <div className="bg-[#f0f7f2] border border-[#c5dbc9] rounded-2xl p-5 text-center mb-2">
              <p className="text-2xl mb-2">🌱</p>
              <p className="text-sm font-semibold text-[#2D5A3D] mb-1">
                Start planning {schoolYears.upcoming?.name ?? "next year"}!
              </p>
              <p className="text-xs text-[#7a6f65]">
                Add curriculum and activities now so everything is ready when the new year begins.
              </p>
            </div>
          )}
          {curricGroups.length === 0 && yearView !== "next" && (
            <div className="bg-white border border-[#e8e5e0] rounded-2xl p-5 text-center mb-2">
              <p style={{ fontSize: 13, color: "#b5aca4", margin: 0 }}>No curriculum added yet</p>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {curricGroups.map((group) => {
              const completedFromRows = group.totalCount - group.remainingCount;
              const goal = group.goalData;
              const displaySubject = goal?.subject_label ?? group.subjectName ?? "General";
              const displayCompleted = goal?.current_lesson ?? completedFromRows;
              const displayTotal = goal?.total_lessons ?? group.totalCount;
              const pct = displayTotal > 0 ? Math.round((displayCompleted / displayTotal) * 100) : 0;
              const miniFillWidth = pct > 0 ? Math.max(4, Math.round((pct / 100) * 48)) : 0;
              const child = children.find(c => c.id === group.childId);
              const isExpanded = expandedCourses.has(group.key);

              // Projected finish
              const currentLesson = displayCompleted;
              const totalLessons = displayTotal;
              const lessonsRemaining = totalLessons - currentLesson;

              return (
                <div key={group.key} className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden">
                  {/* Header (tappable) */}
                  <button
                    onClick={() => setExpandedCourses(prev => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                      return next;
                    })}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 13px", border: "none", background: "none", cursor: "pointer", textAlign: "left",
                    }}
                  >
                    {/* Child avatar */}
                    <span style={{
                      width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0,
                      backgroundColor: child?.color ?? "#7a6f65",
                    }}>
                      {(child?.name ?? "?").charAt(0).toUpperCase()}
                    </span>

                    {/* Name + subject */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#2d2926", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {group.goalData?.icon_emoji ?? "📚"} {child?.name ?? "Unassigned"} · {group.curricName}
                      </p>
                      <p style={{ fontSize: 10, color: "#b5aca4", margin: "1px 0 0" }}>
                        {displaySubject} · {displayCompleted} of {displayTotal}
                      </p>
                    </div>

                    {/* Mini progress bar + percentage */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <div style={{ width: 48, height: 4, background: "#f0ede8", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: miniFillWidth, height: "100%", background: "var(--g-brand)", borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--g-brand)", minWidth: 28, textAlign: "right" }}>{pct}%</span>
                    </div>

                    {/* Chevron */}
                    <span style={{ fontSize: 14, color: "#b5aca4", flexShrink: 0, transition: "transform 0.15s" }}>
                      {isExpanded ? "⌄" : "›"}
                    </span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ borderTop: "0.5px solid #f5f0e8", padding: "10px 13px 11px" }}>
                      {/* Lesson count + percentage row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#2d2926" }}>{displayCompleted} of {displayTotal} lessons</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--g-brand)" }}>{pct}%</span>
                      </div>

                      {/* Full-width progress bar */}
                      <div style={{ width: "100%", height: 6, background: "#ece8e0", borderRadius: 3, overflow: "hidden", marginBottom: 10 }}>
                        <div style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, height: "100%", background: "var(--g-brand)", borderRadius: 3 }} />
                      </div>

                      {/* Meta row: finish status + Edit link */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        {/* Finish status */}
                        <div>
                          {(() => {
                            if (lessonsRemaining <= 0) return <span style={{ fontSize: 11, color: "var(--g-brand)" }}>✓ Complete</span>;

                            const thisYear = new Date().getFullYear();
                            const fmtDate = (d: Date) => {
                              const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
                              if (d.getFullYear() !== thisYear) opts.year = "numeric";
                              return d.toLocaleDateString("en-US", opts);
                            };

                            // Find the last scheduled incomplete lesson for this curriculum
                            const incompleteDates = allLessons
                              .filter(l => l.curriculum_goal_id === group.goalId && !l.completed && l.scheduled_date)
                              .map(l => l.scheduled_date!)
                              .sort();
                            const lastScheduled = incompleteDates.length > 0 ? new Date(incompleteDates[incompleteDates.length - 1] + "T00:00:00") : null;
                            const targetDate = goal?.target_date ? new Date(goal.target_date + "T00:00:00") : null;

                            const parts: React.ReactNode[] = [];

                            if (targetDate) {
                              parts.push(<span key="goal" style={{ fontSize: 11, color: "#9a8f85" }}>Goal: {fmtDate(targetDate)}</span>);
                            }

                            if (lastScheduled) {
                              if (targetDate && lastScheduled > targetDate) {
                                parts.push(<span key="proj" style={{ fontSize: 11, color: "#8a6d00" }}> · Behind — finishes {fmtDate(lastScheduled)}</span>);
                              } else {
                                parts.push(<span key="proj" style={{ fontSize: 11, color: "var(--g-brand)" }}> · On track to finish {fmtDate(lastScheduled)}</span>);
                              }
                            }

                            if (parts.length === 0) return <span style={{ fontSize: 11, color: "#aaa" }}>Set a target date to track pace</span>;
                            return <span>{parts}</span>;
                          })()}
                        </div>

                        {/* Edit link */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditWizardData({
                              goalId: group.goalId ?? undefined,
                              childId: group.childId ?? "",
                              curricName: group.curricName,
                              subjectLabel: group.goalData?.subject_label ?? group.subjectName ?? null,
                              totalLessons: group.goalData?.total_lessons ?? group.totalCount,
                              currentLesson: group.goalData?.current_lesson ?? completedFromRows,
                              targetDate: group.goalData?.target_date ?? "",
                              schoolDays: group.goalData?.school_days ?? [],
                              lessonStartTime: group.goalData?.scheduled_start_time ?? null,
                            });
                          }}
                          style={{ fontSize: 11, color: "var(--g-brand)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                        >
                          Edit →
                        </button>
                      </div>

                      {/* Backfilled lessons (editable) */}
                      {group.goalId && (() => {
                        const goalId = group.goalId!;
                        const bfCount = allLessons.filter(l => l.curriculum_goal_id === goalId && (l as unknown as { is_backfill?: boolean }).is_backfill).length;
                        if (bfCount === 0) return null;
                        const isOpen = expandedBackfill === goalId;
                        const bfLessons = backfillLessons[goalId] ?? [];

                        return (
                          <div style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              onClick={() => {
                                if (isOpen) {
                                  setExpandedBackfill(null);
                                } else {
                                  setExpandedBackfill(goalId);
                                  if (!backfillLessons[goalId]) loadBackfillLessons(goalId);
                                }
                              }}
                              style={{ fontSize: 11, color: "#8B7E74", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4 }}
                            >
                              <span style={{ fontSize: 10 }}>{isOpen ? "▾" : "▸"}</span>
                              Backfilled lessons ({bfCount})
                            </button>
                            {isOpen && bfLessons.length > 0 && (
                              <div style={{ marginTop: 6, maxHeight: 200, overflowY: "auto" }}>
                                {bfLessons.map((bl) => {
                                  const editKey = bl.id;
                                  const currentMin = backfillEdits[editKey] ?? bl.minutes_spent ?? 30;
                                  const displayDate = new Date(bl.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                                  return (
                                    <div key={bl.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "3px 0", fontSize: 11 }}>
                                      <span style={{ color: "#9a8f85", minWidth: 52 }}>{displayDate}</span>
                                      <span style={{ color: "#2d2926", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        Lesson {bl.lesson_number}
                                      </span>
                                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                                        <input
                                          type="number"
                                          min="1"
                                          max="480"
                                          value={currentMin}
                                          onChange={(e) => {
                                            const val = parseInt(e.target.value) || 0;
                                            setBackfillEdits(prev => ({ ...prev, [editKey]: val }));
                                          }}
                                          onBlur={() => {
                                            if (currentMin !== (bl.minutes_spent ?? 30)) {
                                              saveBackfillHours(bl.id, currentMin);
                                              setBackfillLessons(prev => ({
                                                ...prev,
                                                [goalId]: (prev[goalId] ?? []).map(l => l.id === bl.id ? { ...l, minutes_spent: currentMin } : l),
                                              }));
                                            }
                                          }}
                                          style={{
                                            width: 44, padding: "2px 4px", borderRadius: 6,
                                            border: "1px solid #e8e5e0", fontSize: 11, textAlign: "center",
                                            color: "#2d2926", background: "white",
                                          }}
                                        />
                                        <span style={{ color: "#9a8f85", fontSize: 10 }}>min</span>
                                        {savingBackfillId === bl.id && <span style={{ color: "#5c7f63", fontSize: 10 }}>...</span>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {isOpen && bfLessons.length === 0 && (
                              <p style={{ fontSize: 10, color: "#b5aca4", marginTop: 4 }}>Loading...</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* + Add curriculum / + Add activity */}
          <div className="flex gap-3 mt-3">
            <button
              onClick={() => setShowCreateWizard(true)}
              className="flex-1 border-2 border-dashed border-[#e0ddd8] rounded-2xl p-4 text-center text-[#5c7f63] font-medium text-sm cursor-pointer hover:bg-[#faf9f7] transition-colors"
            >
              + Add curriculum
            </button>
            <button
              onClick={() => setShowActivityModal(true)}
              className="flex-1 border-2 border-dashed border-[#e0ddd8] rounded-2xl p-4 text-center text-[#5c7f63] font-medium text-sm cursor-pointer hover:bg-[#faf9f7] transition-colors"
            >
              {"\u{1F4CB}"} Add activity
            </button>
          </div>

          {/* Prompt cards */}
          {!allLessons.some(l => (l as unknown as { is_backfill?: boolean }).is_backfill) && (
            <button
              onClick={() => setShowCreateWizard(true)}
              className="w-full bg-[#F8F7F4] border border-[#e8e5e0] rounded-xl p-4 flex items-start gap-3 text-left hover:bg-[#f0ede8] transition-colors mt-3"
            >
              <span className="text-xl shrink-0">📚</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[#5C5346]">Log your pre-Rooted lessons</p>
                <p className="text-[11px] text-[#7a6f65] mt-0.5">Need to log the lessons and activities you completed before Rooted? We got you.</p>
              </div>
              <ChevronRight size={16} className="text-[#b5aca4] shrink-0 mt-0.5" />
            </button>
          )}
          {activities.length === 0 && (
            <button
              onClick={() => setShowActivityModal(true)}
              className="w-full bg-[#F8F7F4] border border-[#e8e5e0] rounded-xl p-4 flex items-start gap-3 text-left hover:bg-[#f0ede8] transition-colors mt-2"
            >
              <span className="text-xl shrink-0">🎨</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[#5C5346]">Track activities too?</p>
                <p className="text-[11px] text-[#7a6f65] mt-0.5">Art, music, PE, co-ops — add activities that count toward your hours →</p>
              </div>
              <ChevronRight size={16} className="text-[#b5aca4] shrink-0 mt-0.5" />
            </button>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          SECTION — ACTIVITIES
      ══════════════════════════════════════════════════ */}
      {!isPartner && !loading && yearScopedActivities.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2 pl-1">
            {"\u{1F4CB}"} Activities
          </p>
          <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
            {activities.map((act) => {
              const dayNames = act.days.map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).filter(Boolean);
              const freqLabel = act.frequency === "weekly" ? "Every" : act.frequency === "biweekly" ? "Every other" : "Monthly";
              const durLabel = act.duration_minutes >= 60
                ? `${Math.floor(act.duration_minutes / 60)} hr${Math.floor(act.duration_minutes / 60) > 1 ? "s" : ""}${act.duration_minutes % 60 > 0 ? ` ${act.duration_minutes % 60}m` : ""}`
                : `${act.duration_minutes} min`;
              const timeLabel = act.scheduled_start_time
                ? (() => { const [h, m] = act.scheduled_start_time.split(":").map(Number); const ampm = h >= 12 ? "PM" : "AM"; return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`; })()
                : null;
              const schedule = `${freqLabel} ${dayNames.join(", ")} \u00b7 ${durLabel}${timeLabel ? ` \u00b7 ${timeLabel}` : ""}`;

              return (
                <div key={act.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-lg">{act.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#2d2926] truncate">{act.name}</p>
                      <p className="text-[11px] text-[#9a8e84] truncate mt-0.5">{schedule}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center shrink-0">
                    <button
                      onClick={() => setEditingActivity({
                        id: act.id,
                        name: act.name,
                        emoji: act.emoji,
                        frequency: act.frequency,
                        days: act.days,
                        duration_minutes: act.duration_minutes,
                        scheduled_start_time: act.scheduled_start_time,
                        child_ids: act.child_ids,
                        location: act.location,
                      })}
                      className="text-[11px] font-medium text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteActivity(act.id)}
                      className="text-[11px] font-medium text-[#b5aca4] hover:text-[#7a6f65] transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
            {/* + Add activity inside card */}
            <button
              onClick={() => setShowActivityModal(true)}
              className="w-full px-5 py-3 text-sm font-medium text-[#5c7f63] text-center hover:bg-[#faf9f7] transition-colors"
            >
              + Add activity
            </button>
          </div>
        </div>
      )}

      {/* ── Curriculum empty state ───────────────────────────── */}
      {!loading && !isPartner && curricGroups.length === 0 && curriculumGoals.length === 0 && subjects.length === 0 && allLessons.length === 0 && (
        <div className="bg-white border border-[#e8e5e0] rounded-2xl p-8 flex flex-col items-center text-center">
          <span className="text-4xl mb-4">🌱</span>
          <h2 className="text-xl font-semibold text-[var(--g-deep)] mb-2">Your plan is ready to grow!</h2>
          <p className="text-sm text-[#7a6f65] leading-relaxed max-w-sm mx-auto mb-6">
            Start by setting up your curriculum. Add your subjects, lessons, and schedule — it only takes a few minutes and sets the foundation for everything in Rooted.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-5">
            <button
              onClick={() => setShowCreateWizard(true)}
              className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              Set Up Curriculum →
            </button>
            <a
              href="https://rootedhomeschoolapp.com/tour"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-white border border-[#e8e2d9] hover:border-[#5c7f63] text-[#5c7f63] text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              Watch how it works
            </a>
          </div>
          <p className="text-xs text-[#b5aca4]">💡 Tip: Most families get set up in under 5 minutes</p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          BREAKS & VACATIONS
      ══════════════════════════════════════════════════ */}
      {!isPartner && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2 pl-1">
            Breaks &amp; Vacations
          </p>
          <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden">
            {vacationBlocks.length > 0 && (
              <div className="divide-y divide-[#f0ede8]">
                {vacationBlocks.map((block) => {
                  const s = new Date(block.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const e = new Date(block.end_date   + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  return (
                    <div key={block.id} className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm">🌴</span>
                        <span className="text-sm font-medium text-[#2d2926]">{block.name}</span>
                        <span className="text-xs text-[#9a8e84]">{s} – {e}</span>
                      </div>
                      <button
                        onClick={() => deleteVacationBlock(block.id)}
                        className="text-[11px] font-medium text-[#b5aca4] hover:text-[#7a6f65] transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {vacationBlocks.length === 0 && (
              <div className="px-5 py-4 text-center">
                <p className="text-sm text-[#b5aca4]">No breaks scheduled</p>
              </div>
            )}
            <button
              onClick={() => { setVacName(""); setVacStart(""); setVacEnd(""); setVacReschedule("shift"); setShowVacModal(true); }}
              className="w-full px-5 py-3 text-sm font-medium text-[#5c7f63] text-center hover:bg-[#faf9f7] transition-colors border-t border-[#f0ede8]"
            >
              + Add break or vacation
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          HOURS & PROGRESS REPORT (combined) — hidden in next year view
      ══════════════════════════════════════════════════ */}
      {!isPartner && !loading && yearView === "this" && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2 pl-1">
            Progress Report
          </p>
          <div className="bg-white border border-[#e8e5e0] rounded-2xl p-5">
            {/* Hours summary */}
            {allLessons.length > 0 && (() => {
              const completedLessons = allLessons.filter(l => l.completed);
              const totalMins = completedLessons.reduce((sum, l) => {
                if (l.minutes_spent != null) return sum + l.minutes_spent;
                if (l.hours != null && l.hours > 0) return sum + Math.round(l.hours * 60);
                return sum + 30;
              }, 0);
              const h = Math.floor(totalMins / 60);
              const m = totalMins % 60;
              return (
                <>
                  <div className="mb-4">
                    <p className="text-2xl font-bold text-[#2D2A26]">{h}h {m > 0 ? `${m}m` : ""}</p>
                    <p className="text-[12px] text-[#8B7E74]">logged this year</p>
                    <p className="text-[11px] text-[#8B7E74] mt-1">
                      Curriculum: {h}h {m > 0 ? `${m}m` : ""} · Auto-tracked from {completedLessons.length} lessons
                    </p>
                  </div>
                  <div className="border-t border-[#f0ede8] mb-4" />
                </>
              );
            })()}

            {/* Report section */}
            <h3 className="text-sm font-bold text-[#2d2926]">📊 Progress Report</h3>
            <p className="text-[11px] text-[#8B7E74] mt-0.5 leading-relaxed mb-3">
              Lessons, hours, books, and daily activity log — ready to download or share.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-[#7a6f65] shrink-0">For:</label>
              <select
                value={reportChildId}
                onChange={(e) => setReportChildId(e.target.value)}
                className="text-xs border border-[#e8e2d9] rounded-lg px-2.5 py-1.5 bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/30"
              >
                {children.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-1 flex-wrap">
                {(["full", "q1", "q2", "q3", "q4", "custom"] as const).map(r => (
                  <button key={r} onClick={() => setReportRange(r)}
                    className={`text-[11px] px-2 py-1 rounded-lg transition-colors ${
                      reportRange === r
                        ? "bg-[#2D5A3D] text-white font-semibold"
                        : "bg-[#f0ede8] text-[#7a6f65] hover:bg-[#e8e2d9]"
                    }`}>
                    {r === "full" ? "Full Year" : r === "custom" ? "Custom" : r.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                onClick={downloadReport}
                disabled={downloadingReport}
                className="flex items-center gap-1.5 text-xs font-semibold bg-[#2D5A3D] hover:opacity-90 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl transition-colors shrink-0 ml-auto"
              >
                {downloadingReport ? "Generating…" : "Download Report"}
              </button>
            </div>
            {reportRange === "custom" && (
              <div className="flex items-center gap-2 mt-2">
                <input type="date" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)}
                  className="text-xs border border-[#e8e2d9] rounded-lg px-2.5 py-1.5 bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63]" />
                <span className="text-[11px] text-[#b5aca4]">to</span>
                <input type="date" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)}
                  className="text-xs border border-[#e8e2d9] rounded-lg px-2.5 py-1.5 bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63]" />
              </div>
            )}
            {reportRange !== "full" && reportRange !== "custom" && (() => {
              const now3 = new Date();
              const sy = now3.getMonth() >= 7 ? now3.getFullYear() : now3.getFullYear() - 1;
              const labels: Record<string, string> = {
                q1: `Sep 1 \u2013 Nov 30, ${sy}`,
                q2: `Dec 1, ${sy} \u2013 Feb 28, ${sy + 1}`,
                q3: `Mar 1 \u2013 May 31, ${sy + 1}`,
                q4: `Jun 1 \u2013 Aug 31, ${sy + 1}`,
              };
              return <p className="text-[10px] text-[#5c7f63] mt-1">{labels[reportRange]}</p>;
            })()}
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeActivities}
                onChange={e => setIncludeActivities(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[#d4d0ca] text-[#5c7f63] focus:ring-[#5c7f63]/30"
              />
              <span className="text-[11px] text-[#7a6f65]">Include activity hours</span>
            </label>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          EDIT LESSON MODAL
      ══════════════════════════════════════════════════ */}
      {editingLesson && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#2d2926]">✏️ Edit Lesson</h2>
              <button onClick={() => setEditingLesson(null)} className="text-[#b5aca4] hover:text-[#7a6f65]"><X size={18} /></button>
            </div>
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                <select value={editChildId} onChange={(e) => setEditChildId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                  <option value="">All / unassigned</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Subject</label>
              <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)}
                list="plan-edit-subjects" placeholder="e.g. Math, Reading, Science"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              <datalist id="plan-edit-subjects">{subjects.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Lesson title *</label>
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !savingEdit && saveEdit()}
                placeholder="Lesson title" autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Estimated hours (optional)</label>
              <input value={editHours} onChange={(e) => setEditHours(e.target.value)}
                type="number" min="0" max="24" step="0.5" placeholder="e.g. 1.5"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditingLesson(null)} className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit || !editTitle.trim()} className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {savingEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          DELETE CURRICULUM CONFIRM MODAL
      ══════════════════════════════════════════════════ */}
      {deleteConfirmGroup && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
              Remove &ldquo;{deleteConfirmGroup.curricName}&rdquo;?
            </h2>
            <p className="text-sm text-[#7a6f65] leading-relaxed">
              This will delete all{" "}
              <strong className="text-[#2d2926]">{deleteConfirmGroup.remainingCount} remaining lessons</strong>.
              This cannot be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteConfirmGroup(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-semibold text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteCurriculumGroup(deleteConfirmGroup)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          ADD A BREAK MODAL
      ══════════════════════════════════════════════════ */}
      {showVacModal && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
            <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold text-[#2d2926]">🌴 Add a Break</h2>
                  <p className="text-xs text-[#7a6f65] mt-0.5">Mark dates off for vacation or holidays</p>
                </div>
                <button onClick={() => setShowVacModal(false)} className="text-[#b5aca4] hover:text-[#7a6f65] mt-0.5"><X size={18} /></button>
              </div>

              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Break name</label>
                <input
                  value={vacName}
                  onChange={(e) => setVacName(e.target.value)}
                  placeholder="Spring Break, Christmas, Beach Trip..."
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Start date</label>
                  <input type="date" value={vacStart} onChange={(e) => setVacStart(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">End date</label>
                  <input type="date" value={vacEnd} onChange={(e) => setVacEnd(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
                </div>
              </div>

              {vacStart && vacEnd && (
                <div className="bg-[#fef9e8] border border-[#f0dda8] rounded-2xl px-4 py-3 text-center text-sm text-[#7a4a1a] font-medium">
                  🌴 {vacDays > 0 ? `${vacDays} ${vacDays === 1 ? "day" : "days"} off` : "Check dates"} — {vacStartLabel} to {vacEndLabel}
                </div>
              )}

              {vacStart && vacEnd && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#7a6f65]">What would you like to do with your scheduled lessons?</p>
                  <label className={`flex items-start gap-3 p-3 rounded-2xl border-2 cursor-pointer transition-all ${
                    vacReschedule === "shift" ? "border-[#5c7f63] bg-[#f2f9f3]" : "border-[#e8e2d9] bg-white hover:border-[#c8ddb8]"
                  }`}>
                    <input type="radio" name="vac-reschedule" value="shift" checked={vacReschedule === "shift"}
                      onChange={() => setVacReschedule("shift")} className="mt-0.5 accent-[#5c7f63]" />
                    <div>
                      <p className="text-sm font-semibold text-[#2d2926]">Shift everything forward <span className="text-[10px] font-medium text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full ml-1">recommended</span></p>
                      <p className="text-xs text-[#7a6f65] mt-0.5">Reschedule all upcoming lessons after your break</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 p-3 rounded-2xl border-2 cursor-pointer transition-all ${
                    vacReschedule === "leave" ? "border-[#5c7f63] bg-[#f2f9f3]" : "border-[#e8e2d9] bg-white hover:border-[#c8ddb8]"
                  }`}>
                    <input type="radio" name="vac-reschedule" value="leave" checked={vacReschedule === "leave"}
                      onChange={() => setVacReschedule("leave")} className="mt-0.5 accent-[#5c7f63]" />
                    <div>
                      <p className="text-sm font-semibold text-[#2d2926]">Leave my schedule as is</p>
                      <p className="text-xs text-[#7a6f65] mt-0.5">I&apos;ll pick up where I left off when we&apos;re back</p>
                    </div>
                  </label>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowVacModal(false)} className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
                <button onClick={saveVacationBlock} disabled={savingVac || !vacCanSave}
                  className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                  {savingVac ? "Saving…" : "Save Break 🌴"}
                </button>
              </div>
            </div>
          </div>
      )}

      {/* ══════════════════════════════════════════════════
          CURRICULUM WIZARD (create / edit)
      ══════════════════════════════════════════════════ */}
      {showCreateWizard && (
        <CurriculumWizard
          mode="create"
          schoolYearId={viewingYearId}
          onClose={() => setShowCreateWizard(false)}
          onSaved={() => { loadData(); loadAllLessons(); }}
        />
      )}
      {showCreateYear && effectiveUserId && (
        <CreateSchoolYearModal
          userId={effectiveUserId}
          activeYearName={schoolYears.active?.name}
          onClose={() => setShowCreateYear(false)}
          onCreated={() => { schoolYears.reload(); setYearView("next"); }}
        />
      )}
      {showActivityModal && (
        <ActivitySetupModal
          onClose={() => setShowActivityModal(false)}
          onSaved={() => { loadActivities(); }}
          schoolYearId={viewingYearId}
        />
      )}
      {editingActivity && (
        <ActivitySetupModal
          editingActivity={editingActivity}
          onClose={() => setEditingActivity(null)}
          onSaved={() => { setEditingActivity(null); loadActivities(); }}
          schoolYearId={viewingYearId}
        />
      )}
      {editWizardData && (
        <CurriculumWizard
          mode="edit"
          editData={editWizardData}
          schoolYearId={viewingYearId}
          onClose={() => setEditWizardData(null)}
          onSaved={() => { loadData(); loadAllLessons(); }}
          showToast={(msg) => setPlanToastMsg(msg)}
        />
      )}

      <div className="h-4" />

      {/* ── Reschedule bottom sheet (Plan page) ──────────── */}
      {planRescheduleLesson && (() => {
        const schoolDays = getSchoolDaysForLesson(planRescheduleLesson);
        const n = missedLessons.length || 1;
        const isSingle = n === 1;

        // Option 1 subtitle
        const opt1NextDay = nthSchoolDay(todayStr, schoolDays, 1);
        const opt1Label = new Date(opt1NextDay + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
        const opt1ExistingCount = allLessons.filter(l => (l.scheduled_date ?? l.date) === opt1NextDay && l.id !== planRescheduleLesson.id).length;
        let opt1Subtitle: string;
        if (isSingle) {
          opt1Subtitle = `Adds to ${opt1Label} · you'll have ${opt1ExistingCount + 1} lesson${opt1ExistingCount + 1 !== 1 ? "s" : ""}`;
        } else {
          const firstLabel = new Date(nthSchoolDay(todayStr, schoolDays, 1) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const lastLabel = new Date(nthSchoolDay(todayStr, schoolDays, n) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
          opt1Subtitle = `Adds ${n} lessons across ${firstLabel} – ${lastLabel}`;
        }

        // Option 2 subtitle
        const opt2Subtitle = isSingle
          ? "Shifts all upcoming lessons back 1 school day and fits your missed lesson in"
          : `Shifts all upcoming lessons back ${n} school days and fits your ${n} missed lessons in`;

        // Conflict confirmation state
        const confirmD = planPickerConfirmDate ? new Date(planPickerConfirmDate + "T00:00:00") : null;
        const confirmLabel = confirmD?.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) ?? "";

        return (
          <>
            <div className="fixed inset-0 bg-black/30 z-[80]" onClick={() => setPlanRescheduleLesson(null)} />
            <div className="fixed bottom-0 left-0 right-0 z-[81] bg-[#faf8f4] rounded-t-2xl shadow-xl max-w-lg mx-auto">
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-medium text-[var(--g-deep)]" style={{ fontFamily: "var(--font-display)" }}>
                    Reschedule {isSingle ? (planRescheduleLesson.title || "this lesson") : `${n} missed lessons`}
                  </h3>
                  <button onClick={() => setPlanRescheduleLesson(null)} className="text-[#b5aca4] hover:text-[#7a6f65] text-lg leading-none p-1">✕</button>
                </div>

                {/* ── Conflict confirmation (Pick a Day) ────── */}
                {planPickerConfirmDate ? (
                  <div className="space-y-3">
                    <div className="bg-[#fffbf0] border border-[#f0dda8] rounded-xl p-4">
                      <p className="text-sm font-medium text-[#7a4a1a] mb-1">
                        {confirmLabel} already has {planPickerConflictCount} lesson{planPickerConflictCount !== 1 ? "s" : ""}.
                      </p>
                      <p className="text-xs text-[#a07000]">
                        Adding this makes {planPickerConflictCount + 1} — still good?
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => planRescheduleMoveTo(planPickerConfirmDate, true)}
                        className="flex-1 py-2.5 bg-[#5c7f63] text-white text-sm font-medium rounded-xl hover:bg-[var(--g-deep)] transition-colors"
                      >
                        Yes, add it
                      </button>
                      <button
                        onClick={() => { setPlanPickerConfirmDate(null); setPlanPickerConflictCount(0); }}
                        className="flex-1 py-2.5 bg-white text-sm font-medium text-[#2d2926] rounded-xl border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors"
                      >
                        Pick a different day
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* OPTION 1 — Add to my next school day */}
                    <button
                      onClick={() => planAddToNextSchoolDays()}
                      className="w-full flex items-center gap-3 p-4 rounded-xl shadow-sm text-left transition-colors hover:bg-[#f0f7f1]"
                      style={{ background: "#f8fdf9", border: "1.5px solid #b8d89a" }}
                    >
                      <span className="text-lg shrink-0">📅</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#2d3a2e]">Add to my next school day{isSingle ? "" : "s"}</p>
                        <p className="text-xs text-[#9a8e84] mt-0.5">{opt1Subtitle}</p>
                      </div>
                      <span className="text-[#b8d89a] text-base shrink-0">›</span>
                    </button>

                    {/* OPTION 2 — Push schedule back N school days */}
                    <button
                      onClick={() => planPushBackNDays()}
                      className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left"
                    >
                      <span className="text-lg shrink-0">⏭</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#2d3a2e]">Push my schedule back {n} school day{n !== 1 ? "s" : ""}</p>
                        <p className="text-xs text-[#9a8e84] mt-0.5">{opt2Subtitle}</p>
                      </div>
                      <span className="text-[#c8bfb5] text-base shrink-0">›</span>
                    </button>

                    {/* OPTION 3 — Pick a day myself */}
                    <div>
                      <button
                        onClick={() => { setPlanReschedulePicker(v => !v); setPlanPickerConfirmDate(null); }}
                        className="w-full flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm border border-[#e8e2d9] hover:bg-[#f4faf0] transition-colors text-left"
                      >
                        <span className="text-lg shrink-0">🗓</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#2d3a2e]">Pick a day myself</p>
                          <p className="text-xs text-[#9a8e84] mt-0.5">Choose a school day from the calendar</p>
                        </div>
                        <span className="text-[#c8bfb5] text-base shrink-0">{planReschedulePicker ? "⌄" : "›"}</span>
                      </button>
                      {planReschedulePicker && (
                        <div className="flex items-center gap-2 mt-2 px-1">
                          <input
                            type="date" min={todayStr}
                            value={planReschedulePickerDate}
                            onChange={(e) => setPlanReschedulePickerDate(e.target.value)}
                            className="flex-1 text-sm border border-[#e8e2d9] rounded-xl px-3 py-2.5 text-[#2d2926] bg-white"
                          />
                          <button
                            onClick={() => {
                              if (!planReschedulePickerDate || planReschedulePickerDate < todayStr) return;
                              if (!isSchoolDayDate(planReschedulePickerDate, schoolDays)) return;
                              planRescheduleMoveTo(planReschedulePickerDate);
                            }}
                            disabled={!planReschedulePickerDate || planReschedulePickerDate < todayStr || !isSchoolDayDate(planReschedulePickerDate, schoolDays)}
                            className="px-5 py-2.5 bg-[#5c7f63] text-white text-sm font-medium rounded-xl disabled:opacity-40 hover:bg-[var(--g-deep)] transition-colors"
                          >
                            Move
                          </button>
                        </div>
                      )}
                      {planReschedulePicker && planReschedulePickerDate && !isSchoolDayDate(planReschedulePickerDate, schoolDays) && (
                        <p className="text-xs text-[#b91c1c] mt-1 px-1">That&apos;s not a school day — pick a day your family schools.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="h-6" />
            </div>
          </>
        );
      })()}

      {/* ── Delete toast ──────────────────────────────────────── */}
      {planToastMsg && (
        <Toast message={planToastMsg} onDone={() => setPlanToastMsg(null)} />
      )}

      {/* ── Reschedule undo toast (Plan page) ──────────────── */}
      {planRescheduleUndo && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[var(--g-brand)] text-white text-sm font-medium px-4 py-2.5 rounded-2xl shadow-lg flex items-center gap-3">
            <span>{planRescheduleUndo.message}</span>
            <button onClick={() => undoPlanReschedule()} className="text-white font-semibold underline text-sm">Undo</button>
          </div>
        </div>
      )}

      {/* ── Appointment action undo toast ──────────────────── */}
      {apptUndo && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70]">
          <div className="bg-[#6d28d9] text-white text-sm font-medium px-4 py-2.5 rounded-2xl shadow-lg flex items-center gap-3">
            <span>{apptUndo.message}</span>
            <button
              onClick={async () => {
                const restore = apptUndo.restore;
                if (apptUndoTimer.current) clearTimeout(apptUndoTimer.current);
                setApptUndo(null);
                await restore();
              }}
              className="text-white font-semibold underline text-sm"
            >
              Undo
            </button>
          </div>
        </div>
      )}

      {/* ── Appointment wizard (edit or create) ────────────── */}
      <AppointmentWizard
        isOpen={!!editingAppt || showApptCreate}
        onClose={() => { setEditingAppt(null); setShowApptCreate(false); }}
        onSaved={() => { setEditingAppt(null); setShowApptCreate(false); loadMonthData(); }}
        editingAppointment={editingAppt}
        initialDate={!editingAppt && showApptCreate ? selectedDay : undefined}
      />
    </div>
    </>
  );
}
