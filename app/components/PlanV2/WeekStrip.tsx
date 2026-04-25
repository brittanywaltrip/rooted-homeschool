"use client";

import { useMemo } from "react";
import DayCell, { CELL_ID_PREFIX } from "./DayCell";
import type {
  PlanV2Appointment,
  PlanV2Child,
  PlanV2Lesson,
  PlanV2Vacation,
} from "./types";

/* ============================================================================
 * WeekStrip — 7-day horizontal strip for the Week view of PlanV2.
 *
 * Same DayCell sub-renderer as MonthGrid uses; we just lay out 7 cells in a
 * row with a taller `sizeVariant="week"` so more lesson pills fit before
 * the "+N more" overflow trigger. All Month-view interactions (drag-drop,
 * select mode, context menu, keyboard nav) work in Week view because they
 * all live on DayCell — this component is only a layout swap.
 *
 * The week starts Sunday to match MonthGrid's weekday header order so the
 * two views feel like the same data viewed at different zoom levels.
 * ==========================================================================*/

const HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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

interface Props {
  weekStart: Date; // Sunday on or before the focused date
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
  holidays?: Map<string, string>;
  milestones?: Map<string, string>;
}

function SkeletonCell() {
  return (
    <div
      className="min-h-[160px] rounded-lg animate-pulse"
      style={{ backgroundColor: "#f4f0e8", border: "0.5px solid #ece8e0" }}
    />
  );
}

export default function WeekStrip(props: Props) {
  const {
    weekStart, todayStr, kids, lessons, appointments, vacationBlocks,
    loading, dndEnabled, isDragActive, recentlyLandedIds,
    selectMode, selectedIds, moveTargetMode,
    focusedDateStr, onFocusedDateChange,
    onCellClick, onLessonClick, onAppointmentClick, onOverflowClick,
    onLessonLongPress, onLessonSelectToggle, onMoveTargetPick,
    onCellContextMenu, holidays, milestones,
  } = props;

  const cells = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) {
      out.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    }
    return out;
  }, [weekStart]);

  const childrenById = useMemo(() => {
    const m = new Map<string, { child: PlanV2Child; index: number }>();
    kids.forEach((c, i) => m.set(c.id, { child: c, index: i }));
    return m;
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

  const visibleDateStrs = useMemo(() => cells.map(toDateStr), [cells]);
  const effectiveFocusedDateStr = useMemo(() => {
    if (focusedDateStr && visibleDateStrs.includes(focusedDateStr)) return focusedDateStr;
    if (visibleDateStrs.includes(todayStr)) return todayStr;
    return visibleDateStrs[0] ?? null;
  }, [focusedDateStr, visibleDateStrs, todayStr]);

  function moveFocus(deltaDays: number) {
    if (!effectiveFocusedDateStr) return;
    const base = parseDateStr(effectiveFocusedDateStr);
    base.setDate(base.getDate() + deltaDays);
    const next = toDateStr(base);
    if (visibleDateStrs.includes(next)) onFocusedDateChange?.(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); moveFocus(-1); break;
      case "ArrowRight": e.preventDefault(); moveFocus(1); break;
      // Up/Down on a 1-row strip have no semantic target — let the browser
      // scroll instead of trapping the keystroke.
      case "Home":
        e.preventDefault();
        if (visibleDateStrs[0]) onFocusedDateChange?.(visibleDateStrs[0]);
        break;
      case "End":
        e.preventDefault();
        if (visibleDateStrs[6]) onFocusedDateChange?.(visibleDateStrs[6]);
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
      aria-label="Week calendar"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-activedescendant={
        effectiveFocusedDateStr ? `${CELL_ID_PREFIX}${effectiveFocusedDateStr}` : undefined
      }
      className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2D5A3D] focus-visible:ring-offset-2 rounded-lg"
    >
      {/* Day-of-week + date headers — Caveat day name; date number is also
          rendered larger inside each DayCell, so we keep this header slim. */}
      <div className="grid grid-cols-7 gap-1 pb-1.5">
        {cells.map((d, i) => {
          const isToday = toDateStr(d) === todayStr;
          return (
            <div
              key={i}
              className="text-center"
              style={{ color: isToday ? "#2D5A3D" : "var(--ink-soft, #6B7363)" }}
            >
              <p
                className="font-handwritten"
                style={{ fontSize: 18, lineHeight: 1, margin: 0 }}
              >
                {HEADERS[i]}
              </p>
            </div>
          );
        })}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7 gap-1">
        {loading
          ? Array.from({ length: 7 }).map((_, i) => <SkeletonCell key={i} />)
          : cells.map((d) => {
              const dateStr = toDateStr(d);
              const isToday = dateStr === todayStr;
              const nativeDow = d.getDay();
              const isWeekend = nativeDow === 0 || nativeDow === 6;
              const vac = vacationFor(dateStr, vacationBlocks);
              return (
                <DayCell
                  key={dateStr}
                  date={d}
                  dateStr={dateStr}
                  isCurrentMonth={true}
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
                  holidayName={holidays?.get(dateStr)}
                  milestoneLabel={milestones?.get(dateStr)}
                  sizeVariant="week"
                />
              );
            })}
      </div>
    </div>
  );
}
