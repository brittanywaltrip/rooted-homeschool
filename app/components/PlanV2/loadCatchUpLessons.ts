/**
 * The catch-up flows' view of the whole schedule.
 *
 * Push Back and Shift Forward act on EVERY goal, so their input has to be
 * every uncompleted scheduled lesson the family has, not the visible grid
 * and not the first 1,000 rows. PostgREST answers any unranged select with
 * at most `db-max-rows` (1,000) and gives no sign it stopped. 45 families are
 * past that; one holds 1,950 uncompleted scheduled rows. For her the old
 * single read returned the earliest 1,000, so `future` was truncated, the
 * goal set derived from [...missed, ...future] missed every curriculum whose
 * open rows all fall late in the year, and a confirm re-projected some
 * subjects and not others. The load exists precisely to refuse a partial
 * schedule, and it could not tell it had one.
 *
 * Two paged reads now, through lib/supabase-all-rows.ts, each ordered by
 * (scheduled_date, id) so the page boundary is stable:
 *   - missed: scheduled before today, the full row, because the modal
 *     previews these.
 *   - future: scheduled today or later, only the columns the flows use (the
 *     affected goal ids and the count). NOT bounded to a window: a goal
 *     whose next open row is in May must still count as affected.
 * Either read failing returns null, and both openers close their modal with
 * "Couldn't load your whole schedule, nothing moved", which is now true.
 *
 * Relative imports (not "@/...") so this resolves under both the Next.js
 * bundler and the raw `node --test` runner.
 */

import type { PlanV2Lesson } from "./types.ts";
import { selectAllRowsResult } from "../../../lib/supabase-all-rows.ts";

export type CatchUpRow = Pick<
  PlanV2Lesson,
  "id" | "title" | "lesson_number" | "scheduled_date" | "date"
> & { child_id: string | null; curriculum_goal_id: string | null };

/** The upcoming half carries only what the flows read from it. */
export type CatchUpGoalRow = Pick<
  CatchUpRow,
  "id" | "scheduled_date" | "date" | "child_id" | "curriculum_goal_id"
>;

export type CatchUpSets = { missed: CatchUpRow[]; future: CatchUpGoalRow[] };

/** The full row, for the missed half the modal previews. */
export const MISSED_COLUMNS =
  "id, title, lesson_number, scheduled_date, date, child_id, curriculum_goal_id, queue_pinned";

/** Just enough to know which goals are affected and how many rows there are. */
export const FUTURE_COLUMNS = "id, child_id, curriculum_goal_id, scheduled_date, date";

type RowPage = { data: unknown; error: { message: string } | null };

/**
 * The slice of a supabase-js query builder this loader touches, typed
 * structurally so the unit tests can hand in a fake without casting.
 */
export type CatchUpFilter = PromiseLike<RowPage> & {
  eq(column: string, value: unknown): CatchUpFilter;
  not(column: string, operator: string, value: unknown): CatchUpFilter;
  lt(column: string, value: unknown): CatchUpFilter;
  gte(column: string, value: unknown): CatchUpFilter;
  or(filters: string): CatchUpFilter;
  order(column: string, options?: { ascending?: boolean }): CatchUpFilter;
  range(from: number, to: number): PromiseLike<RowPage>;
};

export type CatchUpClient = {
  from(table: string): { select(columns: string): CatchUpFilter };
};

/**
 * The archived-goal exclusion, shared by both halves.
 *
 * Deliberately NOT a bare `.not("curriculum_goal_id","in",...)`. That compiles
 * to `NOT (col IN (...))`, which evaluates to NULL (and so drops the row) for
 * standalone lessons with no goal. Verified against the DB: the bare form
 * keeps 0 of the incomplete no-goal rows, this explicit IS NULL branch keeps
 * all of them.
 */
export function archivedGoalFilter(archivedGoalIds: readonly string[]): string | null {
  if (archivedGoalIds.length === 0) return null;
  return `curriculum_goal_id.is.null,curriculum_goal_id.not.in.(${archivedGoalIds.join(",")})`;
}

export type LoadCatchUpArgs = {
  userId: string;
  /** YYYY-MM-DD in the family's timezone. */
  todayStr: string;
  /** Rows per page; the default is PostgREST's cap. Tests lower it. */
  pageSize?: number;
};

/**
 * Every uncompleted scheduled lesson for the family, split at today.
 * Returns null when any read fails, so callers can abort without writing.
 */
export async function loadCatchUpRows(
  client: CatchUpClient,
  { userId, todayStr, pageSize }: LoadCatchUpArgs,
): Promise<CatchUpSets | null> {
  const { data: archivedData, error: archivedErr } = await client
    .from("curriculum_goals")
    .select("id")
    .eq("user_id", userId)
    .eq("archived", true);
  if (archivedErr) return null;
  const archivedGoalIds = ((archivedData ?? []) as { id: string }[]).map((g) => g.id);
  const exclusion = archivedGoalFilter(archivedGoalIds);

  const base = (columns: string) => {
    let q = client
      .from("lessons")
      .select(columns)
      .eq("user_id", userId)
      .eq("completed", false)
      .not("scheduled_date", "is", null);
    if (exclusion) q = q.or(exclusion);
    return q;
  };

  const [missedRes, futureRes] = await Promise.all([
    selectAllRowsResult<CatchUpRow>(
      (from, to) =>
        base(MISSED_COLUMNS)
          .lt("scheduled_date", todayStr)
          .order("scheduled_date", { ascending: true })
          // The tie-breaker that makes the pages stable. scheduled_date is
          // nowhere near unique for the families this is for (the 2,341-row
          // family has 170 dates carrying more than one open row), and
          // PostgreSQL does not promise the same tie order for LIMIT 1000 and
          // LIMIT 1000 OFFSET 1000, so without a unique second key a row can
          // land on both pages or on neither. Neither is the missing goal.
          .order("id", { ascending: true })
          .range(from, to),
      pageSize,
    ),
    selectAllRowsResult<CatchUpGoalRow>(
      (from, to) =>
        base(FUTURE_COLUMNS)
          .gte("scheduled_date", todayStr)
          .order("scheduled_date", { ascending: true })
          // The tie-breaker that makes the pages stable. scheduled_date is
          // nowhere near unique for the families this is for (the 2,341-row
          // family has 170 dates carrying more than one open row), and
          // PostgreSQL does not promise the same tie order for LIMIT 1000 and
          // LIMIT 1000 OFFSET 1000, so without a unique second key a row can
          // land on both pages or on neither. Neither is the missing goal.
          .order("id", { ascending: true })
          .range(from, to),
      pageSize,
    ),
  ]);
  if (missedRes.error || !missedRes.data) return null;
  if (futureRes.error || !futureRes.data) return null;

  const missed = missedRes.data;
  const future = futureRes.data;
  // For the health check: the counts that a capped read used to hide.
  console.debug(
    `[catch-up] read the whole schedule: ${missed.length} missed, ${future.length} upcoming` +
      ` (${archivedGoalIds.length} archived goal(s) excluded)`,
  );
  return { missed, future };
}
