"use client";

import { useMemo } from "react";
import type { PlanV2Lesson } from "./types";
import { lessonMinutes } from "@/lib/lesson-minutes";

/* ============================================================================
 * StatsBar — compact viewport totals rendered above the calendar card.
 *
 * Pure presentational. Counts derive from the filtered lessons already in
 * view + a memories array the parent loads alongside (for books +
 * field_trips). Updates automatically whenever the parent's filter or
 * month window changes.
 *
 * Hours math is lib/lesson-minutes.ts, the rule every total shares: recorded
 * minutes (a recorded 0 included), else a saved hours value, else the
 * estimate. The "~" prefix surfaces when ANY lesson fell back to the estimate
 * so the user knows the number is approximate.
 * ==========================================================================*/

export type StatsMemory = {
  type: string;
  date: string;
};

export interface StatsBarProps {
  /** Lessons already filtered by child + date range. */
  lessonsInView: PlanV2Lesson[];
  /** Memories in the current viewport date range (type + date are enough
   *  — body fields aren't rendered). */
  memoriesInRange: StatsMemory[];
  /** Distinct subject names in view — computed by the parent so this
   *  component stays presentational. */
  subjectCount: number;
}

function fmtHours(mins: number, estimated: boolean): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const prefix = estimated ? "~" : "";
  if (h === 0) return `${prefix}${m}m`;
  if (m === 0) return `${prefix}${h}h`;
  return `${prefix}${h}h ${m}m`;
}

export default function StatsBar(props: StatsBarProps) {
  const { lessonsInView, memoriesInRange, subjectCount } = props;

  const { lessonsCompleted, lessonsTotal, totalMinutes, estimated } = useMemo(() => {
    let completed = 0;
    let mins = 0;
    let est = false;
    for (const l of lessonsInView) {
      if (l.completed) completed++;
      if (l.completed) {
        const m = lessonMinutes(l);
        mins += m.minutes;
        if (m.estimated) est = true;
      }
    }
    return {
      lessonsCompleted: completed,
      lessonsTotal: lessonsInView.length,
      totalMinutes: mins,
      estimated: est,
    };
  }, [lessonsInView]);

  const bookCount = useMemo(() => memoriesInRange.filter((m) => m.type === "book").length, [memoriesInRange]);
  const tripCount = useMemo(
    () => memoriesInRange.filter((m) => ["field_trip", "project", "activity"].includes(m.type)).length,
    [memoriesInRange],
  );

  return (
    <section
      aria-label="Viewport stats"
      className="flex flex-wrap items-stretch gap-0 bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden divide-x divide-[#f0ede8]"
    >
      <Stat label="Lessons" value={`${lessonsCompleted} / ${lessonsTotal}`} />
      <Stat label="Hours" value={fmtHours(totalMinutes, estimated)} />
      <Stat label="Subjects" value={`${subjectCount}`} />
      <Stat label="Books" value={`${bookCount}`} />
      <Stat label="Field trips" value={`${tripCount}`} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 min-w-[92px] px-3 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B7E74] leading-tight">
        {label}
      </p>
      <p className="text-[15px] font-bold text-[#2d2926] tabular-nums mt-0.5 leading-tight">{value}</p>
    </div>
  );
}
