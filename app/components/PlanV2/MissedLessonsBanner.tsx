"use client";

import { useState } from "react";
import type { PlanV2Lesson } from "./types";

/* ============================================================================
 * MissedLessonsBanner — amber warning surfaced above the calendar card.
 *
 * Shows lessons whose scheduled_date is in the past and completed=false (after
 * the orchestrator applies the active child-filter chips). Two bulk actions
 * live in the banner header — "Mark all done" (primary) and "Select all"
 * (opens the existing multi-select mode with banner items pre-selected so the
 * user can Move / Skip / Delete) — plus per-row "Reschedule" buttons that
 * match the legacy banner behavior.
 *
 * "Mark all done" uses an inline two-step confirm (no blocking modal) so the
 * grader can stay in flow. The orchestrator owns the atomic update + undo.
 * ========================================================================== */

export interface MissedLessonsBannerProps {
  missedLessons: PlanV2Lesson[];
  onMarkAllDone: () => void;
  onSelectAll: () => void;
  onReschedule: (lesson: PlanV2Lesson) => void;
  busy?: boolean;
}

export default function MissedLessonsBanner(props: MissedLessonsBannerProps) {
  const { missedLessons, onMarkAllDone, onSelectAll, onReschedule, busy } = props;
  const [confirming, setConfirming] = useState(false);

  const n = missedLessons.length;

  // When the banner hides (child filter empties the set, or all missed
  // lessons become done), React unmounts us — the next mount starts fresh,
  // so no explicit reset of `confirming` is needed.
  if (n === 0) return null;

  return (
    <div
      role="region"
      aria-label={`${n} missed lessons`}
      style={{
        background: "#fffbf0",
        border: "1px solid #f0dda8",
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      {/* Header row — title + bulk actions */}
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <p
          className="flex items-center gap-1.5 min-w-0"
          style={{ fontSize: 12, fontWeight: 700, color: "#7a4a1a", margin: 0 }}
        >
          <span aria-hidden>⚠️</span>
          <span className="truncate">
            You have {n} missed lesson{n !== 1 ? "s" : ""}
          </span>
        </p>

        <div className="flex-1" />

        {confirming ? (
          <div className="flex items-center gap-1.5">
            <span
              className="truncate"
              style={{ fontSize: 12, fontWeight: 600, color: "#7a4a1a" }}
            >
              Mark {n} missed lesson{n !== 1 ? "s" : ""} as done?
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onMarkAllDone();
              }}
              aria-label={`Confirm — mark ${n} missed lesson${n !== 1 ? "s" : ""} as done`}
              className="text-[11px] font-bold text-white rounded-lg px-3 py-1.5 min-h-[32px] transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#5c7f63" }}
              onMouseEnter={(e) => { if (!busy) e.currentTarget.style.backgroundColor = "#3d5c42"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#5c7f63"; }}
            >
              Yes, mark done
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 min-h-[32px] transition-colors"
              style={{ color: "#7a4a1a", backgroundColor: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#fef9e8"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy || n === 0}
              onClick={() => setConfirming(true)}
              aria-label={`Mark ${n} missed lesson${n !== 1 ? "s" : ""} as done`}
              className="text-[11px] font-bold text-white rounded-lg px-3 py-1.5 min-h-[32px] transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#5c7f63" }}
              onMouseEnter={(e) => { if (!busy && n > 0) e.currentTarget.style.backgroundColor = "#3d5c42"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#5c7f63"; }}
            >
              Mark all done
            </button>
            <button
              type="button"
              disabled={busy || n === 0}
              onClick={onSelectAll}
              aria-label={`Select all ${n} missed lesson${n !== 1 ? "s" : ""} for bulk actions`}
              className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 min-h-[32px] underline-offset-2 hover:underline transition-colors disabled:opacity-50 disabled:no-underline"
              style={{ color: "#7a4a1a", backgroundColor: "transparent" }}
            >
              Select all
            </button>
          </div>
        )}
      </div>

      {/* Per-row list (capped at 10, same as legacy) */}
      <div className="flex flex-col gap-1.5">
        {missedLessons.slice(0, 10).map((lesson) => {
          const dateStr = lesson.scheduled_date ?? lesson.date ?? "";
          const dateLabel = dateStr
            ? new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })
            : "";
          const subjectLabel = lesson.subjects?.name ?? "General";
          const title =
            lesson.title && lesson.title.trim().length > 0
              ? lesson.title
              : lesson.lesson_number
                ? `Lesson ${lesson.lesson_number}`
                : "Lesson";
          return (
            <div
              key={lesson.id}
              className="flex items-center justify-between gap-2"
              style={{
                background: "white",
                borderRadius: 10,
                padding: "8px 12px",
                border: "0.5px solid #f0dda8",
              }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="truncate"
                  style={{ fontSize: 12, fontWeight: 500, color: "#2d2926", margin: 0 }}
                >
                  {dateLabel ? `${dateLabel} · ` : ""}
                  {title}
                </p>
                <p style={{ fontSize: 10, color: "#9a8e84", margin: "1px 0 0" }}>
                  {subjectLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onReschedule(lesson)}
                aria-label={`Reschedule ${title}`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#7a4a1a",
                  background: "#fef9e8",
                  border: "1px solid #f0dda8",
                  borderRadius: 8,
                  padding: "4px 10px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Reschedule
              </button>
            </div>
          );
        })}
        {n > 10 ? (
          <p
            style={{
              fontSize: 11,
              color: "#9a8e84",
              textAlign: "center",
              margin: "2px 0 0",
            }}
          >
            + {n - 10} more
          </p>
        ) : null}
      </div>
    </div>
  );
}
