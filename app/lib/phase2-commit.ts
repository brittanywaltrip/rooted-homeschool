// The Schedule Builder's phase 2 commit: one curriculum's lesson rebuild,
// planned in full, validated in full, then written as ONE transaction.
//
// Sentry ROOTED-HOMESCHOOL-1Q (2026-09-21). A family unticked a lesson
// recorded as done before they started tracking. The pointer could not follow
// it back, so it sat unfinished behind the pointer, on today, invisible to
// every projection. The next save put the next lesson on the same day. The
// pre-write check counted only the rows it was about to insert; the post-write
// check counted everything and threw after the delete and every insert had
// committed, as separate browser requests with no transaction.
//
// So, for each curriculum:
//   1. PLAN (app/dashboard/plan/schedule/page.tsx, with planPhase2Rows and the
//      projector): what to delete, insert, re-date, pin and retire.
//   2. VALIDATE (validatePhase2End, here): the COMPLETE resulting row set,
//      kept rows and completed work included, day by day, before anything is
//      written.
//   3. COMMIT (applyPhase2Commit, here): public.apply_builder_rebuild, which
//      re-reads the rows under lock, refuses a plan made against rows that
//      have since changed (including any row it would retire or delete that
//      now carries notes or minutes), writes everything, and re-checks
//      capacity inside the same transaction. A failure anywhere, or a missing
//      function, writes nothing. There is no client-side fallback.
//
// Pure except applyPhase2Commit. No "@/" imports: node --test runs this file
// directly (strip-only TypeScript).

import type { SupabaseClient } from "@supabase/supabase-js";

/** A lesson row as phase 2 reads it. */
export type Phase2CommitRow = {
  id: string;
  lesson_number: number | null;
  queue_position: number | null;
  completed: boolean;
  completed_at?: string | null;
  queue_pinned: boolean | null;
  skipped?: boolean | null;
  scheduled_date: string | null;
  date?: string | null;
  notes?: string | null;
  minutes_spent?: number | null;
  title?: string | null;
};

/** A row phase 2 inserts: history (completed) or the forward queue. */
export type Phase2Insert = {
  child_id: string | null;
  lesson_number: number;
  queue_position: number | null;
  title: string;
  scheduled_date: string;
  scheduled_source: "wizard_create";
  completed: boolean;
  completed_at?: string | null;
  is_backfill?: boolean;
  minutes_spent?: number | null;
  hours: number;
};

/** Everything one curriculum's rebuild writes, decided before any write. */
export type Phase2CommitPlan = {
  /** Live-queue pins a schedule change releases. */
  unpin_ids: string[];
  /** Unpinned rows behind the pointer, dated today or later, that become make-ups. */
  makeup_ids: string[];
  /** Unfinished rows the rebuild replaces. Never completed, pinned-kept, skipped, or carrying work. */
  delete_ids: string[];
  inserts: Phase2Insert[];
  /** Retire unfinished rows past this lesson number (a shortened curriculum), or null. */
  retire_above: number | null;
  /** Rows past the new end that carry notes or minutes: unscheduled, not deleted. */
  retire_keep_ids: string[];
  /** Kept rows the rebuild re-dates. */
  redates: { id: string; to: string }[];
};

/** The goal fields a plan was made from, as apply_builder_rebuild compares them. */
export type Phase2GoalSnapshot = {
  total_lessons: number;
  current_lesson: number;
  start_at_lesson: number;
  lessons_per_day: number;
  lessons_per_day_overrides: Record<string, number> | null;
  school_days: string[] | null;
  start_date: string | null;
};

export function holdsParentWork(r: { notes?: string | null; minutes_spent?: number | null }): boolean {
  return (r.notes != null && r.notes.trim().length > 0) || r.minutes_spent != null;
}

/** "Completed today" the way Today counts it: completed_at inside the local day. */
export function countDoneToday(
  rows: readonly Pick<Phase2CommitRow, "completed" | "completed_at">[],
  dayStartIso: string,
  dayEndIso: string,
): number {
  const start = Date.parse(dayStartIso);
  const end = Date.parse(dayEndIso);
  let n = 0;
  for (const r of rows) {
    if (!r.completed || !r.completed_at) continue;
    const t = Date.parse(r.completed_at);
    if (t >= start && t < end) n++;
  }
  return n;
}

/**
 * What apply_builder_rebuild compares before it writes anything. Rows are
 * sorted by id so the database builds the identical array; any difference in
 * any of these fields means the plan was made against rows that have changed.
 */
