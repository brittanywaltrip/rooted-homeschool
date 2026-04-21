"use client";

import { useDraggable } from "@dnd-kit/core";
import type { PlanV2Child, PlanV2Lesson } from "./types";
import { resolveChildColor } from "./colors";

/* Compact lesson chip used in DayCell. Color-coded by child.
 *
 * When draggable=true (desktop only — PlanV2 wires this per the mobile gate),
 * the pill registers with @dnd-kit as a draggable whose id is the lesson id
 * and whose data carries the source dateStr. Dragging dims the source at
 * opacity 0.35; a DragOverlay at the root renders the floating ghost. */

interface Props {
  lesson: PlanV2Lesson;
  child: PlanV2Child | undefined;
  childOrderedIndex: number;
  /** Source date as "YYYY-MM-DD" — travels with the drag payload so the drop
   * handler can tell whether the move is a no-op. */
  sourceDateStr: string;
  /** True if the lesson's scheduled_date is before today and not completed. */
  missed?: boolean;
  /** True if this pill should render the "newly-landed" green ring. */
  justLanded?: boolean;
  /** When false, useDraggable is skipped entirely (mobile path). */
  draggable?: boolean;
  onClick?: () => void;
}

function displayTitle(l: PlanV2Lesson): string {
  if (l.title && l.title.trim().length > 0) return l.title;
  if (l.lesson_number) return `Lesson ${l.lesson_number}`;
  return "Untitled";
}

export default function LessonPill({
  lesson, child, childOrderedIndex, sourceDateStr, missed, justLanded, draggable = true, onClick,
}: Props) {
  const color = resolveChildColor(child, childOrderedIndex);
  const subject = lesson.subjects?.name ?? null;
  const initial = child ? child.name.charAt(0).toUpperCase() : "·";
  const done = lesson.completed;
  const label = displayTitle(lesson);

  return draggable ? (
    <DraggableLessonPill
      lesson={lesson}
      sourceDateStr={sourceDateStr}
      color={color}
      initial={initial}
      subject={subject}
      label={label}
      done={done}
      missed={missed}
      justLanded={justLanded}
      onClick={onClick}
      child={child}
    />
  ) : (
    <PillShell
      onClick={onClick}
      color={color}
      initial={initial}
      subject={subject}
      label={label}
      done={done}
      missed={missed}
      justLanded={justLanded}
      ariaLabel={buildAria(label, child, done)}
    />
  );
}

function buildAria(label: string, child: PlanV2Child | undefined, done: boolean): string {
  return `Lesson: ${label}${child ? ` for ${child.name}` : ""}${done ? ", completed" : ""}`;
}

interface DraggableProps {
  lesson: PlanV2Lesson;
  sourceDateStr: string;
  color: string;
  initial: string;
  subject: string | null;
  label: string;
  done: boolean;
  missed?: boolean;
  justLanded?: boolean;
  onClick?: () => void;
  child: PlanV2Child | undefined;
}

function DraggableLessonPill(p: DraggableProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lesson:${p.lesson.id}`,
    data: { type: "lesson", lessonId: p.lesson.id, sourceDateStr: p.sourceDateStr },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="touch-none">
      <PillShell
        color={p.color}
        initial={p.initial}
        subject={p.subject}
        label={p.label}
        done={p.done}
        missed={p.missed}
        justLanded={p.justLanded}
        dragging={isDragging}
        onClick={p.onClick}
        ariaLabel={buildAria(p.label, p.child, p.done)}
      />
    </div>
  );
}

interface ShellProps {
  color: string;
  initial: string;
  subject: string | null;
  label: string;
  done: boolean;
  missed?: boolean;
  justLanded?: boolean;
  dragging?: boolean;
  onClick?: () => void;
  ariaLabel: string;
  /** When true the shell is rendered inside a DragOverlay — no button,
   * no cursor handling; just the visual. */
  overlay?: boolean;
}

export function PillShell({
  color, initial, subject, label, done, missed, justLanded, dragging, onClick, ariaLabel, overlay,
}: ShellProps) {
  const baseClasses = [
    "w-full text-left rounded-md px-1.5 py-[3px] text-[10px] font-medium bg-white border transition-colors flex items-center gap-1 min-w-0",
    overlay ? "" : "hover:bg-[#faf8f4]",
    missed ? "ring-1 ring-[#dc6b53]" : "",
    justLanded ? "ring-1 ring-[#5c7f63]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style: React.CSSProperties = {
    borderColor: "#e8e2d9",
    borderLeftWidth: 3,
    borderLeftColor: color,
    opacity: dragging ? 0.35 : done ? 0.55 : 1,
    transition: "opacity 120ms, box-shadow 200ms",
    boxShadow: overlay ? "0 10px 24px rgba(45, 41, 38, 0.25)" : undefined,
    transform: overlay ? "rotate(-1.5deg)" : undefined,
  };

  const content = (
    <>
      <span
        className="shrink-0 inline-flex items-center justify-center rounded-full text-[8px] font-bold text-white leading-none"
        style={{ width: 12, height: 12, backgroundColor: color }}
        aria-hidden
      >
        {initial}
      </span>
      <span
        className="min-w-0 flex-1 truncate leading-tight"
        style={{ color: "#2d2926", textDecoration: done ? "line-through" : "none" }}
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
    </>
  );

  if (overlay) {
    return (
      <div aria-hidden className={baseClasses} style={style}>
        {content}
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={baseClasses} style={style}>
      {content}
    </button>
  );
}
