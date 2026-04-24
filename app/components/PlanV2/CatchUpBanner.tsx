"use client";

import { X } from "lucide-react";

/* ============================================================================
 * CatchUpBanner — "you're N lessons behind" surface.
 *
 * Different from MissedLessonsBanner: that one handles day-off items with
 * per-row reschedule + the two actions we already added (Mark all done,
 * Select all). This banner is the BULK momentum surface: it assumes the
 * user fell meaningfully behind and wants a single action to catch up or
 * push the whole schedule back.
 *
 * The orchestrator decides when to render (5+ across 2+ days after
 * filter), what count to show, and which action to run on click. This
 * component is presentational.
 * ==========================================================================*/

export interface CatchUpBannerProps {
  count: number;
  onShiftForward: () => void;
  onPushBack: () => void;
  onDismiss: () => void;
}

export default function CatchUpBanner(props: CatchUpBannerProps) {
  const { count, onShiftForward, onPushBack, onDismiss } = props;
  if (count <= 0) return null;

  return (
    <div
      role="region"
      aria-label={`${count} lessons behind`}
      className="flex flex-wrap items-center gap-3"
      style={{
        background: "#fff4e0",
        border: "1px solid #f0c87a",
        borderRadius: 14,
        padding: "12px 14px",
      }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span aria-hidden className="text-base leading-none">🗓️</span>
        <div className="min-w-0">
          <p className="truncate" style={{ fontSize: 13, fontWeight: 700, color: "#7a4a1a", margin: 0 }}>
            You&apos;re {count} lesson{count === 1 ? "" : "s"} behind — want to catch up?
          </p>
          <p style={{ fontSize: 11, color: "#8a5a2a", margin: "1px 0 0" }}>
            Shift them forward or push your whole schedule back.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={onShiftForward}
          aria-label={`Shift ${count} lessons to next school days`}
          className="text-[11px] font-bold text-white rounded-lg px-3 py-1.5 min-h-[32px] transition-colors"
          style={{ backgroundColor: "#5c7f63" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#3d5c42"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#5c7f63"; }}
        >
          Shift to next school days
        </button>
        <button
          type="button"
          onClick={onPushBack}
          aria-label="Push whole schedule back"
          className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 min-h-[32px] underline-offset-2 hover:underline transition-colors"
          style={{ color: "#7a4a1a", backgroundColor: "transparent" }}
        >
          Push schedule back
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss catch-up banner for 7 days"
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#a07a3a] hover:bg-[#fef0d8] transition-colors"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
