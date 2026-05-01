"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { capitalizeChildNames } from "@/lib/utils";
import { resolveLessonSubject } from "@/lib/lesson-subject";
import { computeNextLessonsForGoal, type CurriculumGoalConfig, type VacationBlock as SchedVacationBlock } from "@/app/lib/scheduler";
import { tintFromHex, darkenHex } from "@/lib/color-tint";

// ─── Types ────────────────────────────────────────────────────────────────────

type Subject = {
  id: string;
  name: string;
  color: string | null;
  days_of_week: string[];
};

type Lesson = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string | null;
  subjects: { name: string; color: string | null } | null;
  curriculum_goals?: { subject_label: string | null } | null;
  scheduled_date: string | null;
  date: string | null;
};

type Child = { id: string; name: string; color: string | null };

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const start = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = friday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${start} – ${end}`;
}

function getSubjectStyle(color: string | null, name: string): { bg: string; text: string } {
  if (color) return { bg: color + "22", text: color };
  const n = name.toLowerCase();
  if (n.includes("math") || n.includes("algebra") || n.includes("geometry"))
    return { bg: "#e4f0f4", text: "#1a4a5a" };
  if (n.includes("read") || n.includes("language") || n.includes("english") || n.includes("writing"))
    return { bg: "#f0e8f4", text: "#4a2a5a" };
  if (n.includes("science") || n.includes("biology") || n.includes("chemistry"))
    return { bg: "#e8f0e9", text: "var(--g-deep)" };
  if (n.includes("history") || n.includes("social") || n.includes("geography"))
    return { bg: "#fef0e4", text: "#7a4a1a" };
  if (n.includes("art") || n.includes("music") || n.includes("drama"))
    return { bg: "#fce8ec", text: "#7a2a36" };
  return { bg: "#f0ede8", text: "#5c5248" };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { effectiveUserId } = usePartner();
  const todayStr = toDateStr(new Date());

  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()));
  const [subjects,  setSubjects]  = useState<Subject[]>([]);
  const [lessons,   setLessons]   = useState<Lesson[]>([]);
  const [children,  setChildren]  = useState<Child[]>([]);
  const [loading,   setLoading]   = useState(true);

  const weekDays = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const isCurrentWeek = toDateStr(weekStart) === toDateStr(getMondayOf(new Date()));

  useEffect(() => { document.title = "Schedule \u00b7 Rooted"; }, []);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);

    const ws = new Date(weekStart);
    const we = new Date(weekStart);
    we.setDate(we.getDate() + 4); // Mon–Fri only
    const s = toDateStr(ws);
    const e = toDateStr(we);

    // Source of truth for upcoming lessons is the curriculum goal queue
    // position (Path A, 2026-05). See app/lib/scheduler.ts.
    const [{ data: kids }, { data: subs }, { data: goalsRaw }, { data: vacsRaw }] = await Promise.all([
      supabase
        .from("children")
        .select("id, name, color")
        .eq("user_id", effectiveUserId)
        .eq("archived", false)
        .order("sort_order"),
      supabase
        .from("subjects")
        .select("id, name, color, days_of_week")
        .eq("user_id", effectiveUserId)
        .order("name"),
      supabase
        .from("curriculum_goals")
        .select("id, total_lessons, lessons_per_day, school_days, current_lesson")
        .eq("user_id", effectiveUserId),
      supabase
        .from("vacation_blocks")
        .select("start_date, end_date")
        .eq("user_id", effectiveUserId),
    ]);

    setChildren(capitalizeChildNames(kids ?? []));
    setSubjects((subs as unknown as Subject[]) ?? []);

    // Projection ALWAYS starts from today, not from `ws`. See note in
    // app/dashboard/plan/page.tsx loadLessonsForRange for the off-by-
    // one rationale (day-detail audit 2026-05-01).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysAhead = Math.max(0, Math.floor((we.getTime() - today.getTime()) / 86400000) + 1);
    const goals = (goalsRaw ?? []) as { id: string; total_lessons: number | null; lessons_per_day: number | null; school_days: string[] | null; current_lesson: number | null }[];
    const vacationBlocks: SchedVacationBlock[] = ((vacsRaw ?? []) as { start_date: string; end_date: string }[])
      .map((b) => ({ start_date: b.start_date, end_date: b.end_date }));
    const projected: { goal_id: string; lesson_number: number; date: string }[] = [];
    for (const g of goals) {
      if (!g.total_lessons || g.total_lessons <= 0) continue;
      const cfg: CurriculumGoalConfig = {
        id: g.id,
        total_lessons: g.total_lessons,
        lessons_per_day: g.lessons_per_day ?? 1,
        school_days: g.school_days,
        current_lesson: g.current_lesson ?? 0,
      };
      projected.push(...computeNextLessonsForGoal(cfg, today, daysAhead, vacationBlocks).filter((p) => p.date >= s && p.date <= e));
    }
    const projDateByKey = new Map(projected.map((p) => [`${p.goal_id}|${p.lesson_number}`, p.date]));
    const projGoalIds = Array.from(new Set(projected.map((p) => p.goal_id)));
    const projNumbers = Array.from(new Set(projected.map((p) => p.lesson_number)));

    const [{ data: projRowsRaw }, { data: pastDoneRaw }, { data: oneOffRaw }] = await Promise.all([
      projGoalIds.length > 0
        ? supabase
            .from("lessons")
            .select("id, title, completed, child_id, subjects(name, color), curriculum_goals(subject_label), scheduled_date, date, curriculum_goal_id, lesson_number")
            .eq("user_id", effectiveUserId)
            .in("curriculum_goal_id", projGoalIds)
            .in("lesson_number", projNumbers)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, subjects(name, color), curriculum_goals(subject_label), scheduled_date, date, curriculum_goal_id, lesson_number")
        .eq("user_id", effectiveUserId)
        .eq("completed", true)
        .lt("scheduled_date", todayStr)
        .gte("scheduled_date", s)
        .lte("scheduled_date", e),
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, subjects(name, color), curriculum_goals(subject_label), scheduled_date, date, curriculum_goal_id, lesson_number")
        .eq("user_id", effectiveUserId)
        .is("curriculum_goal_id", null)
        .or(`and(scheduled_date.gte.${s},scheduled_date.lte.${e}),and(scheduled_date.is.null,date.gte.${s},date.lte.${e})`),
    ]);

    type Row = Lesson & { curriculum_goal_id?: string | null; lesson_number?: number | null };
    const projRows = ((projRowsRaw ?? []) as unknown as Row[])
      .filter((r) => projDateByKey.has(`${r.curriculum_goal_id}|${r.lesson_number}`))
      .map((r) => {
        const projDate = projDateByKey.get(`${r.curriculum_goal_id}|${r.lesson_number}`)!;
        return { ...r, scheduled_date: projDate, date: projDate } as Row;
      });
    const pastDoneRows = ((pastDoneRaw ?? []) as unknown as Row[]);
    const oneOffRows = ((oneOffRaw ?? []) as unknown as Row[]);
    const byId = new Map<string, Row>();
    for (const r of pastDoneRows) byId.set(r.id, r);
    for (const r of projRows) byId.set(r.id, r);
    for (const r of oneOffRows) byId.set(r.id, r);
    setLessons(Array.from(byId.values()) as Lesson[]);
    setLoading(false);
  }, [weekStart, effectiveUserId, todayStr]);

  useEffect(() => { loadData(); }, [loadData]);

  function prevWeek() {
    setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  }
  function nextWeek() {
    setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
  }
  function goToToday() { setWeekStart(getMondayOf(new Date())); }

  // Build lessons-by-day map
  const lessonsByDay: Record<string, Lesson[]> = {};
  for (const l of lessons) {
    const key = l.scheduled_date ?? l.date ?? "";
    if (!lessonsByDay[key]) lessonsByDay[key] = [];
    lessonsByDay[key].push(l);
  }

  // Map day short-name to date string
  const dayKeyMap: Record<string, string> = {};
  weekDays.forEach((d, i) => { dayKeyMap[WEEKDAYS[i]] = toDateStr(d); });

  return (
    <div className="max-w-4xl px-4 py-7 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/dashboard/plan"
              className="text-xs font-medium text-[#7a6f65] hover:text-[#5c7f63] transition-colors"
            >
              ← Plan
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-[#2d2926]">Weekly Schedule 📅</h1>
          <p className="text-sm text-[#7a6f65] mt-1">
            Subjects by day and scheduled lessons for the week.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {!isCurrentWeek && (
            <button
              onClick={goToToday}
              className="text-xs font-semibold text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1.5 rounded-full transition-colors mr-1"
            >
              This week
            </button>
          )}
          <button onClick={prevWeek} className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-[#2d2926] whitespace-nowrap px-1">
            {formatWeekRange(weekStart)}
          </span>
          <button onClick={nextWeek} className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <span className="text-4xl animate-pulse">📅</span>
        </div>
      ) : (
        <>
          {/* Subject schedule legend */}
          {subjects.some((s) => s.days_of_week?.length > 0) && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
                Subject Schedule
              </p>
              <div className="flex flex-wrap gap-2 mb-1">
                {subjects.filter((s) => s.days_of_week?.length > 0).map((sub) => {
                  const style = getSubjectStyle(sub.color, sub.name);
                  return (
                    <div
                      key={sub.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium"
                      style={{ backgroundColor: style.bg, color: style.text, borderColor: style.text + "30" }}
                    >
                      <span>{sub.name}</span>
                      <span className="opacity-60">·</span>
                      <span className="opacity-70">{sub.days_of_week.join(", ")}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Weekly grid — Mon to Fri */}
          <div className="grid grid-cols-5 gap-2">
            {weekDays.map((day, i) => {
              const dayName = WEEKDAYS[i];
              const dateKey = toDateStr(day);
              const isToday = dateKey === todayStr;
              const isPast  = day < new Date(new Date().setHours(0, 0, 0, 0));
              const dayLessons = lessonsByDay[dateKey] ?? [];

              // Subjects scheduled on this day
              const daySubjects = subjects.filter(
                (s) => s.days_of_week?.includes(dayName)
              );

              return (
                <div
                  key={dateKey}
                  className={`flex flex-col rounded-2xl overflow-hidden transition-all ${
                    isToday
                      ? "border-2 border-[#5c7f63] shadow-md"
                      : "border border-[#e8e2d9]"
                  }`}
                  style={{ backgroundColor: isToday ? "#f2f9f3" : "#fefcf9" }}
                >
                  {/* Day header */}
                  <div
                    className={`px-2 pt-3 pb-2.5 flex flex-col items-center border-b ${
                      isToday ? "border-[#b8d9bc] bg-[#d4ead6]" : "border-[#f0ede8]"
                    }`}
                  >
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${
                      isToday ? "text-[var(--g-deep)]" : isPast ? "text-[#c8bfb5]" : "text-[#7a6f65]"
                    }`}>
                      {dayName}
                    </span>
                    <span className={`text-xl font-bold leading-tight mt-0.5 ${
                      isToday ? "text-[var(--g-deep)]" : isPast ? "text-[#c8bfb5]" : "text-[#2d2926]"
                    }`}>
                      {day.getDate()}
                    </span>
                    {isToday && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#5c7f63] text-white mt-1 uppercase tracking-wide">
                        Today
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-2 space-y-1.5 min-h-[120px]">
                    {/* Subject pills */}
                    {daySubjects.map((sub) => {
                      const style = getSubjectStyle(sub.color, sub.name);
                      return (
                        <div
                          key={sub.id}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold leading-snug"
                          style={{ backgroundColor: style.bg, color: style.text }}
                        >
                          {sub.name}
                        </div>
                      );
                    })}

                    {/* Lessons */}
                    {dayLessons.length > 0 && daySubjects.length > 0 && (
                      <div className="border-t border-[#f0ede8] my-1" />
                    )}
                    {dayLessons.map((lesson) => {
                      const child = children.find((c) => c.id === lesson.child_id);
                      const subjName = resolveLessonSubject(lesson.subjects?.name, lesson.curriculum_goals?.subject_label);
                      // Kid-color tinted card matches Today schedule
                      // (parity with InlineScheduleTabs / TodayKidSection).
                      // Background tinted; subject pill uses the kid's
                      // darker shade. Subject color from the subjects
                      // table is no longer used here — the card already
                      // signals the subject by its kid-keyed background.
                      const kidColor = child?.color ?? "#7a6f65";
                      const kidBg = tintFromHex(kidColor, 0.25);
                      const kidTitle = darkenHex(kidColor, 0.45);
                      const kidPillBg = tintFromHex(kidColor, 0.35);
                      const kidPillText = darkenHex(kidColor, 0.55);
                      return (
                        <div
                          key={lesson.id}
                          className={`rounded-lg p-1.5 text-[10px] transition-all ${
                            lesson.completed ? "opacity-50" : ""
                          }`}
                          style={{
                            backgroundColor: kidBg,
                          }}
                        >
                          <p className={`font-medium leading-snug ${lesson.completed ? "line-through" : ""}`} style={{ color: lesson.completed ? "#b5aca4" : kidTitle }}>
                            {lesson.title}
                          </p>
                          {subjName && (
                            <span
                              className="inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
                              style={{ backgroundColor: kidPillBg, color: kidPillText }}
                            >
                              {subjName}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {daySubjects.length === 0 && dayLessons.length === 0 && (
                      <p className="text-[10px] text-[#c8bfb5] text-center pt-3">—</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Empty state for subjects with no days_of_week set */}
          {subjects.length > 0 && subjects.every((s) => !s.days_of_week?.length) && (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 text-center">
              <p className="text-sm font-medium text-[#2d2926] mb-1">No subject days configured yet</p>
              <p className="text-sm text-[#7a6f65] leading-relaxed max-w-xs mx-auto">
                Subject days can be set from the subjects settings. Scheduled lessons will still appear above.
              </p>
            </div>
          )}

          {subjects.length === 0 && lessons.length === 0 && (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 flex flex-col items-center text-center">
              <span className="text-4xl mb-3">📅</span>
              <p className="text-base font-semibold text-[#2d2926] mb-1.5">Nothing scheduled yet</p>
              <p className="text-sm text-[#7a6f65] leading-relaxed max-w-xs mb-5">
                Set up your curriculum on the Plan page to see lessons here.
              </p>
              <Link
                href="/dashboard/plan"
                className="inline-flex items-center gap-1.5 bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
              >
                Go to Plan 📋
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
