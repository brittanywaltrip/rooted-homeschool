"use client";

import { formatLessonLabel } from "@/lib/lesson-label";
import { useLessonUnits } from "@/lib/lesson-units-context";
import type { MissedEntry } from "@/app/lib/recoverySelection";

/* ============================================================================
 * MissedLessonsBanner: amber notice above the calendar card.
 *
 * Lists the SAME lessons Today asks about (app/lib/missed-work.ts): the lessons
 * that would have been due on past school days since each curriculum's last
 * completion, not yet answered for. It used to list lessons whose STORED date
 * was before today, which drifted from Today whenever dates were re-dated (one
 * lesson marked on its planned past day re-dated the rest, and this list
 * emptied while Today still asked about them).
 *
 * Review opens the same prompt Today uses, so the question has one set of
 * answers: mark each lesson done on its day, or keep them in the plan. Moving
 * dates never answers it. A family taking time off adds a break instead: the
 * old "Push schedule back" wrote dates the daily reconciliation undid by the
 * next morning, while a break holds on Today and Plan alike.
 * ========================================================================== */

export interface MissedLessonsBannerGroup {
  goalId: string;
  /** "Maya · Math", as the prompt labels the curriculum. */
  label: string;
  entries: MissedEntry[];
}

export interface MissedLessonsBannerProps {
  groups: MissedLessonsBannerGroup[];
  onReview: () => void;
  /** Opens the break sheet, starting today. */
  onAddBreak?: () => void;
  busy?: boolean;
}

function dayLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function MissedLessonsBanner(props: MissedLessonsBannerProps) {
  // The curriculum's own words for a lesson number ("Week 12.3"), display only.
  const { unitFor } = useLessonUnits();
  const { groups, onReview, onAddBreak, busy } = props;
  const n = groups.reduce((sum, g) => sum + g.entries.length, 0);
  if (n === 0) return null;
  const anyAlsoToday = groups.some((g) => g.entries.some((e) => e.also_today));

  return (
    <div
      role="region"
      aria-label={`${n} lessons from earlier not marked yet`}
      style={{
        background: "#fffbf0",
        border: "1px solid #f0dda8",
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <p
          className="flex items-center gap-1.5 min-w-0"
          style={{ fontSize: 12, fontWeight: 700, color: "#7a4a1a", margin: 0 }}
        >
          <span aria-hidden>⚠️</span>
          <span className="truncate">
            {n} lesson{n !== 1 ? "s" : ""} from earlier {n !== 1 ? "aren't" : "isn't"} marked yet
          </span>
        </p>
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy}
          onClick={onReview}
          aria-label={`Review ${n} lesson${n !== 1 ? "s" : ""} from earlier`}
          className="text-[11px] font-bold text-white rounded-lg px-3 py-1.5 min-h-[32px] transition-colors disabled:opacity-50"
          style={{ backgroundColor: "#5c7f63" }}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.backgroundColor = "#3d5c42"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#5c7f63"; }}
        >
          Review
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {groups.map((g) => (
          <div
            key={g.goalId}
            style={{
              background: "white",
              borderRadius: 10,
              padding: "8px 12px",
              border: "0.5px solid #f0dda8",
            }}
          >
            <p className="truncate" style={{ fontSize: 12, fontWeight: 500, color: "#2d2926", margin: 0 }}>
              {g.label}
            </p>
            <ul className="mt-0.5" style={{ fontSize: 11, color: "#7a6f65", margin: 0, padding: 0, listStyle: "none" }}>
              {g.entries.slice(0, 6).map((e) => (
                <li key={`${e.goal_id}|${e.lesson_number}`} className="flex flex-wrap items-center gap-x-1.5">
                  <span>
                    {formatLessonLabel(e.lesson_number, unitFor(e.goal_id))}, due {dayLabel(e.date)}
                  </span>
                  {e.also_today ? (
                    <span style={{ fontSize: 10, color: "#7a6f65", background: "#f6f3ee", borderRadius: 999, padding: "0 6px" }}>
                      also on today&apos;s list
                    </span>
                  ) : null}
                </li>
              ))}
              {g.entries.length > 6 ? <li>+ {g.entries.length - 6} more</li> : null}
            </ul>
          </div>
        ))}
      </div>

      {anyAlsoToday ? (
        <p style={{ fontSize: 11, color: "#8a5a2a", margin: "8px 0 0" }}>
          A lesson that hasn&apos;t been marked yet is still next up, so it also shows today.
        </p>
      ) : null}

      {onAddBreak ? (
        <p style={{ fontSize: 11, color: "#8a5a2a", margin: "6px 0 0" }}>
          Taking some time off?{" "}
          <button
            type="button"
            onClick={onAddBreak}
            className="underline underline-offset-2"
            style={{ color: "#7a4a1a", fontWeight: 500, background: "transparent" }}
          >
            Add a break
          </button>{" "}
          and your lessons will wait until you&apos;re back.
        </p>
      ) : null}
    </div>
  );
}
