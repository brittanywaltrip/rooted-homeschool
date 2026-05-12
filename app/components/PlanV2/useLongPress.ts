"use client";

import { useCallback, useRef } from "react";

/* ============================================================================
 * useLongPress — 150ms hold detection (per Phase 6 spec).
 *
 * A pointer press that stays down for `holdMs` without moving more than
 * `moveThresholdPx` triggers `onLongPress`. If the user moves past the
 * threshold (scroll intent) or lifts early, the timer is cancelled and
 * nothing fires — the caller's own click handler runs normally.
 *
 * Returns spreadable pointer props to attach to any element. Use together
 * with an onClick handler; this hook suppresses onClick only when the long
 * press actually fires, by tracking a triggeredRef the caller can inspect.
 * ==========================================================================*/

export interface UseLongPressOpts {
  holdMs?: number;
  moveThresholdPx?: number;
}

export interface UseLongPressBindings {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  /** True while a long-press has just fired. Clicks that follow should
   * check this and skip their normal handler. Auto-clears on the next
   * pointerdown. */
  wasLongPress: () => boolean;
}

export function useLongPress(
  onLongPress: () => void,
  opts: UseLongPressOpts = {},
): UseLongPressBindings {
  const holdMs = opts.holdMs ?? 150;
  const moveThresholdPx = opts.moveThresholdPx ?? 6;

  const timerRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      firedRef.current = false;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        onLongPress();
      }, holdMs);
    },
    [clear, holdMs, onLongPress],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (timerRef.current === null) return;
      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;
      if (dx * dx + dy * dy > moveThresholdPx * moveThresholdPx) clear();
    },
    [clear, moveThresholdPx],
  );

  const onPointerUp = useCallback(() => clear(), [clear]);
  const onPointerCancel = useCallback(() => clear(), [clear]);
  const onPointerLeave = useCallback(() => clear(), [clear]);

  const wasLongPress = useCallback(() => firedRef.current, []);

  return { onPointerDown, onPointerUp, onPointerMove, onPointerCancel, onPointerLeave, wasLongPress };
}
