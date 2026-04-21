"use client";

import type { PlanV2Child, PlanV2Lesson } from "./types";
import { resolveChildColor } from "./colors";

/* Compact lesson chip used in DayCell. Color-coded by child. */

interface Props {
  lesson: PlanV2Lesson;
  child: PlanV2Child | undefined;
  childOrderedIndex: number;
  /** True if the lesson's scheduled_date is before today and not completed. */
  missed?: boolean;
  onClick?: () => void;
}

function displayTitle(l: PlanV2Lesson): string {
  if (l.title && l.title.trim().length > 0) return l.title;
  if (l.lesson_number) return `Lesson ${l.lesson_number}`;
  return "Untitled";
}

export default function LessonPill({ lesson, child, childOrderedIndex, missed, onClick }: Props) {
  const color = resolveChildColor(child, childOrderedIndex);
  const subject = lesson.subjects?.name ?? null;
  const initial = child ? child.name.charAt(0).toUpperCase() : "·";
  const done = lesson.completed;
  const label = displayTitle(lesson);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Lesson: ${label}${child ? ` for ${child.name}` : ""}${done ? ", completed" : ""}`}
      className={`w-full text-left rounded-md px-1.5 py-[3px] text-[10px] font-medium bg-white border transition-colors hover:bg-[#faf8f4] flex items-center gap-1 min-w-0 ${
        missed ? "ring-1 ring-[#dc6b53]" : ""
      }`}
      style={{
        borderColor: "#e8e2d9",
        borderLeftWidth: 3,
        borderLeftColor: color,
        opacity: done ? 0.55 : 1,
      }}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center rounded-full text-[8px] font-bold text-white leading-none"
        style={{ width: 12, height: 12, backgroundColor: color }}
        aria-hidden
      >
        {initial}
      </span>
      <span
        className="min-w-0 flex-1 truncate leading-tight"
        style={{
          color: "#2d2926",
          textDecoration: done ? "line-through" : "none",
        }}
      >
        {subject ? <span className="text-[#7a6f65]">{subject} · </span> : null}
        {label}
      </span>
      {missed ? (
        <span
          aria-hidden
          className="shrink-0 rounded-full"
          style={{ width: 5, height: 5, backgroundColor: "#dc6b53" }}
        />
      ) : null}
    </button>
  );
}
