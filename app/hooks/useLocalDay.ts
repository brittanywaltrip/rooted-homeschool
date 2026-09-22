"use client";

import { useEffect, useState } from "react";

/**
 * Today's local date as `format(new Date())`, re-rendering when the clock
 * crosses midnight: checked once a minute and whenever the tab regains focus
 * or becomes visible (a sleeping tab's timers may not fire on time).
 */
export function useLocalDay(format: (d: Date) => string): string {
  const [day, setDay] = useState(() => format(new Date()));
  useEffect(() => {
    // Read the clock here, not inside a state updater; an unchanged string is
    // a no-op for React.
    const check = () => setDay(format(new Date()));
    const tick = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [format]);
  return day;
}
