"use client";

import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDailyReconcileRunner,
  reconcileForDay,
  DAILY_RECONCILE_FAILED_NOTE,
  type DailyReconcileRun,
} from "@/app/lib/daily-reconcile";
import { ymdInTz } from "@/app/lib/timezone";

/**
 * Keep this tab's stored lesson dates in step with Today, once per curriculum
 * per local day (see app/lib/daily-reconcile.ts). Used by Today and Plan; only
 * one of them is mounted in a tab at a time.
 *
 * Triggers: when the page mounts with a user, when the tab regains focus or
 * becomes visible, and once a minute, so a tab left open overnight catches up
 * without a reload. Each trigger after the day has settled costs nothing.
 *
 * Whether anything is written is decided by the server switch at the moment of
 * the call, not by this build, so switching the job off stops open tabs too.
 */
export function useDailyReconcile(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  handlers: { onRedated?: (run: DailyReconcileRun) => void; onFailure?: (message: string) => void },
) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!userId) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const runner = createDailyReconcileRunner({
      run: (now) => reconcileForDay(supabase, userId, { timezone: tz, now }),
      now: () => new Date(),
      dayOf: (d) => ymdInTz(d, tz),
      onRedated: (run) => handlersRef.current.onRedated?.(run),
      onFailure: () => handlersRef.current.onFailure?.(DAILY_RECONCILE_FAILED_NOTE),
    });
    const kick = () => {
      if (document.visibilityState === "visible") void runner.trigger();
    };
    kick();
    const tick = window.setInterval(kick, 60_000);
    window.addEventListener("focus", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [supabase, userId]);
}
