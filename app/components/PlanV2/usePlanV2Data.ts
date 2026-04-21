"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type {
  PlanV2Appointment,
  PlanV2Child,
  PlanV2Lesson,
  PlanV2Vacation,
} from "./types";

/* ============================================================================
 * usePlanV2Data — loads everything the month grid needs in one place.
 *
 * Fetches children + vacation_blocks + lessons (scheduled in the visible grid
 * window) + appointments (via GET /api/appointments which expands recurring
 * series). Reloads when `monthStart` changes. Silent-fails — a fetch error
 * leaves the previous data in place so users don't see a half-empty grid.
 *
 * The visible grid is always six Sun-Sat rows (42 cells) starting from the
 * Sunday on-or-before the 1st of the month.
 * ==========================================================================*/

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function computeGridRange(monthStart: Date): {
  cells: Date[];
  startStr: string;
  endStr: string;
} {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lead = firstOfMonth.getDay(); // Sun=0..Sat=6
  const gridStart = new Date(year, month, 1 - lead);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return {
    cells,
    startStr: toDateStr(cells[0]),
    endStr: toDateStr(cells[cells.length - 1]),
  };
}

export type PlanV2Data = {
  kids: PlanV2Child[];
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  vacationBlocks: PlanV2Vacation[];
  loading: boolean;
  reload: () => void;
};

export function usePlanV2Data(opts: {
  effectiveUserId: string | undefined;
  monthStart: Date;
}): PlanV2Data {
  const { effectiveUserId, monthStart } = opts;
  const [kids, setKids] = useState<PlanV2Child[]>([]);
  const [lessons, setLessons] = useState<PlanV2Lesson[]>([]);
  const [appointments, setAppointments] = useState<PlanV2Appointment[]>([]);
  const [vacationBlocks, setVacationBlocks] = useState<PlanV2Vacation[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const monthKey = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
  const cancelRef = useRef(false);

  const load = useCallback(async () => {
    if (!effectiveUserId) {
      setKids([]); setLessons([]); setAppointments([]); setVacationBlocks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { startStr, endStr } = computeGridRange(monthStart);

    let token: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token ?? null;
    } catch {
      token = null;
    }

    const childrenReq = supabase
      .from("children")
      .select("id, name, color, sort_order")
      .eq("user_id", effectiveUserId)
      .eq("archived", false)
      .order("sort_order");

    const vacReq = supabase
      .from("vacation_blocks")
      .select("id, name, start_date, end_date")
      .eq("user_id", effectiveUserId);

    const lessonReq = supabase
      .from("lessons")
      .select("id, title, lesson_number, completed, child_id, scheduled_date, date, curriculum_goal_id, subjects(name, color)")
      .eq("user_id", effectiveUserId)
      .gte("scheduled_date", startStr)
      .lte("scheduled_date", endStr);

    const apptReq = token
      ? fetch(`/api/appointments?date=${startStr}&end=${endStr}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => (r.ok ? r.json() : []))
      : Promise.resolve([]);

    try {
      const [cRes, vRes, lRes, aRes] = await Promise.all([childrenReq, vacReq, lessonReq, apptReq]);
      if (cancelRef.current) return;
      setKids((cRes.data ?? []) as PlanV2Child[]);
      setVacationBlocks((vRes.data ?? []) as PlanV2Vacation[]);
      setLessons((lRes.data ?? []) as unknown as PlanV2Lesson[]);
      setAppointments(Array.isArray(aRes) ? (aRes as PlanV2Appointment[]) : []);
    } catch {
      /* silent-fail — leave previous data in place */
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }, [effectiveUserId, monthStart]);

  useEffect(() => {
    cancelRef.current = false;
    load();
    return () => {
      cancelRef.current = true;
    };
    // monthKey / reloadNonce capture all real dependencies; load is recreated
    // when monthStart or effectiveUserId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId, monthKey, reloadNonce]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  return { kids, lessons, appointments, vacationBlocks, loading, reload };
}
