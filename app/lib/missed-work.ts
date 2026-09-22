// Missed work: ONE definition, for Today and Plan.
//
// "Missed" is a question about past school days: which lessons would have been
// due between the day after a curriculum's last completion (or its start date)
// and yesterday, at most 14 days back, and never before the day after the
// family last answered the catch-up question for it. It is projected from the
// curriculum's settings and reads no lesson dates, so re-dating rows (a parent
// action, or the daily reconciliation) never answers it. Only an answer does:
// a completion, or "not done" recorded by markCatchupAnswered.
//
// Plan used to call a lesson missed when its STORED date was before today.
// That drifted from Today whenever dates were re-dated: one lesson marked on
// its planned past day re-dated the rest, and Plan's list emptied while Today
// still asked about them.
//
// A lesson nobody has marked stays next in the queue, so an overdue lesson is
// usually also on today's list. `also_today` says so.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeGapLessonsForGoal,
  computeTodayLessons,
  loadPinsByGoal,
  toGoalConfig,
  GOAL_CONFIG_COLUMNS,
  type GoalConfigRow,
  type QueueHold,
  type VacationBlock,
} from "./scheduler.ts";
import { gapStartAfterAnswer, type MissedEntry } from "./recoverySelection.ts";
import { addDays, startOfDayInTzAsUtc, ymdInTz } from "./timezone.ts";

/** A family back from a long break gets the last two weeks, not two hundred rows. */
export const MAX_GAP_DAYS = 14;

export type MissedWorkGoal = GoalConfigRow & {
  start_date?: string | null;
  catchup_answered_on?: string | null;
};

/** Newest completion per goal, from rows sorted newest first. */
export function latestCompletionByGoal(
  rows: Array<{ curriculum_goal_id: string | null; completed_at: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.curriculum_goal_id || !r.completed_at) continue;
    if (!out.has(r.curriculum_goal_id)) out.set(r.curriculum_goal_id, r.completed_at);
  }
  return out;
}

/**
 * The first day this goal's missed work can be on. The day after its last
 * completion (local), else its start date; floored at MAX_GAP_DAYS back; and
 * never on or before the day the catch-up question was last answered for it.
 * Null when there is nothing to anchor to.
 */
export function gapStartForGoal(args: {
  lastCompletedIso: string | null | undefined;
  startDate: string | null | undefined;
  answeredOn: string | null | undefined;
  todayMid: Date;
}): Date | null {
  const earliest = new Date(args.todayMid);
  earliest.setDate(earliest.getDate() - MAX_GAP_DAYS);
  let anchor: Date | null = null;
  if (args.lastCompletedIso) {
    anchor = new Date(args.lastCompletedIso);
    anchor.setHours(0, 0, 0, 0);
    anchor.setDate(anchor.getDate() + 1);
  } else if (args.startDate) {
    anchor = new Date(args.startDate + "T00:00:00");
  }
  if (!anchor) return null;
  const floored = anchor < earliest ? earliest : anchor;
  return gapStartAfterAnswer(floored, args.answeredOn ?? null);
}

/**
 * Every goal's missed entries, each flagged when the same lesson is also on
 * today's list. A family with no completions at all gets nothing: the wizard
 * owns their welcome, and there is no gap for work never begun.
 */
