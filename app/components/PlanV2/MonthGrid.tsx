"use client";

import { useMemo } from "react";
import DayCell, { CELL_ID_PREFIX } from "./DayCell";
import { computeGridRange } from "./usePlanV2Data";
import type {
  PlanV2Appointment,
  PlanV2Child,
  PlanV2Lesson,
  PlanV2Vacation,
} from "./types";

/* 42-cell month grid. Owns layout, per-cell bucket precomputation, and
 * keyboard navigation. DayCell stays pure. */

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function vacationFor(dateStr: string, blocks: PlanV2Vacation[]): PlanV2Vacation | null {
  return blocks.find((b) => dateStr >= b.start_date && dateStr <= b.end_date) ?? null;
}

const HEADERS = ["S", "M", "T", "W", "T", "F", "S"] as const;

interface Props {
  monthStart: Date;
  todayStr: string;
  kids: PlanV2Child[];
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  vacationBlocks: PlanV2Vacation[];
  loading: boolean;
  dndEnabled?: boolean;
  isDragActive?: boolean;
  recentlyLandedIds?: Set<string>;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  moveTargetMode?: boolean;
  /** Currently focused cell for keyboard nav ("YYYY-MM-DD"). */
  focusedDateStr?: string | null;
  onFocusedDateChange?: (dateStr: string) => void;
  onCellClick?: (dateStr: string) => void;
  onLessonClick?: (lesson: PlanV2Lesson) => void;
  onAppointmentClick?: (appt: PlanV2Appointment) => void;
  onOverflowClick?: (dateStr: string) => void;
  onLessonLongPress?: (lesson: PlanV2Lesson) => void;
  onLessonSelectToggle?: (lesson: PlanV2Lesson) => void;
  onMoveTargetPick?: (dateStr: string) => void;
  onCellContextMenu?: (dateStr: string, x: number, y: number) => void;
}

function SkeletonCell() {
  return (
    <div
      className="min-h-[82px] rounded-lg animate-pulse"
      style={{ backgroundColor: "#f4f0e8", border: "0.5px solid #ece8e0" }}
    />
  );
}

