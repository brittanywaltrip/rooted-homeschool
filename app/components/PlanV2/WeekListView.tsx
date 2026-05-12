"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, GripVertical, X } from "lucide-react";
import { resolveChildColor } from "./colors";
import { resolveLessonSubject } from "@/lib/lesson-subject";
import type { PlanV2Appointment, PlanV2Child, PlanV2Lesson, PlanV2Vacation } from "./types";

/* WeekListView. Renders all 7 days of the current week (Mon–Sun) expanded
 * vertically. Replaces WeekStrip in week mode. Edit mode swaps a per-card
 * drag handle in; tapping it opens a bottom-sheet day picker for moving
 * the lesson to another day in the same week. Native dnd-kit drag wiring
 * elsewhere in PlanV2 is intentionally untouched and remains inert here
 * until a follow-up consolidates the two move flows. */

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  // getDay: Sun=0, Mon=1 ... Sat=6. Walk back to Monday.
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}

const DAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

type Goal = {
  id: string;
  curriculum_name: string | null;
  subject_label: string | null;
  child_id: string | null;
};

type Props = {
  weekStart: Date;
  todayStr: string;
  kids: PlanV2Child[];
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  vacationBlocks: PlanV2Vacation[];
  curriculumGoals: Goal[];
  loading: boolean;
  editMode: boolean;
  onToggleEdit: () => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  weekRangeLabel: string;
  onMoveLesson: (lessonId: string, targetDate: string) => void | Promise<void>;
  /** Tap on a lesson card in non-edit mode. Caller opens the day-detail
   *  panel for the lesson's date. */
  onLessonClick: (lesson: PlanV2Lesson) => void;
  /** Tap on an appointment card. Caller opens the day-detail panel for
   *  the appointment's instance_date. */
  onAppointmentClick: (appt: PlanV2Appointment) => void;
};