export function phase2Expected(a: {
  goal: Phase2GoalSnapshot;
  rows: readonly Phase2CommitRow[];
  dayStartIso: string;
  dayEndIso: string;
}) {
  const rows = [...a.rows]
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .map((r) => [
      r.id,
      r.lesson_number,
      r.queue_position,
      r.completed,
      r.queue_pinned ?? false,
      r.skipped ?? false,
      r.scheduled_date,
    ]);
  return {
    goal: {
      total_lessons: a.goal.total_lessons,
      current_lesson: a.goal.current_lesson,
      start_at_lesson: a.goal.start_at_lesson,
      lessons_per_day: a.goal.lessons_per_day,
      lessons_per_day_overrides: a.goal.lessons_per_day_overrides,
      school_days: a.goal.school_days,
      start_date: a.goal.start_date,
    },
    rows,
    day_start: a.dayStartIso,
    day_end: a.dayEndIso,
  };
}

/** A row in the simulated end state. `placed` = this plan decided its date. */
export type Phase2EndRow = {
  id: string;
  lesson_number: number | null;
  queue_position: number | null;
  completed: boolean;
  queue_pinned: boolean;
  skipped: boolean;
  scheduled_date: string | null;
  notes: string | null;
  minutes_spent: number | null;
  placed: boolean;
  inserted: boolean;
};

/** The rows the curriculum will hold once `plan` commits, derived without a database. */
export function simulatePhase2End(
  beforeRows: readonly Phase2CommitRow[],
  plan: Phase2CommitPlan,
): Phase2EndRow[] {
  const deleted = new Set(plan.delete_ids);
  const unpin = new Set(plan.unpin_ids);
  const makeup = new Set(plan.makeup_ids);
  const retireKeep = new Set(plan.retire_keep_ids);
  const redate = new Map(plan.redates.map((r) => [r.id, r.to]));
  const out: Phase2EndRow[] = [];
  for (const r of beforeRows) {
    if (deleted.has(r.id)) continue;
    const retiring =
      plan.retire_above != null && !r.completed && r.lesson_number != null && r.lesson_number > plan.retire_above;
    if (retiring && !retireKeep.has(r.id)) continue;
    const pinned = (r.queue_pinned ?? false) && !unpin.has(r.id);
    const row: Phase2EndRow = {
      id: r.id,
      lesson_number: r.lesson_number,
      queue_position: r.queue_position,
      completed: r.completed,
      queue_pinned: pinned || makeup.has(r.id),
      skipped: r.skipped ?? false,
      scheduled_date: redate.get(r.id) ?? r.scheduled_date,
      notes: r.notes ?? null,
      minutes_spent: r.minutes_spent ?? null,
      placed: redate.has(r.id),
      inserted: false,
    };
    if (retiring) {
      row.scheduled_date = null;
      row.queue_position = null;
      row.queue_pinned = false;
      row.placed = false;
    }
    out.push(row);
  }
  plan.inserts.forEach((ins, i) => {
    out.push({
      id: `insert:${i}`,
      lesson_number: ins.lesson_number,
      queue_position: ins.queue_position,
      completed: ins.completed,
      queue_pinned: false,
      skipped: false,
      scheduled_date: ins.scheduled_date,
      notes: null,
      minutes_spent: ins.minutes_spent ?? null,
      placed: !ins.completed,
      inserted: true,
    });
  });
  return out;
}

export type Phase2Validation = {
  /** Days where lessons this plan placed exceed what the day has room for. Refuses the save. */
  overCapacity: { date: string; placed: number; room: number }[];
  /** Days where the family's own pins exceed the pace. Reported, never refused (Invariant 2 carve-out). */
  pinStacks: { date: string; pinned: number; allowed: number }[];
  /** Anything else the plan must never do. Refuses the save. */
  integrity: string[];
};

/**
 * Validate the COMPLETE result of a plan, before anything is written.
 *
 * Capacity, for every day from today on: the lessons this plan placed must fit
 * in what the day allows after the lessons already done today (they count
 * against today's pace) and every other unfinished lesson dated there (pins,
 * make-ups, and anything the rebuild keeps where it is). The same rule runs
 * again inside apply_builder_rebuild, on the rows as written.
 */
