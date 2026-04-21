"use client";

import { useMemo } from "react";
import LessonPill from "./LessonPill";
import AppointmentPill from "./AppointmentPill";
import type {
  PlanV2Appointment,
  PlanV2Child,
  PlanV2Lesson,
  PlanV2Vacation,
} from "./types";

/* A single day in the MonthGrid. Pure props — no data fetching or state
 * beyond click handling. Parent owns filtering and selection state.
 *
 * Pills render order: all appointments first (sorted by time), then lessons.
 * Visible pill cap = 4; the rest collapse into a "+ N more" affordance that
 * opens the DayDetailPanel for the same date (wired by parent in Phase 4). */

const MAX_VISIBLE_PILLS = 4;

interface Props {
  date: Date;
  dateStr: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  vacation: PlanV2Vacation | null;
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  childrenById: Map<string, { child: PlanV2Child; index: number }>;
  todayStr: string;
  onCellClick?: (dateStr: string) => void;
  onLessonClick?: (lesson: PlanV2Lesson) => void;
  onAppointmentClick?: (appt: PlanV2Appointment) => void;
  onOverflowClick?: (dateStr: string) => void;
}

function sortAppointments(appts: PlanV2Appointment[]): PlanV2Appointment[] {
  return [...appts].sort((a, b) => {
    if (a.time === null && b.time !== null) return -1;
    if (a.time !== null && b.time === null) return 1;
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return 0;
  });
}

export default function DayCell(props: Props) {
  const {
    date, dateStr, isCurrentMonth, isToday, isWeekend, vacation,
    lessons, appointments, childrenById, todayStr,
    onCellClick, onLessonClick, onAppointmentClick, onOverflowClick,
  } = props;

  const isPast = dateStr < todayStr;

  const sortedAppts = useMemo(() => sortAppointments(appointments), [appointments]);
  const totalItems = sortedAppts.length + lessons.length;
  const visibleAppts = sortedAppts.slice(0, MAX_VISIBLE_PILLS);
  const remainingLessonCap = Math.max(0, MAX_VISIBLE_PILLS - visibleAppts.length);
  const visibleLessons = lessons.slice(0, remainingLessonCap);
  const overflowCount = totalItems - visibleAppts.length - visibleLessons.length;

  const cellBg =
    !isCurrentMonth ? "#fbfaf7"
    : isWeekend ? "#faf8f4"
    : "#ffffff";
  const borderColor = isToday ? "#5c7f63" : "#ece8e0";

  return (
    <div
      role="gridcell"
      aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      onClick={() => onCellClick?.(dateStr)}
      className="relative min-h-[82px] flex flex-col gap-[3px] p-1.5 transition-colors hover:bg-[#faf8f4] cursor-pointer"
      style={{
        backgroundColor: cellBg,
        border: isToday ? `1.5px solid ${borderColor}` : `0.5px solid ${borderColor}`,
        borderRadius: 8,
        opacity: isCurrentMonth ? 1 : 0.45,
        backgroundImage: vacation
          ? "repeating-linear-gradient(135deg, #fff8f0 0 6px, #fef0dc 6px 12px)"
          : undefined,
      }}
    >
      {/* Header row: day number + count */}
      <div className="flex items-center justify-between shrink-0">
        <span
          className="inline-flex items-center justify-center text-[11px] font-semibold leading-none"
          style={{
            color: isToday ? "#ffffff" : isCurrentMonth ? "#2d2926" : "#b5aca4",
            backgroundColor: isToday ? "#5c7f63" : "transparent",
            borderRadius: 999,
            width: isToday ? 18 : undefined,
            height: isToday ? 18 : undefined,
            padding: isToday ? 0 : "0 2px",
          }}
        >
          {date.getDate()}
        </span>
        {totalItems > 0 && !vacation ? (
          <span
            className="text-[9px] font-semibold text-[#7a6f65] leading-none"
            aria-hidden
          >
            {totalItems}
          </span>
        ) : null}
      </div>

      {/* Vacation label */}
      {vacation ? (
        <p className="text-[9px] font-semibold truncate" style={{ color: "#a07000" }}>
          🌴 {vacation.name}
        </p>
      ) : null}

      {/* Pills */}
      {!vacation ? (
        <div className="flex flex-col gap-[3px] min-w-0">
          {visibleAppts.map((a) => (
            <AppointmentPill
              key={`a-${a.id}-${a.instance_date}`}
              appt={a}
              onClick={() => onAppointmentClick?.(a)}
            />
          ))}
          {visibleLessons.map((l) => {
            const meta = l.child_id ? childrenById.get(l.child_id) : undefined;
            const missed = isPast && !l.completed;
            return (
              <LessonPill
                key={`l-${l.id}`}
                lesson={l}
                child={meta?.child}
                childOrderedIndex={meta?.index ?? 0}
                missed={missed}
                onClick={() => onLessonClick?.(l)}
              />
            );
          })}
          {overflowCount > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOverflowClick?.(dateStr);
              }}
              className="text-[9px] font-semibold text-[#5c7f63] hover:text-[#2D5A3D] text-left px-1"
            >
              + {overflowCount} more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
