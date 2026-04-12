"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, X } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import CurriculumWizard, { type CurriculumWizardEditData } from "@/app/components/CurriculumWizard";
import Toast from "@/components/Toast";
import { posthog } from "@/lib/posthog";

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

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CURRICULUM_RE = /^(.+) — Lesson \d+$/;

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
  const [lessons,          setLessons]          = useState<Lesson[]>([]);
  const [children,         setChildren]         = useState<Child[]>([]);
  const [selectedChild,    setSelectedChild]    = useState<string | null>(null);
  const [subjects,         setSubjects]         = useState<Subject[]>([]);
  const [curriculumGoals,  setCurriculumGoals]  = useState<CurriculumGoal[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [allLessons,       setAllLessons]       = useState<Lesson[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>(todayStr);

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
  const [reportChildId, setReportChildId] = useState<string>("all");
  const [reportRange, setReportRange] = useState<string>("full");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [planType, setPlanType] = useState<string | null>(null);
  const previewFree = typeof window !== 'undefined' && window.location.search.includes('previewFree=true');
  const isFreeUser = !planType || planType === "free" || previewFree;

  useEffect(() => { document.title = "Plan · Rooted"; }, []);

  useEffect(() => {
    if (searchParams.get("openWizard") === "true") {
      setShowCreateWizard(true);
      router.replace("/dashboard/plan");
    }
  }, [searchParams, router]);
  const [editWizardData,    setEditWizardData]    = useState<CurriculumWizardEditData | null>(null);
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<CurriculumGroup | null>(null);
  const [planToastMsg, setPlanToastMsg] = useState<string | null>(null);

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

  // ── Reschedule state (Plan page) ─────────────────────────────────────────
  const [planRescheduleLesson, setPlanRescheduleLesson] = useState<Lesson | null>(null);
  const [planReschedulePicker, setPlanReschedulePicker] = useState(false);
  const [planReschedulePickerDate, setPlanReschedulePickerDate] = useState("");
  const [planRescheduleUndo, setPlanRescheduleUndo] = useState<{ message: string; undoData: { lessonId: string; date: string }[] } | null>(null);
  const planRescheduleUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [planPickerConfirmDate, setPlanPickerConfirmDate] = useState<string | null>(null);
  const [planPickerConflictCount, setPlanPickerConflictCount] = useState(0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
  });
  const isCurrentWeek = toDateStr(weekStart) === toDateStr(getMondayOf(new Date()));

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
      supabase.from("curriculum_goals").select("id, curriculum_name, subject_label, child_id, total_lessons, current_lesson, target_date, school_days, created_at, default_minutes").eq("user_id", effectiveUserId).order("created_at"),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, subjects(name, color)")
        .eq("user_id", effectiveUserId).gte("scheduled_date", s).lte("scheduled_date", e),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, subjects(name, color)")
        .eq("user_id", effectiveUserId).is("scheduled_date", null).gte("date", s).lte("date", e),
    ]);
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? false);
    setProfileSchoolDays((profile as { school_days?: string[] } | null)?.school_days ?? []);
    setPlanType((profile as { plan_type?: string } | null)?.plan_type ?? null);
    setChildren(kids ?? []);
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
      .select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, subjects(name, color)")
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

  const loadMonthData = useCallback(async () => {
    if (!effectiveUserId) return;
    const ms = new Date(monthStart);
    const me = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const s = toDateStr(ms), e = toDateStr(me);
    const [{ data: bySched }, { data: byDate }] = await Promise.all([
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, subjects(name, color)")
        .eq("user_id", effectiveUserId).gte("scheduled_date", s).lte("scheduled_date", e),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, curriculum_goal_id, subjects(name, color)")
        .eq("user_id", effectiveUserId).is("scheduled_date", null).gte("date", s).lte("date", e),
    ]);
    setMonthLessons([...((bySched as unknown as Lesson[]) ?? []), ...((byDate as unknown as Lesson[]) ?? [])]);
  }, [monthStart, effectiveUserId]);

  useEffect(() => { loadData(); },           [loadData]);
  useEffect(() => { loadAllLessons(); },     [loadAllLessons]);
  useEffect(() => { loadVacationBlocks(); }, [loadVacationBlocks]);

  // Re-fetch when children are edited in Settings
  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener("rooted:children-updated", handler);
    return () => window.removeEventListener("rooted:children-updated", handler);
  }, [loadData]);
  useEffect(() => { if (viewMode === "month") loadMonthData(); }, [viewMode, loadMonthData]);

  // ── Week navigation ───────────────────────────────────────────────────────

  function prevWeek() { setWeekStart((d) => getMondayOf(new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000))); }
  function nextWeek() { setWeekStart((d) => getMondayOf(new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000))); }

  // ── Month navigation ──────────────────────────────────────────────────────

  function prevMonth() { setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }

  // ── Toggle ────────────────────────────────────────────────────────────────

  async function toggleLesson(id: string, current: boolean) {
    setLessons((prev) => prev.map((l) => l.id === id ? { ...l, completed: !current } : l));
    setMonthLessons((prev) => prev.map((l) => l.id === id ? { ...l, completed: !current } : l));
    await supabase.from("lessons").update({ completed: !current }).eq("id", id);
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

  // Lessons for the selected day (works for both week and month views)
  const selectedDayLessons: Lesson[] = (() => {
    if (viewMode === "week") return lessonsByDay[selectedDay] ?? [];
    return monthLessonMap[selectedDay] ?? [];
  })();

  // Curriculum groups from allLessons
  const curricGroups: CurriculumGroup[] = (() => {
    const map = new Map<string, CurriculumGroup>();
    for (const l of allLessons) {
      const match = CURRICULUM_RE.exec(l.title);
      if (!match) continue;
      const cName = match[1];
      const key = `${cName}||${l.child_id ?? ""}`;
      if (!map.has(key)) {
        const goal = curriculumGoals.find((g) => g.curriculum_name === cName && g.child_id === l.child_id);
        map.set(key, { key, curricName: cName, childId: l.child_id, subjectName: l.subjects?.name ?? null, totalCount: 0, remainingCount: 0, lessonIds: [], goalId: goal?.id ?? null, goalData: goal ?? null });
      }
      const g = map.get(key)!;
      g.totalCount++;
      if (!l.completed) g.remainingCount++;
      g.lessonIds.push(l.id);
    }
    return Array.from(map.values()).sort((a, b) => a.curricName.localeCompare(b.curricName));
  })();

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

      type LR = { child_id: string; title: string; completed: boolean; minutes_spent: number | null; scheduled_date: string | null; date: string | null; curriculum_goal_id: string | null; subjects: { name: string } | null };
      type MR = { child_id: string | null; type: string; title: string | null; date: string; duration_minutes: number | null };
      type GR = { id: string; default_minutes: number };

      const [{ data: lr }, { data: mr }, { data: gr }] = await Promise.all([
        supabase.from("lessons").select("child_id, title, completed, minutes_spent, scheduled_date, date, curriculum_goal_id, subjects(name)").eq("user_id", effectiveUserId),
        supabase.from("memories").select("child_id, type, title, date, duration_minutes").eq("user_id", effectiveUserId),
        supabase.from("curriculum_goals").select("id, default_minutes").eq("user_id", effectiveUserId),
      ]);

      let allLessons = (lr || []) as unknown as LR[];
      let allMemories = (mr || []) as unknown as MR[];
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
      }

      const lessons = allLessons;
      const memories = allMemories;

      const done = lessons.filter(l => l.completed);
      const tLM = done.reduce((s, l) => s + lm(l).m, 0);
      const mM = memories.filter(m => m.duration_minutes).reduce((s, m) => s + (m.duration_minutes || 0), 0);
      const books = memories.filter(m => m.type === "book");
      const trips = memories.filter(m => ["field_trip", "project", "activity"].includes(m.type));
      const sDays = new Set(done.map(l => ld(l)).filter(Boolean)).size;

      const isPerChild = reportChildId !== "all";
      const selectedChild = isPerChild ? children.find(c => c.id === reportChildId) : null;
      const reportChildren = isPerChild && selectedChild ? [selectedChild] : children;

      // Filter lessons/memories to selected child when per-child
      const scopedDone = isPerChild ? done.filter(l => l.child_id === reportChildId) : done;
      const scopedMemories = isPerChild ? memories.filter(m => m.child_id === reportChildId) : memories;

      // Recalculate summary for scoped data
      const scopedTLM = scopedDone.reduce((s, l) => s + lm(l).m, 0);
      const scopedMM = scopedMemories.filter(m => m.duration_minutes).reduce((s, m) => s + (m.duration_minutes || 0), 0);
      const scopedBooks = scopedMemories.filter(m => m.type === "book");
      const scopedTrips = scopedMemories.filter(m => ["field_trip", "project", "activity"].includes(m.type));
      const scopedSDays = new Set(scopedDone.map(l => ld(l)).filter(Boolean)).size;

      const childReport = reportChildren.map(c => {
        const cl = done.filter(l => l.child_id === c.id);
        const cm = cl.reduce((s, l) => s + lm(l).m, 0);
        const cd = new Set(cl.map(l => ld(l)).filter(Boolean)).size;
        const sa: Record<string, { n: number; m: number; e: boolean }> = {};
        for (const l of cl) { const nm = l.subjects?.name || "General"; if (!sa[nm]) sa[nm] = { n: 0, m: 0, e: false }; sa[nm].n++; const r = lm(l); sa[nm].m += r.m; if (r.e) sa[nm].e = true; }
        return {
          name: c.name,
          totalHours: fmtMins(cm),
          totalLessons: cl.length,
          schoolDays: cd,
          subjects: Object.entries(sa).map(([n, d]) => ({ name: n, count: d.n, hours: fmtMins(d.m), estimated: d.e })).sort((a, b) => b.count - a.count),
          books: memories.filter(m => m.type === "book" && m.child_id === c.id).map(m => m.title || "Untitled"),
          fieldTrips: memories.filter(m => ["field_trip","project","activity"].includes(m.type) && m.child_id === c.id).map(m => ({ title: m.title || "Untitled", duration: m.duration_minutes })),
          wins: memories.filter(m => ["win","quote"].includes(m.type) && m.child_id === c.id).map(m => m.title || "Untitled"),
          badges: [],
        };
      });

      // Build child name lookup for daily log
      const childNameMap: Record<string, string> = {};
      for (const c of children) childNameMap[c.id] = c.name;

      // Daily log — scoped to selected child when per-child
      const logMap: Record<string, { childName: string; subject: string; description: string; minutes: number; type: string; estimated: boolean }[]> = {};
      for (const l of scopedDone) { const d = ld(l); if (!d) continue; if (!logMap[d]) logMap[d] = []; const r = lm(l); logMap[d].push({ childName: childNameMap[l.child_id] || "", subject: l.subjects?.name || "General", description: l.title || "Lesson", minutes: r.m, type: "Lesson", estimated: r.e }); }
      for (const m of scopedMemories) { if (!m.duration_minutes || !["field_trip","project","activity","win"].includes(m.type)) continue; if (!logMap[m.date]) logMap[m.date] = []; logMap[m.date].push({ childName: m.child_id ? (childNameMap[m.child_id] || "") : "", subject: m.type === "win" ? "Win" : "Field Trip", description: m.title || "Activity", minutes: m.duration_minutes, type: "Activity", estimated: false }); }
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
        summary: { totalHours: fmtMins(scopedTLM + scopedMM), schoolDays: scopedSDays, lessons: scopedDone.length, books: scopedBooks.length, trips: scopedTrips.length, memories: scopedMemories.length },
        children: childReport,
        dailyLog,
        showChildColumn: !isPerChild,
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
    <div className="px-4 pt-5 pb-7 space-y-4 max-w-5xl">

      {/* ── Total hours this year ─────────────────────────── */}
      {!loading && allLessons.length > 0 && (() => {
        const completedLessons = allLessons.filter(l => l.completed);
        const totalMins = completedLessons.reduce((sum, l) => {
          if (l.minutes_spent != null) return sum + l.minutes_spent;
          if (l.hours != null && l.hours > 0) return sum + Math.round(l.hours * 60);
          return sum + 30; // fallback default
        }, 0);
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        return (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4]">Total hours this year</p>
              <p className="text-2xl font-bold text-[#2d2926] mt-0.5">{h}h {m > 0 ? `${m}m` : ""}</p>
              <p className="text-[10px] text-[#b5aca4] mt-0.5">Auto-tracked from {completedLessons.length} lessons ✓</p>
            </div>
            <span className="text-3xl">⏱</span>
          </div>
        );
      })()}

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

      {/* ── Week / Month toggle ──────────────────────────── */}
      <div style={{ background: "white", border: "0.5px solid #e8e0d4", borderRadius: 10, overflow: "hidden", display: "flex" }}>
        <button
          onClick={() => setViewMode("week")}
          style={{
            flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
            background: viewMode === "week" ? "var(--g-brand)" : "white",
            color: viewMode === "week" ? "white" : "#7a6f65",
          }}
        >
          Week
        </button>
        <button
          onClick={() => setViewMode("month")}
          style={{
            flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
            background: viewMode === "month" ? "var(--g-brand)" : "white",
            color: viewMode === "month" ? "white" : "#7a6f65",
          }}
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
          SECTION 2A — WEEK VIEW
      ══════════════════════════════════════════════════ */}
      {viewMode === "week" && !loading && (
        <div>
          {/* Week navigation */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 10 }}>
            <button onClick={prevWeek} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#7a6f65" }}>
              <ChevronLeft size={18} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#2d2926" }}>
              {formatWeekRange(weekStart)}
            </span>
            <button onClick={nextWeek} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#7a6f65" }}>
              <ChevronRight size={18} />
            </button>
          </div>

          {/* 7-day strip */}
          <div style={{ display: "flex", gap: 5 }}>
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

              if (isVacation) {
                bg = "#fff8f0";
                border = "0.5px solid #f0c878";
              } else if (isToday && isSelected) {
                bg = "var(--g-brand)";
              } else if (isToday) {
                bg = "var(--g-brand)";
              } else if (isSelected) {
                bg = "#f4faf0";
                border = "1.5px solid var(--g-brand)";
              } else if (hasLessons) {
                bg = "white";
                border = "0.5px solid #e8e0d4";
              }
              if (isPast && hasLessons && !isSelected) opacity = 0.6;

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(key)}
                  style={{
                    flex: 1, borderRadius: 12, padding: "7px 4px", display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 3, cursor: "pointer", background: bg, border,
                    opacity, minWidth: 0,
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
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          SECTION 2B — MONTH VIEW
      ══════════════════════════════════════════════════ */}
      {viewMode === "month" && !loading && (
        <div>
          {/* Month navigation */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 10 }}>
            <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#7a6f65" }}>
              <ChevronLeft size={18} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#2d2926" }}>
              {monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
            <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#7a6f65" }}>
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 4 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 9, textTransform: "uppercase", color: "#b5aca4", fontWeight: 600 }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {(() => {
            const year = monthStart.getFullYear();
            const month = monthStart.getMonth();
            const firstDay = new Date(year, month, 1);
            // Sunday-based offset for S M T W T F S headers
            const startOffset = firstDay.getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const cells: (Date | null)[] = [
              ...Array(startOffset).fill(null),
              ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
            ];
            while (cells.length % 7 !== 0) cells.push(null);

            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                {cells.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} />;
                  const key = toDateStr(day);
                  const isToday = key === todayStr;
                  const isPast = day < todayMidnight && !isToday;
                  const isSelected = key === selectedDay;
                  const isVacation = isDateInBlocks(key, vacationBlocks);
                  const dayLessons = monthLessonMap[key] ?? [];
                  const hasLessons = dayLessons.length > 0;
                  const dayChildIds = [...new Set(dayLessons.map(l => l.child_id).filter(Boolean))];
                  const dayChildren = dayChildIds.map(id => children.find(c => c.id === id)).filter(Boolean) as Child[];

                  let bg = "transparent";
                  let border = "none";

                  if (isVacation) {
                    bg = "#fff8f0";
                    border = "0.5px solid #f0c878";
                  } else if (isToday) {
                    bg = "var(--g-brand)";
                  } else if (isSelected) {
                    bg = "#f4faf0";
                    border = "1.5px solid var(--g-brand)";
                  } else if (hasLessons) {
                    bg = "white";
                    border = "0.5px solid #e8e0d4";
                  }

                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDay(key)}
                      style={{
                        aspectRatio: "1", borderRadius: 8, display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", gap: 2, cursor: "pointer",
                        background: bg, border, opacity: isPast ? 0.55 : 1, padding: 2,
                      }}
                    >
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: isToday ? "white" : "#2d2926",
                      }}>
                        {day.getDate()}
                      </span>
                      <div style={{ display: "flex", gap: 2, minHeight: 4 }}>
                        {isVacation ? (
                          <span style={{ fontSize: 8 }}>🌴</span>
                        ) : dayChildren.length > 0 ? (
                          dayChildren.map(c => (
                            <span key={c.id} style={{
                              width: 4, height: 4, borderRadius: "50%", display: "inline-block",
                              backgroundColor: isToday ? "rgba(255,255,255,0.5)" : (c.color ?? "#5c7f63"),
                            }} />
                          ))
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          SECTION 3 — DAY PANEL
      ══════════════════════════════════════════════════ */}
      {!loading && (
        <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b5aca4", marginBottom: 8 }}>
          {selectedDay === todayStr
            ? "Today\u2019s Lessons"
            : `Lessons — ${selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`}
        </p>
      )}
      {!loading && (() => {
        // Vacation day
        if (isSelectedVacation) {
          return (
            <div style={{ background: "white", borderRadius: 14, border: "0.5px solid #e8e0d4", padding: "24px 16px", textAlign: "center" }}>
              <span style={{ fontSize: 22, opacity: 0.35 }}>🌴</span>
              <p style={{ fontSize: 12, color: "#b5aca4", marginTop: 6 }}>{selectedVacName}</p>
            </div>
          );
        }

        // No lessons day
        if (selectedDayTotal === 0) {
          return (
            <div style={{ background: "white", borderRadius: 14, border: "0.5px solid #e8e0d4", padding: "24px 16px", textAlign: "center" }}>
              <span style={{ fontSize: 22, opacity: 0.35 }}>🌿</span>
              <p style={{ fontSize: 12, color: "#b5aca4", marginTop: 6 }}>
                {isSelectedWeekend ? "Enjoy your day off!" : "No lessons scheduled"}
              </p>
            </div>
          );
        }

        // Day with lessons
        return (
          <div style={{ background: "white", borderRadius: 14, border: "0.5px solid #e8e0d4", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "10px 13px 8px", borderBottom: "0.5px solid #f0ece4" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#2d2926" }}>{selectedDateLabel}</span>
            </div>

            {/* Children groups */}
            {lessonsByChild.map(({ child, lessons: childLessons }, groupIdx) => {
              const childDone = childLessons.filter(l => l.completed).length;
              const childTotal = childLessons.length;
              const allDone = childDone === childTotal;
              let statusText: string;
              let statusColor: string;
              if (allDone) { statusText = "✓ All done"; statusColor = "var(--g-brand)"; }
              else if (childDone === 0) { statusText = `0 of ${childTotal}`; statusColor = "#8a6d00"; }
              else { statusText = `${childDone} of ${childTotal} done`; statusColor = "#b5aca4"; }

              return (
                <div key={child?.id ?? "__none__"}>
                  {/* Child header */}
                  {child && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 13px 5px" }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 700, color: "white", flexShrink: 0,
                        backgroundColor: child.color ?? "#5c7f63",
                      }}>
                        {child.name.charAt(0).toUpperCase()}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#2d2926", flex: 1 }}>{child.name}</span>
                      <span style={{ fontSize: 11, color: statusColor, fontWeight: 500 }}>{statusText}</span>
                    </div>
                  )}

                  {/* Lesson rows */}
                  {childLessons.map((lesson, lessonIdx) => (
                    <div
                      key={lesson.id}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        paddingLeft: 43, paddingRight: 13, paddingTop: 7, paddingBottom: 7,
                        borderTop: lessonIdx > 0 ? "0.5px solid #faf7f3" : undefined,
                      }}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => !isPartner && toggleLesson(lesson.id, lesson.completed)}
                        style={{
                          width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          border: lesson.completed ? "none" : "1.5px solid #ccc",
                          background: lesson.completed ? "var(--g-brand)" : "transparent",
                          cursor: isPartner ? "default" : "pointer",
                        }}
                      >
                        {lesson.completed && (
                          <svg viewBox="0 0 8 7" style={{ width: 9, height: 7 }}>
                            <path d="M1 3.5l1.8 2L7 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>

                      {/* Lesson text */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                          <p style={{
                            fontSize: 12, fontWeight: 500, margin: 0,
                            textDecoration: lesson.completed ? "line-through" : "none",
                            color: lesson.completed ? "#bbb" : "#2d2926",
                          }}>
                            {lesson.title}
                          </p>
                          {lesson.completed && lesson.minutes_spent != null && (
                            <span style={{ fontSize: 10, color: "#b5aca4" }}>· {lesson.minutes_spent} min</span>
                          )}
                        </div>
                        {lesson.subjects && (
                          <p style={{ fontSize: 10, color: "#bbb", margin: "1px 0 0" }}>{lesson.subjects.name}</p>
                        )}
                      </div>
                      {/* Reschedule link for past uncompleted lessons */}
                      {isSelectedPast && !lesson.completed && !isPartner && (
                        <button
                          onClick={() => openPlanReschedule(lesson)}
                          style={{ fontSize: 10, fontWeight: 600, color: "#7a4a1a", background: "none", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap", flexShrink: 0 }}
                        >
                          Reschedule
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Day time total */}
            {(() => {
              const allDayLessons = lessonsByChild.flatMap(g => g.lessons);
              const completed = allDayLessons.filter(l => l.completed);
              if (completed.length === 0) return null;
              const totalMins = completed.reduce((sum, l) => {
                if (l.minutes_spent != null) return sum + l.minutes_spent;
                if (l.hours != null && l.hours > 0) return sum + Math.round(l.hours * 60);
                return sum + 30;
              }, 0);
              const display = totalMins >= 60 ? `${Math.floor(totalMins / 60)}h ${totalMins % 60 > 0 ? `${totalMins % 60}m` : ""}` : `${totalMins} min`;
              return (
                <div style={{ borderTop: "0.5px solid #f5f0e8", padding: "8px 13px" }}>
                  <p style={{ fontSize: 11, color: "#b5aca4", margin: 0 }}>Total: {display}</p>
                </div>
              );
            })()}

            {/* Past-day note */}
            {isSelectedPast && (
              <div style={{ borderTop: "0.5px solid #f5f0e8", padding: "8px 13px" }}>
                <p style={{ fontSize: 11, color: "#b5aca4", fontStyle: "italic", margin: 0 }}>
                  Past lessons never expire — check off what you covered.
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════
          SECTION 4 — YOUR COURSES
      ══════════════════════════════════════════════════ */}
      {!isPartner && !loading && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b5aca4", marginBottom: 8 }}>
            Course Progress
          </p>
          {curricGroups.length === 0 && (
            <div style={{ background: "white", borderRadius: 14, border: "0.5px solid #e8e0d4", padding: "24px 16px", textAlign: "center", marginBottom: 8 }}>
              <p style={{ fontSize: 13, color: "#b5aca4", margin: 0 }}>No curriculum added yet</p>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                <div key={group.key} style={{ background: "white", borderRadius: 14, border: isExpanded ? "0.5px solid #b8d89a" : "0.5px solid #e8e0d4", overflow: "hidden" }}>
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
                        {child?.name ?? "Unassigned"} · {group.curricName}
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
                            const startDate = goal?.created_at ? new Date(goal.created_at) : null;
                            if (!startDate) return <span style={{ fontSize: 11, color: "#aaa" }}>Log more to see pace</span>;
                            const daysSinceCreated = Math.max(1, (Date.now() - startDate.getTime()) / 86400000);
                            const weeksActive = Math.max(1, daysSinceCreated / 7);
                            const weeklyPace = currentLesson / weeksActive;
                            if (weeklyPace < 0.5) return <span style={{ fontSize: 11, color: "#aaa" }}>Log more to see pace</span>;
                            const daysToFinish = (lessonsRemaining / weeklyPace) * 7;
                            const projectedFinish = new Date(Date.now() + daysToFinish * 86400000);
                            const thisYear = new Date().getFullYear();
                            const fmtDate = (d: Date) => {
                              const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
                              if (d.getFullYear() !== thisYear) opts.year = "numeric";
                              return d.toLocaleDateString("en-US", opts);
                            };
                            const projectedLabel = fmtDate(projectedFinish);
                            const targetDate = goal?.target_date ? new Date(goal.target_date + "T00:00:00") : null;

                            if (targetDate) {
                              const diffDays = Math.round((projectedFinish.getTime() - targetDate.getTime()) / 86400000);
                              if (diffDays > 14) {
                                return <span style={{ fontSize: 11, color: "#8a6d00" }}>Behind pace · projected {projectedLabel}</span>;
                              }
                              return <span style={{ fontSize: 11, color: "var(--g-brand)" }}>✓ On track · finishes {projectedLabel}</span>;
                            }

                            return <span style={{ fontSize: 11, color: "#aaa" }}>Projected finish: {projectedLabel}</span>;
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
                            });
                          }}
                          style={{ fontSize: 11, color: "var(--g-brand)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                        >
                          Edit →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* + Add curriculum */}
          <button
            onClick={() => setShowCreateWizard(true)}
            style={{
              width: "100%", background: "white", border: "0.5px solid #e8e0d4", borderRadius: 12,
              padding: "11px 13px", fontSize: 12, color: "var(--g-brand)", fontWeight: 600, cursor: "pointer",
              marginTop: 8, textAlign: "center",
            }}
          >
            + Add curriculum
          </button>
        </div>
      )}

      {/* ── Curriculum empty state ───────────────────────────── */}
      {!loading && !isPartner && curricGroups.length === 0 && curriculumGoals.length === 0 && subjects.length === 0 && allLessons.length === 0 && (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-8 flex flex-col items-center text-center">
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
          SECTION 5 — PROGRESS REPORT
      ══════════════════════════════════════════════════ */}
      {!isPartner && !loading && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b5aca4", marginBottom: 8 }}>
            Progress Report
          </p>
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#2d2926]">📊 Progress Report</h3>
                <p className="text-[11px] text-[#b5aca4] mt-0.5 leading-relaxed max-w-xs">
                  A full record of your homeschool year — lessons, hours, books, and daily activity log — ready to download or share.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <label className="text-[11px] text-[#7a6f65] shrink-0">For:</label>
              <select
                value={reportChildId}
                onChange={(e) => setReportChildId(e.target.value)}
                className="text-xs border border-[#e8e2d9] rounded-lg px-2.5 py-1.5 bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/30"
              >
                <option value="all">All Children</option>
                {children.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-1 flex-wrap">
                {(["full", "q1", "q2", "q3", "q4", "custom"] as const).map(r => (
                  <button key={r} onClick={() => setReportRange(r)}
                    className={`text-[11px] px-2 py-1 rounded-lg transition-colors ${
                      reportRange === r
                        ? "bg-[#5c7f63] text-white font-semibold"
                        : "bg-[#f0ede8] text-[#7a6f65] hover:bg-[#e8e2d9]"
                    }`}>
                    {r === "full" ? "Full Year" : r === "custom" ? "Custom" : r.toUpperCase()}
                  </button>
                ))}
              </div>
              {isFreeUser ? (
                <div className="ml-auto text-right">
                  <button
                    disabled
                    className="flex items-center gap-1.5 text-xs font-semibold bg-[#b5aca4] text-white px-4 py-2 rounded-lg cursor-not-allowed opacity-60"
                  >
                    Download Report
                  </button>
                  <Link
                    href="/upgrade"
                    onClick={() => posthog.capture('upgrade_clicked', { source: 'progress_report' })}
                    className="text-[10px] text-[#5c7f63] hover:underline mt-1 inline-block"
                  >
                    Upgrade to Founding Family to download →
                  </Link>
                </div>
              ) : (
                <button
                  onClick={downloadReport}
                  disabled={downloadingReport}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors shrink-0 ml-auto"
                >
                  {downloadingReport ? "Generating…" : "Download Report"}
                </button>
              )}
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
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          SECTION 6 — BREAKS & VACATIONS
      ══════════════════════════════════════════════════ */}
      {!isPartner && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b5aca4", marginBottom: 8 }}>
            Breaks &amp; Vacations
          </p>

          {/* Vacation pills */}
          {vacationBlocks.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {vacationBlocks.map((block) => {
                const s = new Date(block.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                const e = new Date(block.end_date   + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div key={block.id} style={{
                    background: "#fff8f0", border: "0.5px solid #f0c878", borderRadius: 20,
                    padding: "5px 10px 5px 8px", display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{ fontSize: 12 }}>🌴</span>
                    <span style={{ fontSize: 11, color: "#7a5000", fontWeight: 700 }}>{block.name} · {s}–{e}</span>
                    <button
                      onClick={() => deleteVacationBlock(block.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#c8bfb5", padding: 0, display: "flex" }}
                      aria-label="Remove break"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* + Add break */}
          <button
            onClick={() => { setVacName(""); setVacStart(""); setVacEnd(""); setVacReschedule("shift"); setShowVacModal(true); }}
            style={{
              width: "100%", background: "white", border: "0.5px solid #e8e0d4", borderRadius: 12,
              padding: "11px 13px", fontSize: 12, color: "var(--g-brand)", fontWeight: 600, cursor: "pointer",
              textAlign: "center",
            }}
          >
            + Add break or vacation
          </button>
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
          onClose={() => setShowCreateWizard(false)}
          onSaved={() => { loadData(); loadAllLessons(); }}
        />
      )}
      {editWizardData && (
        <CurriculumWizard
          mode="edit"
          editData={editWizardData}
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
    </div>
    </>
  );
}
