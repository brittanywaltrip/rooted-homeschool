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

import { isCalendarRefusal, type ReconcileBlock } from "./calendar-refusal.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planDailyReconcile, splitDoneToday, toGoalConfig, type DoneTodaySplit, type GoalConfigRow, type VacationBlock } from "./scheduler.ts";
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
  /** Refusal needs an explicit retry, never automatic polling. */
  blocked?: ReconcileBlock["kind"];
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
  opts: { timezone?: string; now?: Date; verifyCalendar?: boolean } = {},
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
  const doneTodayFor = async (goalId: string): Promise<DoneTodaySplit | null> => {
    const { data, error } = await supabase
      .from("lessons")
      .select("id, queue_position")
      .eq("user_id", userId)
      .eq("curriculum_goal_id", goalId)
      .eq("completed", true)
      .gte("completed_at", dayStart)
      .lt("completed_at", dayEnd);
    if (error || !data) return null;
    // Queue lessons rewind onto today; unslotted ones hold today (splitDoneToday).
    return splitDoneToday(data as { queue_position: number | null }[]);
  };

  let shared = await loadShared();
  if (!shared) {
    run.retry = true;
    run.results.push({ goalId: "*", status: "error", written: 0, reason: "read_failed" });
    return run;
  }

  // Explicit retries must verify the calendar even if the cache now needs no
  // writes. Otherwise a "nothing" result could clear an unresolved mismatch.
  if (opts.verifyCalendar && shared.goals.length) {
    try {
      const {data,error}=await supabase.rpc("read_cascade_snapshot",{p_goal_id:shared.goals[0].id,p_local_day:day,p_day_start:dayStart,p_day_end:dayEnd});
      if(error || data?.status!=='ready' || Date.parse(data.snapshot?.dayStartIso)!==Date.parse(dayStart) || Date.parse(data.snapshot?.dayEndIso)!==Date.parse(dayEnd)) {
        const calendar=!error && (isCalendarRefusal(data?.reason) || data?.status==='ready');
        return {...run,retry:true,blocked:calendar?'calendar':'refused',results:[{goalId:shared.goals[0].id,status:'invalid',written:0,reason:calendar?'calendar_mismatch':'calendar_check_failed'}]};
      }
    } catch { return {...run,retry:true,blocked:'refused',results:[{goalId:'*',status:'error',written:0,reason:'calendar_check_failed'}]}; }
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
          preserved: plan.preserved ?? [],
          skipped: plan.skipped,
          // apply_daily_reconcile checks every completion today, slotted or not.
          done_today: doneToday.slotted + doneToday.unslotted,
          day_start: dayStart,
          day_end: dayEnd,
        },
        p_writes: plan.moves,
      });
      // The function not existing yet (app deployed before the migration)
      // means the job is not available, exactly like the switch being off:
      // nothing is written and the family is not told something failed.
      if (error && (error as { code?: string }).code === "PGRST202") {
        outcome = { goalId: goal.id, status: "disabled", written: 0, reason: "function_missing" };
        break;
      }
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
  const refused=run.results.filter(r=>r.status==='invalid');
  if(refused.length) run.blocked=refused.some(r=>isCalendarRefusal(r.reason))?'calendar':'refused';
  if(opts.verifyCalendar&&run.disabled)run.blocked='refused';
  run.retry = !!run.blocked || run.results.some((r) => r.status === "error" || r.status === "stale");
  return run;
}

/**
 * One per tab. Runs the reconciliation when the tab first loads and whenever
 * the local day has changed since the last SETTLED run, so an open tab left
 * overnight reconciles on its next tick, focus or visibility change. A run that
 * failed or stayed stale is not settled: the next trigger retries it, but no
 * sooner than `retryAfterMs` after the failure (a new day retries at once).
 * Explicit refusals remain blocked across days and require trigger(true).
 * Manual retries share the in-flight promise and a 30-second cooldown;
 * initialBlock/onBlocked let the UI persist that marker across reloads.
 * Never two runs at once in the same tab. `onFailure` fires at most once per
 * local day; `onSettled` fires when a later run finishes, so a page can keep a
 * failure note up until then rather than flash it while it is still loading.
 *
 * A run that found the switch off counts as settled for that day: the tab
 * stops calling until the next day or the next page load.
 */
export function createDailyReconcileRunner(deps: {
  run: (now: Date, explicit: boolean) => Promise<DailyReconcileRun>;
  now: () => Date;
  dayOf: (d: Date) => string;
  retryAfterMs?: number;
  manualRetryAfterMs?: number;
  initialBlock?: ReconcileBlock | null;
  onBlocked?: (block: ReconcileBlock) => void;
  onRedated?: (run: DailyReconcileRun) => void;
  onFailure?: (run: DailyReconcileRun | null, err?: unknown) => void;
  onSettled?: (run: DailyReconcileRun) => void;
}) {
  const retryAfterMs = deps.retryAfterMs ?? 5 * 60_000;
  let blocked: ReconcileBlock | null = deps.initialBlock ?? null;
  let lastManualAt = blocked ? blocked.retryAt - (deps.manualRetryAfterMs ?? 30_000) : -Infinity;
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
    trigger(explicit = false): Promise<DailyReconcileRun | null> {
      if (inFlight) return inFlight;
      const now = deps.now();
      const day = deps.dayOf(now);
      if (explicit) {
        if(now.getTime()<lastManualAt+(deps.manualRetryAfterMs??30_000)) return Promise.resolve(null);
        lastManualAt=now.getTime();
        if(blocked) { blocked={...blocked,retryAt:lastManualAt+(deps.manualRetryAfterMs??30_000)};deps.onBlocked?.(blocked); }
      } else if(blocked) return Promise.resolve(null);
      if (settledDay === day) return Promise.resolve(null);
      if (!explicit && failedDay === day && now.getTime() - failedAt < retryAfterMs) return Promise.resolve(null);
      inFlight = deps
        .run(now, explicit)
        .then((r) => {
          if (r.written > 0) deps.onRedated?.(r);
          if(r.blocked) {
            blocked={kind:r.blocked,day:r.day,retryAt:Number.isFinite(lastManualAt)?lastManualAt+(deps.manualRetryAfterMs??30_000):now.getTime()};
            deps.onBlocked?.(blocked);
          } else if (r.retry) {
            // A failed explicit check must not erase an earlier refusal.
            if(blocked) { blocked={...blocked,retryAt:lastManualAt+(deps.manualRetryAfterMs??30_000)};deps.onBlocked?.(blocked); }
            else fail(r.day, r);
          } else {
            blocked=null;
            settledDay = r.day;
            deps.onSettled?.(r);
          }
          return r;
        })
        .catch((err) => {
          if(blocked) { blocked={...blocked,retryAt:lastManualAt+(deps.manualRetryAfterMs??30_000)};deps.onBlocked?.(blocked); }
          else fail(day, null, err);
          return null;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    get blocked() { return blocked; },
    get settledDay() {
      return settledDay;
    },
  };
}

/** Shown on Today and Plan while a run could not finish, until one does. */
export const DAILY_RECONCILE_FAILED_NOTE =
  "Couldn't bring your plan's dates up to today. Rooted will try again.";
