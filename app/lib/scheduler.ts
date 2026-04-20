import type { SupabaseClient } from "@supabase/supabase-js";

// Day index conventions: Mon=0..Sun=6 for school_days / school_days bool arrays
// (matches the wizard and plan page). getDay() → Sun=0..Sat=6, so translate with
// (d.getDay() + 6) % 7.

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_LABEL_TO_IDX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

export function schoolDaysToBool(days: string[] | null | undefined): boolean[] {
  const list = days && days.length > 0 ? days : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return DAY_LABELS.map((d) => list.includes(d));
}

export function isSchoolDayIdx(date: Date, schoolDaysBool: boolean[]): boolean {
  const idx = (date.getDay() + 6) % 7;
  return !!schoolDaysBool[idx];
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Recompute `current_lesson` from actual lesson rows and write it back to the
 * goal. Canonical formula:
 *   current_lesson = max(start_at_lesson - 1, max(lesson_number) of completed rows, 0)
 * and never exceeds total_lessons.
 *
 * This is the single source of truth for progress. Call it after ANY write
 * that could change the completion state of a lesson (complete, uncomplete,
 * delete, insert, backfill).
 */
export async function recomputeCurrentLesson(
  supabase: SupabaseClient,
  goalId: string,
): Promise<number | null> {
  const { data: goal } = await supabase
    .from("curriculum_goals")
    .select("total_lessons, start_at_lesson")
    .eq("id", goalId)
    .maybeSingle();
  if (!goal) return null;

  const total = (goal as { total_lessons: number | null }).total_lessons ?? 0;
  const startAt = (goal as { start_at_lesson: number | null }).start_at_lesson ?? 1;

  const { data: completedRows } = await supabase
    .from("lessons")
    .select("lesson_number")
    .eq("curriculum_goal_id", goalId)
    .eq("completed", true)
    .not("lesson_number", "is", null)
    .order("lesson_number", { ascending: false })
    .limit(1);

  const maxCompleted = (completedRows?.[0] as { lesson_number: number | null } | undefined)?.lesson_number ?? 0;
  const floor = Math.max(0, startAt - 1);
  let value = Math.max(floor, maxCompleted);
  if (total > 0) value = Math.min(value, total);

  await supabase
    .from("curriculum_goals")
    .update({ current_lesson: value })
    .eq("id", goalId);

  return value;
}

/**
 * Heal a goal's lesson rows to match invariants:
 *   - completed=true implies completed_at IS NOT NULL
 *   - delete incomplete duplicate lesson_number rows (keep one)
 *
 * Does NOT delete completed duplicates or rows with NULL lesson_number —
 * those need human review. Does NOT create missing rows (caller does that).
 */
export async function healGoalIntegrity(
  supabase: SupabaseClient,
  goalId: string,
): Promise<void> {
  // 1. Fix ghost completions: completed=true + completed_at=null → set completed_at
  //    from scheduled_date (or date) at noon UTC.
  const { data: ghostRows } = await supabase
    .from("lessons")
    .select("id, scheduled_date, date")
    .eq("curriculum_goal_id", goalId)
    .eq("completed", true)
    .is("completed_at", null);
  const ghosts = (ghostRows ?? []) as { id: string; scheduled_date: string | null; date: string | null }[];
  for (const g of ghosts) {
    const d = g.scheduled_date ?? g.date;
    const ts = d ? `${d}T12:00:00Z` : new Date().toISOString();
    await supabase.from("lessons").update({ completed_at: ts }).eq("id", g.id);
  }

  // 2. Remove incomplete duplicates: for each lesson_number with >1 row where
  //    at least one is incomplete, keep the completed one (or the earliest) and
  //    delete the extra incomplete rows.
  const { data: allRows } = await supabase
    .from("lessons")
    .select("id, lesson_number, completed, created_at")
    .eq("curriculum_goal_id", goalId)
    .not("lesson_number", "is", null);
  const rows = (allRows ?? []) as { id: string; lesson_number: number; completed: boolean; created_at: string }[];
  const byNum = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byNum.get(r.lesson_number) ?? [];
    list.push(r);
    byNum.set(r.lesson_number, list);
  }
  const toDelete: string[] = [];
  for (const [, list] of byNum) {
    if (list.length < 2) continue;
    // Prefer keeping a completed row; else keep the earliest created_at.
    const keeperIdx = list.findIndex((r) => r.completed);
    const keeper = keeperIdx >= 0 ? list[keeperIdx] : list.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    for (const r of list) {
      if (r.id === keeper.id) continue;
      if (r.completed) continue; // don't delete completed dupes
      toDelete.push(r.id);
    }
  }
  for (let i = 0; i < toDelete.length; i += 100) {
    await supabase.from("lessons").delete().in("id", toDelete.slice(i, i + 100));
  }
}

/**
 * Find the next lesson_number that needs a row for this goal.
 * Returns the smallest N in [1..totalLessons] that has no row, or null if
 * the goal is fully populated. Honors start_at_lesson floor when looking at
 * gaps only past the floor.
 */
export async function nextMissingLessonNumber(
  supabase: SupabaseClient,
  goalId: string,
  totalLessons: number,
  startAtLesson: number,
): Promise<number | null> {
  const { data } = await supabase
    .from("lessons")
    .select("lesson_number")
    .eq("curriculum_goal_id", goalId)
    .not("lesson_number", "is", null);
  const existing = new Set<number>(
    ((data ?? []) as { lesson_number: number }[]).map((r) => r.lesson_number),
  );
  const floor = Math.max(1, startAtLesson);
  for (let n = floor; n <= totalLessons; n++) {
    if (!existing.has(n)) return n;
  }
  return null;
}

/**
 * Collect school days (as yyyy-mm-dd strings) starting at startDate, skipping
 * vacation blocks, until we have `count` dates. Packs `perDay` lessons onto
 * each school day, so N lessons use Math.ceil(N / perDay) days.
 *
 * Returns pairs of (date, lessonSlot) — lessonSlot is the 0-indexed position
 * within the day (0..perDay-1). Caller is responsible for mapping to lesson
 * numbers.
 */
export function collectSchoolDaySlots(
  startDate: Date,
  schoolDaysBool: boolean[],
  vacationBlocks: { start_date: string; end_date: string }[],
  perDay: number,
  count: number,
): { date: string; slot: number }[] {
  const result: { date: string; slot: number }[] = [];
  const cursor = new Date(startDate);
  let safety = 0;
  while (result.length < count && safety < 3650) {
    const dateStr = toDateStr(cursor);
    const idx = (cursor.getDay() + 6) % 7;
    const inVac = vacationBlocks.some((b) => dateStr >= b.start_date && dateStr <= b.end_date);
    if (schoolDaysBool[idx] && !inVac) {
      for (let s = 0; s < perDay && result.length < count; s++) {
        result.push({ date: dateStr, slot: s });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }
  return result;
}

export { DAY_LABELS, DAY_LABEL_TO_IDX };
