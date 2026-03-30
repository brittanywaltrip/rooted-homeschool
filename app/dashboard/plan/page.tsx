"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, X } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import CurriculumWizard, { type CurriculumWizardEditData } from "@/app/components/CurriculumWizard";

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
  if (remainingCount === 0) return { label: "✓ Complete", color: "#3d5c42", bg: "#e8f0e9" };
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
  if (futureDays >= remainingCount) return { label: "✓ On pace", color: "#3d5c42", bg: "#e8f0e9" };
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

  useEffect(() => { document.title = "Plan · Rooted"; }, []);

  useEffect(() => {
    if (searchParams.get("openWizard") === "true") {
      setShowCreateWizard(true);
      router.replace("/dashboard/plan");
    }
  }, [searchParams, router]);
  const [editWizardData,    setEditWizardData]    = useState<CurriculumWizardEditData | null>(null);
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<CurriculumGroup | null>(null);

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
      supabase.from("profiles").select("onboarded, school_days").eq("id", effectiveUserId).maybeSingle(),
      supabase.from("children").select("id, name, color").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase.from("subjects").select("id, name, color").eq("user_id", effectiveUserId).order("name"),
      supabase.from("curriculum_goals").select("id, curriculum_name, subject_label, child_id, total_lessons, current_lesson, target_date, school_days, created_at, default_minutes").eq("user_id", effectiveUserId).order("created_at"),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId).gte("scheduled_date", s).lte("scheduled_date", e),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId).is("scheduled_date", null).gte("date", s).lte("date", e),
    ]);
    setOnboarded((profile as { onboarded?: boolean } | null)?.onboarded ?? false);
    setProfileSchoolDays((profile as { school_days?: string[] } | null)?.school_days ?? []);
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
      .select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, subjects(name, color)")
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
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId).gte("scheduled_date", s).lte("scheduled_date", e),
      supabase.from("lessons").select("id, title, completed, child_id, hours, minutes_spent, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId).is("scheduled_date", null).gte("date", s).lte("date", e),
    ]);
    setMonthLessons([...((bySched as unknown as Lesson[]) ?? []), ...((byDate as unknown as Lesson[]) ?? [])]);
  }, [monthStart, effectiveUserId]);

  useEffect(() => { loadData(); },           [loadData]);
  useEffect(() => { loadAllLessons(); },     [loadAllLessons]);
  useEffect(() => { loadVacationBlocks(); }, [loadVacationBlocks]);
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
            background: viewMode === "week" ? "#2D5a1B" : "white",
            color: viewMode === "week" ? "white" : "#7a6f65",
          }}
        >
          Week
        </button>
        <button
          onClick={() => setViewMode("month")}
          style={{
            flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
            background: viewMode === "month" ? "#2D5a1B" : "white",
            color: viewMode === "month" ? "white" : "#7a6f65",
          }}
        >
          Month
        </button>
      </div>

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
                bg = "#2D5a1B";
              } else if (isToday) {
                bg = "#2D5a1B";
              } else if (isSelected) {
                bg = "#f4faf0";
                border = "1.5px solid #2D5a1B";
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
                    bg = "#2D5a1B";
                  } else if (isSelected) {
                    bg = "#f4faf0";
                    border = "1.5px solid #2D5a1B";
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
              if (allDone) { statusText = "✓ All done"; statusColor = "#2D5a1B"; }
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
                          background: lesson.completed ? "#2D5a1B" : "transparent",
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
                        <p style={{
                          fontSize: 12, fontWeight: 500, margin: 0,
                          textDecoration: lesson.completed ? "line-through" : "none",
                          color: lesson.completed ? "#bbb" : "#2d2926",
                        }}>
                          {lesson.title}
                        </p>
                        {lesson.subjects && (
                          <p style={{ fontSize: 10, color: "#bbb", margin: "1px 0 0" }}>{lesson.subjects.name}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

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
      {!isPartner && curricGroups.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b5aca4", marginBottom: 8 }}>
            Course Progress
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {curricGroups.map((group) => {
              const completedCount = group.totalCount - group.remainingCount;
              const pct = group.totalCount > 0 ? Math.round((completedCount / group.totalCount) * 100) : 0;
              const miniFillWidth = pct > 0 ? Math.max(4, Math.round((pct / 100) * 48)) : 0;
              const child = children.find(c => c.id === group.childId);
              const isExpanded = expandedCourses.has(group.key);

              // Projected finish
              const goal = group.goalData;
              const currentLesson = goal?.current_lesson ?? completedCount;
              const totalLessons = goal?.total_lessons ?? group.totalCount;
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
                        {group.subjectName ?? "General"} · {completedCount} of {group.totalCount}
                      </p>
                    </div>

                    {/* Mini progress bar + percentage */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <div style={{ width: 48, height: 4, background: "#f0ede8", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: miniFillWidth, height: "100%", background: "#2D5a1B", borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#2D5a1B", minWidth: 28, textAlign: "right" }}>{pct}%</span>
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
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#2d2926" }}>{completedCount} of {group.totalCount} lessons</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#2D5a1B" }}>{pct}%</span>
                      </div>

                      {/* Full-width progress bar */}
                      <div style={{ width: "100%", height: 6, background: "#ece8e0", borderRadius: 3, overflow: "hidden", marginBottom: 10 }}>
                        <div style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, height: "100%", background: "#2D5a1B", borderRadius: 3 }} />
                      </div>

                      {/* Meta row: finish status + Edit link */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        {/* Finish status */}
                        <div>
                          {(() => {
                            if (lessonsRemaining <= 0) return <span style={{ fontSize: 11, color: "#2D5a1B" }}>✓ Complete</span>;
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
                              return <span style={{ fontSize: 11, color: "#2D5a1B" }}>✓ On track · finishes {projectedLabel}</span>;
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
                              currentLesson: group.goalData?.current_lesson ?? completedCount,
                              targetDate: group.goalData?.target_date ?? "",
                              schoolDays: group.goalData?.school_days ?? [],
                            });
                          }}
                          style={{ fontSize: 11, color: "#2D5a1B", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
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
              padding: "11px 13px", fontSize: 12, color: "#2D5a1B", fontWeight: 600, cursor: "pointer",
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
          <h2 className="text-xl font-semibold text-[#3d5c42] mb-2">Your plan is ready to grow!</h2>
          <p className="text-sm text-[#7a6f65] leading-relaxed max-w-sm mx-auto mb-6">
            Start by setting up your curriculum. Add your subjects, lessons, and schedule — it only takes a few minutes and sets the foundation for everything in Rooted.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-5">
            <button
              onClick={() => setShowCreateWizard(true)}
              className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
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
          SECTION 5 — BREAKS & VACATIONS
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
              padding: "11px 13px", fontSize: 12, color: "#2D5a1B", fontWeight: 600, cursor: "pointer",
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
              <button onClick={saveEdit} disabled={savingEdit || !editTitle.trim()} className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
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
                  className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-sm transition-colors">
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
        />
      )}

      <div className="h-4" />
    </div>
    </>
  );
}
