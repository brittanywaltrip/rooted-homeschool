import type { SupabaseClient } from "@supabase/supabase-js";

/* ============================================================================
 * move-keep-slot.ts: moving one lesson to a later day without renumbering the
 * queue.
 *
 * Plan's "Move just this lesson" promises "Only this lesson moves. Lessons
 * after it stay on their dates." It used move_lesson_to_date, which gives the
 * moved lesson a new queue_position and slides the lessons in between down a
 * slot. Plan reads stored dates and kept the promise; Today projects slots
 * from today and did not: move lesson 4 off today and Today showed lesson 5,
 * which Plan still had on Friday. The same renumbering made "Shift all
 * remaining lessons forward" pull the later lessons EARLIER, and made a later
 * completion strand a lesson behind the pointer where no screen shows it.
 *
 * public.move_lesson_keep_slot never touches queue_position. The lesson is
 * pinned on its new day, and with `holdBetween` every later unfinished lesson
 * dated from today through that day is held where it is (pinned,
 * scheduled_source 'plan_hold'), because the pin would otherwise push them
 * past it. `planKeepSlotMove` is the same rule in TypeScript, for the tests;
 * the function is what runs. supabase/tests/move-keep-slot/run.sh rehearses
 * the SQL.
 *
 * No "@/" imports at module scope: node --test is strip-only.
 * ==========================================================================*/

/** scheduled_source on a lesson held in place by "Move just this lesson". */
export const MOVE_HOLD_SOURCE = "plan_hold";

/** A row as the function reports it: the state BEFORE it wrote. */
export interface KeepSlotRow {
  id: string;
  lesson_number: number | null;
  queue_position: number | null;
  scheduled_date: string | null;
  date: string | null;
  queue_pinned: boolean | null;
  scheduled_source: string | null;
}

export type KeepSlotMoveResult =
  /** Written. `moved` and `held` carry each row's prior state, for Undo. */
  | { status: "moved"; moved: KeepSlotRow; held: KeepSlotRow[] }
  /** A shape this path does not own (one-off, completed, skipped, earlier day). Nothing written. */
  | { status: "not_movable"; reason: string }
  /** The database does not have the function yet (PGRST202). Nothing written. */
  | { status: "unavailable" }
  /** Refused or failed. Nothing written: the function is one transaction. */
  | { status: "failed"; reason: string };

function asRow(v: unknown): KeepSlotRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  return {
    id: o.id,
    lesson_number: typeof o.lesson_number === "number" ? o.lesson_number : null,
    queue_position: typeof o.queue_position === "number" ? o.queue_position : null,
    scheduled_date: typeof o.scheduled_date === "string" ? o.scheduled_date : null,
    date: typeof o.date === "string" ? o.date : null,
    queue_pinned: typeof o.queue_pinned === "boolean" ? o.queue_pinned : null,
    scheduled_source: typeof o.scheduled_source === "string" ? o.scheduled_source : null,
  };
}

/** Read the RPC's answer. Pure, so every shape is tested without a database. */
export function parseKeepSlotMove(
  data: unknown,
  error: { code?: string; message?: string } | null,
): KeepSlotMoveResult {
  if (error) {
    if (error.code === "PGRST202") return { status: "unavailable" };
    return { status: "failed", reason: error.message ?? "error" };
  }
  const o = (data ?? {}) as Record<string, unknown>;
  if (o.status === "moved") {
    const moved = asRow(o.moved);
    const held = Array.isArray(o.held) ? o.held.map(asRow) : [];
    if (!moved || held.some((h) => h === null)) return { status: "failed", reason: "malformed" };
    return { status: "moved", moved, held: held as KeepSlotRow[] };
  }
  if (o.status === "not_movable") return { status: "not_movable", reason: String(o.reason ?? "") };
  return { status: "failed", reason: String(o.reason ?? o.status ?? "unknown") };
}

export async function moveLessonKeepSlot(
  supabase: SupabaseClient,
  args: { lessonId: string; targetDate: string; localDay: string; holdBetween: boolean },
): Promise<KeepSlotMoveResult> {
  try {
    const { data, error } = await supabase.rpc("move_lesson_keep_slot", {
      p_lesson_id: args.lessonId,
      p_target_date: args.targetDate,
      p_local_day: args.localDay,
      p_hold_between: args.holdBetween,
    });
    return parseKeepSlotMove(data, error);
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "error" };
  }
}

/**
 * What Undo writes: every row the move changed, back to its prior date, pin
 * and source. No queue_position, because none changed. Moved row first.
 */
export function keepSlotUndoRows(result: { moved: KeepSlotRow; held: KeepSlotRow[] }): KeepSlotRow[] {
  return [result.moved, ...result.held];
}

/** The rows `planKeepSlotMove` reads. */
export interface KeepSlotPlanRow {
  id: string;
  queue_position: number | null;
  scheduled_date: string | null;
  completed?: boolean | null;
  skipped?: boolean | null;
  queue_pinned?: boolean | null;
}

/**
 * The function's rule, in TypeScript: which rows "Move just this lesson"
 * holds. Unfinished, unskipped, unpinned lessons later in the queue than the
 * moved one, dated from `localDay` through `targetDate`. Nothing for a make-up
 * (a slot at or below `currentLesson`), which holds no place in the queue.
 * Returns null for a move the function refuses.
 */
