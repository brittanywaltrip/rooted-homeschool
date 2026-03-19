"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, X, BookOpen } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child   = { id: string; name: string; color: string | null };
type Subject = { id: string; name: string; color: string | null };
type Lesson  = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string | null;
  hours: number | null;
  date: string | null;
  scheduled_date: string | null;
  subjects: { name: string; color: string | null } | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SUBJECT_CHIPS = [
  { label: "Math",     bg: "#e4f0f4", text: "#1a4a5a" },
  { label: "Reading",  bg: "#f0e8f4", text: "#4a2a5a" },
  { label: "Science",  bg: "#e8f0e9", text: "#3d5c42" },
  { label: "History",  bg: "#fef0e4", text: "#7a4a1a" },
  { label: "Art",      bg: "#fce8ec", text: "#7a2a36" },
  { label: "Other",    bg: "#f0ede8", text: "#5c5248" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
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
  const [menuOpen, setMenuOpen] = useState(false);
  const subStyle = getSubjectStyle(lesson.subjects?.name);

  return (
    <div
      className={`rounded-xl p-2 border-l-[3px] transition-all relative ${
        lesson.completed ? "opacity-55" : "shadow-sm"
      }`}
      style={{
        borderLeftColor: lesson.subjects?.color ?? subStyle.text,
        backgroundColor: lesson.completed ? "#f0f7f1" : "white",
      }}
    >
      <div className="flex items-start gap-1.5">
        <button
          onClick={() => onToggle(lesson.id, lesson.completed)}
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
            <span
              className="inline-block text-[9px] mt-1 font-semibold px-1.5 py-0.5 rounded-full leading-none"
              style={{ backgroundColor: subStyle.bg, color: subStyle.text }}
            >
              {lesson.subjects.name}
            </span>
          )}
          <div className="flex gap-1 mt-1 flex-wrap items-center">
            {childObj && (
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white leading-none"
                style={{ backgroundColor: childObj.color ?? "#5c7f63" }}
              >
                {childObj.name}
              </span>
            )}
            {lesson.hours != null && lesson.hours > 0 && (
              <span className="text-[9px] text-[#b5aca4] font-medium">{lesson.hours}h</span>
            )}
          </div>
        </div>

        {!isPartner && (
          <div className="relative shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="w-5 h-5 rounded flex items-center justify-center text-[#c8bfb5] hover:text-[#7a6f65] hover:bg-[#f0ede8] transition-colors text-xs leading-none"
              aria-label="Lesson options"
            >
              ···
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-6 bg-white border border-[#e8e2d9] rounded-xl shadow-lg z-30 overflow-hidden min-w-[100px]">
                  <button onClick={() => { onEdit(lesson); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-[#2d2926] hover:bg-[#f8f7f4] transition-colors">
                    ✏️ Edit
                  </button>
                  <button onClick={() => { onDelete(lesson.id); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors">
                    🗑 Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Day Column ───────────────────────────────────────────────────────────────

function DayColumn({
  day, lessons, children, isToday, isPast, isWeekend,
  onAdd, onToggle, onEdit, onDelete, hideAdd, isPartner,
}: {
  day:       Date;
  lessons:   Lesson[];
  children:  Child[];
  isToday:   boolean;
  isPast:    boolean;
  isWeekend: boolean;
  onAdd:     (day: Date) => void;
  onToggle:  (id: string, current: boolean) => void;
  onEdit:    (lesson: Lesson) => void;
  onDelete:  (id: string) => void;
  hideAdd?:  boolean;
  isPartner: boolean;
}) {
  const dayName = day.toLocaleDateString("en-US", { weekday: "short" });
  const dayNum  = day.getDate();
  const done    = lessons.filter((l) => l.completed).length;
  const total   = lessons.length;
  const allDone = total > 0 && done === total;

  return (
    <div
      className={`flex flex-col rounded-2xl overflow-hidden transition-all ${
        isToday
          ? "border-2 border-[#5c7f63] shadow-md ring-2 ring-[#5c7f63]/10"
          : isWeekend ? "border border-[#ece8e2]"
          : "border border-[#e8e2d9]"
      }`}
      style={{ backgroundColor: isToday ? "#f2f9f3" : isWeekend ? "#faf9f7" : "#fefcf9" }}
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
        ) : (
          <span className="mt-1 h-3" />
        )}
      </div>

      <div className="flex-1 p-1.5 space-y-1.5 min-h-[120px]">
        {lessons.map((l) => (
          <LessonCard
            key={l.id}
            lesson={l}
            childObj={children.find((c) => c.id === l.child_id)}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            isPartner={isPartner}
          />
        ))}
      </div>

      {!hideAdd && (
        <div className="px-1.5 pb-2">
          <button
            onClick={() => onAdd(day)}
            className={`w-full flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-semibold transition-colors ${
              isToday ? "text-[#5c7f63] hover:bg-[#d4ead4]" : "text-[#c8bfb5] hover:text-[#5c7f63] hover:bg-[#f0ede8]"
            }`}
          >
            <Plus size={11} strokeWidth={2.5} />
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Wizard Progress Bar ──────────────────────────────────────────────────────

function WizardProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5 justify-center mb-2">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i + 1 <= step ? "bg-[#5c7f63] w-8" : "bg-[#e8e2d9] w-4"
            }`}
          />
        ))}
      </div>
      <p className="text-center text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4]">
        Step {step} of {total}
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const { isPartner, effectiveUserId } = usePartner();
  const todayMidnight = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  const todayStr = toDateStr(todayMidnight);

  const [weekStart,    setWeekStart]    = useState(() => getMondayOf(new Date()));
  const [lessons,      setLessons]      = useState<Lesson[]>([]);
  const [children,     setChildren]     = useState<Child[]>([]);
  const [subjects,     setSubjects]     = useState<Subject[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [mobileOffset, setMobileOffset] = useState<number>(() => {
    const dow = new Date().getDay();
    const idx = (dow + 6) % 7;
    return Math.max(0, Math.min(4, idx));
  });

  // ── Quick-add modal ───────────────────────────────────────────────────────
  const [showModal,   setShowModal]   = useState(false);
  const [modalDate,   setModalDate]   = useState(new Date());
  const [formChild,   setFormChild]   = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formTitle,   setFormTitle]   = useState("");
  const [formHours,   setFormHours]   = useState("");
  const [saving,      setSaving]      = useState(false);

  // ── Edit modal ────────────────────────────────────────────────────────────
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [editTitle,     setEditTitle]     = useState("");
  const [editSubject,   setEditSubject]   = useState("");
  const [editHours,     setEditHours]     = useState("");
  const [editChildId,   setEditChildId]   = useState("");
  const [savingEdit,    setSavingEdit]    = useState(false);

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [showWizard,       setShowWizard]       = useState(false);
  const [wizStep,          setWizStep]          = useState<1|2|3|4>(1);
  const [wizChildId,       setWizChildId]       = useState("");
  const [wizCurricName,    setWizCurricName]    = useState("");
  const [wizSubject,       setWizSubject]       = useState("");
  const [wizTotalLessons,  setWizTotalLessons]  = useState("");
  const [wizStartLesson,   setWizStartLesson]   = useState("1");
  const [wizSchoolDays,    setWizSchoolDays]    = useState([true, true, true, true, true, false, false]);
  const [wizLessonsPerDay, setWizLessonsPerDay] = useState("1");
  const [wizGoalDate,      setWizGoalDate]      = useState("");
  const [wizGenerating,    setWizGenerating]    = useState(false);
  const [wizDone,          setWizDone]          = useState(false);
  const [wizGenCount,      setWizGenCount]      = useState(0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const isCurrentWeek = toDateStr(weekStart) === toDateStr(getMondayOf(new Date()));

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);

    const ws = new Date(weekStart);
    const we = new Date(weekStart);
    we.setDate(we.getDate() + 6);
    const weekStartStr = toDateStr(ws);
    const weekEndStr   = toDateStr(we);

    const [
      { data: kids },
      { data: subs },
      { data: byScheduled },
      { data: byDateOnly },
    ] = await Promise.all([
      supabase.from("children").select("id, name, color")
        .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase.from("subjects").select("id, name, color")
        .eq("user_id", effectiveUserId).order("name"),
      supabase.from("lessons")
        .select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId)
        .gte("scheduled_date", weekStartStr).lte("scheduled_date", weekEndStr),
      supabase.from("lessons")
        .select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId)
        .is("scheduled_date", null)
        .gte("date", weekStartStr).lte("date", weekEndStr),
    ]);

    setChildren(kids ?? []);
    setSubjects((subs as Subject[]) ?? []);
    setLessons([
      ...((byScheduled as unknown as Lesson[]) ?? []),
      ...((byDateOnly  as unknown as Lesson[]) ?? []),
    ]);
    setLoading(false);
  }, [weekStart, effectiveUserId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (isCurrentWeek) {
      const dow = new Date().getDay();
      const idx = (dow + 6) % 7;
      setMobileOffset(Math.max(0, Math.min(4, idx)));
    } else {
      setMobileOffset(0);
    }
  }, [weekStart, isCurrentWeek]);

  // ── Week navigation ───────────────────────────────────────────────────────

  function prevWeek() { setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; }); }
  function nextWeek() { setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; }); }
  function goToToday() { setWeekStart(getMondayOf(new Date())); }

  // ── Toggle ────────────────────────────────────────────────────────────────

  async function toggleLesson(id: string, current: boolean) {
    setLessons((prev) => prev.map((l) => (l.id === id ? { ...l, completed: !current } : l)));
    await supabase.from("lessons").update({ completed: !current }).eq("id", id);
  }

  // ── Quick-add lesson ──────────────────────────────────────────────────────

  function openAddModal(day: Date, preSubject?: string) {
    setModalDate(day);
    setFormChild(children.length === 1 ? children[0].id : "");
    setFormSubject(preSubject ?? "");
    setFormTitle("");
    setFormHours("");
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
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSub } = await supabase.from("subjects")
          .insert({ user_id: user.id, name: formSubject.trim() }).select("id, name, color").single();
        if (newSub) { setSubjects((prev) => [...prev, newSub as Subject]); subjectId = newSub.id; }
      }
    }

    const dateStr = toDateStr(modalDate);
    const { data: newLesson } = await supabase.from("lessons")
      .insert({
        user_id: user.id, child_id: formChild || null, subject_id: subjectId,
        title: formTitle.trim(), hours: formHours ? parseFloat(formHours) : null,
        completed: false, date: dateStr, scheduled_date: dateStr,
      })
      .select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
      .single();

    if (newLesson) setLessons((prev) => [...prev, newLesson as unknown as Lesson]);
    setSaving(false);
    setShowModal(false);
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
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSub } = await supabase.from("subjects")
          .insert({ user_id: user.id, name: editSubject.trim() }).select("id, name, color").single();
        if (newSub) { setSubjects((prev) => [...prev, newSub as Subject]); subjectId = newSub.id; }
      }
    }

    await supabase.from("lessons").update({
      title: editTitle.trim(), subject_id: subjectId,
      hours: editHours ? parseFloat(editHours) : null,
      child_id: editChildId || null,
    }).eq("id", editingLesson.id);

    setLessons((prev) => prev.map((l) => {
      if (l.id !== editingLesson.id) return l;
      const subName = editSubject.trim();
      return {
        ...l,
        title:    editTitle.trim(),
        subjects: subName ? { name: subName, color: l.subjects?.color ?? null } : null,
        hours:    editHours ? parseFloat(editHours) : null,
        child_id: editChildId || l.child_id,
      };
    }));

    setSavingEdit(false);
    setEditingLesson(null);
  }

  // ── Delete lesson ─────────────────────────────────────────────────────────

  async function deleteLesson(id: string) {
    setLessons((prev) => prev.filter((l) => l.id !== id));
    await supabase.from("lessons").delete().eq("id", id);
  }

  // ── Wizard ────────────────────────────────────────────────────────────────

  function openWizard() {
    setWizCurricName("");
    setWizSubject("");
    setWizTotalLessons("");
    setWizStartLesson("1");
    setWizSchoolDays([true, true, true, true, true, false, false]);
    setWizLessonsPerDay("1");
    setWizGoalDate("");
    setWizGenerating(false);
    setWizDone(false);
    setWizGenCount(0);

    if (children.length === 1) {
      setWizChildId(children[0].id);
      setWizStep(2);
    } else {
      setWizChildId("");
      setWizStep(1);
    }
    setShowWizard(true);
  }

  function closeWizard() {
    setShowWizard(false);
  }

  // Compute estimated finish date from wizard state
  function calcFinishDate(): string {
    const total  = parseInt(wizTotalLessons) || 0;
    const start  = parseInt(wizStartLesson)  || 1;
    const perDay = parseInt(wizLessonsPerDay) || 1;
    const remaining = Math.max(0, total - start + 1);
    if (remaining === 0 || perDay <= 0 || !wizSchoolDays.some(Boolean)) return "";

    const daysNeeded = Math.ceil(remaining / perDay);
    let schoolDayCount = 0;
    const cursor = new Date(todayMidnight);
    let safety = 0;

    while (schoolDayCount < daysNeeded && safety < 3650) {
      const dayIdx = (cursor.getDay() + 6) % 7; // Mon=0…Sun=6
      if (wizSchoolDays[dayIdx]) schoolDayCount++;
      if (schoolDayCount < daysNeeded) cursor.setDate(cursor.getDate() + 1);
      safety++;
    }

    return cursor.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  async function generateSchedule() {
    setWizGenerating(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setWizGenerating(false); return; }

    // Resolve or create subject
    let subjectId: string | null = null;
    if (wizSubject.trim()) {
      const existing = subjects.find((s) => s.name.toLowerCase() === wizSubject.toLowerCase());
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSub } = await supabase.from("subjects")
          .insert({ user_id: user.id, name: wizSubject }).select("id, name, color").single();
        if (newSub) { setSubjects((prev) => [...prev, newSub as Subject]); subjectId = newSub.id; }
      }
    }

    const total  = parseInt(wizTotalLessons) || 0;
    const start  = parseInt(wizStartLesson)  || 1;
    const perDay = parseInt(wizLessonsPerDay) || 1;

    // Build list of (date, lessonNum) pairs
    const rows: { date: string; lessonNum: number }[] = [];
    let lessonNum = start;
    const cursor  = new Date(todayMidnight);
    let safety    = 0;

    while (lessonNum <= total && safety < 3650) {
      const dayIdx = (cursor.getDay() + 6) % 7;
      if (wizSchoolDays[dayIdx]) {
        for (let i = 0; i < perDay && lessonNum <= total; i++, lessonNum++) {
          rows.push({ date: toDateStr(cursor), lessonNum });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
      safety++;
    }

    // Batch insert in chunks of 100
    const inserts = rows.map(({ date, lessonNum: n }) => ({
      user_id:        user.id,
      child_id:       wizChildId || null,
      subject_id:     subjectId,
      title:          `${wizCurricName} — Lesson ${n}`,
      date,
      scheduled_date: date,
      completed:      false,
      hours:          null,
    }));

    for (let i = 0; i < inserts.length; i += 100) {
      await supabase.from("lessons").insert(inserts.slice(i, i + 100));
    }

    setWizGenCount(rows.length);
    setWizGenerating(false);
    setWizDone(true);
    loadData();
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

  const modalDateLabel = modalDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const mobileDays     = weekDays.slice(mobileOffset, mobileOffset + 3);
  const canMobileLeft  = mobileOffset > 0;
  const canMobileRight = mobileOffset < 4;

  // Wizard-derived
  const wizChildObj    = children.find((c) => c.id === wizChildId);
  const wizRemaining   = Math.max(0, (parseInt(wizTotalLessons) || 0) - (parseInt(wizStartLesson) || 1) + 1);
  const wizFinishDate  = calcFinishDate();
  const wizSelectedDayNames = DAY_LABELS.filter((_, i) => wizSchoolDays[i]).join(", ");
  const wizStep2Valid  = wizCurricName.trim() && wizTotalLessons.trim() && parseInt(wizTotalLessons) > 0;
  const wizStep3Valid  = wizSchoolDays.some(Boolean) && parseInt(wizLessonsPerDay) > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-7 space-y-5 max-w-5xl">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
            Curriculum &amp; Schedule
          </p>
          <h1 className="text-2xl font-bold text-[#2d2926]">Plan 📋</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isPartner && (
            <button
              onClick={openWizard}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1.5 rounded-full transition-colors border border-[#c8ddb8]"
            >
              <BookOpen size={13} strokeWidth={2} />
              Set Up Curriculum
            </button>
          )}
          <div className="flex items-center gap-1.5">
            {!isCurrentWeek && (
              <button onClick={goToToday}
                className="text-xs font-semibold text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1.5 rounded-full transition-colors mr-1">
                This week
              </button>
            )}
            <button onClick={prevWeek}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-[#2d2926] whitespace-nowrap px-1">
              {formatWeekRange(weekStart)}
            </span>
            <button onClick={nextWeek}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Weekly Summary Bar ───────────────────────────────── */}
      {!loading && totalWeek > 0 && (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm flex-wrap">
              <span className="font-semibold text-[#2d2926]">{totalWeek}</span>
              <span className="text-[#7a6f65]">lesson{totalWeek !== 1 ? "s" : ""} planned</span>
              <span className="text-[#c8bfb5]">·</span>
              <span className="font-semibold text-[#5c7f63]">{completedWeek}</span>
              <span className="text-[#7a6f65]">done</span>
              <span className="text-[#c8bfb5]">·</span>
              <span className="text-[#b5aca4]">{totalWeek - completedWeek} remaining</span>
            </div>
            {completedWeek === totalWeek && (
              <span className="text-xs bg-[#e8f0e9] text-[#3d5c42] px-2.5 py-0.5 rounded-full font-semibold shrink-0">
                🌿 Perfect week!
              </span>
            )}
          </div>
          <div className="h-1.5 bg-[#e8e2d9] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#5c7f63] rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Empty State ──────────────────────────────────────── */}
      {!loading && !isPartner && totalWeek === 0 && (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-7 text-center space-y-4">
          <div className="text-4xl">📅</div>
          <div>
            <h2 className="font-bold text-[#2d2926] text-lg mb-1" style={{ fontFamily: "Georgia, serif" }}>
              Plan your first week
            </h2>
            <p className="text-sm text-[#7a6f65] leading-relaxed max-w-xs mx-auto">
              Set up a full curriculum schedule automatically, or add lessons one at a time.
            </p>
          </div>
          <button
            onClick={openWizard}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold transition-colors shadow-sm"
          >
            <BookOpen size={15} strokeWidth={2} />
            Set Up Curriculum 📚
          </button>
          <p className="text-xs text-[#b5aca4]">
            or use{" "}
            <button onClick={() => openAddModal(todayMidnight)} className="underline hover:text-[#7a6f65] transition-colors">
              + Add
            </button>
            {" "}on any day to add a single lesson
          </p>
        </div>
      )}

      {/* ── Calendar ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <span className="text-4xl animate-pulse">🗓️</span>
        </div>
      ) : (
        <>
          {/* Desktop: full 7-day grid */}
          <div className="hidden lg:block overflow-x-auto -mx-4 px-4 pb-2">
            <div className="grid grid-cols-7 gap-2 min-w-[700px]">
              {weekDays.map((day) => {
                const key       = toDateStr(day);
                const isToday   = key === todayStr;
                const isPast    = day < todayMidnight;
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                return (
                  <DayColumn
                    key={key}
                    day={day}
                    lessons={lessonsByDay[key] ?? []}
                    children={children}
                    isToday={isToday}
                    isPast={isPast}
                    isWeekend={isWeekend}
                    onAdd={isPartner ? () => {} : openAddModal}
                    onToggle={isPartner ? () => {} : toggleLesson}
                    onEdit={openEdit}
                    onDelete={deleteLesson}
                    hideAdd={isPartner}
                    isPartner={isPartner}
                  />
                );
              })}
            </div>
          </div>

          {/* Mobile: 3-day view */}
          <div className="lg:hidden">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setMobileOffset((v) => Math.max(0, v - 1))}
                disabled={!canMobileLeft}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] disabled:opacity-25 transition-all"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-xs font-semibold text-[#7a6f65]">
                {mobileDays[0]?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {" – "}
                {mobileDays[2]?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              <button
                onClick={() => setMobileOffset((v) => Math.min(4, v + 1))}
                disabled={!canMobileRight}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] disabled:opacity-25 transition-all"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {mobileDays.map((day) => {
                const key       = toDateStr(day);
                const isToday   = key === todayStr;
                const isPast    = day < todayMidnight;
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                return (
                  <DayColumn
                    key={key}
                    day={day}
                    lessons={lessonsByDay[key] ?? []}
                    children={children}
                    isToday={isToday}
                    isPast={isPast}
                    isWeekend={isWeekend}
                    onAdd={isPartner ? () => {} : openAddModal}
                    onToggle={isPartner ? () => {} : toggleLesson}
                    onEdit={openEdit}
                    onDelete={deleteLesson}
                    hideAdd={isPartner}
                    isPartner={isPartner}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}

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
              <button onClick={() => setShowModal(false)} className="text-[#b5aca4] hover:text-[#7a6f65] mt-0.5">
                <X size={18} />
              </button>
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
              <datalist id="plan-subjects">
                {subjects.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
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
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                Cancel
              </button>
              <button onClick={saveLesson} disabled={saving || !formTitle.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
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
              <button onClick={() => setEditingLesson(null)} className="text-[#b5aca4] hover:text-[#7a6f65]">
                <X size={18} />
              </button>
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
              <datalist id="plan-edit-subjects">
                {subjects.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
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
              <button onClick={() => setEditingLesson(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={savingEdit || !editTitle.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {savingEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          CURRICULUM SETUP WIZARD
      ══════════════════════════════════════════════════════ */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">

            {/* Close */}
            <div className="flex justify-end mb-1">
              <button onClick={closeWizard} className="text-[#b5aca4] hover:text-[#7a6f65] transition-colors">
                <X size={18} />
              </button>
            </div>

            <WizardProgress step={wizStep} total={4} />

            {/* ── STEP 1: Choose child ─────────────────────── */}
            {wizStep === 1 && (
              <div className="space-y-5">
                <div className="text-center">
                  <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "Georgia, serif" }}>
                    Which child is this for?
                  </h2>
                  <p className="text-sm text-[#7a6f65]">Select a child to assign this curriculum to.</p>
                </div>

                {children.length === 0 ? (
                  <div className="text-center py-6 space-y-3">
                    <div className="text-3xl">🌱</div>
                    <p className="text-sm text-[#7a6f65] leading-relaxed">
                      You need to add a child before setting up a curriculum.
                    </p>
                    <Link
                      href="/dashboard/settings"
                      onClick={closeWizard}
                      className="inline-block px-4 py-2 rounded-xl bg-[#e8f0e9] text-[#3d5c42] text-sm font-semibold hover:bg-[#d4ead4] transition-colors"
                    >
                      Go to Settings →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {children.map((child) => {
                      const initial = child.name.trim().charAt(0).toUpperCase();
                      const selected = wizChildId === child.id;
                      return (
                        <button
                          key={child.id}
                          onClick={() => setWizChildId(child.id)}
                          className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                            selected
                              ? "border-[#5c7f63] bg-[#f2f9f3] shadow-sm"
                              : "border-[#e8e2d9] bg-white hover:border-[#c8ddb8] hover:bg-[#fafcfa]"
                          }`}
                        >
                          <div
                            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white font-bold text-lg"
                            style={{ backgroundColor: child.color ?? "#5c7f63" }}
                          >
                            {initial}
                          </div>
                          <span className="font-semibold text-[#2d2926] text-base">{child.name}</span>
                          {selected && (
                            <span className="ml-auto text-[#5c7f63] text-lg">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {children.length > 0 && (
                  <button
                    onClick={() => setWizStep(2)}
                    disabled={!wizChildId}
                    className="w-full py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-sm transition-colors"
                  >
                    Next →
                  </button>
                )}
              </div>
            )}

            {/* ── STEP 2: Curriculum info ──────────────────── */}
            {wizStep === 2 && (
              <div className="space-y-5">
                <div className="text-center">
                  <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "Georgia, serif" }}>
                    Tell us about this curriculum
                  </h2>
                  <p className="text-sm text-[#7a6f65]">We&apos;ll use this to name each lesson automatically.</p>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                    Curriculum name *
                  </label>
                  <input
                    value={wizCurricName}
                    onChange={(e) => setWizCurricName(e.target.value)}
                    placeholder="e.g. Saxon Math 5/4, All About Reading Level 3"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                    Subject
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SUBJECT_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        onClick={() => setWizSubject(wizSubject === chip.label ? "" : chip.label)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                          wizSubject === chip.label
                            ? "border-transparent shadow-sm scale-105"
                            : "border-[#e8e2d9] bg-white hover:border-[#c8ddb8]"
                        }`}
                        style={wizSubject === chip.label ? { backgroundColor: chip.bg, color: chip.text } : {}}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                      Total lessons *
                    </label>
                    <input
                      value={wizTotalLessons}
                      onChange={(e) => setWizTotalLessons(e.target.value)}
                      type="number" min="1" max="999" placeholder="e.g. 170"
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                      Start at lesson
                    </label>
                    <input
                      value={wizStartLesson}
                      onChange={(e) => setWizStartLesson(e.target.value)}
                      type="number" min="1" placeholder="1"
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                    />
                    <p className="text-[10px] text-[#b5aca4] mt-1">Mid-curriculum? Start at lesson 45.</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setWizStep(children.length > 1 ? 1 : 1)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => setWizStep(3)}
                    disabled={!wizStep2Valid}
                    className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-sm transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Schedule ─────────────────────────── */}
            {wizStep === 3 && (
              <div className="space-y-5">
                <div className="text-center">
                  <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "Georgia, serif" }}>
                    Pick your school days
                  </h2>
                  <p className="text-sm text-[#7a6f65]">We&apos;ll schedule lessons only on the days you choose.</p>
                </div>

                {/* Day toggles */}
                <div className="flex gap-1.5 justify-center flex-wrap">
                  {DAY_LABELS.map((label, i) => (
                    <button
                      key={label}
                      onClick={() => setWizSchoolDays((prev) => prev.map((v, j) => j === i ? !v : v))}
                      className={`w-11 h-11 rounded-xl text-xs font-bold transition-all ${
                        wizSchoolDays[i]
                          ? "bg-[#5c7f63] text-white shadow-sm"
                          : "bg-[#f0ede8] text-[#7a6f65] hover:bg-[#e8e2d9]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                    Lessons per school day
                  </label>
                  <input
                    value={wizLessonsPerDay}
                    onChange={(e) => setWizLessonsPerDay(e.target.value)}
                    type="number" min="1" max="10" placeholder="1"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#7a6f65] block mb-2">
                    Goal finish date (optional)
                  </label>
                  <input
                    value={wizGoalDate}
                    onChange={(e) => setWizGoalDate(e.target.value)}
                    type="date"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                  />
                </div>

                {/* Live preview */}
                {wizFinishDate && wizStep3Valid && (
                  <div className="bg-[#f2f9f3] border border-[#c8ddb8] rounded-2xl px-4 py-3 text-center">
                    <p className="text-sm text-[#3d5c42] leading-relaxed">
                      📅 At <strong>{wizLessonsPerDay}</strong> lesson{parseInt(wizLessonsPerDay) !== 1 ? "s" : ""}/day
                      on <strong>{wizSelectedDayNames || "your school days"}</strong>,<br />
                      you&apos;ll finish{" "}
                      <strong>{wizRemaining} lesson{wizRemaining !== 1 ? "s" : ""}</strong>{" "}
                      by <strong>{wizFinishDate}</strong>.
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setWizStep(2)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => setWizStep(4)}
                    disabled={!wizStep3Valid}
                    className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-sm transition-colors"
                  >
                    Generate My Schedule →
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Confirm & Generate ───────────────── */}
            {wizStep === 4 && (
              <div className="space-y-5">
                {!wizDone && !wizGenerating && (
                  <>
                    <div className="text-center">
                      <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "Georgia, serif" }}>
                        Here&apos;s your plan{wizChildObj ? ` for ${wizChildObj.name}` : ""}
                      </h2>
                      <p className="text-sm text-[#7a6f65]">Looks good? We&apos;ll create all the lessons for you.</p>
                    </div>

                    {/* Summary card */}
                    <div className="bg-[#f8f7f4] border border-[#e8e2d9] rounded-2xl p-5 space-y-3">
                      {[
                        { label: "Curriculum", value: wizCurricName },
                        { label: "Subject",    value: wizSubject || "Not specified" },
                        { label: "Lessons",    value: `${wizStartLesson} to ${wizTotalLessons} (${wizRemaining} to create)` },
                        { label: "School days", value: wizSelectedDayNames || "—" },
                        { label: "Per day",    value: `${wizLessonsPerDay} lesson${parseInt(wizLessonsPerDay) !== 1 ? "s" : ""}` },
                        ...(wizFinishDate ? [{ label: "Finishes around", value: wizFinishDate }] : []),
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-baseline justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[#b5aca4] shrink-0">{label}</span>
                          <span className="text-sm font-medium text-[#2d2926] text-right">{value}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setWizStep(3)}
                        className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                      >
                        ← Back
                      </button>
                      <button
                        onClick={generateSchedule}
                        className="flex-[2] py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold text-sm transition-colors"
                      >
                        Create {wizRemaining} Lessons ✓
                      </button>
                    </div>
                  </>
                )}

                {/* Generating spinner */}
                {wizGenerating && (
                  <div className="text-center py-10 space-y-4">
                    <div className="text-4xl animate-spin inline-block">🌿</div>
                    <p className="font-semibold text-[#2d2926]">Building your schedule…</p>
                    <p className="text-sm text-[#7a6f65]">Creating {wizRemaining} lessons across your school days.</p>
                  </div>
                )}

                {/* Done */}
                {wizDone && (
                  <div className="text-center py-6 space-y-4">
                    <div className="text-5xl">🌿</div>
                    <div>
                      <h2 className="text-xl font-bold text-[#2d2926] mb-1" style={{ fontFamily: "Georgia, serif" }}>
                        {wizGenCount} lessons scheduled!
                      </h2>
                      <p className="text-sm text-[#7a6f65] leading-relaxed">
                        Your plan is ready. Each lesson is on your calendar — just check them off as you go.
                      </p>
                    </div>
                    <button
                      onClick={closeWizard}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold transition-colors shadow-sm"
                    >
                      View my plan →
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}
