"use client";

import { useDraggable } from "@dnd-kit/core";
import type { PlanV2Appointment } from "./types";

/* Appointment chip. Distinct visual from lessons so the eye separates
 * appointments from schoolwork: white fill, dashed border, 📍 prefix.
 *
 * Non-recurring instances are draggable on desktop; recurring instances
 * are non-draggable (a drag would mean "move this one occurrence" which
 * needs scope-picker semantics — handled in the appointment editor). */

interface Props {
  appt: PlanV2Appointment;
  /** Source date as "YYYY-MM-DD" — travels with the drag payload. */
  sourceDateStr: string;
  /** When false, useDraggable is skipped entirely (recurring, mobile, or
   *  drag-disabled context). */
  draggable?: boolean;
  onClick?: () => void;
}

function formatTimeShort(t: string | null): string | null {
  if (!t) return null;
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const hour12 = ((h + 11) % 12) + 1;
  const suffix = h >= 12 ? "p" : "a";
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

function formatTime12Full(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const hour12 = ((h + 11) % 12) + 1;
  const suffix = h >= 12 ? "PM" : "AM";
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function buildApptAria(appt: PlanV2Appointment): string {
  const [y, m, d] = appt.instance_date.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
  const timePart = appt.time ? ` at ${formatTime12Full(appt.time)}` : " all day";
  const locationPart = appt.location ? `, ${appt.location}` : "";
  const recurringPart = appt.is_recurring ? ", recurring" : "";
  const donePart = appt.completed ? ", completed" : "";
  return `Appointment: ${appt.title}${timePart} on ${dateLabel}${locationPart}${recurringPart}${donePart}`;
}

export default function AppointmentPill({ appt, sourceDateStr, draggable = false, onClick }: Props) {
  const ariaLabel = buildApptAria(appt);
  const dragActive = draggable && !appt.is_recurring;

  if (dragActive) {
    return (
      <DraggableAppointmentPill
        appt={appt}
        sourceDateStr={sourceDateStr}
        ariaLabel={ariaLabel}
        onClick={onClick}
      />
    );
  }

  return <AppointmentPillShell appt={appt} ariaLabel={ariaLabel} onClick={onClick} />;
}

// ── Draggable wrapper ──────────────────────────────────────────────────────

interface DraggableProps {
  appt: PlanV2Appointment;
  sourceDateStr: string;
  ariaLabel: string;
  onClick?: () => void;
}

function DraggableAppointmentPill(p: DraggableProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `appt:${p.appt.id}:${p.sourceDateStr}`,
    data: { type: "appointment", apptId: p.appt.id, sourceDateStr: p.sourceDateStr },
  });

  // Mirror LessonPill's pointer handling: stop bubbling so DayCell's
  // long-press doesn't fire while dragging the chip.
  const l = listeners as Record<string, ((e: React.PointerEvent) => void) | undefined> | undefined;
  const onPointerDown = (e: React.PointerEvent) => {
    l?.onPointerDown?.(e);
    e.stopPropagation();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    l?.onPointerUp?.(e);
    e.stopPropagation();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    l?.onPointerMove?.(e);
  };
  const onPointerCancel = (e: React.PointerEvent) => {
    l?.onPointerCancel?.(e);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.stopPropagation()}
      className="touch-none"
    >
      <AppointmentPillShell
        appt={p.appt}
        ariaLabel={p.ariaLabel}
        dragging={isDragging}
        onClick={p.onClick}
      />
    </div>
  );
}

// ── Visual shell ───────────────────────────────────────────────────────────

interface ShellProps {
  appt: PlanV2Appointment;
  ariaLabel: string;
  dragging?: boolean;
  onClick?: () => void;
  /** When true, renders inside a DragOverlay — no button, no hover. */
  overlay?: boolean;
}

export function AppointmentPillShell({ appt, ariaLabel, dragging, onClick, overlay }: ShellProps) {
  const time = formatTimeShort(appt.time);
  const done = appt.completed;

  const baseClasses = [
    "w-full text-left rounded-md px-1.5 py-[3px] text-[10px] font-medium bg-white flex items-center gap-1 min-w-0",
    overlay ? "" : "transition-colors hover:bg-[#faf8f4]",
  ].filter(Boolean).join(" ");

  const style: React.CSSProperties = {
    border: "1px dashed #c4b5d8",
    opacity: dragging ? 0.35 : done ? 0.55 : 1,
    transition: "opacity 120ms, box-shadow 200ms",
    boxShadow: overlay ? "0 10px 24px rgba(45, 41, 38, 0.25)" : undefined,
    transform: overlay ? "rotate(-1.5deg)" : undefined,
  };

  const content = (
    <>
      <span aria-hidden className="shrink-0 text-[9px]">📍</span>
      {time ? (
        <span className="shrink-0 text-[9px] font-semibold" style={{ color: "#5c7f63" }}>
          {time}
        </span>
      ) : null}
      <span
        className="min-w-0 flex-1 truncate leading-tight"
        style={{ color: "#2d2926", textDecoration: done ? "line-through" : "none" }}
      >
        {appt.title}
      </span>
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
      className={baseClasses}
      style={style}
    >
      {content}
    </button>
  );
}