export function planKeepSlotMove(args: {
  rows: readonly KeepSlotPlanRow[];
  lessonId: string;
  targetDate: string;
  localDay: string;
  currentLesson: number;
  holdBetween: boolean;
}): { holdIds: string[] } | null {
  const moved = args.rows.find((r) => r.id === args.lessonId);
  if (!moved || moved.completed || moved.skipped || moved.queue_position == null) return null;
  if (moved.scheduled_date != null && args.targetDate <= moved.scheduled_date) return null;
  if (!args.holdBetween || moved.queue_position <= args.currentLesson) return { holdIds: [] };
  const slot = moved.queue_position;
  const holdIds = args.rows
    .filter(
      (r) =>
        r.id !== moved.id &&
        !r.completed &&
        !r.skipped &&
        !r.queue_pinned &&
        r.queue_position != null &&
        r.queue_position > slot &&
        r.scheduled_date != null &&
        r.scheduled_date >= args.localDay &&
        r.scheduled_date <= args.targetDate,
    )
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0))
    .map((r) => r.id);
  return { holdIds };
}

/* ── "I'm actually on lesson X" ────────────────────────────────────────── */

/**
 * Has this curriculum's queue drifted from book order? True when, read in
 * lesson_number order, the slots do not rise: some lesson sits in the queue
 * ahead of a lesson that comes before it in the book. A drift is left by a Plan
 * move made with move_lesson_to_date (every move before this change, and still
 * a move to an earlier day). Slots that skip a number but keep the order are
 * not a drift; restore_queue_book_order leaves those alone too.
 */
export function queueOutOfBookOrder(
  rows: readonly { lesson_number: number | null; queue_position: number | null }[],
): boolean {
  const slotted = rows
    .filter((r) => r.lesson_number != null && r.queue_position != null)
    .sort((a, b) => (a.lesson_number as number) - (b.lesson_number as number));
  for (let i = 1; i < slotted.length; i++) {
    if ((slotted[i].queue_position as number) < (slotted[i - 1].queue_position as number)) return true;
  }
  return false;
}

/**
 * The curriculum as restore_queue_book_order leaves it, computed without
 * writing: each slotted row takes the slot at its rank in book order (the same
 * set of slots, reassigned in lesson_number order), and the pointer is what the
 * lessons trigger then computes, GREATEST(start_at_lesson - 1, the highest
 * completed slot), capped at total_lessons. The "I'm actually on" form words
 * its question from this view and the write restores the order before reading,
 * so the two name the same lessons.
 */
export function bookOrderView<T extends { lesson_number: number | null; queue_position: number | null; completed?: boolean | null }>(
  rows: readonly T[],
  goal: { start_at_lesson: number | null; total_lessons: number | null },
): { rows: T[]; currentLesson: number; drifted: boolean } {
  const slotted = rows.filter((r) => r.lesson_number != null && r.queue_position != null);
  const slots = slotted.map((r) => r.queue_position as number).sort((a, b) => a - b);
  const byNumber = [...slotted].sort((a, b) => (a.lesson_number as number) - (b.lesson_number as number));
  const slotFor = new Map<T, number>(byNumber.map((r, i) => [r, slots[i]]));
  const out = rows.map((r) => (slotFor.has(r) ? { ...r, queue_position: slotFor.get(r)! } : r));
  const maxDone = out.reduce((m, r) => (r.completed && r.queue_position != null ? Math.max(m, r.queue_position) : m), 0);
  let current = Math.max((goal.start_at_lesson ?? 1) - 1, maxDone);
  if (goal.total_lessons != null) current = Math.min(current, goal.total_lessons);
  return { rows: out, currentLesson: current, drifted: queueOutOfBookOrder(rows) };
}

export type RestoreBookOrderResult =
  | { status: "restored"; changed: number }
  | { status: "in_order" }
  | { status: "unavailable" }
  | { status: "failed"; reason: string };

export function parseRestoreBookOrder(
  data: unknown,
  error: { code?: string; message?: string } | null,
): RestoreBookOrderResult {
  if (error) {
    if (error.code === "PGRST202") return { status: "unavailable" };
    return { status: "failed", reason: error.message ?? "error" };
  }
  const o = (data ?? {}) as Record<string, unknown>;
  if (o.status === "restored") return { status: "restored", changed: Number(o.changed ?? 0) };
  if (o.status === "in_order") return { status: "in_order" };
  return { status: "failed", reason: String(o.reason ?? o.status ?? "unknown") };
}

/**
 * Put the curriculum's queue back in book order: the slots it already holds,
 * reassigned in lesson_number order, in one transaction. Only "I'm actually
 * on lesson X" calls it, because the family has just told us where they are
 * in the book. Nothing does it automatically.
 */
export async function restoreQueueBookOrder(
  supabase: SupabaseClient,
  goalId: string,
  localDay: string,
): Promise<RestoreBookOrderResult> {
  try {
    const { data, error } = await supabase.rpc("restore_queue_book_order", {
      p_goal_id: goalId,
      p_local_day: localDay,
    });
    return parseRestoreBookOrder(data, error);
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "error" };
  }
}
