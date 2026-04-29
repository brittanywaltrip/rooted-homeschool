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
 * Pick the date to start a forward lesson schedule from. Forward lessons
 * begin on the next calendar day STRICTLY AFTER today, unless the user
 * picked a startDate later than that — in which case we honor it.
 *
 * The day-by-day walk in the caller will skip non-school days and vacation
 * blocks from this start, so the first lesson lands on the first school
 * day strictly after today (or after the user's pick).
 *
 * Why "strictly after today" and not "today onwards": if the user already
 * has lessons going (or just backfilled history through yesterday), placing
 * the next batch on today suddenly bloats today's count. If they paused and
 * are restarting, today belongs to the prior pattern and the new schedule
 * should kick in tomorrow.
 */
export function forwardScheduleStart(userPickedStart: Date, today: Date): Date {
  const todayMid = new Date(today);
  todayMid.setHours(0, 0, 0, 0);
  const tomorrow = new Date(todayMid);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const pick = new Date(userPickedStart);
  pick.setHours(0, 0, 0, 0);
  return pick > tomorrow ? pick : tomorrow;
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

/**
 * Returns the Nth school day strictly after afterDate (1-indexed: N=1 → next
 * school day). schoolDays uses the Mon=0..Sun=6 label convention.
 */
export function nthSchoolDay(afterDate: string, schoolDays: string[], n: number): string {
  const activeDays = new Set(schoolDays.map((d) => DAY_LABEL_TO_IDX[d] ?? -1));
  const cursor = new Date(afterDate + "T12:00:00");
  let found = 0;
  for (let i = 0; i < 365; i++) {
    cursor.setDate(cursor.getDate() + 1);
    if (activeDays.has((cursor.getDay() + 6) % 7)) {
      found++;
      if (found === n) return toDateStr(cursor);
    }
  }
  return toDateStr(cursor);
}

/**
 * Minimal lesson shape consumed by the missed-lesson reschedule planners.
 * Pages pass their full Lesson rows in — the planners only read these fields.
 */
export type ReschedulableLesson = {
  id: string;
  scheduled_date: string | null;
  date?: string | null;
  curriculum_goal_id?: string | null;
};

/**
 * "Add to my next school day(s)" — places each missed lesson on the next
 * available school day, sequentially starting from todayStr. Pure: returns
 * the planned updates and undo data; the caller writes to the DB.
 */
export function planAddToNextSchoolDays(
  missed: ReschedulableLesson[],
  getSchoolDaysForLesson: (lesson: ReschedulableLesson) => string[],
  todayStr: string,
): {
  updates: { id: string; newDate: string }[];
  undoData: { lessonId: string; date: string }[];
} {
  const undoData = missed.map((l) => ({
    lessonId: l.id,
    date: l.scheduled_date ?? l.date ?? todayStr,
  }));
  const updates: { id: string; newDate: string }[] = [];
  for (let i = 0; i < missed.length; i++) {
    const schoolDays = getSchoolDaysForLesson(missed[i]);
    const targetDate = nthSchoolDay(todayStr, schoolDays, i + 1);
    updates.push({ id: missed[i].id, newDate: targetDate });
  }
  return { updates, undoData };
}

/**
 * "Push schedule back N school days" — shifts each future incomplete lesson
 * forward by `missed.length` school days, then fills the vacated slots with
 * the missed lessons. Pure: returns updates + undo data.
 */
export function planPushBackNDays(
  missed: ReschedulableLesson[],
  futureLessons: ReschedulableLesson[],
  getSchoolDaysForLesson: (lesson: ReschedulableLesson) => string[],
  todayStr: string,
): {
  updates: { id: string; newDate: string }[];
  undoData: { lessonId: string; date: string }[];
} {
  const n = missed.length;
  const undoData = [
    ...missed.map((l) => ({ lessonId: l.id, date: l.scheduled_date ?? l.date ?? todayStr })),
    ...futureLessons.map((l) => ({ lessonId: l.id, date: l.scheduled_date ?? l.date ?? todayStr })),
  ];
  const futureUpdates: { id: string; newDate: string }[] = [];
  for (const lesson of futureLessons) {
    const schoolDays = getSchoolDaysForLesson(lesson);
    const orig = lesson.scheduled_date ?? lesson.date ?? todayStr;
    const newDate = nthSchoolDay(orig, schoolDays, n);
    futureUpdates.push({ id: lesson.id, newDate });
  }
  const missedUpdates: { id: string; newDate: string }[] = [];
  for (let i = 0; i < n; i++) {
    const schoolDays = getSchoolDaysForLesson(missed[i]);
    const slot = nthSchoolDay(todayStr, schoolDays, i + 1);
    missedUpdates.push({ id: missed[i].id, newDate: slot });
  }
  return { updates: [...futureUpdates, ...missedUpdates], undoData };
}

/**
 * After mom logs an "extra" lesson today (i.e., she completed lesson N+1 a
 * day early), this plans how to re-spread her remaining incomplete future
 * lessons onto upcoming school days at `perDay` density, packed tightly
 * starting the first school day strictly AFTER today.
 *
 * Inputs:
 *   - `incomplete` MUST already be sorted by `lesson_number` ASC and MUST
 *     exclude `is_backfill` rows and rows dated <= today. The caller filters.
 *   - `schoolDays` uses the Mon=0..Sun=6 label convention.
 *
 * Output: `updates` is the planned date assignments; `undoData` captures the
 * original dates for an undo toast. Pure: caller writes to the DB.
 *
 * The result is "compress by exactly one school day" relative to a baseline
 * that included the now-completed extra: with one fewer slot to fill, the
 * schedule fits in one less school day.
 */
export function planCompressAfterExtra(
  incomplete: ReschedulableLesson[],
  schoolDays: string[],
  perDay: number,
  todayStr: string,
): {
  updates: { id: string; newDate: string }[];
  undoData: { lessonId: string; date: string }[];
} {
  const undoData = incomplete.map((l) => ({
    lessonId: l.id,
    date: l.scheduled_date ?? l.date ?? todayStr,
  }));
  const updates: { id: string; newDate: string }[] = [];
  const slotsPerDay = Math.max(1, perDay);
  let cursor = nthSchoolDay(todayStr, schoolDays, 1); // first school day strictly after today
  let slotsLeft = slotsPerDay;
  for (const lesson of incomplete) {
    updates.push({ id: lesson.id, newDate: cursor });
    slotsLeft -= 1;
    if (slotsLeft === 0) {
      cursor = nthSchoolDay(cursor, schoolDays, 1);
      slotsLeft = slotsPerDay;
    }
  }
  return { updates, undoData };
}

/**
 * Snapshot of a lesson row's date columns BEFORE a reschedule write. The
 * Today-page undo restores from this exact shape so we never recompute
 * "what the original date was" — the captured value IS the source of truth.
 *
 * Both columns are captured because some legacy code paths (e.g. the older
 * "Log an extra lesson" flow before CC1) wrote `date` without touching
 * `scheduled_date`. A single-column snapshot would silently lose that
 * difference on undo.
 */
export type LessonDateSnapshot = {
  id: string;
  date: string | null;
  scheduled_date: string | null;
};

/**
 * Capture the full date-column state of the given rows. Pure — caller is
 * responsible for storing the snapshot durably (state + ref) before issuing
 * the reschedule UPDATE.
 */
export function buildLessonDateSnapshot(
  rows: { id: string; date?: string | null; scheduled_date?: string | null }[],
): LessonDateSnapshot[] {
  return rows.map((r) => ({
    id: r.id,
    date: r.date ?? null,
    scheduled_date: r.scheduled_date ?? null,
  }));
}

/**
 * Apply a captured snapshot to a current state map (id → row). Returns the
 * resulting state map. Pure — useful for unit-testing the undo round-trip
 * without a DB. Real callers issue UPDATE per snapshot row instead.
 */
export function applyUndoSnapshot(
  current: Map<string, { date: string | null; scheduled_date: string | null }>,
  snapshot: LessonDateSnapshot[],
): Map<string, { date: string | null; scheduled_date: string | null }> {
  const next = new Map(current);
  for (const entry of snapshot) {
    next.set(entry.id, { date: entry.date, scheduled_date: entry.scheduled_date });
  }
  return next;
}

/**
 * Whitelist gate for the saveEdit reshuffle. Returns true ONLY when one of
 * the schedule-relevant goal fields actually changed: lessons_per_day,
 * school_days, start_date, target_date, total_lessons.
 *
 * Cosmetic edits — curriculum_name, subject_label, icon_emoji,
 * default_minutes, scheduled_start_time, course_level, credits_value — must
 * NOT trigger a reshuffle. Two non-obvious rules guard against a previous
 * regression where saving a name-only edit pushed today's incomplete
 * lesson forward:
 *
 *   1. start_date and total_lessons checks are skipped when the original
 *      DB value is null (legacy goals from before those columns were
 *      persisted). Comparing a hydrated null against a form default would
 *      otherwise always return "changed" and trip the reshuffle.
 *
 *   2. Callers MUST hydrate the form's startDate from the persisted goal
 *      row before calling this. The wizard hydration in CurriculumWizard
 *      makes that happen for the edit flow.
 */
export function hasScheduleFieldsChanged(
  original: {
    lessons_per_day: number | null;
    school_days: string[] | null;
    start_date: string | null;
    target_date: string | null;
    total_lessons: number | null;
  },
  next: {
    lessons_per_day: number;
    school_days: string[];
    start_date: string | null;
    target_date: string | null;
    total_lessons: number;
  },
): boolean {
  const arraysEqual = (a: string[] | null, b: string[] | null) => {
    const aa = (a ?? []).slice().sort();
    const bb = (b ?? []).slice().sort();
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
    return true;
  };
  if (original.lessons_per_day !== null && next.lessons_per_day !== original.lessons_per_day) return true;
  if (!arraysEqual(original.school_days, next.school_days)) return true;
  if (original.start_date !== null && next.start_date !== original.start_date) return true;
  if (next.target_date !== original.target_date) return true;
  if (original.total_lessons !== null && next.total_lessons !== original.total_lessons) return true;
  return false;
}

export { DAY_LABELS, DAY_LABEL_TO_IDX };
