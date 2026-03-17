"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

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

// ─── Lesson Card ──────────────────────────────────────────────────────────────

function LessonCard({
  lesson,
  childObj,
  onToggle,
}: {
  lesson: Lesson;
  childObj: Child | undefined;
  onToggle: (id: string, current: boolean) => void;
}) {
  const subColor = lesson.subjects?.color ?? "#7a9e7e";

  return (
    <div
      className={`rounded-xl p-2 border-l-[3px] transition-all ${
        lesson.completed ? "opacity-55" : "shadow-sm"
      }`}
      style={{
        borderLeftColor: subColor,
        backgroundColor: lesson.completed ? "#f0f7f1" : "white",
      }}
    >
      <div className="flex items-start gap-1.5">
        {/* Checkbox */}
        <button
          onClick={() => onToggle(lesson.id, lesson.completed)}
          className={`mt-0.5 w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
            lesson.completed
              ? "bg-[#5c7f63] border-[#5c7f63]"
              : "border-[#c8bfb5] hover:border-[#5c7f63]"
          }`}
          aria-label={lesson.completed ? "Mark incomplete" : "Mark complete"}
        >
          {lesson.completed && (
            <svg viewBox="0 0 8 7" className="w-2 h-1.5">
              <path d="M1 3.5l1.8 2L7 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`text-[11px] font-semibold leading-tight ${
            lesson.completed ? "line-through text-[#b5aca4]" : "text-[#2d2926]"
          }`}>
            {lesson.title}
          </p>
          {lesson.subjects && (
            <p className="text-[9px] mt-0.5 font-medium truncate" style={{ color: subColor }}>
              {lesson.subjects.name}
            </p>
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
      </div>
    </div>
  );
}

// ─── Day Column ───────────────────────────────────────────────────────────────

function DayColumn({
  day,
  lessons,
  children,
  isToday,
  isPast,
  isWeekend,
  onAdd,
  onToggle,
}: {
  day: Date;
  lessons: Lesson[];
  children: Child[];
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
  onAdd: (day: Date) => void;
  onToggle: (id: string, current: boolean) => void;
}) {
  const dayName  = day.toLocaleDateString("en-US", { weekday: "short" });
  const dayNum   = day.getDate();
  const done     = lessons.filter((l) => l.completed).length;
  const total    = lessons.length;
  const allDone  = total > 0 && done === total;

  return (
    <div
      className={`flex flex-col rounded-2xl overflow-hidden border min-w-[110px] ${
        isToday   ? "border-[#5c7f63]"  :
        isWeekend ? "border-[#ece8e2]"  :
                    "border-[#e8e2d9]"
      }`}
      style={{
        backgroundColor:
          isToday   ? "#f2f9f3" :
          isWeekend ? "#faf9f7" :
                      "#fefcf9",
      }}
    >
      {/* Day header */}
      <div
        className={`px-2 pt-3 pb-2.5 flex flex-col items-center border-b ${
          isToday ? "border-[#b8d9bc] bg-[#e8f5ea]" : "border-[#f0ede8]"
        }`}
      >
        <span className={`text-[10px] font-bold uppercase tracking-widest ${
          isToday   ? "text-[#3d5c42]" :
          isPast    ? "text-[#c8bfb5]" :
          isWeekend ? "text-[#b5aca4]" :
                      "text-[#7a6f65]"
        }`}>
          {dayName}
        </span>

        <span className={`text-2xl font-bold leading-tight mt-0.5 ${
          isToday ? "text-[#3d5c42]" :
          isPast  ? "text-[#c8bfb5]" :
                    "text-[#2d2926]"
        }`}>
          {dayNum}
        </span>

        {isToday && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#5c7f63] mt-1" />
        )}

        {total > 0 && (
          <span className={`text-[9px] mt-1 font-semibold ${
            allDone ? "text-[#5c7f63]" : "text-[#b5aca4]"
          }`}>
            {allDone ? "✓ done" : `${done}/${total}`}
          </span>
        )}
      </div>

      {/* Lessons */}
      <div className="flex-1 p-1.5 space-y-1.5 min-h-[120px]">
        {lessons.map((l) => (
          <LessonCard
            key={l.id}
            lesson={l}
            childObj={children.find((c) => c.id === l.child_id)}
            onToggle={onToggle}
          />
        ))}
      </div>

      {/* Add button */}
      <div className="px-1.5 pb-2">
        <button
          onClick={() => onAdd(day)}
          className={`w-full flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-semibold transition-colors ${
            isToday
              ? "text-[#5c7f63] hover:bg-[#d4ead4]"
              : "text-[#c8bfb5] hover:text-[#5c7f63] hover:bg-[#f0ede8]"
          }`}
        >
          <Plus size={11} strokeWidth={2.5} />
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const todayMidnight = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  const todayStr = toDateStr(todayMidnight);

  const [weekStart,   setWeekStart]   = useState(() => getMondayOf(new Date()));
  const [lessons,     setLessons]     = useState<Lesson[]>([]);
  const [children,    setChildren]    = useState<Child[]>([]);
  const [subjects,    setSubjects]    = useState<Subject[]>([]);
  const [loading,     setLoading]     = useState(true);

  // Modal state
  const [showModal,   setShowModal]   = useState(false);
  const [modalDate,   setModalDate]   = useState(new Date());
  const [formChild,   setFormChild]   = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formTitle,   setFormTitle]   = useState("");
  const [formHours,   setFormHours]   = useState("");
  const [saving,      setSaving]      = useState(false);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const isCurrentWeek = toDateStr(weekStart) === toDateStr(getMondayOf(new Date()));

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

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
      supabase
        .from("children").select("id, name, color")
        .eq("user_id", user.id).eq("archived", false).order("sort_order"),
      supabase
        .from("subjects").select("id, name, color")
        .eq("user_id", user.id).order("name"),
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
        .eq("user_id", user.id)
        .gte("scheduled_date", weekStartStr)
        .lte("scheduled_date", weekEndStr),
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
        .eq("user_id", user.id)
        .is("scheduled_date", null)
        .gte("date", weekStartStr)
        .lte("date", weekEndStr),
    ]);

    setChildren(kids ?? []);
    setSubjects((subs as Subject[]) ?? []);
    setLessons([
      ...((byScheduled as unknown as Lesson[]) ?? []),
      ...((byDateOnly  as unknown as Lesson[]) ?? []),
    ]);
    setLoading(false);
  }, [weekStart]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Navigation ────────────────────────────────────────────────────────────

  function prevWeek() {
    setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  }
  function nextWeek() {
    setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
  }
  function goToToday() {
    setWeekStart(getMondayOf(new Date()));
  }

  // ── Toggle complete ───────────────────────────────────────────────────────

  async function toggleLesson(id: string, current: boolean) {
    setLessons((prev) =>
      prev.map((l) => (l.id === id ? { ...l, completed: !current } : l))
    );
    await supabase.from("lessons").update({ completed: !current }).eq("id", id);
  }

  // ── Open modal ────────────────────────────────────────────────────────────

  function openAddModal(day: Date) {
    setModalDate(day);
    setFormChild(children.length === 1 ? children[0].id : "");
    setFormSubject("");
    setFormTitle("");
    setFormHours("");
    setShowModal(true);
  }

  // ── Save lesson ───────────────────────────────────────────────────────────

  async function saveLesson() {
    if (!formTitle.trim()) return;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    // Find or create subject
    let subjectId: string | null = null;
    if (formSubject.trim()) {
      const existing = subjects.find(
        (s) => s.name.toLowerCase() === formSubject.trim().toLowerCase()
      );
      if (existing) {
        subjectId = existing.id;
      } else {
        const { data: newSub } = await supabase
          .from("subjects")
          .insert({ user_id: user.id, name: formSubject.trim() })
          .select("id, name, color")
          .single();
        if (newSub) {
          setSubjects((prev) => [...prev, newSub as Subject]);
          subjectId = newSub.id;
        }
      }
    }

    const dateStr = toDateStr(modalDate);

    const { data: newLesson } = await supabase
      .from("lessons")
      .insert({
        user_id:        user.id,
        child_id:       formChild || null,
        subject_id:     subjectId,
        title:          formTitle.trim(),
        hours:          formHours ? parseFloat(formHours) : null,
        completed:      false,
        date:           dateStr,
        scheduled_date: dateStr,
      })
      .select("id, title, completed, child_id, hours, date, scheduled_date, subjects(name, color)")
      .single();

    if (newLesson) {
      setLessons((prev) => [...prev, newLesson as unknown as Lesson]);
    }

    setSaving(false);
    setShowModal(false);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const lessonsByDay = weekDays.reduce<Record<string, Lesson[]>>((acc, day) => {
    const key = toDateStr(day);
    acc[key] = lessons.filter(
      (l) => (l.scheduled_date ?? l.date) === key
    );
    return acc;
  }, {});

  const totalWeek     = lessons.length;
  const completedWeek = lessons.filter((l) => l.completed).length;

  const modalDateLabel = modalDate.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

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

        {/* Week navigation */}
        <div className="flex items-center gap-1.5">
          {!isCurrentWeek && (
            <button
              onClick={goToToday}
              className="text-xs font-semibold text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1.5 rounded-full transition-colors mr-1"
            >
              This week
            </button>
          )}
          <button
            onClick={prevWeek}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-[#2d2926] whitespace-nowrap px-1">
            {formatWeekRange(weekStart)}
          </span>
          <button
            onClick={nextWeek}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── Week stats bar ───────────────────────────────────── */}
      {totalWeek > 0 && (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-semibold text-[#2d2926]">{totalWeek}</span>
          <span className="text-[#7a6f65]">lesson{totalWeek !== 1 ? "s" : ""} planned</span>
          <span className="text-[#c8bfb5] px-0.5">·</span>
          <span className="font-semibold text-[#5c7f63]">{completedWeek}</span>
          <span className="text-[#7a6f65]">completed</span>
          {completedWeek === totalWeek && (
            <span className="ml-1 text-xs bg-[#e8f0e9] text-[#3d5c42] px-2.5 py-0.5 rounded-full font-semibold">
              🌿 Perfect week!
            </span>
          )}
        </div>
      )}

      {/* ── Calendar grid ───────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <span className="text-4xl animate-pulse">🗓️</span>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 pb-2">
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
                  onAdd={openAddModal}
                  onToggle={toggleLesson}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state hint */}
      {!loading && totalWeek === 0 && (
        <div className="text-center py-4">
          <p className="text-sm text-[#b5aca4]">
            Click <strong className="text-[#7a6f65]">+ Add</strong> on any day to schedule a lesson.
          </p>
        </div>
      )}

      {/* ── Add Lesson Modal ─────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold text-[#2d2926]">📋 Add a Lesson</h2>
                <p className="text-xs text-[#7a6f65] mt-0.5">{modalDateLabel}</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-[#b5aca4] hover:text-[#7a6f65] mt-0.5"
              >
                <X size={18} />
              </button>
            </div>

            {/* Child */}
            {children.length > 0 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child</label>
                <select
                  value={formChild}
                  onChange={(e) => setFormChild(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                >
                  <option value="">All / unassigned</option>
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Subject */}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Subject</label>
              <input
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                list="plan-subjects"
                placeholder="e.g. Math, Reading, Science"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
              <datalist id="plan-subjects">
                {subjects.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>

            {/* Title */}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                Lesson title *
              </label>
              <input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !saving && saveLesson()}
                placeholder="e.g. Chapter 5 — Fractions"
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
            </div>

            {/* Hours */}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                Estimated hours (optional)
              </label>
              <input
                value={formHours}
                onChange={(e) => setFormHours(e.target.value)}
                type="number"
                min="0"
                max="24"
                step="0.5"
                placeholder="e.g. 1.5"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveLesson}
                disabled={saving || !formTitle.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {saving ? "Saving…" : "Add to Plan 📋"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}
