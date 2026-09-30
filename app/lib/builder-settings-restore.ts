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
