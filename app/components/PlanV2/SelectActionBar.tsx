"use client";

import { Calendar, Check, FastForward, Trash2, X } from "lucide-react";

/* ============================================================================
 * SelectActionBar — dark-green toolbar shown while multi-select is active.
 *
 * Count label: "N selected · X from Tue · Y from Wed" — two leading per-day
 * breakdowns to keep the bar compact. Action chips:
 *   📅 Move to…   ✓ Mark done   ⏩ Skip all   🗑 Delete   Cancel
 *
 * The orchestrator owns selection state and action wiring; this component is
 * purely presentational.
 *
 * In move-target sub-mode ("Move to…" was pressed and the calendar is now
 * waiting for a target day), the chips collapse into a single "← Back to
 * selection" control.
 * ==========================================================================*/

export interface SelectActionBarProps {
  count: number;
  dateBreakdown: { dateStr: string; count: number }[];
  inMoveTargetMode: boolean;
  busy?: boolean;
  onMoveTo: () => void;
  onMarkDone: () => void;
  onSkipAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onBackToSelection: () => void;
}

function shortDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}

export default function SelectActionBar(props: SelectActionBarProps) {
  const {
    count, dateBreakdown, inMoveTargetMode, busy,
    onMoveTo, onMarkDone, onSkipAll, onDelete, onCancel, onBackToSelection,
  } = props;

  // Group consecutive same-day entries + cap at 2 for a compact label.
  const breakdownLabel = dateBreakdown
    .slice(0, 2)
    .map((b) => `${b.count} from ${shortDayLabel(b.dateStr)}`)
    .join(" · ");
  const overflowLabel =
    dateBreakdown.length > 2 ? ` · +${dateBreakdown.length - 2} more days` : "";

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b"
      style={{ backgroundColor: "#1f3a28", borderColor: "#2d5a3d", color: "#ffffff" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="inline-flex items-center justify-center rounded-full text-[11px] font-bold bg-white/20 text-white w-6 h-6 shrink-0"
          aria-hidden
        >
          {count}
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold leading-tight truncate">
            {count} selected
            {breakdownLabel ? <span className="font-normal text-white/70"> · {breakdownLabel}{overflowLabel}</span> : null}
          </p>
        </div>
      </div>

      <div className="flex-1" />

      {inMoveTargetMode ? (
        <button
          type="button"
          onClick={onBackToSelection}
          className="flex items-center gap-1.5 text-[12px] font-semibold bg-white/15 hover:bg-white/25 text-white rounded-lg px-3 py-1.5 min-h-[36px] transition-colors"
        >
          ← Back to selection
        </button>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          <ActionChip label="Move to…" icon={<Calendar size={13} />} onClick={onMoveTo} disabled={busy} />
          <ActionChip label="Mark done" icon={<Check size={13} />} onClick={onMarkDone} disabled={busy} />
          <ActionChip label="Skip all" icon={<FastForward size={13} />} onClick={onSkipAll} disabled={busy} />
          <ActionChip
            label="Delete"
            icon={<Trash2 size={13} />}
            onClick={onDelete}
            disabled={busy}
            destructive
          />
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel selection"
            className="flex items-center gap-1 text-[12px] font-semibold bg-transparent hover:bg-white/10 text-white/80 hover:text-white rounded-lg px-2.5 py-1.5 min-h-[36px] transition-colors disabled:opacity-50"
          >
            <X size={13} /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function ActionChip({
  label, icon, onClick, disabled, destructive,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const base =
    "flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-1.5 min-h-[36px] transition-colors disabled:opacity-50";
  const color = destructive
    ? "bg-[#3a1f1f] hover:bg-[#5a2d2d] text-[#ffb3b3]"
    : "bg-white/15 hover:bg-white/25 text-white";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${color}`}>
      {icon}
      {label}
    </button>
  );
}
