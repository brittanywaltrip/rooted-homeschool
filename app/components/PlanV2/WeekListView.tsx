"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Calendar, GripVertical, MoreVertical, Move, Pencil, Plus, X } from "lucide-react";
import { resolveChildColor } from "./colors";
import { resolveLessonSubject } from "@/lib/lesson-subject";
import { tintFromHex, darkenHex } from "@/lib/color-tint";
import type { PlanV2Activity, PlanV2Appointment, PlanV2Child, PlanV2Lesson, PlanV2Vacation } from "./types";
import { buildActivitiesByDate } from "./activityOccurrences";

/* WeekListView. Renders all 7 days of the current week (Mon..Sun) expanded
 * vertically. Card visual style matches V1 (light child-color tint, full
 * lesson title, inline action buttons). Edit-week mode swaps the card click
 * to the day-picker bottom sheet for moving a lesson. Native dnd-kit drag
 * wiring elsewhere in PlanV2 is intentionally untouched and remains inert
 * inside this component until a follow-up consolidates the two move flows. */

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

const DAY_NAMES_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Goal = {
  id: string;
  curriculum_name: string | null;
  subject_label: string | null;
  child_id: string | null;
  icon_emoji: string | null;
};

type Props = {
  weekStart: Date;
  todayStr: string;
  kids: PlanV2Child[];
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  activities: PlanV2Activity[];
  vacationBlocks: PlanV2Vacation[];
  curriculumGoals: Goal[];
  loading: boolean;
  isPartner: boolean;
  /** Edit-week toggle is owned by the V2 toolbar; this component just
   *  reads it to switch card behavior between tap-to-open and tap-to-move. */
  editMode: boolean;
  onMoveLesson: (lessonId: string, targetDate: string) => void | Promise<void>;
  /** Tap a lesson card in non-edit mode. Caller opens DayDetailPanel. */
  onLessonClick: (lesson: PlanV2Lesson) => void;
  /** Tap an appointment card. Caller opens DayDetailPanel. */
  onAppointmentClick: (appt: PlanV2Appointment) => void;
  /** Tap an activity card. Caller opens the day detail for that date.
   *  Optional so legacy callers stay working. */
  onActivityClick?: (activity: PlanV2Activity, dateStr: string) => void;
  /** Inline action wiring (V2 equivalents of V1's per-card actions). */
  onSkipLesson: (lesson: PlanV2Lesson) => void;
  onRescheduleLesson: (lesson: PlanV2Lesson) => void;
  onEditLesson: (lesson: PlanV2Lesson) => void;
  onToggleLessonDone: (lesson: PlanV2Lesson) => void;
  /** "+ Add lesson" link below the day section. */
  onAddLessonForDay: (dateStr: string) => void;
  /** "Mark as break →" header link. */
  onMarkBreakForDay: (dateStr: string) => void;
  /** Per-day "+" button in the day header — opens the unified add sheet
   *  pre-filled with that date. Optional so legacy callers stay working. */
  onDayAdd?: (dateStr: string) => void;
  /** Per-appointment overflow menu — Edit opens the existing appointment
   *  edit form; Delete fires after the parent confirms. Optional. */
  onEditAppointment?: (appt: PlanV2Appointment) => void;
  onDeleteAppointment?: (appt: PlanV2Appointment) => void;
  /** "Move to another day" on the appointment kebab. Opens the shared date
   *  picker seeded with the appointment's current date. Non-recurring only
   *  (the item is hidden for recurring series). Optional. */
  onMoveAppointment?: (appt: PlanV2Appointment) => void;
};