export default function MonthGrid(props: Props) {
  const {
    monthStart, todayStr, kids, lessons, appointments, vacationBlocks,
    loading, dndEnabled, isDragActive, recentlyLandedIds,
    selectMode, selectedIds, moveTargetMode,
    focusedDateStr, onFocusedDateChange,
    onCellClick, onLessonClick, onAppointmentClick, onOverflowClick,
    onLessonLongPress, onLessonSelectToggle, onMoveTargetPick,
    onCellContextMenu,
  } = props;

  const { cells } = useMemo(() => computeGridRange(monthStart), [monthStart]);
  const monthIndex = monthStart.getMonth();

  const childrenById = useMemo(() => {
    const map = new Map<string, { child: PlanV2Child; index: number }>();
    kids.forEach((c, i) => map.set(c.id, { child: c, index: i }));
    return map;
  }, [kids]);

  const { lessonsByDate, apptsByDate } = useMemo(() => {
    const lMap = new Map<string, PlanV2Lesson[]>();
    for (const l of lessons) {
      const d = l.scheduled_date ?? l.date;
      if (!d) continue;
      const list = lMap.get(d) ?? [];
      list.push(l);
      lMap.set(d, list);
    }
    const aMap = new Map<string, PlanV2Appointment[]>();
    for (const a of appointments) {
      const list = aMap.get(a.instance_date) ?? [];
      list.push(a);
      aMap.set(a.instance_date, list);
    }
    return { lessonsByDate: lMap, apptsByDate: aMap };
  }, [lessons, appointments]);

  // Clamp the focused cell to the 42-cell window. The orchestrator may set
  // a focusedDateStr that falls outside (e.g. in the previous month) after
  // month nav — we fall back to the first same-month cell in that case.
  const visibleDateStrs = useMemo(() => cells.map(toDateStr), [cells]);
  const effectiveFocusedDateStr = useMemo(() => {
    if (focusedDateStr && visibleDateStrs.includes(focusedDateStr)) return focusedDateStr;
    // Fallback: today if visible, else first day of the current month.
    if (visibleDateStrs.includes(todayStr)) return todayStr;
    const firstCurrent = visibleDateStrs.find((s) => {
      const d = parseDateStr(s);
      return d.getMonth() === monthIndex;
    });
    return firstCurrent ?? visibleDateStrs[0] ?? null;
  }, [focusedDateStr, visibleDateStrs, todayStr, monthIndex]);

  function moveFocus(deltaDays: number) {
    if (!effectiveFocusedDateStr) return;
    const base = parseDateStr(effectiveFocusedDateStr);
    base.setDate(base.getDate() + deltaDays);
    const next = toDateStr(base);
    // Only move within the visible window. Beyond-edge = no-op (prev/next
    // month are reachable via the toolbar arrows; avoids surprise jumps).
    if (visibleDateStrs.includes(next)) onFocusedDateChange?.(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Allow unmodified arrow/Enter/Space/Home/End only — don't intercept
    // browser shortcuts or screen reader pass-throughs.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault(); moveFocus(-1); break;
      case "ArrowRight":
        e.preventDefault(); moveFocus(1); break;
      case "ArrowUp":
        e.preventDefault(); moveFocus(-7); break;
      case "ArrowDown":
        e.preventDefault(); moveFocus(7); break;
      case "Home":
        e.preventDefault();
        if (effectiveFocusedDateStr) {
          const base = parseDateStr(effectiveFocusedDateStr);
          const idx = base.getDay();
          base.setDate(base.getDate() - idx);
          const next = toDateStr(base);
          if (visibleDateStrs.includes(next)) onFocusedDateChange?.(next);
        }
        break;
      case "End":
        e.preventDefault();
        if (effectiveFocusedDateStr) {
          const base = parseDateStr(effectiveFocusedDateStr);
          const idx = base.getDay();
          base.setDate(base.getDate() + (6 - idx));
          const next = toDateStr(base);
          if (visibleDateStrs.includes(next)) onFocusedDateChange?.(next);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (effectiveFocusedDateStr) onCellClick?.(effectiveFocusedDateStr);
        break;
    }
  }

  return (
    <div
      role="grid"
      aria-label="Month calendar"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-activedescendant={
        effectiveFocusedDateStr ? `${CELL_ID_PREFIX}${effectiveFocusedDateStr}` : undefined
      }
      className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2D5A3D] focus-visible:ring-offset-2 rounded-lg"
    >
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 pb-1.5">
        {HEADERS.map((h, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "#8B7E74" }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7 gap-1">
        {loading
          ? Array.from({ length: 42 }).map((_, i) => <SkeletonCell key={i} />)
          : cells.map((d) => {
              const dateStr = toDateStr(d);
              const isCurrentMonth = d.getMonth() === monthIndex;
              const isToday = dateStr === todayStr;
              const nativeDow = d.getDay();
              const isWeekend = nativeDow === 0 || nativeDow === 6;
              const vac = vacationFor(dateStr, vacationBlocks);
              return (
                <DayCell
                  key={dateStr}
                  date={d}
                  dateStr={dateStr}
                  isCurrentMonth={isCurrentMonth}
                  isToday={isToday}
                  isWeekend={isWeekend}
                  vacation={vac}
                  lessons={lessonsByDate.get(dateStr) ?? []}
                  appointments={apptsByDate.get(dateStr) ?? []}
                  childrenById={childrenById}
                  todayStr={todayStr}
                  dndEnabled={dndEnabled}
                  isDragActive={isDragActive}
                  recentlyLandedIds={recentlyLandedIds}
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  moveTargetMode={moveTargetMode}
                  isKeyboardFocused={effectiveFocusedDateStr === dateStr}
                  onCellClick={(ds) => {
                    onFocusedDateChange?.(ds);
                    onCellClick?.(ds);
                  }}
                  onLessonClick={onLessonClick}
                  onAppointmentClick={onAppointmentClick}
                  onOverflowClick={onOverflowClick}
                  onLessonLongPress={onLessonLongPress}
                  onLessonSelectToggle={onLessonSelectToggle}
                  onMoveTargetPick={onMoveTargetPick}
                  onCellContextMenu={onCellContextMenu}
                />
              );
            })}
      </div>
    </div>
  );
}
