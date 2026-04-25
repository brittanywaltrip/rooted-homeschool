"use client";

import { useDraggable } from "@dnd-kit/core";
import { useLongPress } from "./useLongPress";
import { CheckCircle } from "./print-decorations";
import type { PlanV2Child, PlanV2Lesson } from "./types";
import { resolveChildColor } from "./colors";

/* Compact lesson chip used in DayCell. Color-coded by child.
 *
 * Three interaction modes:
 *   - default           tap → onClick (opens day panel); drag works on desktop
 *   - long-press        mobile-only; 150ms hold → onLongPress (enters select mode)
 *   - select-mode       no drag; tap → onRequestSelect (toggles selection);
 *                       renders a checkbox affordance on the right edge
 *
 * Dragging dims the source to opacity 0.35; a DragOverlay renders the ghost. */

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
  /** When false, useDraggable is skipped entirely (mobile path or select mode). */
  draggable?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onLongPress?: () => void;
  onRequestSelect?: () => void;
}

function displayTitle(l: PlanV2Lesson): string {
  if (l.title && l.title.trim().length > 0) return l.title;
  if (l.lesson_number) return `Lesson ${l.lesson_number}`;
  return "Untitled";
}

export default function LessonPill(props: Props) {
  const {
    lesson, child, childOrderedIndex, sourceDateStr,
    missed, justLanded, draggable = true,
    selectMode, selected,
    onClick, onLongPress, onRequestSelect,
  } = props;

  const color = resolveChildColor(child, childOrderedIndex);
  const subject = lesson.subjects?.name ?? null;
  const initial = child ? child.name.charAt(0).toUpperCase() : "·";
  const done = lesson.completed;
  const label = displayTitle(lesson);
  const ariaLabel = buildAria(label, child, subject, sourceDateStr, done, !!selected, !!missed);

  // Drag is suppressed in select mode even on desktop — users are picking, not moving.
  const dragActive = draggable && !selectMode;

  const handleClick = () => {
    if (selectMode) onRequestSelect?.();
    else onClick?.();
  };

  if (dragActive) {
    return (
      <DraggableLessonPill
        lesson={lesson}
        sourceDateStr={sourceDateStr}
        onLongPress={onLongPress}
        color={color}
        initial={initial}
        subject={subject}
        label={label}
        done={done}
        missed={missed}
        justLanded={justLanded}
        selectMode={selectMode}
        selected={selected}
        onClick={handleClick}
        ariaLabel={ariaLabel}
      />
    );
  }

  return (
    <NonDraggablePill
      onLongPress={onLongPress}
      onClick={handleClick}
      color={color}
      initial={initial}
      subject={subject}
      label={label}
      done={done}
      missed={missed}
      justLanded={justLanded}
      selectMode={selectMode}
      selected={selected}
      ariaLabel={ariaLabel}
    />
  );
}

function buildAria(
  label: string,
  child: PlanV2Child | undefined,
  subject: string | null,
  dateStr: string,
  done: boolean,
  selected: boolean,
  missed: boolean,
): string {
  // "Lesson: Emma's Math Lesson 45, scheduled Tuesday April 21"
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
  const whose = child ? `${child.name}'s` : "";
  const subjectPart = subject ? ` ${subject}` : "";
  const head = `Lesson:${whose ? ` ${whose}` : ""}${subjectPart} ${label}`.replace(/\s+/g, " ").trim();
  return `${head}, scheduled ${dateLabel}${done ? ", completed" : ""}${missed ? ", missed" : ""}${selected ? ", selected" : ""}`;
}

// ── Draggable wrapper ──────────────────────────────────────────────────────

interface DraggableProps extends Omit<ShellProps, "overlay" | "dragging"> {
  lesson: PlanV2Lesson;
  sourceDateStr: string;
  onLongPress?: () => void;
}