export function validatePhase2End(a: {
  beforeRows: readonly Phase2CommitRow[];
  plan: Phase2CommitPlan;
  endRows: readonly Phase2EndRow[];
  todayYmd: string;
  doneToday: number;
  currentLesson: number;
  perDayAllowed: (ymd: string) => number;
}): Phase2Validation {
  const placed = new Map<string, number>();
  const other = new Map<string, number>();
  const pinned = new Map<string, number>();
  for (const r of a.endRows) {
    if (r.completed || r.skipped || !r.scheduled_date || r.scheduled_date < a.todayYmd) continue;
    const d = r.scheduled_date;
    if (r.placed && !r.queue_pinned) placed.set(d, (placed.get(d) ?? 0) + 1);
    else other.set(d, (other.get(d) ?? 0) + 1);
    if (r.queue_pinned) pinned.set(d, (pinned.get(d) ?? 0) + 1);
  }
  const overCapacity: Phase2Validation["overCapacity"] = [];
  for (const [date, n] of placed) {
    const done = date === a.todayYmd ? a.doneToday : 0;
    const room = Math.max(0, a.perDayAllowed(date) - done - (other.get(date) ?? 0));
    if (n > room) overCapacity.push({ date, placed: n, room });
  }
  overCapacity.sort((x, y) => (x.date < y.date ? -1 : 1));
  const pinStacks: Phase2Validation["pinStacks"] = [];
  for (const [date, n] of pinned) {
    const allowed = a.perDayAllowed(date);
    if (n > allowed) pinStacks.push({ date, pinned: n, allowed });
  }
  pinStacks.sort((x, y) => (x.date < y.date ? -1 : 1));

  const integrity: string[] = [];
  const before = new Map(a.beforeRows.map((r) => [r.id, r]));
  for (const id of a.plan.delete_ids) {
    const r = before.get(id);
    if (!r) integrity.push(`delete names a row the goal does not hold (${id})`);
    else if (r.completed) integrity.push(`delete would remove completed lesson ${r.lesson_number}`);
    else if (r.skipped) integrity.push(`delete would remove skipped lesson ${r.lesson_number}`);
    else if (holdsParentWork(r)) integrity.push(`delete would erase the family's notes or minutes on lesson ${r.lesson_number}`);
    else if (r.queue_pinned && !a.plan.unpin_ids.includes(id)) integrity.push(`delete would remove pinned lesson ${r.lesson_number}`);
    else if (r.queue_position != null && r.queue_position <= a.currentLesson) {
      integrity.push(`delete would remove reopened lesson ${r.lesson_number} behind the pointer`);
    }
  }
  for (const t of a.plan.redates) {
    const r = before.get(t.id);
    if (!r) integrity.push(`re-date names a row the goal does not hold (${t.id})`);
    else if (r.completed) integrity.push(`re-date would move completed lesson ${r.lesson_number}`);
    else if (r.queue_pinned && !a.plan.unpin_ids.includes(t.id)) integrity.push(`re-date would move pinned lesson ${r.lesson_number}`);
    else if (t.to < a.todayYmd) integrity.push(`re-date would move lesson ${r.lesson_number} into the past`);
  }
  for (const ins of a.plan.inserts) {
    if (!ins.completed && ins.lesson_number <= a.currentLesson) {
      integrity.push(`insert would schedule lesson ${ins.lesson_number} at or below the starting position`);
    }
    if (!ins.completed && ins.scheduled_date < a.todayYmd) {
      integrity.push(`insert would date unfinished lesson ${ins.lesson_number} in the past`);
    }
  }
  const nums = new Map<number, number>();
  const slots = new Map<number, number>();
  for (const r of a.endRows) {
    if (r.lesson_number != null) nums.set(r.lesson_number, (nums.get(r.lesson_number) ?? 0) + 1);
    if (r.queue_position != null) slots.set(r.queue_position, (slots.get(r.queue_position) ?? 0) + 1);
  }
  for (const [n, c] of nums) if (c > 1) integrity.push(`lesson ${n} would exist ${c} times`);
  for (const [q, c] of slots) if (c > 1) integrity.push(`queue slot ${q} would be held ${c} times`);
  return { overCapacity, pinStacks, integrity };
}

export type Phase2CommitResult =
  | { status: "applied"; inserted: number; redated: number }
  | {
      /**
       * stale: rows changed since they were read (retry re-reads and re-plans).
       * unavailable: apply_builder_rebuild is not on this database (retryable,
       * and reported: the release order puts the migration first).
       * failed: the transaction failed and wrote nothing (retryable).
       * refused / invalid: the database rejected the plan; deterministic.
       */
      status: "stale" | "refused" | "invalid" | "failed" | "unavailable";
      reason: string;
    };

/** PostgREST's "function not found": the migration is not on this database yet. */
function isMissingFunction(err: { code?: string } | null | undefined): boolean {
  return err?.code === "PGRST202";
}