export default function WeekListView(props: Props) {
  const {
    weekStart, todayStr, kids, lessons, appointments, vacationBlocks,
    curriculumGoals, loading, editMode, onToggleEdit, onPrevWeek, onNextWeek,
    weekRangeLabel, onMoveLesson, onLessonClick, onAppointmentClick,
  } = props;

  const days = useMemo(() => {
    const start = mondayOf(weekStart);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const lessonsByDay = useMemo(() => {
    const m = new Map<string, PlanV2Lesson[]>();
    for (const l of lessons) {
      const key = l.scheduled_date ?? l.date;
      if (!key) continue;
      const arr = m.get(key) ?? [];
      arr.push(l);
      m.set(key, arr);
    }
    return m;
  }, [lessons]);

  const apptsByDay = useMemo(() => {
    const m = new Map<string, PlanV2Appointment[]>();
    for (const a of appointments) {
      const key = a.instance_date;
      if (!key) continue;
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return m;
  }, [appointments]);

  const childById = useMemo(() => {
    const m = new Map<string, { child: PlanV2Child; index: number }>();
    kids.forEach((c, i) => m.set(c.id, { child: c, index: i }));
    return m;
  }, [kids]);

  const goalById = useMemo(() => {
    const m = new Map<string, Goal>();
    for (const g of curriculumGoals) m.set(g.id, g);
    return m;
  }, [curriculumGoals]);

  const isVacationDay = (key: string): { vacation: true; name: string | null } | { vacation: false } => {
    for (const v of vacationBlocks) {
      if (key >= v.start_date && key <= v.end_date) return { vacation: true, name: v.name };
    }
    return { vacation: false };
  };

  const [moveTarget, setMoveTarget] = useState<{ lessonId: string; fromDate: string } | null>(null);

  return (
    <div className="px-4 pb-4">
      {/* Page context — one line above the week header. */}
      <p className="text-[12px] text-[#7a6f65] mb-3">
        Plan page, your week at a glance. Tap Edit to move things around.
      </p>

      {/* Header row: prev/next + range + Edit week. */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevWeek}
            aria-label="Previous week"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-[#e8e5e0] bg-white text-[#5c7f63] hover:bg-[#f0ede8] transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[14px] font-medium text-[#2D2A26] min-w-[110px] text-center">
            {weekRangeLabel}
          </span>
          <button
            type="button"
            onClick={onNextWeek}
            aria-label="Next week"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-[#e8e5e0] bg-white text-[#5c7f63] hover:bg-[#f0ede8] transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={onToggleEdit}
          aria-pressed={editMode}
          className={`text-[13px] font-semibold px-4 py-2 rounded-full transition-colors ${
            editMode
              ? "bg-[#2D5A3D] text-white hover:bg-[#244830]"
              : "bg-[#2D5A3D] text-white hover:bg-[#244830]"
          }`}
        >
          {editMode ? "Done" : "Edit week"}
        </button>
      </div>

      {/* 7-day vertical list. */}
      <div className="space-y-0">
        {days.map((day, idx) => {
          const key = ymd(day);
          const isToday = key === todayStr;
          const dayLessons = lessonsByDay.get(key) ?? [];
          const dayAppts = apptsByDay.get(key) ?? [];
          const vac = isVacationDay(key);
          const dateLabel = day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const dayHeaderColor = isToday ? "#2D5A3D" : "#7a6f65";

          return (
            <div
              key={key}
              className={`py-3 ${idx > 0 ? "border-t border-[#f0ede8]" : ""}`}
            >
              {/* Day header */}
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-[12px] font-bold uppercase tracking-wider"
                  style={{ color: dayHeaderColor }}
                >
                  {DAY_NAMES[idx]}
                </span>
                <span
                  className="text-[12px] font-medium"
                  style={{ color: dayHeaderColor }}
                >
                  {dateLabel}
                </span>
              </div>

              {/* Vacation note */}
              {vac.vacation ? (
                <p className="text-[12px] text-[#7a5000] italic mb-1">
                  🌴 {vac.name ?? "Break"}
                </p>
              ) : null}

              {/* Lesson + appointment cards or empty state */}
              {!loading && dayLessons.length === 0 && dayAppts.length === 0 ? (
                <p className="text-[12px] text-[#9a8f86] italic">Nothing scheduled</p>
              ) : (
                <div className="space-y-2">
                  {dayLessons.map((l) => {
                    const childCtx = l.child_id ? childById.get(l.child_id) : undefined;
                    const color = resolveChildColor(childCtx?.child ?? null, childCtx?.index ?? 0);
                    const goal = l.curriculum_goal_id ? goalById.get(l.curriculum_goal_id) : undefined;
                    const subject =
                      resolveLessonSubject(l.subjects?.name, goal?.subject_label ?? null) ??
                      goal?.curriculum_name ??
                      "Lesson";
                    const lessonNum = l.lesson_number;
                    const titleText = lessonNum != null ? `${subject} · L${lessonNum}` : subject;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          if (editMode) {
                            setMoveTarget({ lessonId: l.id, fromDate: key });
                          } else {
                            onLessonClick(l);
                          }
                        }}
                        aria-label={
                          editMode
                            ? `Move ${titleText} to a different day`
                            : `Open ${titleText} details`
                        }
                        className={`relative w-full text-left rounded-xl overflow-hidden transition-transform active:scale-[0.99] ${l.completed ? "opacity-60" : ""}`}
                        style={{ background: "#1f2a26" }}
                      >
                        <div
                          aria-hidden="true"
                          className="absolute left-0 top-0 bottom-0 w-1.5"
                          style={{ background: color }}
                        />
                        <div className="flex items-center gap-3 pl-4 pr-3 py-3">
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-[14px] font-semibold truncate ${l.completed ? "line-through" : ""}`}
                              style={{ color: "#f5efe6" }}
                            >
                              {titleText}
                            </p>
                            <p className="text-[11px] mt-0.5" style={{ color: "#a8a094" }}>
                              {subject}
                            </p>
                          </div>
                          {editMode ? (
                            <span
                              aria-hidden="true"
                              className="flex items-center justify-center w-9 h-9 rounded-lg text-[#a8a094]"
                            >
                              <GripVertical size={18} />
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}

                  {/* Appointments — same dark card shell, purple accent. */}
                  {dayAppts.map((a) => (
                    <button
                      key={`${a.id}-${a.instance_date}`}
                      type="button"
                      onClick={() => onAppointmentClick(a)}
                      aria-label={`Open ${a.title} details`}
                      className={`relative w-full text-left rounded-xl overflow-hidden transition-transform active:scale-[0.99] ${a.completed ? "opacity-60" : ""}`}
                      style={{ background: "#1f2a26" }}
                    >
                      <div
                        aria-hidden="true"
                        className="absolute left-0 top-0 bottom-0 w-1.5"
                        style={{ background: "#a78bfa" }}
                      />
                      <div className="flex items-center gap-3 pl-4 pr-3 py-3">
                        <span className="text-base">{a.emoji ?? "📅"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold truncate" style={{ color: "#f5efe6" }}>
                            {a.title}
                          </p>
                          <p className="text-[11px] mt-0.5" style={{ color: "#a8a094" }}>
                            {a.time
                              ? (() => {
                                  const [h, m] = a.time.split(":").map(Number);
                                  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
                                })()
                              : "All day"}
                            {a.location ? ` · 📍 ${a.location}` : ""}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Move bottom sheet */}
      {moveTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setMoveTarget(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-t-2xl p-5 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Move to which day?"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[14px] font-semibold text-[#2D2A26]">Move to which day?</p>
              <button
                type="button"
                onClick={() => setMoveTarget(null)}
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center rounded-full text-[#7a6f65] hover:bg-[#f0ede8]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-1.5">
              {days.map((d, idx) => {
                const key = ymd(d);
                const isFrom = key === moveTarget.fromDate;
                const label = `${DAY_NAMES[idx][0] + DAY_NAMES[idx].slice(1).toLowerCase()}, ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isFrom}
                    onClick={() => {
                      void onMoveLesson(moveTarget.lessonId, key);
                      setMoveTarget(null);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-xl text-[14px] transition-colors ${
                      isFrom
                        ? "bg-[#f0ede8] text-[#9a8f86] cursor-not-allowed"
                        : "bg-[#faf8f4] text-[#2D2A26] hover:bg-[#e8f0e9]"
                    }`}
                  >
                    {label}
                    {isFrom ? <span className="text-[11px] text-[#9a8f86] ml-2">(current)</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