export default function WeekListView(props: Props) {
  const {
    weekStart, todayStr, kids, lessons, appointments, activities, vacationBlocks,
    curriculumGoals, loading, isPartner, editMode,
    onMoveLesson, onLessonClick, onAppointmentClick, onActivityClick,
    onSkipLesson, onRescheduleLesson, onEditLesson, onToggleLessonDone,
    onAddLessonForDay, onMarkBreakForDay, onDayAdd,
    onEditAppointment, onDeleteAppointment, onMoveAppointment,
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
    // Sort within each day so rows render in queue order regardless of the
    // upstream fetch sequence. Primary: lesson_number ASC. Nulls (extra /
    // one-off lessons logged via the unified "+") sort to the end of the
    // day so they don't break the numerical run. Secondary tiebreakers:
    // curriculum_goal_id, then title — deterministic ordering when two
    // subjects share a day or when lesson_numbers tie.
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const an = a.lesson_number;
        const bn = b.lesson_number;
        if (an == null && bn != null) return 1;
        if (an != null && bn == null) return -1;
        if (an != null && bn != null && an !== bn) return an - bn;
        const ag = a.curriculum_goal_id ?? "";
        const bg = b.curriculum_goal_id ?? "";
        if (ag !== bg) return ag.localeCompare(bg);
        const at = a.title ?? "";
        const bt = b.title ?? "";
        return at.localeCompare(bt);
      });
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

  const activitiesByDay = useMemo(
    () => buildActivitiesByDate(activities, days),
    [activities, days],
  );

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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [apptMenuOpenId, setApptMenuOpenId] = useState<string | null>(null);

  // Escape cancels move mode so users have a panic exit alongside the
  // banner's Cancel button. Body scroll is intentionally not locked; the
  // user needs to scroll to reach off-screen days to drop into.
  useEffect(() => {
    if (!moveTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoveTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveTarget]);

  const movingLesson = useMemo(() => {
    if (!moveTarget) return null;
    const l = lessons.find((x) => x.id === moveTarget.lessonId);
    if (!l) return null;
    const goal = l.curriculum_goal_id ? goalById.get(l.curriculum_goal_id) : undefined;
    const title =
      l.title && l.title.trim().length > 0
        ? l.title
        : goal?.curriculum_name ?? "Lesson";
    return { id: l.id, title };
  }, [moveTarget, lessons, goalById]);

  return (
    <div className="w-full max-w-full overflow-hidden px-4 pb-4">
      {/* Week navigation lives in the V2 toolbar above; no inner nav row here. */}

      {moveTarget && movingLesson ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#5c7f63] bg-[#eaf2ec] px-4 py-3"
        >
          <p className="text-[13px] text-[#2D5A3D] min-w-0 truncate">
            <span className="font-medium">Moving</span>{" "}
            <span className="truncate">{movingLesson.title}</span>. Tap a day to drop it.
          </p>
          <button
            type="button"
            onClick={() => setMoveTarget(null)}
            className="shrink-0 text-[13px] font-medium text-[#2D5A3D] hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {/* 7 day sections wrapped in a single outer card so the week reads
          as one cohesive schedule block. Internal dividers separate days. */}
      <div className="rounded-2xl border border-[#e8e5e0] bg-white shadow-sm overflow-hidden">
        {days.map((day, idx) => {
          const key = ymd(day);
          const isToday = key === todayStr;
          const dayLessons = lessonsByDay.get(key) ?? [];
          const dayAppts = apptsByDay.get(key) ?? [];
          const dayActivities = activitiesByDay.get(key) ?? [];
          const vac = isVacationDay(key);
          const headerColor = isToday ? "#2D5A3D" : "#8B7E74";
          const shortName = DAY_NAMES_FULL[idx].slice(0, 3);
          const dateNum = day.getDate();
          const headerLabel = isToday
            ? `${shortName} ${dateNum} · TODAY`
            : `${shortName} ${dateNum}`;

          // Soft warm tint on empty non-vacation days so they read as
          // intentional whitespace rather than a missing block. Today wins
          // over the warm empty-day tint so an idle today still reads as
          // "this is now", not "nothing here."
          const isEmptyDay = !loading && dayLessons.length === 0 && dayAppts.length === 0 && dayActivities.length === 0 && !vac.vacation;
          const sectionBgClass = isToday
            ? "bg-[#f0f7f2]"
            : isEmptyDay
              ? "bg-[#faf7f2]"
              : "";
          return (
            <Fragment key={key}>
              {idx > 0 ? <div className="border-t border-[#e8e5e0]" /> : null}
              <div className={`px-4 py-3 ${sectionBgClass}`}>
              {/* Day header. Today's date number gets a bold + underlined
                  treatment in --g-brand to match the DateCircle ring the
                  Month view paints around today. The full header color
                  already flips green for today (headerColor above); the
                  underline + bold anchors the eye to the date glyph. */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <p
                  className="text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: headerColor }}
                >
                  {shortName}{" "}
                  {isToday ? (
                    <span
                      className="font-bold border-b-2 border-[#2D5A3D] pb-px"
                    >
                      {dateNum}
                    </span>
                  ) : (
                    <span>{dateNum}</span>
                  )}
                  {isToday ? " · TODAY" : ""}
                </p>
                {!isPartner && onDayAdd ? (
                  <button
                    type="button"
                    onClick={() => onDayAdd(key)}
                    aria-label={`Add to ${headerLabel}`}
                    className="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
                    style={{
                      border: "1px solid #5c7f63",
                      backgroundColor: "#eaf2ec",
                      color: "#2D5A3D",
                    }}
                  >
                    <Plus size={12} strokeWidth={2.5} />
                  </button>
                ) : null}
              </div>

              {vac.vacation ? (
                <p className="text-[12px] text-[#7a5000] italic mb-2 pl-1">🌴 {vac.name ?? "Break"}</p>
              ) : null}

              {/* Lessons + appointments, or vacation marker. Non-vacation
                  empty days render no content (the warm bg above makes
                  the day section visually intentional). */}
              {!loading && dayLessons.length === 0 && dayAppts.length === 0 && dayActivities.length === 0 ? (
                vac.vacation ? (
                  <div className="rounded-xl text-center" style={{ background: "#F8F7F4", border: "1px solid #e5e0d8", padding: 18 }}>
                    <p className="text-sm text-[#7a5000]">🌴 {vac.name ?? "Break"}, enjoy the time off!</p>
                  </div>
                ) : null
              ) : (
                <div className="space-y-2">
                  {dayLessons.map((l) => {
                    const childCtx = l.child_id ? childById.get(l.child_id) : undefined;
                    const kidColor = resolveChildColor(childCtx?.child ?? null, childCtx?.index ?? 0);
                    const goal = l.curriculum_goal_id ? goalById.get(l.curriculum_goal_id) : undefined;
                    const subject =
                      resolveLessonSubject(l.subjects?.name, goal?.subject_label ?? null) ??
                      goal?.curriculum_name ??
                      "Lesson";
                    const childName = childCtx?.child.name ?? null;
                    const titleText = l.title && l.title.trim().length > 0
                      ? l.title
                      : goal?.curriculum_name ?? "Lesson";
                    const kidBg = tintFromHex(kidColor, 0.25);
                    const kidTitle = darkenHex(kidColor, 0.45);
                    const kidSubtle = darkenHex(kidColor, 0.30);
                    const kidPillBg = tintFromHex(kidColor, 0.35);
                    const kidPillText = darkenHex(kidColor, 0.55);
                    const icon = goal?.icon_emoji ?? "📚";

                    const isBeingMoved = moveTarget?.lessonId === l.id;
                    const editStyleExtras = editMode
                      ? "ring-2 ring-dashed ring-[#5c7f63]/60 ring-offset-2 ring-offset-white shadow-md"
                      : isBeingMoved
                        ? "ring-2 ring-dashed ring-[#5c7f63] ring-offset-2 ring-offset-white opacity-50"
                        : "";

                    const subtitleText = subject
                      ? `${subject}${childName ? ` · ${childName}` : ""}`
                      : null;

                    return (
                      <div
                        key={l.id}
                        className={`rounded-xl ${l.completed ? "opacity-60" : ""} ${editStyleExtras}`}
                        style={{ background: kidBg }}
                      >
                        {/* Header row: checkbox + tap-to-open + overflow menu.
                            Future-dated rows ungatekeep retroactive flips: the
                            checkbox is disabled and grayed so the user can see
                            lessons are coming without being able to tap them. */}
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          {(() => {
                            const isCheckable = key <= todayStr;
                            return (
                          <button
                            type="button"
                            disabled={!isCheckable}
                            onClick={() => { if (isCheckable) onToggleLessonDone(l); }}
                            aria-label={
                              !isCheckable
                                ? `${titleText} is scheduled for a future day`
                                : l.completed
                                  ? `Mark ${titleText} not done`
                                  : `Mark ${titleText} complete`
                            }
                            className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                              !isCheckable ? "opacity-40 cursor-not-allowed" : ""
                            }`}
                            style={{
                              borderColor: l.completed ? kidTitle : "#c8bfb5",
                              backgroundColor: l.completed ? kidTitle : "transparent",
                            }}
                          >
                            {l.completed ? (
                              <svg viewBox="0 0 8 7" width="8" height="7" fill="none" aria-hidden>
                                <path d="M1 3.5l1.8 2L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : null}
                          </button>
                            );
                          })()}
                          <button
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
                            className="flex-1 min-w-0 text-left flex items-center gap-2.5"
                          >
                            <span className="text-xl shrink-0">{icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-[14px] font-medium break-words ${l.completed ? "line-through" : ""}`}
                                  style={{ color: l.completed ? "#b5aca4" : kidTitle }}
                                >
                                  {titleText}
                                </span>
                                {l.completed ? (
                                  <span
                                    className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{ background: kidTitle, color: "white" }}
                                  >
                                    ✓ Done
                                  </span>
                                ) : key < todayStr ? (
                                  <span
                                    className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{ background: "#fef3e3", color: "#8b6f47" }}
                                  >
                                    Overdue
                                  </span>
                                ) : key === todayStr ? (
                                  <span
                                    className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{ background: "#e8f0e9", color: "#2D5A3D" }}
                                  >
                                    Today
                                  </span>
                                ) : null}
                              </div>
                              {subtitleText ? (
                                <p className="text-xs mt-0.5" style={{ color: kidSubtle }}>
                                  {subtitleText}
                                </p>
                              ) : null}
                            </div>
                          </button>
                          {editMode ? (
                            <span
                              aria-hidden="true"
                              className="flex items-center justify-center w-8 h-8 rounded-lg text-[#5c7f63] shrink-0"
                            >
                              <GripVertical size={18} />
                            </span>
                          ) : !isPartner ? (
                            <div className="relative shrink-0">
                              <button
                                type="button"
                                onClick={() => setMenuOpenId((id) => (id === l.id ? null : l.id))}
                                aria-label={`More actions for ${titleText}`}
                                aria-haspopup="menu"
                                aria-expanded={menuOpenId === l.id}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
                                style={{ color: kidTitle }}
                              >
                                <MoreVertical size={18} />
                              </button>
                              {menuOpenId === l.id ? (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setMenuOpenId(null)}
                                    aria-hidden
                                  />
                                  <div
                                    role="menu"
                                    className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-[#e8e2d9] overflow-hidden min-w-[150px]"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setMenuOpenId(null);
                                        setMoveTarget({ lessonId: l.id, fromDate: key });
                                      }}
                                      className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                                    >
                                      <Move size={14} className="text-[#5c7f63]" /> Move
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setMenuOpenId(null); onSkipLesson(l); }}
                                      className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                                    >
                                      <X size={14} className="text-[#8a8580]" /> Skip
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setMenuOpenId(null); onRescheduleLesson(l); }}
                                      className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                                    >
                                      <Calendar size={14} className="text-[#5c7f63]" /> Reschedule
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setMenuOpenId(null); onEditLesson(l); }}
                                      className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                                    >
                                      <Pencil size={14} className="text-[#5c7f63]" /> Edit
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {/* Notes preview (kept) */}
                        {l.notes ? (
                          <p className="px-4 pb-1 text-[11px] text-[#6b6560] italic line-clamp-1">{l.notes}</p>
                        ) : null}

                        {/* Visible action row — Add a note + Mark not done. Skip
                            / Reschedule / Edit moved to the overflow menu above. */}
                        {!isPartner && !editMode ? (
                          <div className="px-4 pb-2.5">
                            <div className="flex items-center gap-x-1 gap-y-1 flex-wrap">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onLessonClick(l); }}
                                aria-label={l.notes ? "Edit note" : "Add a note"}
                                className="inline-flex items-center whitespace-nowrap min-h-[40px] -ml-1 px-2 text-[13px] font-medium hover:text-[var(--g-deep)] transition-colors"
                                style={{ color: l.notes ? "#2D5A3D" : "#5c7f63" }}
                              >
                                <Pencil size={14} className="mr-1.5" />
                                {l.notes ? "Edit note" : "+ Add a note"}
                              </button>
                              {l.completed ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onToggleLessonDone(l); }}
                                  aria-label="Mark not done"
                                  className="flex items-center gap-1 whitespace-nowrap min-h-[40px] px-2 text-[13px] text-[#8a8580] font-medium hover:text-[#2d2926] transition-colors"
                                >
                                  <X size={14} /> Mark not done
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {/* Appointments rendered after lessons, before the move
                      drop zone (which sits at the bottom of the day's stack). */}
                  {dayAppts.map((a) => (
                    <div
                      key={`${a.id}-${a.instance_date}`}
                      className={`rounded-xl ${a.completed ? "opacity-50" : ""}`}
                      style={{ background: "linear-gradient(to bottom right, #f5f0ff, #ede5ff)", border: "1px solid #e8deff" }}
                    >
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => onAppointmentClick(a)}
                          aria-label={`Open ${a.title} details`}
                          className="flex-1 min-w-0 text-left flex items-center gap-3"
                        >
                          <span className="text-xl shrink-0">{a.emoji ?? "📅"}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-[14px] font-medium break-words ${a.completed ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                                {a.title}
                              </span>
                              <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 bg-[#ede9fe] text-[#6d28d9]">
                                Appt
                              </span>
                            </div>
                            <p className="text-xs text-[#7a6f65] mt-0.5">
                              {a.time
                                ? (() => {
                                    const [h, m] = a.time.split(":").map(Number);
                                    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
                                  })()
                                : "All day"}
                              {a.location ? ` · 📍 ${a.location}` : ""}
                            </p>
                          </div>
                        </button>
                        {!isPartner && (onEditAppointment || onDeleteAppointment || (onMoveAppointment && !a.is_recurring)) ? (
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => setApptMenuOpenId((id) => (id === a.id ? null : a.id))}
                              aria-label={`More actions for ${a.title}`}
                              aria-haspopup="menu"
                              aria-expanded={apptMenuOpenId === a.id}
                              className="w-8 h-8 flex items-center justify-center rounded-full text-[#6d28d9] hover:bg-black/5 transition-colors"
                            >
                              <MoreVertical size={18} />
                            </button>
                            {apptMenuOpenId === a.id ? (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setApptMenuOpenId(null)}
                                  aria-hidden
                                />
                                <div
                                  role="menu"
                                  className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-[#e8e2d9] overflow-hidden min-w-[170px]"
                                >
                                  {/* Recurring series can't move a single
                                      occurrence (the appointment move writes the
                                      canonical date); hide the item for them. */}
                                  {onMoveAppointment && !a.is_recurring ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setApptMenuOpenId(null); onMoveAppointment(a); }}
                                      className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                                    >
                                      <Move size={14} className="text-[#5c7f63]" /> Move to another day
                                    </button>
                                  ) : null}
                                  {onEditAppointment ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setApptMenuOpenId(null); onEditAppointment(a); }}
                                      className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                                    >
                                      <Pencil size={14} className="text-[#5c7f63]" /> Edit
                                    </button>
                                  ) : null}
                                  {onDeleteAppointment ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setApptMenuOpenId(null); onDeleteAppointment(a); }}
                                      className="w-full px-3 py-2 text-left text-[13px] text-[#b91c1c] hover:bg-[#fef2f2] flex items-center gap-2"
                                    >
                                      <X size={14} /> {a.is_recurring ? "Stop" : "Delete"}
                                    </button>
                                  ) : null}
                                </div>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  {/* Activities rendered after appointments. Recurring,
                      no completion state, so no checkbox — tap opens the
                      day detail. Green-tinted to match the Month-view pill. */}
                  {dayActivities.map((act) => (
                    <div
                      key={act.id}
                      className="rounded-xl"
                      style={{ background: "#f0f4f1", border: "1px solid #c8d9cb" }}
                    >
                      <button
                        type="button"
                        onClick={() => onActivityClick?.(act, key)}
                        aria-label={`Open ${act.name} details`}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5"
                      >
                        <span className="text-xl shrink-0">{act.emoji ?? "📝"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-medium break-words text-[#2d2926]">
                              {act.name}
                            </span>
                            <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 bg-[#e2ece4] text-[#3d5c42]">
                              Activity
                            </span>
                          </div>
                          {act.location ? (
                            <p className="text-xs text-[#7a6f65] mt-0.5">📍 {act.location}</p>
                          ) : null}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Inline drop zone for move mode. Non-source days show a
                  tappable "Move here" target; the source day shows a quiet
                  "Original day" hint so the user can see where the lesson
                  started. Vacation days are eligible targets. The move
                  handler upstream already shows a "(weekend)" suffix in
                  the confirmation toast when needed. */}
              {moveTarget ? (
                key === moveTarget.fromDate ? (
                  <p className="mt-2 text-center text-[11px] italic text-[#7a6f65]">
                    Original day
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void onMoveLesson(moveTarget.lessonId, key);
                      setMoveTarget(null);
                    }}
                    aria-label={`Move to ${headerLabel}`}
                    className="mt-2 w-full rounded-xl border-2 border-dashed border-[#5c7f63] bg-[#eaf2ec]/50 px-4 py-3 text-[13px] font-medium text-[#2D5A3D] hover:bg-[#eaf2ec] transition-colors"
                  >
                    Move here
                  </button>
                )
              ) : null}

              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
