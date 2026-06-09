"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type {
  PlanV2Activity,
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
  /** Active recurring activities. Occurrence math (which dates they land on)
   *  lives in activityOccurrences.ts — this is the raw row set. */
  activities: PlanV2Activity[];
  loading: boolean;
  reload: () => void;
  /** Exposed so consumers can run optimistic updates via usePlanLessonActions. */
  setLessons: React.Dispatch<React.SetStateAction<PlanV2Lesson[]>>;
  /** Exposed for optimistic appointment toggles (Phase 10 fix). */
  setAppointments: React.Dispatch<React.SetStateAction<PlanV2Appointment[]>>;
  setActivities: React.Dispatch<React.SetStateAction<PlanV2Activity[]>>;
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
  const [activities, setActivities] = useState<PlanV2Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const monthKey = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
  const cancelRef = useRef(false);

  const load = useCallback(async () => {
    if (!effectiveUserId) {
      setKids([]); setLessons([]); setAppointments([]); setVacationBlocks([]); setActivities([]);
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

    // Pre-fetch archived goal IDs so we can hide their lesson rows from the
    // calendar. "Mark as finished" sets curriculum_goals.archived=true but
    // intentionally leaves the lesson history in place; without this filter
    // those completed lessons keep rendering on past dates and the user
    // can't clear them. Standalone lessons (curriculum_goal_id IS NULL)
    // stay visible — PostgREST's `not.in` treats NULL as not-in-set.
    const { data: archivedGoalsData } = await supabase
      .from("curriculum_goals")
      .select("id")
      .eq("user_id", effectiveUserId)
      .eq("archived", true);
    const archivedGoalIds = ((archivedGoalsData ?? []) as { id: string }[]).map((g) => g.id);

    // No `is_backfill` filter on purpose. The Plan calendar shows the full
    // history of the family's work, including the "Log past hours" entries
    // and the wizard-generated backfill rows for past start_dates. Today
    // page filters `is_backfill !== true` separately so backfill rows stay
    // out of the daily checklist; the Plan calendar wants the opposite.
    let lessonReq = supabase
      .from("lessons")
      .select("id, title, lesson_number, completed, child_id, scheduled_date, date, curriculum_goal_id, hours, minutes_spent, notes, scheduled_source, completed_at, subjects(name, color), curriculum_goals(subject_label)")
      .eq("user_id", effectiveUserId)
      .gte("scheduled_date", startStr)
      .lte("scheduled_date", endStr)
      .order("lesson_number", { ascending: true });
    if (archivedGoalIds.length > 0) {
      lessonReq = lessonReq.not("curriculum_goal_id", "in", `(${archivedGoalIds.join(",")})`);
    }

    const apptReq = token
      ? fetch(`/api/appointments?date=${startStr}&end=${endStr}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => (r.ok ? r.json() : []))
      : Promise.resolve([]);

    // Activities aren't date-windowed in the query — recurrence is expanded
    // client-side over the visible grid (see activityOccurrences.ts), so we
    // pull every active row once and let the grid decide which dates it lands
    // on. created_at is the biweekly cadence anchor.
    const actReq = supabase
      .from("activities")
      .select("id, name, emoji, frequency, days, start_date, end_date, duration_minutes, child_ids, location, created_at")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true);

    try {
      const [cRes, vRes, lRes, aRes, actRes] = await Promise.all([childrenReq, vacReq, lessonReq, apptReq, actReq]);
      if (cancelRef.current) return;
      setKids((cRes.data ?? []) as PlanV2Child[]);
      setVacationBlocks((vRes.data ?? []) as PlanV2Vacation[]);
      setLessons((lRes.data ?? []) as unknown as PlanV2Lesson[]);
      setAppointments(Array.isArray(aRes) ? (aRes as PlanV2Appointment[]) : []);
      setActivities((actRes.data ?? []) as unknown as PlanV2Activity[]);
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

  return { kids, lessons, appointments, vacationBlocks, activities, loading, reload, setLessons, setAppointments, setActivities };
}
