"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ============================================================================
 * useLiveAnnouncer — small hook for screen reader announcements.
 *
 * Returns an `announce(message)` function and a `liveText` string the caller
 * should render into an aria-live region. Consecutive identical messages are
 * disambiguated with a non-breaking-space toggle so AT still reads them.
 * ==========================================================================*/

export function useLiveAnnouncer(): {
  announce: (message: string) => void;
  liveText: string;
} {
  const [liveText, setLiveText] = useState("");
  const toggleRef = useRef(false);
  const clearTimerRef = useRef<number | null>(null);

  const announce = useCallback((message: string) => {
    // Toggle trailing whitespace so two identical announcements re-fire.
    toggleRef.current = !toggleRef.current;
    const suffix = toggleRef.current ? " " : "";
    setLiveText(message + suffix);
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    // Clear after a few seconds so stale messages don't linger in the tree
    // across route changes or unmounts.
    clearTimerRef.current = window.setTimeout(() => {
      setLiveText("");
      clearTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    };
  }, []);

  return { announce, liveText };
}

/** sr-only utility classes string — kept here so callers don't need a CSS
 * rule. Matches Tailwind's `sr-only` visually-hidden pattern. */
export const SR_ONLY_STYLE: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};