export function computeMissedWork(args: {
  goals: MissedWorkGoal[];
  lastCompletedByGoal: Map<string, string>;
  anyCompletion: boolean;
  todayMid: Date;
  vacations: VacationBlock[];
  holdsByGoal: Map<string, readonly QueueHold[]>;
  doneTodayByGoal: Map<string, number>;
}): Map<string, MissedEntry[]> {
  const out = new Map<string, MissedEntry[]>();
  if (!args.anyCompletion) return out;
  for (const goal of args.goals) {
    if ((goal.current_lesson ?? 0) >= (goal.total_lessons ?? 0)) continue;
    const gapStart = gapStartForGoal({
      lastCompletedIso: args.lastCompletedByGoal.get(goal.id),
      startDate: goal.start_date,
      answeredOn: goal.catchup_answered_on,
      todayMid: args.todayMid,
    });
    if (!gapStart) continue;
    const cfg = toGoalConfig(goal);
    const holds = args.holdsByGoal.get(goal.id) ?? [];
    // A skipped lesson is never offered as one they might have done.
    const gap = computeGapLessonsForGoal(cfg, gapStart, args.todayMid, args.vacations, holds);
    if (gap.length === 0) continue;
    const todaySlots = new Set(
      computeTodayLessons([cfg], args.todayMid, args.vacations, args.doneTodayByGoal, args.holdsByGoal)
        .map((p) => p.lesson_number),
    );
    out.set(
      goal.id,
      gap.map((p) => ({
        goal_id: goal.id,
        lesson_number: p.lesson_number,
        date: p.date,
        also_today: todaySlots.has(p.lesson_number),
      })),
    );
  }
  return out;
}

export type MissedWorkGoalRow = MissedWorkGoal & {
  curriculum_name: string;
  subject_label: string | null;
  child_id: string | null;
};

/**
 * Load everything computeMissedWork needs and run it: for a screen that does
 * not already hold Today's data (Plan). Null when a read failed, so the caller
 * can keep what it showed rather than claim nothing is missed.
 */
export async function loadMissedWork(
  supabase: SupabaseClient,
  userId: string,
  opts: { timezone?: string; now?: Date } = {},
): Promise<{ goals: MissedWorkGoalRow[]; entriesByGoal: Map<string, MissedEntry[]> } | null> {
  const now = opts.now ?? new Date();
  const tz = opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = ymdInTz(now, tz);
  const dayStart = startOfDayInTzAsUtc(day, tz).toISOString();
  const dayEnd = startOfDayInTzAsUtc(addDays(day, 1), tz).toISOString();
  const [goalsRes, vacRes, compRes, todayRes, holdsByGoal] = await Promise.all([
    supabase
      .from("curriculum_goals")
      .select(`${GOAL_CONFIG_COLUMNS}, catchup_answered_on, curriculum_name, subject_label, child_id`)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase.from("vacation_blocks").select("start_date, end_date").eq("user_id", userId),
    supabase
      .from("lessons")
      .select("curriculum_goal_id, completed_at")
      .eq("user_id", userId)
      .eq("completed", true)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(500),
    supabase
      .from("lessons")
      .select("curriculum_goal_id")
      .eq("user_id", userId)
      .eq("completed", true)
      .gte("completed_at", dayStart)
      .lt("completed_at", dayEnd)
      .not("curriculum_goal_id", "is", null),
    loadPinsByGoal(supabase, userId),
  ]);
  if (goalsRes.error || vacRes.error || compRes.error || todayRes.error || !goalsRes.data) return null;
  const goals = goalsRes.data as unknown as MissedWorkGoalRow[];
  const comps = (compRes.data ?? []) as Array<{ curriculum_goal_id: string | null; completed_at: string | null }>;
  const doneTodayByGoal = new Map<string, number>();
  for (const r of (todayRes.data ?? []) as Array<{ curriculum_goal_id: string | null }>) {
    if (r.curriculum_goal_id) doneTodayByGoal.set(r.curriculum_goal_id, (doneTodayByGoal.get(r.curriculum_goal_id) ?? 0) + 1);
  }
  const entriesByGoal = computeMissedWork({
    goals,
    lastCompletedByGoal: latestCompletionByGoal(comps),
    anyCompletion: comps.length > 0,
    todayMid: new Date(day + "T00:00:00"),
    vacations: ((vacRes.data ?? []) as VacationBlock[]).map((v) => ({ start_date: v.start_date, end_date: v.end_date })),
    holdsByGoal,
    doneTodayByGoal,
  });
  return { goals, entriesByGoal };
}
