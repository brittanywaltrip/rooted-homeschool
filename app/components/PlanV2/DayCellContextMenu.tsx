"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/* ============================================================================
 * DayCellContextMenu — actions available from right-click (desktop) or cell
 * long-press (mobile). Positioning flips horizontally when the menu would
 * overflow the viewport on the right, and vertically when it would overflow
 * below. Closes on backdrop click or Escape.
 *
 * Presentational only — the orchestrator owns the real handlers. Each menu
 * item is visible even when not applicable (e.g. "Select all 0 items" on an
 * empty day) but gets disabled/greyed so the surface stays predictable.
 * ==========================================================================*/

export interface DayCellContextMenuProps {
  dateStr: string;
  lessonCount: number;
  x: number;
  y: number;
  onSelectAll: () => void;
  onMoveAll: () => void;
  onSkipAll: () => void;
  onMarkBreak: () => void;
  onAddLesson: () => void;
  onAddAppointment: () => void;
  onOpenDay: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 232;
const MENU_MARGIN = 8;

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

export default function DayCellContextMenu(props: DayCellContextMenuProps) {
  const {
    dateStr, lessonCount, x, y,
    onSelectAll, onMoveAll, onSkipAll, onMarkBreak,
    onAddLesson, onAddAppointment, onOpenDay, onClose,
  } = props;

  const menuRef = useRef<HTMLDivElement | null>(null);

  // Measure + flip after mount. We write the computed position straight onto
  // the element's style rather than going through setState — matches the
  // imperative nature of "measure rect, then place" and avoids a visible
  // frame at an offscreen position.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width + MENU_MARGIN > vw) {
      left = Math.max(MENU_MARGIN, vw - rect.width - MENU_MARGIN);
    }
    if (top + rect.height + MENU_MARGIN > vh) {
      top = Math.max(MENU_MARGIN, vh - rect.height - MENU_MARGIN);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [x, y]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const noItems = lessonCount === 0;
  const dateLabel = formatDateLabel(dateStr);

  return (
    <>
      {/* Transparent backdrop — click anywhere else closes the menu. Uses a
          separate contextmenu handler so a second right-click opens a fresh
          menu on the target cell rather than the browser default. */}
      <div
        className="fixed inset-0 z-[75]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        aria-hidden
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Actions for ${dateLabel}`}
        className="fixed z-[76] bg-white border border-[#e8e2d9] rounded-xl shadow-xl overflow-hidden"
        style={{ left: x, top: y, width: MENU_WIDTH, visibility: "hidden" }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="px-3 pt-2.5 pb-1.5 border-b border-[#f0ede8]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B7E74]">
            {dateLabel}
          </p>
          <p className="text-[11px] text-[#7a6f65]">
            {lessonCount === 0
              ? "Nothing scheduled"
              : `${lessonCount} lesson${lessonCount === 1 ? "" : "s"}`}
          </p>
        </div>

        <MenuItem icon="☑" label={`Select all ${lessonCount} ${lessonCount === 1 ? "item" : "items"}`} disabled={noItems} onClick={onSelectAll} />
        <MenuItem icon="📅" label="Move all to another day…" disabled={noItems} onClick={onMoveAll} />
        <MenuItem icon="⏩" label="Skip everything today" disabled={noItems} onClick={onSkipAll} />
        <Divider />
        <MenuItem icon="🏖" label="Mark as a break day" onClick={onMarkBreak} />
        <Divider />
        <MenuItem icon="+" label="Add a lesson" onClick={onAddLesson} />
        <MenuItem icon="📍" label="Add an appointment" onClick={onAddAppointment} />
        <Divider />
        <MenuItem icon="↗" label="Open full day view" onClick={onOpenDay} />
      </div>
    </>
  );
}

function MenuItem({
  icon, label, disabled, onClick,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-[#2d2926] hover:bg-[#f8f7f4] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span aria-hidden className="shrink-0 text-[14px] w-5 text-center leading-none">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
    </button>
  );
}

function Divider() {
  return <div aria-hidden className="h-px bg-[#f0ede8]" />;
}
