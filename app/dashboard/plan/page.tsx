"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, X, BookOpen, Trash2, CalendarDays } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import DayDetailPanel from "@/app/components/DayDetailPanel";
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

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CURRICULUM_RE = /^(.+) — Lesson \d+$/;

const SUBJECT_CHIPS = [
  { label: "Math",          bg: "#e4f0f4", text: "#1a4a5a" },
  { label: "Reading",       bg: "#f0e8f4", text: "#4a2a5a" },
  { label: "Language Arts", bg: "#ede8f4", text: "#3a2a6a" },
  { label: "Science",       bg: "#e8f0e9", text: "#3d5c42" },
  { label: "History",       bg: "#fef0e4", text: "#7a4a1a" },
  { label: "Art",           bg: "#fce8ec", text: "#7a2a36" },
  { label: "Other",         bg: "#f0ede8", text: "#5c5248" },
];

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
  const end   = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  // Count how many calendar days past target to finish remaining lessons
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

// ─── Lesson Card ──────────────────────────────────────────────────────────────

function LessonCard({
  lesson, childObj, onToggle, onEdit, onDelete, isPartner,
}: {
  lesson:    Lesson;
  childObj:  Child | undefined;
  onToggle:  (id: string, current: boolean) => void;
  onEdit:    (lesson: Lesson) => void;
  onDelete:  (id: string) => void;
  isPartner: boolean;
}) {
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isDragging,  setIsDragging]  = useState(false);
  const subStyle    = getSubjectStyle(lesson.subjects?.name);
  const borderColor = lesson.subjects?.color ?? subStyle.text;
  const canDrag     = !isPartner;

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({
          lessonId: lesson.id,
          fromDate: lesson.scheduled_date ?? lesson.date ?? "",
        }));
        e.dataTransfer.effectAllowed = "move";
        setIsDragging(true);
      }}
      onDragEnd={() => setIsDragging(false)}
      className={`group rounded-xl p-2 border-l-[3px] transition-all relative ${
        isDragging
          ? "opacity-50 shadow-none cursor-grabbing"
          : canDrag
          ? "cursor-grab"
          : "cursor-pointer"
      } ${!isDragging && lesson.completed ? "opacity-55" : ""} ${!isDragging && !lesson.completed ? "shadow-sm" : ""}`}
      style={{ borderLeftColor: borderColor, backgroundColor: lesson.completed ? "#f0f7f1" : "white" }}
      onClick={() => !isDragging && setPopoverOpen((v) => !v)}
    >
      <div className="flex items-start gap-1.5">
        {canDrag && (
          <span className="opacity-0 group-hover:opacity-100 text-[#b5aca4] text-[14px] leading-none mt-0.5 transition-opacity shrink-0 select-none cursor-grab">⠿</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(lesson.id, lesson.completed); }}
          className={`mt-0.5 w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
            lesson.completed ? "bg-[#5c7f63] border-[#5c7f63]" : "border-[#c8bfb5] hover:border-[#5c7f63]"
          }`}
          aria-label={lesson.completed ? "Mark incomplete" : "Mark complete"}
        >
          {lesson.completed && (
            <svg viewBox="0 0 8 7" className="w-2 h-1.5">
              <path d="M1 3.5l1.8 2L7 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-[11px] font-semibold leading-tight ${
            lesson.completed ? "line-through text-[#b5aca4]" : "text-[#2d2926]"
          }`}>
            {lesson.title}
          </p>
          {lesson.subjects && (
            <span className="inline-block text-[9px] mt-1 font-semibold px-1.5 py-0.5 rounded-full leading-none"
              style={{ backgroundColor: subStyle.bg, color: subStyle.text }}>
              {lesson.subjects.name}
            </span>
          )}
          <div className="flex gap-1 mt-1 flex-wrap items-center">
            {childObj && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white leading-none"
                style={{ backgroundColor: childObj.color ?? "#5c7f63" }}>
                {childObj.name.charAt(0).toUpperCase()}
              </span>
            )}
            {lesson.hours != null && lesson.hours > 0 && (
              <span className="text-[9px] text-[#b5aca4] font-medium">{lesson.hours}h</span>
            )}
          </div>
        </div>

        {!isPartner && (
          <div className="relative shrink-0">
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="w-5 h-5 rounded flex items-center justify-center text-[#c8bfb5] hover:text-[#7a6f65] hover:bg-[#f0ede8] transition-colors text-xs leading-none"
              aria-label="Lesson options">
              ···
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
                <div className="absolute right-0 top-6 bg-white border border-[#e8e2d9] rounded-xl shadow-lg z-30 overflow-hidden min-w-[100px]">
                  <button onClick={(e) => { e.stopPropagation(); onEdit(lesson); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-[#2d2926] hover:bg-[#f8f7f4] transition-colors">✏️ Edit</button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(lesson.id); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors">🗑 Delete</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Lesson detail popover */}
      {popoverOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setPopoverOpen(false); }} />
          <div
            className="fixed top-1/2 left-1/2 z-50 bg-white border border-[#e8e2d9] rounded-2xl shadow-xl p-4 w-72"
            style={{ transform: "translate(-50%, -50%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-[#2d2926] mb-2 leading-snug">{lesson.title}</p>
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {lesson.subjects && (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: (lesson.subjects.color ?? "#5c7f63") + "22",
                    color: lesson.subjects.color ?? "#5c7f63",
                  }}
                >
                  {lesson.subjects.name}
                </span>
              )}
              {childObj && (
                <span className="text-xs text-[#7a6f65]">{childObj.name}</span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle(lesson.id, lesson.completed);
                setPopoverOpen(false);
              }}
              className="w-full py-2 rounded-xl text-xs font-semibold text-white transition-colors"
              style={{ backgroundColor: lesson.completed ? "#b5aca4" : "#5c7f63" }}
            >
              {lesson.completed ? "↩ Mark Incomplete" : "✓ Mark Complete"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Day Column ───────────────────────────────────────────────────────────────

function DayColumn({
  day, lessons, children, isToday, isPast, isWeekend,
  onAdd, onToggle, onEdit, onDelete, hideAdd, isPartner, onDropLesson,
}: {
  day: Date; lessons: Lesson[]; children: Child[];
  isToday: boolean; isPast: boolean; isWeekend: boolean;
  onAdd: (day: Date) => void;
  onToggle: (id: string, current: boolean) => void;
  onEdit: (lesson: Lesson) => void;
  onDelete: (id: string) => void;
  hideAdd?: boolean; isPartner: boolean;
  onDropLesson?: (lessonId: string, fromDate: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dayName = day.toLocaleDateString("en-US", { weekday: "short" });
  const dayNum  = day.getDate();
  const done    = lessons.filter((l) => l.completed).length;
  const total   = lessons.length;
  const allDone = total > 0 && done === total;

  return (
    <div
      className={`flex flex-col rounded-2xl overflow-hidden transition-all ${
        isDragOver
          ? "border-2 border-dashed border-[#5c7f63]"
          : isToday
          ? "border-2 border-[#5c7f63] shadow-md ring-2 ring-[#5c7f63]/10"
          : isWeekend ? "border border-[#ece8e2]" : "border border-[#e8e2d9]"
      }`}
      style={{ backgroundColor: isDragOver ? "#e8f0e9" : isToday ? "#f2f9f3" : isWeekend ? "#faf9f7" : "#fefcf9" }}
      onDragOver={(e) => { e.preventDefault(); if (onDropLesson) setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        try {
          const { lessonId, fromDate } = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (lessonId && onDropLesson) onDropLesson(lessonId, fromDate);
        } catch { /* ignore malformed drops */ }
      }}
    >
      <div className={`px-2 pt-3 pb-2.5 flex flex-col items-center border-b ${
        isToday ? "border-[#b8d9bc] bg-[#d4ead6]" : "border-[#f0ede8]"
      }`}>
        <span className={`text-[10px] font-bold uppercase tracking-widest ${
          isToday ? "text-[#3d5c42]" : isPast ? "text-[#c8bfb5]" : isWeekend ? "text-[#b5aca4]" : "text-[#7a6f65]"
        }`}>{dayName}</span>
        <span className={`text-2xl font-bold leading-tight mt-0.5 ${
          isToday ? "text-[#3d5c42]" : isPast ? "text-[#c8bfb5]" : "text-[#2d2926]"
        }`}>{dayNum}</span>
        {isToday ? (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#5c7f63] text-white mt-1 uppercase tracking-wide">Today</span>
        ) : total > 0 ? (
          <span className={`text-[9px] mt-1 font-semibold ${allDone ? "text-[#5c7f63]" : "text-[#b5aca4]"}`}>
            {allDone ? "✓ done" : `${done}/${total}`}
          </span>
        ) : <span className="mt-1 h-3" />}
      </div>

      <div className="flex-1 p-1.5 space-y-1.5 min-h-[120px]">
        {lessons.map((l) => (
          <LessonCard key={l.id} lesson={l} childObj={children.find((c) => c.id === l.child_id)}
            onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} isPartner={isPartner} />
        ))}
      </div>

      {!hideAdd && (
        <div className="px-1.5 pb-2">
          <button onClick={() => onAdd(day)}
            className={`w-full flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-semibold transition-colors ${
              isToday ? "text-[#5c7f63] hover:bg-[#d4ead4]" : "text-[#c8bfb5] hover:text-[#5c7f63] hover:bg-[#f0ede8]"
            }`}>
            <Plus size={11} strokeWidth={2.5} />Add
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Wizard Progress Bar ──────────────────────────────────────────────────────

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const { isPartner, effectiveUserId } = usePartner();
  const todayMidnight = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  const todayStr = toDateStr(todayMidnight);

  const [weekStart,    setWeekStart]    = useState(() => getMondayOf(new Date()));
  const [viewMode,     setViewMode]     = useState<"week" | "month">("week");
  const [monthStart,   setMonthStart]   = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [monthLessons, setMonthLessons] = useState<Lesson[]>([]);
  const [lessons,          setLessons]          = useState<Lesson[]>([]);
  const [children,         setChildren]         = useState<Child[]>([]);
  const [subjects,         setSubjects]         = useState<Subject[]>([]);
  const [curriculumGoals,  setCurriculumGoals]  = useState<CurriculumGoal[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [allLessons,       setAllLessons]       = useState<Lesson[]>([]);
  const [mobileOffset, setMobileOffset] = useState<number>(() => {
    const dow = new Date().getDay();
    return Math.max(0, Math.min(4, (dow + 6) % 7));
  });

  // ── Day detail panel (month view) ─────────────────────────────────────────
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const [dragToast, setDragToast] = useState<string | null>(null);

  // ── Quick-add modal ───────────────────────────────────────────────────────
  const [showModal,   setShowModal]   = useState(false);
  const [modalDate,   setModalDate]   = useState(new Date());
  const [formChild,   setFormChild]   = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formTitle,   setFormTitle]   = useState("");
  const [formHours,   setFormHours]   = useState("");
  const [formGoalId,  setFormGoalId]  = useState("");
  const [saving,      setSaving]      = useState(false);

  // ── Edit modal ────────────────────────────────────────────────────────────
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [editTitle,     setEditTitle]     = useState("");
  const [editSubject,   setEditSubject]   = useState("");
  const [editHours,     setEditHours]     = useState("");
  const [editChildId,   setEditChildId]   = useState("");
  const [savingEdit,    setSavingEdit]    = useState(false);

  // ── Curriculum management ─────────────────────────────────────────────────
  const [showCreateWizard,  setShowCreateWizard]  = useState(false);
  const [editWizardData,    setEditWizardData]    = useState<CurriculumWizardEditData | null>(null);
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<CurriculumGroup | null>(null);

  // ── Vacation blocks ───────────────────────────────────────────────────────
  const [vacationBlocks,   setVacationBlocks]   = useState<VacationBlock[]>([]);
  const [showVacModal,     setShowVacModal]     = useState(false);
  const [vacName,          setVacName]          = useState("");
  const [vacStart,         setVacStart]         = useState("");
  const [vacEnd,           setVacEnd]           = useState("");
  const [vacReschedule,    setVacReschedule]    = useState<"shift" | "leave">("shift");
  const [savingVac,        setSavingVac]        = useState(false);


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
    const [{ data: kids }, { data: subs }, { data: goals }, { data: bySched }, { data: byDate }] = await Promise.all([
      supabase.from("children").select("id, name, color").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase.from("subjects").select("id, name, color").eq("user_id", effectiveUserId).order("name"),
      supabase.from("curriculum_goals").select("id, curriculum_name, subject_label, child_id, total_lessons, current_lesson, target_date, school_days").eq("user_id", effectiveUserId).order("created_at"),
      supabase.from("lessons").select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId).gte("scheduled_date", s).lte("scheduled_date", e),
      supabase.from("lessons").select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId).is("scheduled_date", null).gte("date", s).lte("date", e),
    ]);
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

  const loadMonthData = useCallback(async () => {
    if (!effectiveUserId) return;
    const ms = new Date(monthStart);
    const me = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const s = toDateStr(ms), e = toDateStr(me);
    const [{ data: bySched }, { data: byDate }] = await Promise.all([
      supabase.from("lessons").select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId).gte("scheduled_date", s).lte("scheduled_date", e),
      supabase.from("lessons").select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId).is("scheduled_date", null).gte("date", s).lte("date", e),
    ]);
    setMonthLessons([...((bySched as unknown as Lesson[]) ?? []), ...((byDate as unknown as Lesson[]) ?? [])]);
  }, [monthStart, effectiveUserId]);

  useEffect(() => { loadData(); },           [loadData]);
  useEffect(() => { loadAllLessons(); },     [loadAllLessons]);
  useEffect(() => { loadVacationBlocks(); }, [loadVacationBlocks]);
  useEffect(() => { if (viewMode === "month") loadMonthData(); }, [viewMode, loadMonthData]);

  useEffect(() => {
    if (isCurrentWeek) {
      const idx = (new Date().getDay() + 6) % 7;
      setMobileOffset(Math.max(0, Math.min(4, idx)));
    } else {
      setMobileOffset(0);
    }
  }, [weekStart, isCurrentWeek]);

  // ── Week navigation ───────────────────────────────────────────────────────

  function prevWeek() { setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; }); }
  function nextWeek() { setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; }); }
  function goToToday() { setWeekStart(getMondayOf(new Date())); }

  // ── Month navigation ──────────────────────────────────────────────────────

  function prevMonth() { setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }
  function goToCurrentMonth() { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setMonthStart(d); }

  // ── Toggle ────────────────────────────────────────────────────────────────

  async function toggleLesson(id: string, current: boolean) {
    setLessons((prev) => prev.map((l) => l.id === id ? { ...l, completed: !current } : l));
    setMonthLessons((prev) => prev.map((l) => l.id === id ? { ...l, completed: !current } : l));
    await supabase.from("lessons").update({ completed: !current }).eq("id", id);
  }

  // ── Quick-add ─────────────────────────────────────────────────────────────

  function openAddModal(day: Date, preSubject?: string) {
    setModalDate(day);
    setFormChild(children.length === 1 ? children[0].id : "");
    setFormSubject(preSubject ?? "");
    setFormTitle(""); setFormHours(""); setFormGoalId("");
    setShowModal(true);
  }

  async function saveLesson() {
    if (!formTitle.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    let subjectId: string | null = null;
    if (formSubject.trim()) {
      const existing = subjects.find((s) => s.name.toLowerCase() === formSubject.trim().toLowerCase());
      if (existing) { subjectId = existing.id; }
      else {
        const { data: ns } = await supabase.from("subjects").insert({ user_id: user.id, name: formSubject.trim() }).select("id, name, color").single();
        if (ns) { setSubjects((p) => [...p, ns as Subject]); subjectId = ns.id; }
      }
    }
    const dateStr = toDateStr(modalDate);
    const { data: nl } = await supabase.from("lessons")
      .insert({ user_id: user.id, child_id: formChild || null, subject_id: subjectId, title: formTitle.trim(), hours: formHours ? parseFloat(formHours) : null, completed: false, date: dateStr, scheduled_date: dateStr, goal_id: formGoalId || null })
      .select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)").single();
    if (nl) setLessons((p) => [...p, nl as unknown as Lesson]);
    setSaving(false); setShowModal(false);
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

  const totalWeek     = lessons.length;
  const completedWeek = lessons.filter((l) => l.completed).length;
  const progressPct   = totalWeek > 0 ? Math.round((completedWeek / totalWeek) * 100) : 0;

  const mobileDays     = weekDays.slice(mobileOffset, mobileOffset + 3);
  const canMobileLeft  = mobileOffset > 0;
  const canMobileRight = mobileOffset < 4;

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

  // Children who have lessons this week (for legend)
  const childrenWithLessons = children.filter((c) => lessons.some((l) => l.child_id === c.id));

  const modalDateLabel = modalDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Month lesson map (shared by calendar grid + DayDetailPanel)
  const monthLessonMap: Record<string, Lesson[]> = {};
  monthLessons.forEach((l) => {
    const key = l.scheduled_date ?? l.date ?? "";
    if (!monthLessonMap[key]) monthLessonMap[key] = [];
    monthLessonMap[key].push(l);
  });

  // ── Vacation modal derived ────────────────────────────────────────────────
  const vacDays = vacStart && vacEnd && vacEnd >= vacStart
    ? Math.round((new Date(vacEnd + "T00:00:00").getTime() - new Date(vacStart + "T00:00:00").getTime()) / 86400000) + 1
    : 0;
  const vacStartLabel = vacStart ? new Date(vacStart + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const vacEndLabel   = vacEnd   ? new Date(vacEnd   + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const vacCanSave    = !!(vacName.trim() && vacStart && vacEnd);

  // ── Move lesson (drag & drop) ─────────────────────────────────────────────

  async function moveLesson(lessonId: string, fromDate: string, toDate: string) {
    if (!toDate || fromDate === toDate) return;
    // Optimistic update
    setLessons((prev) => prev.map((l) => l.id === lessonId ? { ...l, scheduled_date: toDate } : l));
    setAllLessons((prev) => prev.map((l) => l.id === lessonId ? { ...l, scheduled_date: toDate } : l));
    setMonthLessons((prev) => prev.map((l) => l.id === lessonId ? { ...l, scheduled_date: toDate } : l));
    await supabase.from("lessons").update({ scheduled_date: toDate }).eq("id", lessonId);
    const toDay = new Date(toDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
    setDragToast(`📅 Moved to ${toDay}`);
    setTimeout(() => setDragToast(null), 2000);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    {/* Drag-and-drop toast */}
    {dragToast && (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-[#3d5c42] text-white text-sm font-semibold px-5 py-2.5 rounded-2xl shadow-xl pointer-events-none">
        {dragToast}
      </div>
    )}

    {/* ── Hero Header ──────────────────────────────────────── */}
    <PageHero overline="Your Curriculum" title="Plan 📋">
      {!loading && totalWeek > 0 && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mt-3" style={{ background: "rgba(255,255,255,0.10)" }}>
          <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.80)" }}>
            {totalWeek} lesson{totalWeek !== 1 ? "s" : ""} this week
            {" · "}{completedWeek} done
            {" · "}{totalWeek - completedWeek} remaining
            {completedWeek === totalWeek && totalWeek > 0 ? " 🌿" : ""}
          </span>
        </div>
      )}
    </PageHero>
    <div className="px-4 pt-5 pb-7 space-y-5 max-w-5xl">

      {/* ── Action bar ───────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {!isPartner && (
          <button onClick={() => setShowCreateWizard(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1.5 rounded-full transition-colors border border-[#c8ddb8]">
            + New Curriculum
          </button>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          {!isCurrentWeek && (
            <button onClick={goToToday}
              className="text-xs font-semibold text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1.5 rounded-full transition-colors mr-1">
              This week
            </button>
          )}
          <button onClick={prevWeek} className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-[#2d2926] whitespace-nowrap px-1">{formatWeekRange(weekStart)}</span>
          <button onClick={nextWeek} className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── Manage Curriculum ────────────────────────────────── */}
      {!isPartner && curricGroups.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">Your Curricula</p>
          {curricGroups.map((group) => {
            const child   = children.find((c) => c.id === group.childId);
            const subStyle = getSubjectStyle(group.subjectName ?? undefined);
            return (() => {
                const completedCount = group.totalCount - group.remainingCount;
                const pct = group.totalCount > 0 ? Math.round((completedCount / group.totalCount) * 100) : 0;
                const paceStatus = calcPaceStatus(group.remainingCount, group.goalData?.target_date ?? null, group.goalData?.school_days ?? null);
                const targetDateLabel = group.goalData?.target_date
                  ? new Date(group.goalData.target_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : null;
                return (
                  <div key={group.key} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-4 py-3 space-y-2">
                    <div className="flex items-center gap-3">
                      {/* Child avatar */}
                      {child ? (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold"
                          style={{ backgroundColor: child.color ?? "#5c7f63" }}>
                          {child.name.charAt(0).toUpperCase()}
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#e8e2d9] flex items-center justify-center shrink-0 text-[#7a6f65] text-xs font-bold">?</div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-[#2d2926] truncate">{group.curricName}</p>
                          {group.subjectName && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: subStyle.bg, color: subStyle.text }}>
                              {group.subjectName}
                            </span>
                          )}
                          {paceStatus && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: paceStatus.bg, color: paceStatus.color }}>
                              {paceStatus.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#7a6f65] mt-0.5">
                          {child?.name && <span className="mr-1">{child.name} ·</span>}
                          <span className="text-[#5c7f63] font-semibold">{group.remainingCount} remaining</span>
                          <span className="text-[#b5aca4]"> / {group.totalCount} total</span>
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setEditWizardData({
                            goalId: group.goalId ?? undefined,
                            childId: group.childId ?? "",
                            curricName: group.curricName,
                            subjectLabel: group.goalData?.subject_label ?? group.subjectName ?? null,
                            totalLessons: group.goalData?.total_lessons ?? group.totalCount,
                            currentLesson: group.goalData?.current_lesson ?? completedCount,
                            targetDate: group.goalData?.target_date ?? "",
                            schoolDays: group.goalData?.school_days ?? [],
                          })}
                          className="flex items-center gap-1 text-xs font-semibold text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-2.5 py-1.5 rounded-xl transition-colors">
                          ✏️ Edit
                        </button>
                        <button onClick={() => setDeleteConfirmGroup(group)}
                          className="flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-xl transition-colors">
                          🗑️ Remove
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    {group.totalCount > 0 && (
                      <div className="h-1.5 bg-[#f0ede8] rounded-full overflow-hidden">
                        <div className="h-full bg-[#5c7f63] rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}

                    {/* Finish line date or nudge */}
                    {targetDateLabel ? (
                      <p className="text-[10px] text-[#7a6f65]">
                        🎯 Finish line: <span className="font-medium">{targetDateLabel}</span>
                      </p>
                    ) : (
                      <span className="text-xs text-[#b5aca4]">No finish line set</span>
                    )}
                  </div>
                );
            })();
          })}
        </div>
      )}

      {/* ── Curriculum empty state ───────────────────────────── */}
      {!isPartner && curricGroups.length === 0 && (
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

      {/* ── Breaks & Holidays ────────────────────────────────── */}
      {!isPartner && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">Breaks &amp; Holidays</p>

          {/* Saved blocks as chips */}
          {vacationBlocks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {vacationBlocks.map((block) => {
                const s = new Date(block.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                const e = new Date(block.end_date   + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div key={block.id} className="flex items-center gap-1.5 bg-[#fef9e8] border border-[#f0dda8] rounded-full px-3 py-1.5 text-sm text-[#7a4a1a]">
                    <span>🌴 {block.name} · {s}–{e}</span>
                    <button onClick={() => deleteVacationBlock(block.id)} className="text-[#c8bfb5] hover:text-red-400 transition-colors ml-0.5" aria-label="Remove break">
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={() => { setVacName(""); setVacStart(""); setVacEnd(""); setVacReschedule("shift"); setShowVacModal(true); }}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#7a4a1a] bg-[#fef9e8] hover:bg-[#fef0d0] px-3 py-1.5 rounded-full transition-colors border border-[#f0dda8]"
          >
            <Plus size={12} strokeWidth={2.5} />Add a Break
          </button>
        </div>
      )}

      {/* ── Empty State ──────────────────────────────────────── */}
      {!loading && !isPartner && totalWeek === 0 && (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-7 text-center space-y-4">
          <div className="text-4xl">📅</div>
          <div>
            <h2 className="font-bold text-[#2d2926] text-lg mb-1" style={{ fontFamily: "Georgia, serif" }}>Plan your first week</h2>
            <p className="text-sm text-[#7a6f65] leading-relaxed max-w-xs mx-auto">
              Set up a full curriculum schedule automatically, or add lessons one at a time.
            </p>
          </div>
          <button onClick={() => setShowCreateWizard(true)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold transition-colors shadow-sm">
            <BookOpen size={15} strokeWidth={2} />Set Up Curriculum 📚
          </button>
          <p className="text-xs text-[#b5aca4]">
            or use{" "}
            <button onClick={() => openAddModal(todayMidnight)} className="underline hover:text-[#7a6f65] transition-colors">+ Add</button>
            {" "}on any day to add a single lesson
          </p>
        </div>
      )}

      {/* ── Week / Month toggle ──────────────────────────────── */}
      <div className="flex items-center gap-1 bg-[#f0ede8] rounded-full p-1 w-fit">
        <button
          onClick={() => setViewMode("week")}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            viewMode === "week" ? "bg-white text-[#2d2926] shadow-sm" : "text-[#7a6f65] hover:text-[#2d2926]"
          }`}
        >
          Week
        </button>
        <button
          onClick={() => setViewMode("month")}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            viewMode === "month" ? "bg-white text-[#2d2926] shadow-sm" : "text-[#7a6f65] hover:text-[#2d2926]"
          }`}
        >
          Month
        </button>
      </div>

      {/* ── Month View ───────────────────────────────────────── */}
      {viewMode === "month" && !loading && (
        <div>
          {/* Month nav */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {!(monthStart.getFullYear() === new Date().getFullYear() && monthStart.getMonth() === new Date().getMonth()) && (
                <button
                  onClick={goToCurrentMonth}
                  className="text-xs font-semibold text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1.5 rounded-full transition-colors mr-1"
                >
                  This month
                </button>
              )}
              <button onClick={prevMonth} className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold text-[#2d2926] px-1">
                {monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </span>
              <button onClick={nextMonth} className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
              <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-[#b5aca4] py-1">{d}</div>
            ))}
          </div>
          {/* Calendar grid */}
          {(() => {
            const year = monthStart.getFullYear();
            const month = monthStart.getMonth();
            const firstDay = new Date(year, month, 1);
            // Monday-based offset (0=Mon...6=Sun)
            const startOffset = (firstDay.getDay() + 6) % 7;
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const cells: (Date | null)[] = [
              ...Array(startOffset).fill(null),
              ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
            ];
            // Pad to complete rows
            while (cells.length % 7 !== 0) cells.push(null);
            return (
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} />;
                  const key        = toDateStr(day);
                  const isToday    = key === todayStr;
                  const isPast     = day < todayMidnight;
                  const isBreak    = isDateInBlocks(key, vacationBlocks);
                  const dayLessons = monthLessonMap[key] ?? [];
                  const done       = dayLessons.filter((l) => l.completed).length;
                  const allDone    = dayLessons.length > 0 && done === dayLessons.length;
                  const someDone   = done > 0 && !allDone;

                  if (isBreak) {
                    return (
                      <div
                        key={key}
                        className="min-h-[64px] rounded-xl p-1.5 flex flex-col border border-[#e0d9d0]"
                        style={{ backgroundColor: "#f0ede8" }}
                      >
                        <span className={`text-xs font-bold ${isPast ? "text-[#c8bfb5]" : "text-[#b5aca4]"}`}>
                          {day.getDate()}
                        </span>
                        <span className="text-base mt-1 leading-none">🌴</span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={key}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDayDetailDate(key)}
                      onKeyDown={(e) => e.key === "Enter" && setDayDetailDate(key)}
                      className={`min-h-[64px] rounded-xl p-1.5 flex flex-col border transition-all cursor-pointer hover:shadow-sm ${
                        isToday
                          ? "border-[#5c7f63] bg-[#f2f9f3] hover:bg-[#ecf7ed]"
                          : "border-[#e8e2d9] bg-[#fefcf9] hover:bg-[#faf8f4]"
                      }`}
                    >
                      {/* Date row: number + completion indicator */}
                      <div className="flex items-start justify-between mb-1">
                        <span className={`font-bold leading-none ${
                          isToday
                            ? "text-base text-[#3d5c42]"
                            : isPast
                            ? "text-xs text-[#c8bfb5]"
                            : "text-xs text-[#2d2926]"
                        }`}>
                          {day.getDate()}
                        </span>
                        {allDone && (
                          <span className="text-[10px] font-bold text-[#5c7f63] leading-none">✓</span>
                        )}
                        {someDone && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-0.5" />
                        )}
                      </div>

                      {/* Lesson pills */}
                      {dayLessons.length > 0 && (
                        <div className="space-y-0.5">
                          {dayLessons.slice(0, 3).map((l) => {
                            const subStyle  = getSubjectStyle(l.subjects?.name);
                            const subColor  = l.subjects?.color ?? subStyle.text;
                            return (
                              <div
                                key={l.id}
                                className="text-[9px] font-medium px-1 py-0.5 rounded truncate border-l-2"
                                style={{
                                  backgroundColor: subStyle.bg,
                                  color: subStyle.text,
                                  borderLeftColor: subColor,
                                  opacity: l.completed ? 0.5 : 1,
                                }}
                              >
                                {l.title}
                              </div>
                            );
                          })}
                          {dayLessons.length > 3 && (
                            <span className="text-[9px] text-[#b5aca4]">+{dayLessons.length - 3} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Calendar ─────────────────────────────────────────── */}
      {viewMode === "week" && loading ? (
        <div className="flex items-center justify-center py-24">
          <span className="text-4xl animate-pulse">🗓️</span>
        </div>
      ) : viewMode === "week" ? (
        <>
          {/* Desktop: full 7-day grid */}
          <div className="hidden lg:block overflow-x-auto -mx-4 px-4 pb-2">
            <div className="grid grid-cols-7 gap-2 min-w-[700px]">
              {weekDays.map((day) => {
                const key = toDateStr(day);
                return (
                  <DayColumn key={key} day={day} lessons={lessonsByDay[key] ?? []} children={children}
                    isToday={key === todayStr} isPast={day < todayMidnight} isWeekend={day.getDay() === 0 || day.getDay() === 6}
                    onAdd={isPartner ? () => {} : openAddModal}
                    onToggle={isPartner ? () => {} : toggleLesson}
                    onEdit={openEdit} onDelete={deleteLesson} hideAdd={isPartner} isPartner={isPartner}
                    onDropLesson={isPartner ? undefined : (lessonId, fromDate) => moveLesson(lessonId, fromDate, key)} />
                );
              })}
            </div>
          </div>

          {/* Mobile: 3-day view */}
          <div className="lg:hidden">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setMobileOffset((v) => Math.max(0, v - 1))} disabled={!canMobileLeft}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] disabled:opacity-25 transition-all">
                <ChevronLeft size={18} />
              </button>
              <span className="text-xs font-semibold text-[#7a6f65]">
                {mobileDays[0]?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {" – "}
                {mobileDays[2]?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              <button onClick={() => setMobileOffset((v) => Math.min(4, v + 1))} disabled={!canMobileRight}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] disabled:opacity-25 transition-all">
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {mobileDays.map((day) => {
                const key = toDateStr(day);
                return (
                  <DayColumn key={key} day={day} lessons={lessonsByDay[key] ?? []} children={children}
                    isToday={key === todayStr} isPast={day < todayMidnight} isWeekend={day.getDay() === 0 || day.getDay() === 6}
                    onAdd={isPartner ? () => {} : openAddModal}
                    onToggle={isPartner ? () => {} : toggleLesson}
                    onEdit={openEdit} onDelete={deleteLesson} hideAdd={isPartner} isPartner={isPartner}
                    onDropLesson={isPartner ? undefined : (lessonId, fromDate) => moveLesson(lessonId, fromDate, key)} />
                );
              })}
            </div>
          </div>

          {/* Color legend — shown when multiple children have lessons this week */}
          {childrenWithLessons.length > 1 && (
            <div className="flex items-center gap-4 flex-wrap pt-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4]">Children:</span>
              {childrenWithLessons.map((c) => (
                <div key={c.id} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color ?? "#5c7f63" }} />
                  <span className="text-xs text-[#5c5248] font-medium">{c.name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ══════════════════════════════════════════════════════
          QUICK-ADD LESSON MODAL
      ══════════════════════════════════════════════════════ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold text-[#2d2926]">📋 Add a Lesson</h2>
                <p className="text-xs text-[#7a6f65] mt-0.5">{modalDateLabel}</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-[#b5aca4] hover:text-[#7a6f65] mt-0.5"><X size={18} /></button>
            </div>
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                <select value={formChild} onChange={(e) => setFormChild(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                  <option value="">All / unassigned</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Subject</label>
              <input value={formSubject} onChange={(e) => setFormSubject(e.target.value)}
                list="plan-subjects" placeholder="e.g. Math, Reading, Science"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              <datalist id="plan-subjects">{subjects.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Lesson title *</label>
              <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !saving && saveLesson()}
                placeholder="e.g. Chapter 5 — Fractions" autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Estimated hours (optional)</label>
              <input value={formHours} onChange={(e) => setFormHours(e.target.value)}
                type="number" min="0" max="24" step="0.5" placeholder="e.g. 1.5"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            </div>
            {curriculumGoals.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Link to goal (optional)</label>
                <select value={formGoalId} onChange={(e) => setFormGoalId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
                  <option value="">None</option>
                  {curriculumGoals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.curriculum_name}{g.subject_label ? ` (${g.subject_label})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
              <button onClick={saveLesson} disabled={saving || !formTitle.trim()} className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {saving ? "Saving…" : "Add to Plan 📋"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          EDIT LESSON MODAL
      ══════════════════════════════════════════════════════ */}
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

      {/* ══════════════════════════════════════════════════════
          DELETE CURRICULUM CONFIRM MODAL
      ══════════════════════════════════════════════════════ */}
      {deleteConfirmGroup && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
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

      {/* ══════════════════════════════════════════════════════
          CURRICULUM WIZARD (create / edit)
      ══════════════════════════════════════════════════════ */}
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

    {/* ── Day Detail Panel (month view) ──────────────────── */}
    {dayDetailDate && (
      <DayDetailPanel
        date={new Date(dayDetailDate + "T00:00:00")}
        lessons={monthLessonMap[dayDetailDate] ?? []}
        children={children}
        subjects={subjects}
        onClose={() => setDayDetailDate(null)}
        onToggle={toggleLesson}
        onSaved={() => { loadMonthData(); setDayDetailDate(null); }}
        isPartner={isPartner}
      />
    )}
    </>
  );
}
