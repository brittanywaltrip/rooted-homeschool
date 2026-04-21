"use client";

import { useMemo } from "react";
import DayCell from "./DayCell";
import { computeGridRange } from "./usePlanV2Data";
import type {
  PlanV2Appointment,
  PlanV2Child,
  PlanV2Lesson,
  PlanV2Vacation,
} from "./types";

/* 42-cell month grid. Owns only layout + per-cell bucket precomputation;
 * DayCell is pure. Parent passes the already-filtered collections so the
 * child-filter chips and "hide completed" toggles live in the orchestrator. */

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  onCellClick?: (dateStr: string) => void;
  onLessonClick?: (lesson: PlanV2Lesson) => void;
  onAppointmentClick?: (appt: PlanV2Appointment) => void;
  onOverflowClick?: (dateStr: string) => void;
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
    onCellClick, onLessonClick, onAppointmentClick, onOverflowClick,
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

  return (
    <div role="grid" aria-label="Month calendar" className="w-full">
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
                  onCellClick={onCellClick}
                  onLessonClick={onLessonClick}
                  onAppointmentClick={onAppointmentClick}
                  onOverflowClick={onOverflowClick}
                />
              );
            })}
      </div>
    </div>
  );
}
