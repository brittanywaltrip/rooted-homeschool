// Once-a-day reconciliation of stored lesson dates.
//
// Plan reads each lesson's stored scheduled_date; Today projects from the queue
// pointer. The automatic page-load reconciler (queue_resync) is off, and parent
// actions re-date only when a parent acts, so when a school day passes with the
// family behind or ahead of plan, Plan drifts from Today. This re-dates each
// curriculum's unfinished, unpinned, unskipped, non-backfill lessons to what
// Today projects, at most once per curriculum per local day.
//
// The browser only PROPOSES. The write goes through apply_daily_reconcile, which
// reads the server-side switch at execution time, enforces the once-a-day claim
// across tabs and devices, and refuses ('stale') if anything the proposal was
// computed from changed since: the pointer, pace, school days, overrides, start,
// breaks, pins, skips, today's completions, or any row's date. A refusal or a
// failure writes nothing and does not mark the day, so it is simply retried.
//
// The local day and today's-completion window use the browser's timezone, the
// same rules as Today and the parent re-dates (resyncGoalsForParent).

import type { SupabaseClient } from "@supabase/supabase-js";
import { planDailyReconcile, toGoalConfig, type GoalConfigRow, type VacationBlock } from "./scheduler.ts";
import { addDays, startOfDayInTzAsUtc, ymdInTz } from "./timezone.ts";

export type ReconcileStatus =
  | "applied"   // moved rows and marked the day
  | "already"   // another tab or device already did this curriculum today
  | "nothing"   // stored dates already match; no call made
  | "disabled"  // the server switch is off
  | "stale"     // something changed while computing, twice; not marked, retried later
  | "invalid"   // refused as malformed or not the caller's
  | "error";    // a read or the call failed; not marked, retried later

export interface GoalReconcileResult {
  goalId: string;
  status: ReconcileStatus;
  written: number;
  reason?: string;
}

export interface DailyReconcileRun {
  /** The local day this run was for (YYYY-MM-DD in the browser's timezone). */
  day: string;
  results: GoalReconcileResult[];
  /** Rows moved across all curricula. */
  written: number;
  /** The switch was off. */
  disabled: boolean;
  /** Something failed or stayed stale: the day must NOT be treated as settled. */
  retry: boolean;
}

const RAW_GOAL_COLUMNS =
  "id, total_lessons, current_lesson, lessons_per_day, lessons_per_day_overrides, school_days, start_date";

type RawGoal = GoalConfigRow & { lessons_per_day_overrides?: Record<string, number> | null };

/** The goal values exactly as stored: what the RPC compares them with. */
function expectedGoal(g: RawGoal) {
  return {
    total_lessons: g.total_lessons,
    current_lesson: g.current_lesson,
    lessons_per_day: g.lessons_per_day,
    lessons_per_day_overrides: g.lessons_per_day_overrides ?? null,
    school_days: g.school_days ?? null,
    start_date: g.start_date ?? null,
  };
}

