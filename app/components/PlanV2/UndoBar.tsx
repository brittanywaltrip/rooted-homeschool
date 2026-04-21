"use client";

import { useEffect, useRef, useState } from "react";

/* ============================================================================
 * UndoBar — single global undo slot.
 *
 * Replaces per-feature bars (planRescheduleUndo 8s, apptUndo 5s) with one
 * 30s pill. The bar slides in within ~200ms of the action so it doesn't
 * feel laggy.
 *
 * Single-slot by design: a second action during an active window overwrites
 * the first undo (its window was never going to fire a second time anyway).
 * The owning page passes { message, onUndo } each time an action completes;
 * the bar manages its own countdown + slide-in animation.
 * ==========================================================================*/

const UNDO_WINDOW_MS = 30_000;
const COUNTDOWN_TICK_MS = 200;

export interface UndoAction {
  message: string;
  onUndo: () => void | Promise<void>;
  /** Optional key — changing it restarts the countdown even if message is
   * the same (two consecutive identical moves). */
  key?: string;
}

export interface UndoBarProps {
  action: UndoAction | null;
  onDismiss: () => void;
}

export default function UndoBar({ action, onDismiss }: UndoBarProps) {
  const [msLeft, setMsLeft] = useState<number>(UNDO_WINDOW_MS);
  const [enter, setEnter] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!action) {
      setEnter(false);
      setMsLeft(UNDO_WINDOW_MS);
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    startRef.current = Date.now();
    setMsLeft(UNDO_WINDOW_MS);
    // One paint of the off-screen state before the slide-in, keeps animation crisp.
    const paint = window.requestAnimationFrame(() => setEnter(true));

    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const remaining = UNDO_WINDOW_MS - (Date.now() - startRef.current);
      if (remaining <= 0) {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setEnter(false);
        window.setTimeout(() => onDismiss(), 180);
      } else {
        setMsLeft(remaining);
      }
    }, COUNTDOWN_TICK_MS);

    return () => {
      window.cancelAnimationFrame(paint);
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // onDismiss identity changes per parent render; depending on it would
    // restart the timer on every parent render. Re-run only on action change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.key ?? action?.message ?? null]);

  if (!action) return null;

  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  const pct = Math.max(0, Math.min(100, (msLeft / UNDO_WINDOW_MS) * 100));

  async function handleUndo() {
    setEnter(false);
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      await action!.onUndo();
    } catch {
      /* handler owns rollback; swallow here so dismiss always fires */
    }
    window.setTimeout(() => onDismiss(), 180);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[80] left-1/2 -translate-x-1/2 pointer-events-none px-3 w-full max-w-md"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)",
        transition: "transform 200ms ease-out, opacity 200ms ease-out",
        transform: enter ? "translate(-50%, 0)" : "translate(-50%, 12px)",
        opacity: enter ? 1 : 0,
      }}
    >
      <div className="pointer-events-auto bg-[#2d2926] text-white rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <p className="flex-1 text-[13px] font-medium leading-snug min-w-0">
            {action.message}
          </p>
          <button
            type="button"
            onClick={handleUndo}
            className="shrink-0 text-[13px] font-bold text-white bg-[#5c7f63] hover:bg-[var(--g-deep)] rounded-xl px-3 py-1.5 min-h-[36px] transition-colors"
          >
            Undo
          </button>
          <span
            aria-hidden
            className="shrink-0 text-[11px] font-semibold tabular-nums text-white/60 min-w-[22px] text-right"
          >
            {seconds}s
          </span>
        </div>
        <div className="h-[2px] bg-white/10">
          <div
            className="h-full bg-[#5c7f63] transition-[width] duration-200 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
