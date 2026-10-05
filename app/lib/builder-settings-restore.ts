// A refused Builder rebuild must not leave the curriculum's new scheduling
// settings paired with its old lessons. Phase 1 writes the settings before
// phase 2 builds the lessons, so when phase 2 provably wrote nothing, the
// Schedule Builder puts the settings it changed back the way they were.
//
// Pure decisions only. The page does the reads and the write.

/** The curriculum_goals columns that shape the lesson schedule. */
export const SCHEDULE_FIELDS = [
  "total_lessons",
  "lessons_per_day",
  "lessons_per_day_overrides",
  "school_days",
  "start_date",
  "start_at_lesson",
] as const;

export type ScheduleField = (typeof SCHEDULE_FIELDS)[number];
export type ScheduleSnapshot = Partial<Record<ScheduleField, unknown>>;

/** Pick the schedule columns present on a row or payload. */
export function scheduleSnapshot(source: Record<string, unknown>): ScheduleSnapshot {
  const out: ScheduleSnapshot = {};
  for (const f of SCHEDULE_FIELDS) if (f in source) out[f] = source[f] ?? null;
  return out;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The values to write back: only the columns phase 1 wrote and actually
 * changed. Empty when phase 1 changed no scheduling setting.
 */
export function restorePatch(before: ScheduleSnapshot, written: ScheduleSnapshot): ScheduleSnapshot {
  const patch: ScheduleSnapshot = {};
  for (const f of SCHEDULE_FIELDS) {
    if (!(f in written)) continue;
    if (!same(before[f], written[f])) patch[f] = before[f] ?? null;
  }
  return patch;
}

/**
 * PostgREST filters that match the row only while it still holds exactly what
 * phase 1 wrote, so the restore never overwrites a change made since.
 */
export function stillAsWrittenFilters(written: ScheduleSnapshot, patch: ScheduleSnapshot): Array<[string, string, string]> {
  const filters: Array<[string, string, string]> = [];
  for (const f of SCHEDULE_FIELDS) {
    if (!(f in patch)) continue;
    const v = written[f];
    if (v === null || v === undefined) filters.push([f, "is", "null"]);
    else if (Array.isArray(v)) filters.push([f, "eq", `{${v.map((x) => `"${String(x).replace(/["\\]/g, "\\$&")}"`).join(",")}}`]);
    else if (typeof v === "object") filters.push([f, "eq", JSON.stringify(v)]);
    else filters.push([f, "eq", String(v)]);
  }
  return filters;
}

const NOT_APPLIED = Symbol.for("rooted.phase2NotApplied");

/** Mark a phase 2 error that is known to have written no lesson rows. */
export function markNotApplied<E>(err: E): E {
  if (err && typeof err === "object") (err as Record<symbol, boolean>)[NOT_APPLIED] = true;
  return err;
}

export function wasNotApplied(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as Record<symbol, boolean>)[NOT_APPLIED] === true;
}

/**
 * An apply_builder_rebuild outcome the database decided (refused, invalid,
 * stale, or failed and rolled back). A transport error is not one: the call
 * may have committed even though the response never arrived.
 */
export function isDecidedNotApplied(result: { status: string; transport?: boolean }): boolean {
  return result.status !== "applied" && !result.transport;
}

// ── Atomic settings (20261001000000) ──────────────────────────────────────
// For an existing curriculum, phase 1 no longer writes the scheduling columns.
// The changed values travel in the rebuild plan and apply_builder_rebuild
// writes them in the same transaction as the lessons.

/** The new values of the scheduling columns phase 1 would have changed. */
export function changedSettings(before: ScheduleSnapshot, written: ScheduleSnapshot): ScheduleSnapshot {
  const out: ScheduleSnapshot = {};
  for (const f of SCHEDULE_FIELDS) {
    if (!(f in written)) continue;
    if (!same(before[f], written[f])) out[f] = written[f] ?? null;
  }
  return out;
}

/** The database pointer rule (recompute_curriculum_current_lesson). */
export function pointerFor(a: { startAtLesson: number | null; totalLessons: number | null; maxCompletedSlot: number }): number {
  const value = Math.max((a.startAtLesson ?? 1) - 1, a.maxCompletedSlot);
  return a.totalLessons != null ? Math.min(value, a.totalLessons) : value;
}

type CleanupRow = { completed: boolean; scheduled_date: string | null; queue_pinned: boolean | null; lesson_number: number | null; queue_position: number | null; notes: string | null };

/**
 * The rows the orphan cleanup trigger leaves when the pointer rises from
 * `from` to `to` (trg_curriculum_goals_cleanup_orphans). The plan is made
 * against these, and the database checks it saw the same. Only slotted rows
 * are released (20261005000000): a lesson with no queue slot keeps the date
 * the family gave it.
 */
export function afterOrphanCleanup<R extends CleanupRow>(rows: readonly R[], from: number, to: number): R[] {
  if (!(to > from)) return rows.slice();
  return rows.map((r) =>
    !r.completed && r.scheduled_date != null && r.queue_position != null && !(r.queue_pinned ?? false) && r.lesson_number != null &&
    r.lesson_number <= to && (r.notes == null || r.notes === "")
      ? { ...r, scheduled_date: null }
      : r,
  );
}