function DraggableLessonPill(p: DraggableProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lesson:${p.lesson.id}`,
    data: { type: "lesson", lessonId: p.lesson.id, sourceDateStr: p.sourceDateStr },
  });

  const longPress = useLongPress(() => p.onLongPress?.(), { holdMs: 150 });

  // Merge @dnd-kit pointer listeners with long-press tracking. dnd-kit's
  // listener MUST run first — otherwise PointerSensor never sees the
  // pointerdown and desktop drag never activates. Long-press tracking +
  // bubble-stop run after, so the gesture stays armed for both a move
  // (drag) and a hold (long-press → select mode).
  //
  // Cast: dnd-kit types `listeners` as `SyntheticListenerMap | undefined`
  // — a record of pointer-event handlers. The narrow cast preserves the
  // optional-chain on every call site.
  const l = listeners as Record<string, ((e: React.PointerEvent) => void) | undefined> | undefined;
  const onPointerDown = (e: React.PointerEvent) => {
    l?.onPointerDown?.(e);
    // Stop the gesture from bubbling to the DayCell so a long-press on a
    // pill doesn't ALSO trigger the cell's context-menu long-press.
    e.stopPropagation();
    longPress.onPointerDown(e);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    l?.onPointerUp?.(e);
    e.stopPropagation();
    longPress.onPointerUp(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    l?.onPointerMove?.(e);
    longPress.onPointerMove(e);
  };
  const onPointerCancel = (e: React.PointerEvent) => {
    l?.onPointerCancel?.(e);
    longPress.onPointerCancel();
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onPointerCancel={onPointerCancel}
      onPointerLeave={longPress.onPointerLeave}
      onContextMenu={(e) => e.stopPropagation()}
      className="touch-none"
    >
      <PillShell
        color={p.color}
        initial={p.initial}
        subject={p.subject}
        label={p.label}
        done={p.done}
        missed={p.missed}
        justLanded={p.justLanded}
        selectMode={p.selectMode}
        selected={p.selected}
        dragging={isDragging}
        onClick={(e) => {
          if (longPress.wasLongPress()) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          p.onClick?.(e);
        }}
        ariaLabel={p.ariaLabel}
      />
    </div>
  );
}

// ── Plain wrapper with just long-press + click ─────────────────────────────

function NonDraggablePill(p: Omit<ShellProps, "overlay" | "dragging"> & { onLongPress?: () => void }) {
  const longPress = useLongPress(() => p.onLongPress?.(), { holdMs: 150 });
  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        longPress.onPointerDown(e);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        longPress.onPointerUp(e);
      }}
      onPointerMove={longPress.onPointerMove}
      onPointerCancel={longPress.onPointerCancel}
      onPointerLeave={longPress.onPointerLeave}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <PillShell
        {...p}
        onClick={(e) => {
          if (longPress.wasLongPress()) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          p.onClick?.(e);
        }}
      />
    </div>
  );
}

// ── Visual shell ───────────────────────────────────────────────────────────

interface ShellProps {
  color: string;
  initial: string;
  subject: string | null;
  label: string;
  done: boolean;
  missed?: boolean;
  justLanded?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  dragging?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  ariaLabel: string;
  /** When true the shell is rendered inside a DragOverlay — no button,
   * no cursor handling; just the visual. */
  overlay?: boolean;
}

export function PillShell({
  color, initial, subject, label, done, missed, justLanded, selectMode, selected, dragging, onClick, ariaLabel, overlay,
}: ShellProps) {
  const baseClasses = [
    "w-full text-left rounded-md px-1.5 py-[3px] text-[10px] font-medium bg-white border transition-colors flex items-center gap-1 min-w-0",
    overlay ? "" : "hover:bg-[#faf8f4]",
    missed ? "ring-1 ring-[#dc6b53]" : "",
    justLanded ? "ring-1 ring-[#5c7f63]" : "",
    selected ? "ring-2 ring-[#2D5A3D]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Paper-grain inset shadow on the rest state — almost imperceptible
  // unless you look for it, but reads as "drawn on paper" rather than a
  // flat HTML element. The drag-overlay shadow stays as the dominant
  // depth cue when lifting; we don't double-stack with grain.
  const grainShadow = "inset 0 0 0 1px rgba(0,0,0,0.03)";
  const style: React.CSSProperties = {
    borderColor: "var(--paper-edge, #e8e2d9)",
    borderLeftWidth: 3,
    borderLeftColor: color,
    opacity: dragging ? 0.35 : done ? 0.55 : 1,
    transition: "opacity 120ms, box-shadow 200ms",
    boxShadow: overlay ? "0 10px 24px rgba(45, 41, 38, 0.25)" : grainShadow,
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
      {selectMode ? (
        <span
          aria-hidden
          className="shrink-0 inline-flex items-center justify-center rounded-full"
          style={{
            width: 12, height: 12,
            backgroundColor: selected ? "#2D5A3D" : "transparent",
            border: selected ? "1.5px solid #2D5A3D" : "1.5px solid #c8bfb5",
          }}
        >
          {selected ? (
            <svg viewBox="0 0 8 7" width="7" height="6" fill="none">
              <path d="M1 3.5l1.8 2L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
      ) : done ? (
        // Hand-drawn "done" mark — the same CheckCircle the print sheets
        // and the daily list use, scaled tiny to sit in the pill's right
        // edge. aria-hidden because the line-through above already
        // communicates completion to screen readers.
        <span aria-hidden className="shrink-0 inline-flex">
          <CheckCircle filled size={11} color="#5c7f63" />
        </span>
      ) : missed ? (
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
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={selectMode ? !!selected : undefined}
      className={baseClasses}
      style={style}
    >
      {content}
    </button>
  );
}
