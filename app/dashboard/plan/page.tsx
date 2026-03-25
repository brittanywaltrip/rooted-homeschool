"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, X, AlertTriangle, CheckCircle2, Clock, TrendingUp, Calendar } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
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
};
type Lesson  = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string | null;
  hours: number | null;
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

const CURRICULUM_RE = /^(.+) — Lesson \d+$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function getSubjectStyle(subjectName: string | undefined): { bg: string; text: string } {
  if (!subjectName) return { bg: "#f0ede8", text: "#5c5248" };
  const n = subjectName.toLowerCase();
  if (n.includes("math") || n.includes("algebra") || n.includes("geometry") || n.includes("calculus"))
    return { bg: "#e4f0f4", text: "#1a4a5a" };
  if (n.includes("read") || n.includes("language") || n.includes("english") || n.includes("writing") || n.includes("grammar") || n.includes("lit") || n.includes("spelling") || n.includes("phonics"))
    return { bg: "#f0e8f4", text: "#4a2a5a" };
  if (n.includes("science") || n.includes("biology") || n.includes("chemistry") || n.includes("physics") || n.includes("nature"))
    return { bg: "#e8f0e9", text: "#3d5c42" };
  if (n.includes("history") || n.includes("social") || n.includes("geography") || n.includes("civics") || n.includes("government"))
    return { bg: "#fef0e4", text: "#7a4a1a" };
  if (n.includes("art") || n.includes("music") || n.includes("drama") || n.includes("theater") || n.includes("craft") || n.includes("draw"))
    return { bg: "#fce8ec", text: "#7a2a36" };
  return { bg: "#f0ede8", text: "#5c5248" };
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateLong(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Pace calculation ─────────────────────────────────────────────────────────
// Forward-looking from today. Behind/Ahead badges only shown when an explicit
// end date (target_date on the goal) is set. No badge = no deadline = no stress.

type PaceBadge = { label: string; color: string; bg: string; icon: "check" | "alert" | "clock" | "ahead" | "none" };

function calcPace(
  remainingCount: number,
  schoolDays: string[] | null,
  targetDate: string | null, // explicit end date from curriculum goal — null = no deadline
): { badge: PaceBadge | null; projectedFinish: string | null; lessonsPerWeek: number } {
  if (remainingCount === 0) {
    return {
      badge: { label: "Complete", color: "#3d5c42", bg: "#e8f0e9", icon: "check" },
      projectedFinish: null,
      lessonsPerWeek: 0,
    };
  }

  // Determine lessons per week from school days
  const daysPerWeek = (schoolDays && schoolDays.length > 0) ? schoolDays.length : 5;
  const lessonsPerWeek = daysPerWeek;

  if (lessonsPerWeek === 0) {
    return { badge: null, projectedFinish: null, lessonsPerWeek: 0 };
  }

  // Project finish date forward from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weeksNeeded = remainingCount / lessonsPerWeek;
  const daysNeeded = Math.ceil(weeksNeeded * 7);
  const projected = new Date(today);
  projected.setDate(projected.getDate() + daysNeeded);
  const projectedStr = toDateStr(projected);

  // No explicit end date → no pace badge, just show projected finish
  if (!targetDate) {
    return { badge: null, projectedFinish: projectedStr, lessonsPerWeek };
  }

  // Explicit end date set → compare
  const endDate = new Date(targetDate + "T00:00:00");
  const twoWeeksBefore = new Date(endDate);
  twoWeeksBefore.setDate(twoWeeksBefore.getDate() - 14);

  if (projected > endDate) {
    return {
      badge: { label: "Behind", color: "#b91c1c", bg: "#fef2f2", icon: "alert" },
      projectedFinish: projectedStr,
      lessonsPerWeek,
    };
  }
  if (projected < twoWeeksBefore) {
    return {
      badge: { label: "Ahead", color: "#1a5c80", bg: "#e4f2fb", icon: "ahead" },
      projectedFinish: projectedStr,
      lessonsPerWeek,
    };
  }
  return {
    badge: { label: "On track", color: "#3d5c42", bg: "#e8f0e9", icon: "check" },
    projectedFinish: projectedStr,
    lessonsPerWeek,
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const { isPartner, effectiveUserId } = usePartner();
  const router = useRouter();
  const searchParams = useSearchParams();
  const todayStr = toDateStr(new Date());

  const [children,         setChildren]         = useState<Child[]>([]);
  const [subjects,         setSubjects]         = useState<Subject[]>([]);
  const [curriculumGoals,  setCurriculumGoals]  = useState<CurriculumGoal[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [allLessons,       setAllLessons]       = useState<Lesson[]>([]);
  const [vacationBlocks,   setVacationBlocks]   = useState<VacationBlock[]>([]);
  const [profileSchoolDays, setProfileSchoolDays] = useState<string[]>([]);
  const [schoolYearStart,  setSchoolYearStart]  = useState<string | null>(null);
  const [schoolYearEnd,    setSchoolYearEnd]    = useState<string | null>(null);

  // ── Modals ──────────────────────────────────────────────────────────────────
  const [showCreateWizard,    setShowCreateWizard]    = useState(false);
  const [editWizardData,      setEditWizardData]      = useState<CurriculumWizardEditData | null>(null);
  const [deleteConfirmGroup,  setDeleteConfirmGroup]  = useState<CurriculumGroup | null>(null);
  const [showVacModal,        setShowVacModal]        = useState(false);
  const [vacName,             setVacName]             = useState("");
  const [vacStart,            setVacStart]            = useState("");
  const [vacEnd,              setVacEnd]              = useState("");
  const [vacReschedule,       setVacReschedule]       = useState<"shift" | "leave">("shift");
  const [savingVac,           setSavingVac]           = useState(false);
  const [expandedCurricMenu,  setExpandedCurricMenu]  = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("openWizard") === "true") {
      setShowCreateWizard(true);
      router.replace("/dashboard/plan");
    }
  }, [searchParams, router]);

  // ── Load data ───────────────────────────────────────────────────────────────

  const loadAllLessons = useCallback(async () => {
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from("lessons")
      .select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
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

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const [{ data: profile }, { data: kids }, { data: subs }, { data: goals }] = await Promise.all([
      supabase.from("profiles").select("school_days, school_year_start, school_year_end").eq("id", effectiveUserId).maybeSingle(),
      supabase.from("children").select("id, name, color").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase.from("subjects").select("id, name, color").eq("user_id", effectiveUserId).order("name"),
      supabase.from("curriculum_goals").select("id, curriculum_name, subject_label, child_id, total_lessons, current_lesson, target_date, school_days").eq("user_id", effectiveUserId).order("created_at"),
    ]);
    const p = profile as { school_days?: string[]; school_year_start?: string; school_year_end?: string } | null;
    setProfileSchoolDays(p?.school_days ?? []);
    setSchoolYearStart(p?.school_year_start ?? null);
    setSchoolYearEnd(p?.school_year_end ?? null);
    setChildren(kids ?? []);
    setSubjects((subs as Subject[]) ?? []);
    setCurriculumGoals((goals as unknown as CurriculumGoal[]) ?? []);
    // Also load lessons and vacations before clearing loading — prevents flash of empty state
    await Promise.all([loadAllLessons(), loadVacationBlocks()]);
    setLoading(false);
  }, [effectiveUserId, loadAllLessons, loadVacationBlocks]);

  useEffect(() => { loadData(); }, [loadData]);

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

  // School year overview — only calculated when user has explicitly set dates
  const hasSchoolYearDates = !!(schoolYearStart && schoolYearEnd);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yearStartDate = hasSchoolYearDates ? new Date(schoolYearStart + "T00:00:00") : null;
  const yearEndDate   = hasSchoolYearDates ? new Date(schoolYearEnd + "T00:00:00") : null;
  const totalYearDays = yearStartDate && yearEndDate ? Math.max(1, Math.round((yearEndDate.getTime() - yearStartDate.getTime()) / 86400000)) : 0;
  const elapsedDays   = yearStartDate ? Math.max(0, Math.min(totalYearDays, Math.round((today.getTime() - yearStartDate.getTime()) / 86400000))) : 0;
  const yearPct       = totalYearDays > 0 ? Math.round((elapsedDays / totalYearDays) * 100) : 0;
  const daysLeft      = Math.max(0, totalYearDays - elapsedDays);
  const yearLabel     = yearStartDate && yearEndDate ? `${yearStartDate.getFullYear()}–${yearEndDate.getFullYear()}` : "";

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

  // Group curricula by child
  const childCurricMap = new Map<string, CurriculumGroup[]>();
  for (const g of curricGroups) {
    const key = g.childId ?? "__unassigned__";
    if (!childCurricMap.has(key)) childCurricMap.set(key, []);
    childCurricMap.get(key)!.push(g);
  }

  // Upcoming vacations (future only)
  const upcomingVacations = vacationBlocks.filter((b) => b.end_date >= todayStr);

  // Vacation modal derived
  const vacDays = vacStart && vacEnd && vacEnd >= vacStart
    ? Math.round((new Date(vacEnd + "T00:00:00").getTime() - new Date(vacStart + "T00:00:00").getTime()) / 86400000) + 1
    : 0;
  const vacStartLabel = vacStart ? formatDate(vacStart) : "";
  const vacEndLabel   = vacEnd   ? formatDate(vacEnd)   : "";
  const vacCanSave    = !!(vacName.trim() && vacStart && vacEnd);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <div className="max-w-3xl px-4 pt-4 pb-10 space-y-6" style={{ background: "#faf9f6" }}>

      {/* ── 1. Page Header ──────────────────────────────────── */}
      <div className="pb-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890] mb-1">Your Curriculum</p>
        <h1 className="text-2xl font-bold text-[#3d5c42]">Plan</h1>
      </div>

      {/* ── 2. School Year Overview — only when dates are set ── */}
      {hasSchoolYearDates ? (
        <div className="bg-white rounded-xl border border-[#e8e2d9] p-5 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-[#2d2926]">{yearLabel}</h2>
            <span className="text-xs text-[#7a6f65]">
              {formatDate(schoolYearStart!)} – {formatDate(schoolYearEnd!)}
            </span>
          </div>

          {/* Progress bar */}
          <div>
            <div className="h-2.5 bg-[#f0ede8] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${yearPct}%`, backgroundColor: "#3d5c42" }}
              />
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center justify-between text-center">
            <div>
              <p className="text-lg font-bold text-[#2d2926]">{elapsedDays}</p>
              <p className="text-[10px] uppercase tracking-widest text-[#a09890] font-semibold">Days Done</p>
            </div>
            <div className="w-px h-8 bg-[#e8e2d9]" />
            <div>
              <p className="text-lg font-bold text-[#3d5c42]">{yearPct}%</p>
              <p className="text-[10px] uppercase tracking-widest text-[#a09890] font-semibold">Complete</p>
            </div>
            <div className="w-px h-8 bg-[#e8e2d9]" />
            <div>
              <p className="text-lg font-bold text-[#2d2926]">{daysLeft}</p>
              <p className="text-[10px] uppercase tracking-widest text-[#a09890] font-semibold">Days Left</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-dashed border-[#e8e2d9] px-5 py-4 flex items-center justify-between">
          <p className="text-sm text-[#7a6f65]">Set your school year dates in Settings to track yearly progress</p>
          <a href="/dashboard/settings" className="text-xs font-semibold text-[#5c7f63] hover:underline shrink-0">Settings →</a>
        </div>
      )}

      {/* ── 3. Per-Child Curriculum Progress ────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-3xl animate-pulse">📚</span>
        </div>
      ) : curricGroups.length === 0 ? (
        /* Empty state */
        <div className="bg-white border border-[#e8e2d9] rounded-xl p-8 flex flex-col items-center text-center">
          <span className="text-4xl mb-4">🌱</span>
          <h2 className="text-xl font-semibold text-[#3d5c42] mb-2">Your plan is ready to grow!</h2>
          <p className="text-sm text-[#7a6f65] leading-relaxed max-w-sm mx-auto mb-6">
            Start by setting up your curriculum. Add your subjects, lessons, and schedule — it only takes a few minutes.
          </p>
          {!isPartner && (
            <button
              onClick={() => setShowCreateWizard(true)}
              className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              Set Up Curriculum →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(childCurricMap.entries()).map(([childKey, groups]) => {
            const child = children.find((c) => c.id === childKey);
            const childName = child?.name ?? "Unassigned";
            const childColor = child?.color ?? "#7a6f65";

            return (
              <div key={childKey} className="space-y-3">
                {/* Child section header */}
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: childColor }}
                  >
                    {childName.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">{childName}</p>
                </div>

                {/* Curriculum cards */}
                {groups.map((group) => {
                  const completedCount = group.totalCount - group.remainingCount;
                  const pct = group.totalCount > 0 ? Math.round((completedCount / group.totalCount) * 100) : 0;
                  const subStyle = getSubjectStyle(group.subjectName ?? undefined);
                  const { badge, projectedFinish, lessonsPerWeek } = calcPace(
                    group.remainingCount,
                    group.goalData?.school_days ?? (profileSchoolDays.length > 0 ? profileSchoolDays : null),
                    group.goalData?.target_date ?? null, // only compare against explicit deadline
                  );
                  const isBehind = badge?.icon === "alert";

                  return (
                    <div key={group.key} className="bg-white border border-[#e8e2d9] rounded-xl p-4 space-y-3">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-[#2d2926] truncate">{group.curricName}</p>
                            {group.subjectName && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ backgroundColor: subStyle.bg, color: subStyle.text }}>
                                {group.subjectName}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Pace badge — only shown when a deadline is set */}
                        {badge && (
                          <span
                            className="text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap flex items-center gap-1"
                            style={{ backgroundColor: badge.bg, color: badge.color }}
                          >
                            {badge.icon === "check" && <CheckCircle2 size={10} />}
                            {badge.icon === "alert" && <AlertTriangle size={10} />}
                            {badge.icon === "ahead" && <TrendingUp size={10} />}
                            {badge.label}
                          </span>
                        )}

                        {/* Menu */}
                        {!isPartner && (
                          <div className="relative shrink-0">
                            <button
                              onClick={() => setExpandedCurricMenu(expandedCurricMenu === group.key ? null : group.key)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#b5aca4] hover:text-[#5c7f63] hover:bg-[#e8f0e9] transition-colors text-xs font-bold">
                              ···
                            </button>
                            {expandedCurricMenu === group.key && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setExpandedCurricMenu(null)} />
                                <div className="absolute right-0 top-8 bg-white border border-[#e8e2d9] rounded-xl shadow-lg z-30 overflow-hidden min-w-[120px]">
                                  <button onClick={() => {
                                    setExpandedCurricMenu(null);
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
                                    className="w-full text-left px-3 py-2.5 text-xs text-[#2d2926] hover:bg-[#f8f7f4] transition-colors">Edit</button>
                                  <button onClick={() => { setExpandedCurricMenu(null); setDeleteConfirmGroup(group); }}
                                    className="w-full text-left px-3 py-2.5 text-xs text-red-500 hover:bg-red-50 transition-colors">Remove</button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-[#7a6f65]">{completedCount} / {group.totalCount} lessons</span>
                          <span className="text-xs font-semibold text-[#2d2926]">{pct}%</span>
                        </div>
                        <div className="h-2 bg-[#f0ede8] rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: badge?.color ?? "#5c7f63" }} />
                        </div>
                      </div>

                      {/* Stats line */}
                      <div className="flex items-center gap-3 text-xs text-[#7a6f65] flex-wrap">
                        {lessonsPerWeek > 0 && (
                          <span>{lessonsPerWeek} lessons/week</span>
                        )}
                        {group.remainingCount > 0 && (
                          <span>{group.remainingCount} remaining</span>
                        )}
                        {projectedFinish && (
                          <span className={isBehind ? "text-[#b91c1c] font-semibold" : ""}>
                            {isBehind && "⚠ "}Finishes {formatDateLong(projectedFinish)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 4. Breaks & Holidays ──────────────────────────── */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">Breaks &amp; Holidays</p>

        {upcomingVacations.length > 0 ? (
          <div className="space-y-2">
            {upcomingVacations.map((block) => {
              const s = formatDate(block.start_date);
              const e = formatDate(block.end_date);
              const days = Math.round((new Date(block.end_date + "T00:00:00").getTime() - new Date(block.start_date + "T00:00:00").getTime()) / 86400000) + 1;
              return (
                <div key={block.id} className="bg-white border border-[#e8e2d9] rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-base">🌴</span>
                    <div>
                      <p className="text-sm font-semibold text-[#2d2926]">{block.name}</p>
                      <p className="text-xs text-[#7a6f65]">{s} – {e} · {days} {days === 1 ? "day" : "days"}</p>
                    </div>
                  </div>
                  {!isPartner && (
                    <button onClick={() => deleteVacationBlock(block.id)}
                      className="text-[#c8bfb5] hover:text-red-400 transition-colors" aria-label="Remove break">
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-dashed border-[#e8e2d9] rounded-xl px-4 py-6 text-center">
            <p className="text-sm text-[#b5aca4]">No breaks scheduled</p>
          </div>
        )}
      </div>

      {/* ── 5. Manage Buttons ─────────────────────────────── */}
      {!isPartner && (
        <div className="flex flex-wrap gap-2 pt-2">
          <button onClick={() => setShowCreateWizard(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#5c7f63] bg-white hover:bg-[#e8f0e9] px-4 py-2.5 rounded-xl transition-colors border border-[#e8e2d9]">
            <Plus size={13} strokeWidth={2.5} /> New Curriculum
          </button>
          <button
            onClick={() => { setVacName(""); setVacStart(""); setVacEnd(""); setVacReschedule("shift"); setShowVacModal(true); }}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#7a6f65] bg-white hover:bg-[#f0ede8] px-4 py-2.5 rounded-xl transition-colors border border-[#e8e2d9]">
            <Plus size={13} strokeWidth={2.5} /> Add Break / Vacation
          </button>
        </div>
      )}

      {/* ── 6. Calendar Link ──────────────────────────────── */}
      <Link
        href="/dashboard/plan/calendar"
        className="flex items-center justify-center gap-2 text-sm font-semibold text-[#5c7f63] bg-white hover:bg-[#e8f0e9] px-4 py-3 rounded-xl transition-colors border border-[#e8e2d9] w-full"
      >
        <Calendar size={15} /> View calendar →
      </Link>

    </div>

    {/* ══════════════════════════════════════════════════════
        DELETE CURRICULUM CONFIRM MODAL
    ══════════════════════════════════════════════════════ */}
    {deleteConfirmGroup && (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#2d2926]">
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

    {/* ══════════════════════════════════════════════════════
        ADD A BREAK MODAL
    ══════════════════════════════════════════════════════ */}
    {showVacModal && (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
        <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-bold text-[#2d2926]">Add a Break</h2>
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
              {vacDays > 0 ? `${vacDays} ${vacDays === 1 ? "day" : "days"} off` : "Check dates"} — {vacStartLabel} to {vacEndLabel}
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
              {savingVac ? "Saving..." : "Save Break"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ══════════════════════════════════════════════════════
        CURRICULUM WIZARD (create / edit)
    ══════════════════════════════════════════════════════ */}
    {showCreateWizard && (
      <CurriculumWizard
        mode="create"
        onClose={() => setShowCreateWizard(false)}
        onSaved={() => { loadData(); }}
      />
    )}
    {editWizardData && (
      <CurriculumWizard
        mode="edit"
        editData={editWizardData}
        onClose={() => setEditWizardData(null)}
        onSaved={() => { loadData(); }}
      />
    )}
    </>
  );
}