/**
 * Write one curriculum's plan through apply_builder_rebuild: one transaction,
 * all of it or none of it, against rows re-checked under lock.
 *
 * There is deliberately NO client-side fallback. If the function is missing
 * or the call fails, nothing is written and the caller gets a retryable
 * status. A rebuild written as separate browser requests is what left
 * curricula half rebuilt before this (Sentry ROOTED-HOMESCHOOL-1Q).
 */
export async function applyPhase2Commit(
  supabase: SupabaseClient,
  a: {
    goalId: string;
    localDay: string;
    expected: ReturnType<typeof phase2Expected>;
    plan: Phase2CommitPlan;
  },
): Promise<Phase2CommitResult> {
  const { data, error } = await supabase.rpc("apply_builder_rebuild", {
    p_goal_id: a.goalId,
    p_local_day: a.localDay,
    p_expected: a.expected,
    p_plan: a.plan,
  });
  if (error) {
    if (isMissingFunction(error as { code?: string })) {
      return { status: "unavailable", reason: "apply_builder_rebuild is not deployed on this database" };
    }
    return { status: "failed", reason: (error as { message?: string }).message ?? "rpc error" };
  }
  const res = (data ?? {}) as { status?: string; reason?: string; inserted?: number; redated?: number };
  if (res.status === "applied") {
    return { status: "applied", inserted: res.inserted ?? 0, redated: res.redated ?? 0 };
  }
  const status = res.status === "stale" || res.status === "refused" || res.status === "invalid" ? res.status : "failed";
  return { status, reason: res.reason ?? "unknown" };
}

/**
 * Turn phase 2's row decisions into the plan it commits, and validate the
 * complete result. Pure: the Schedule Builder calls exactly this.
 *
 * Every kept row in the live queue that is unfinished and not pinned takes
 * the projector's date for its slot (Invariant 18, widened from rows carrying
 * notes or minutes: a kept row left on a stale date is a lesson the projector
 * has already given that day to someone else). Pinned rows (Invariant 12),
 * skipped rows (Invariant 22) and rows behind the pointer (Invariant 23) are
 * never re-dated.
 */
export function planPhase2Commit(a: {
  beforeRows: readonly Phase2CommitRow[];
  survivors: readonly Phase2CommitRow[];
  deletedIds: ReadonlySet<string>;
  /** Live-queue pins a schedule change releases (empty unless it changed). */
  releasedIds: ReadonlySet<string>;
  makeUpIds: ReadonlySet<string>;
  behindIds: ReadonlySet<string>;
  projDateBySlot: ReadonlyMap<number, string>;
  inserts: Phase2Insert[];
  totalLessons: number | null;
  todayYmd: string;
  doneToday: number;
  currentLesson: number;
  perDayAllowed: (ymd: string) => number;
}) {
  const redates: { id: string; to: string; from: string | null }[] = [];
  for (const r of a.survivors) {
    if (r.completed || r.skipped || a.behindIds.has(r.id) || a.makeUpIds.has(r.id)) continue;
    if (r.queue_pinned && !a.releasedIds.has(r.id)) continue;
    if (r.queue_position == null) continue;
    const to = a.projDateBySlot.get(r.queue_position);
    if (to === undefined) continue;
    redates.push({ id: r.id, to, from: r.scheduled_date });
  }
  // Shortening a curriculum retires the unfinished rows past the new end; one
  // carrying the parent's notes or minutes is unscheduled instead of deleted
  // (Invariant 18).
  const retireKeepIds = a.beforeRows
    .filter(
      (r) =>
        !r.completed &&
        r.lesson_number != null &&
        a.totalLessons != null &&
        r.lesson_number > a.totalLessons &&
        holdsParentWork(r),
    )
    .map((r) => r.id);
  const plan: Phase2CommitPlan = {
    unpin_ids: [...a.releasedIds],
    makeup_ids: [...a.makeUpIds],
    delete_ids: [...a.deletedIds],
    inserts: a.inserts,
    retire_above: a.totalLessons ?? null,
    retire_keep_ids: retireKeepIds,
    redates: redates.map((t) => ({ id: t.id, to: t.to })),
  };
  const endRows = simulatePhase2End(a.beforeRows, plan);
  const validation = validatePhase2End({
    beforeRows: a.beforeRows,
    plan,
    endRows,
    todayYmd: a.todayYmd,
    doneToday: a.doneToday,
    currentLesson: a.currentLesson,
    perDayAllowed: a.perDayAllowed,
  });
  return { redates, plan, endRows, validation };
}