export async function reconcileForDay(
  supabase: SupabaseClient,
  userId: string,
  opts: { timezone?: string; now?: Date } = {},
): Promise<DailyReconcileRun> {
  const now = opts.now ?? new Date();
  const tz = opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = ymdInTz(now, tz);
  const dayStart = startOfDayInTzAsUtc(day, tz).toISOString();
  const dayEnd = startOfDayInTzAsUtc(addDays(day, 1), tz).toISOString();
  const run: DailyReconcileRun = { day, results: [], written: 0, disabled: false, retry: false };

  const loadShared = async () => {
    const [{ data: goals, error: gErr }, { data: vac, error: vErr }] = await Promise.all([
      supabase.from("curriculum_goals").select(RAW_GOAL_COLUMNS).eq("user_id", userId).eq("archived", false),
      supabase.from("vacation_blocks").select("start_date, end_date").eq("user_id", userId)
        .order("start_date", { ascending: true }).order("end_date", { ascending: true }),
    ]);
    if (gErr || vErr || !goals) return null;
    const vacations = ((vac ?? []) as VacationBlock[]).map((v) => ({ start_date: v.start_date, end_date: v.end_date }));
    return { goals: goals as unknown as RawGoal[], vacations };
  };
  const doneTodayFor = async (goalId: string): Promise<number | null> => {
    const { data, error } = await supabase
      .from("lessons")
      .select("id")
      .eq("user_id", userId)
      .eq("curriculum_goal_id", goalId)
      .eq("completed", true)
      .gte("completed_at", dayStart)
      .lt("completed_at", dayEnd);
    if (error || !data) return null;
    return (data as unknown[]).length;
  };

  let shared = await loadShared();
  if (!shared) {
    run.retry = true;
    run.results.push({ goalId: "*", status: "error", written: 0, reason: "read_failed" });
    return run;
  }

  for (const first of shared.goals) {
    let goal = first;
    let outcome: GoalReconcileResult = { goalId: goal.id, status: "error", written: 0 };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const doneToday = await doneTodayFor(goal.id);
      if (doneToday == null) { outcome = { goalId: goal.id, status: "error", written: 0, reason: "read_failed" }; break; }
      const plan = await planDailyReconcile(supabase, toGoalConfig(goal), shared.vacations, doneToday, now);
      if (!plan.ok) { outcome = { goalId: goal.id, status: "error", written: 0, reason: plan.reason }; break; }
      if (plan.moves.length === 0) { outcome = { goalId: goal.id, status: "nothing", written: 0 }; break; }
      const { data, error } = await supabase.rpc("apply_daily_reconcile", {
        p_goal_id: goal.id,
        p_local_day: day,
        p_expected: {
          goal: expectedGoal(goal),
          vacations: shared.vacations.map((v) => [v.start_date, v.end_date]),
          pins: plan.pins,
          skipped: plan.skipped,
          done_today: doneToday,
          day_start: dayStart,
          day_end: dayEnd,
        },
        p_writes: plan.moves,
      });
      if (error || !data) { outcome = { goalId: goal.id, status: "error", written: 0, reason: error?.message }; break; }
      const res = data as { status: ReconcileStatus; written?: number; reason?: string };
      outcome = { goalId: goal.id, status: res.status, written: res.written ?? 0, reason: res.reason };
      if (res.status !== "stale" || attempt === 2) break;
      // Something changed while we computed (usually a parent action a moment
      // ago). Re-read and try once more from the fresh state.
      const fresh = await loadShared();
      const again = fresh?.goals.find((g) => g.id === goal.id);
      if (!fresh || !again) { outcome = { goalId: goal.id, status: "error", written: 0, reason: "read_failed" }; break; }
      shared = fresh;
      goal = again;
    }
    run.results.push(outcome);
    run.written += outcome.written;
    if (outcome.status === "disabled") { run.disabled = true; break; }
  }
  run.retry = run.results.some((r) => r.status === "error" || r.status === "stale");
  return run;
}

/**
 * One per tab. Runs the reconciliation when the tab first loads and whenever
 * the local day has changed since the last SETTLED run, so an open tab left
 * overnight reconciles on its next tick, focus or visibility change. A run that
 * failed or stayed stale is not settled: the next trigger retries it, but no
 * sooner than `retryAfterMs` after the failure (a new day retries at once).
 * Never two runs at once in the same tab. `onFailure` fires at most once per
 * local day, so a family sees one notice, not one a minute.
 *
 * A run that found the switch off counts as settled for that day: the tab
 * stops calling until the next day or the next page load.
 */
export function createDailyReconcileRunner(deps: {
  run: (now: Date) => Promise<DailyReconcileRun>;
  now: () => Date;
  dayOf: (d: Date) => string;
  retryAfterMs?: number;
  onRedated?: (run: DailyReconcileRun) => void;
  onFailure?: (run: DailyReconcileRun | null, err?: unknown) => void;
}) {
  const retryAfterMs = deps.retryAfterMs ?? 5 * 60_000;
  let settledDay: string | null = null;
  let failedDay: string | null = null;
  let failedAt = 0;
  let notifiedDay: string | null = null;
  let inFlight: Promise<DailyReconcileRun | null> | null = null;

  const fail = (day: string, run: DailyReconcileRun | null, err?: unknown) => {
    failedDay = day;
    failedAt = deps.now().getTime();
    if (notifiedDay === day) return;
    notifiedDay = day;
    deps.onFailure?.(run, err);
  };

  return {
    trigger(): Promise<DailyReconcileRun | null> {
      if (inFlight) return inFlight;
      const now = deps.now();
      const day = deps.dayOf(now);
      if (settledDay === day) return Promise.resolve(null);
      if (failedDay === day && now.getTime() - failedAt < retryAfterMs) return Promise.resolve(null);
      inFlight = deps
        .run(now)
        .then((r) => {
          if (r.written > 0) deps.onRedated?.(r);
          if (r.retry) fail(r.day, r);
          else settledDay = r.day;
          return r;
        })
        .catch((err) => {
          fail(day, null, err);
          return null;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    get settledDay() {
      return settledDay;
    },
  };
}

/** Said once per day per tab when a run could not finish. */
export const DAILY_RECONCILE_FAILED_NOTE =
  "Couldn't bring your plan's dates up to today. Rooted will try again.";
