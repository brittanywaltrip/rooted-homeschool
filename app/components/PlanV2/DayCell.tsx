"use client";

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
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
 * When dndEnabled is true (desktop path), the cell registers as a drop
 * target. Vacation cells are disabled (can't drop at all). Weekends remain
 * droppable but render dimmer so users understand the visual warning; the
 * orchestrator's drop handler decides whether to warn-but-allow, per spec.
 *
 * Select mode adds a checkbox affordance to lessons and routes lesson taps
 * to onLessonSelectToggle. Long-press on a pill (mobile) fires
 * onLessonLongPress — used to enter select mode.
 *
 * Move-target sub-mode dims the cell's normal behavior: clicking the cell
 * calls onMoveTargetPick(dateStr) instead of onCellClick. Vacation cells
 * remain invalid targets. Weekend targets are visually warned but allowed. */

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
  isDragActive?: boolean;
  recentlyLandedIds?: Set<string>;
  dndEnabled?: boolean;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  moveTargetMode?: boolean;
  onCellClick?: (dateStr: string) => void;
  onLessonClick?: (lesson: PlanV2Lesson) => void;
  onAppointmentClick?: (appt: PlanV2Appointment) => void;
  onOverflowClick?: (dateStr: string) => void;
  onLessonLongPress?: (lesson: PlanV2Lesson) => void;
  onLessonSelectToggle?: (lesson: PlanV2Lesson) => void;
  onMoveTargetPick?: (dateStr: string) => void;
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
    isDragActive, recentlyLandedIds, dndEnabled,
    selectMode, selectedIds, moveTargetMode,
    onCellClick, onLessonClick, onAppointmentClick, onOverflowClick,
    onLessonLongPress, onLessonSelectToggle, onMoveTargetPick,
  } = props;

  const isPast = dateStr < todayStr;

  const sortedAppts = useMemo(() => sortAppointments(appointments), [appointments]);
  const totalItems = sortedAppts.length + lessons.length;
  const visibleAppts = sortedAppts.slice(0, MAX_VISIBLE_PILLS);
  const remainingLessonCap = Math.max(0, MAX_VISIBLE_PILLS - visibleAppts.length);
  const visibleLessons = lessons.slice(0, remainingLessonCap);
  const overflowCount = totalItems - visibleAppts.length - visibleLessons.length;

  // Droppable registration. Disabled when the cell is in a vacation block,
  // when select mode is on (drag is suppressed to avoid gesture conflict),
  // or when move-target mode is on (cell-click is the interaction).
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `day:${dateStr}`,
    data: { type: "day", dateStr, isVacation: !!vacation, isWeekend },
    disabled: !dndEnabled || !!vacation || !!selectMode || !!moveTargetMode,
  });

  const cellBg =
    !isCurrentMonth ? "#fbfaf7"
    : isWeekend ? "#faf8f4"
    : "#ffffff";
  const borderColor = isToday ? "#5c7f63" : "#ece8e0";

  // Visual states during a drag.
  const dragValidHint = !!isDragActive && !vacation && dndEnabled && !selectMode && !moveTargetMode;
  const dragHovered = dragValidHint && isOver;

  // Visual states during move-target mode. Valid targets glow green-dashed;
  // vacation cells are disabled and non-interactive.
  const moveTargetValid = !!moveTargetMode && !vacation;
  const moveTargetInvalid = !!moveTargetMode && !!vacation;

  let border: string;
  if (dragHovered || (moveTargetValid && !moveTargetInvalid)) {
    border = moveTargetValid && !dragHovered ? "1.5px dashed #5c7f63" : "1.5px dashed #5c7f63";
  } else if (dragValidHint) border = "1px dashed #b7d1bb";
  else if (isToday) border = `1.5px solid ${borderColor}`;
  else border = `0.5px solid ${borderColor}`;

  const backgroundImage = vacation
    ? "repeating-linear-gradient(135deg, #fff8f0 0 6px, #fef0dc 6px 12px)"
    : dragHovered
      ? "linear-gradient(180deg, #e8f0e9 0%, #d4e8d4 100%)"
      : undefined;

  // Dim other cells during move-target mode to focus attention on valid targets.
  const moveTargetOpacity = moveTargetMode
    ? moveTargetValid ? 1 : 0.4
    : isCurrentMonth ? 1 : 0.45;

  const handleCellClick = () => {
    if (moveTargetMode) {
      if (moveTargetValid) onMoveTargetPick?.(dateStr);
      return;
    }
    onCellClick?.(dateStr);
  };

  const cellCursor = moveTargetMode && !moveTargetValid ? "not-allowed" : "pointer";

  return (
    <div
      ref={setDropRef}
      role="gridcell"
      aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      onClick={handleCellClick}
      className="relative min-h-[82px] flex flex-col gap-[3px] p-1.5 transition-colors hover:bg-[#faf8f4]"
      style={{
        backgroundColor: cellBg,
        backgroundImage,
        border,
        borderRadius: 8,
        opacity: moveTargetOpacity,
        cursor: cellCursor,
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

      {/* "Drop here" preview — only when this specific cell is hovered during a drag */}
      {dragHovered ? (
        <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--g-deep)] mt-0.5">
          Drop here
        </p>
      ) : null}

      {/* Move-target mode cue */}
      {moveTargetValid && !dragHovered ? (
        <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--g-deep)] mt-0.5">
          Move here
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
                sourceDateStr={dateStr}
                missed={missed}
                justLanded={recentlyLandedIds?.has(l.id)}
                draggable={!!dndEnabled}
                selectMode={!!selectMode}
                selected={selectedIds?.has(l.id)}
                onClick={() => onLessonClick?.(l)}
                onLongPress={() => onLessonLongPress?.(l)}
                onRequestSelect={() => onLessonSelectToggle?.(l)}
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
