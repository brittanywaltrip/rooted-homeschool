import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, isoDowFromYmd } from "./timezone.ts";

// Day index conventions: Mon=0..Sun=6 for school_days / school_days bool arrays
// (matches the wizard and plan page). getDay() → Sun=0..Sat=6, so translate with
// (d.getDay() + 6) % 7.

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_LABEL_TO_IDX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

// ISO day-of-week: Mon=1..Sun=7 (matches isoDowFromYmd in ./timezone).
const DAY_LABEL_TO_ISO: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

/**
 * Convert the wizard/DB string-label school_days array (["Mon","Wed"...])
 * to the ISO numeric form (1=Mon..7=Sun) used by `pickNextAvailableDate`.
 * Falls back to Mon-Fri when the input is null/empty (Invariant 5).
 */
export function schoolDayLabelsToIso(labels: string[] | null | undefined): number[] {
  const list = labels && labels.length > 0 ? labels : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const out: number[] = [];
  for (const l of list) {
    const n = DAY_LABEL_TO_ISO[l];
    if (n) out.push(n);
  }
  return out.length > 0 ? out : [1, 2, 3, 4, 5];
}

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
 * @deprecated under queue-based scheduling (Path A, 2026-05). The "missed
 * lesson" concept no longer exists in the new model — completions
 * advance current_lesson, projection trusts current_lesson. Retained for
 * rollback only. New code should not call this.
 *
 * "Add to my next school day(s)" — places each missed lesson on the next
 * available school day, starting STRICTLY AFTER today, with density
 * awareness so missed lessons never stack onto a date that already has a
 * forward-scheduled lesson at capacity.
 *
 * A candidate date is "available" iff:
 *   1. it's a school day for the goal that owns the lesson, AND
 *   2. existingByGoalDate.get(`${goal_id}|${date}`) < lessons_per_day for
 *      that goal.
 *
 * The density map is consumed and mutated locally so placements made
 * earlier in this call cannot be reused by later iterations. Pure: returns
 * planned updates and undo data; the caller writes to the DB.
 *
 * Lessons with no curriculum_goal_id (one-off lessons) get a per-row
 * synthetic key so they neither compete with each other nor with goal
 * lessons; in practice they fall back to the old "consecutive school days"
 * behavior because their density is always 0 of capacity 1.
 *
 * Why this exists: prior version walked `nthSchoolDay(today, schoolDays,
 * i + 1)` for each missed lesson without consulting the lessons table. If
 * the same goal already had forward-scheduled lessons on those exact dates
 * (e.g. mom edited the goal earlier and lessons L8-L14 got packed onto
 * Apr 30 - May 8), clicking "Add to my next school day(s)" on the missed
 * banner stacked L2-L6 on top of L8-L12. Audited 2026-04-30 on
 * garfieldbrittany / TGTB.
 */
export function planAddToNextSchoolDays(
  missed: ReschedulableLesson[],
  getSchoolDaysForLesson: (lesson: ReschedulableLesson) => string[],
  todayStr: string,
  existingByGoalDate: Map<string, number>,
  getLessonsPerDay: (lesson: ReschedulableLesson) => number,
): {
  updates: { id: string; newDate: string }[];
  undoData: { lessonId: string; date: string }[];
} {
  const undoData = missed.map((l) => ({
    lessonId: l.id,
    date: l.scheduled_date ?? l.date ?? todayStr,
  }));
  const density = new Map(existingByGoalDate);
  const updates: { id: string; newDate: string }[] = [];
  for (const lesson of missed) {
    const schoolDays = getSchoolDaysForLesson(lesson);
    const cap = Math.max(1, getLessonsPerDay(lesson));
    const keyPrefix = lesson.curriculum_goal_id ?? `__no_goal__${lesson.id}`;
    let cursor = nthSchoolDay(todayStr, schoolDays, 1);
    let safety = 0;
    while (safety < 365) {
      const key = `${keyPrefix}|${cursor}`;
      if ((density.get(key) ?? 0) < cap) {
        updates.push({ id: lesson.id, newDate: cursor });
        density.set(key, (density.get(key) ?? 0) + 1);
        break;
      }
      cursor = nthSchoolDay(cursor, schoolDays, 1);
      safety++;
    }
  }
  return { updates, undoData };
}

/**
 * @deprecated under queue-based scheduling (Path A, 2026-05). Retained
 * for rollback only.
 *
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
 * @deprecated under queue-based scheduling (Path A, 2026-05). The "log
 * extra → re-spread future" choreography is unnecessary in the new model:
 * completing an extra advances current_lesson, and the next render
 * projects forward from the new position. Retained for rollback only.
 *
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
 * Idempotency gate for one-shot async actions. Used by the Today page's
 * reschedule handlers to prevent a single user click from triggering the
 * same "push all 114 lessons +1 day" operation 2–4 times — observed on
 * production where one tap shifted dates +3-4 school days because the
 * handler fired multiple times against (now-shifted) state.
 *
 * Pure utility: no React. Each handler wraps its body in a `tryEnter()`
 * guard and clears the gate via `exit()` (typically inside `setTimeout` so
 * a retry can't sneak in during the post-action settle window).
 *
 *   const gate = createInFlightGate();
 *   async function reschedulePushAll() {
 *     if (!gate.tryEnter()) return;
 *     try { ...the actual work... }
 *     finally { setTimeout(gate.exit, 1500); }
 *   }
 */
export type InFlightGate = {
  /** Returns true if the gate was free (now entered). False if already busy. */
  tryEnter: () => boolean;
  /** Releases the gate. Idempotent — calling twice is safe. */
  exit: () => void;
  /** Read-only; useful for `disabled={isBusy}` UI feedback. */
  readonly isBusy: () => boolean;
};

export function createInFlightGate(): InFlightGate {
  let active = false;
  return {
    tryEnter() {
      if (active) return false;
      active = true;
      return true;
    },
    exit() {
      active = false;
    },
    isBusy() {
      return active;
    },
  };
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

// ─── Queue-based scheduling (Path A, 2026-05) ────────────────────────────
//
// Source of truth for "what's next" is the goal's queue position
// (current_lesson) plus its cadence (lessons_per_day, school_days). Today
// and Plan project forward from those columns rather than reading
// lessons.scheduled_date — so missing a day shifts the whole upcoming
// block forward, and finishing extra shifts it back, without any
// reschedule write. lessons.scheduled_date is kept as a cache for legacy
// reads but is no longer the source of truth.
//
// All functions below are pure: no DB access. They read goal config and
// return projected (lesson_number, date) pairs. Callers join those back to
// real lesson rows by (curriculum_goal_id, lesson_number) for display
// fields like notes / subject / title.

/**
 * Goal config the projector needs. Mirrors the curriculum_goals columns
 * that drive scheduling — total_lessons / lessons_per_day / school_days /
 * current_lesson — plus id so callers can group results back per goal.
 *
 * `school_days` is the same string-label array stored in the DB
 * (["Mon","Tue",…]) — see schoolDaysToBool / DAY_LABELS for the
 * Mon=0..Sun=6 convention.
 */
export interface CurriculumGoalConfig {
  id: string;
  total_lessons: number;
  lessons_per_day: number;
  school_days: string[] | null;
  current_lesson: number;
  // YYYY-MM-DD. When set and strictly after `fromDate` at projection time,
  // the projector waits for it before laying lesson 1. Goals with a future
  // start_date were silently bypassing this gate before the May 3 hotfix —
  // lessons would land on today and bleed into the visible range filter,
  // showing a half-empty calendar (Bug B, 2026-05-03).
  start_date?: string | null;
}

export interface ProjectedLesson {
  goal_id: string;
  lesson_number: number;
  date: string; // YYYY-MM-DD
}

/**
 * A vacation_blocks row for the queue projector. Inclusive on both ends:
 * `start_date <= candidate <= end_date` is "in break". The projector
 * skips these dates entirely; mom can still manually log lessons on
 * break days, but the system never schedules onto them.
 */
export interface VacationBlock {
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD, inclusive
}

/**
 * Is the given date inside any vacation block? Compares as YYYY-MM-DD
 * strings so timezone math doesn't sneak in.
 */
export function isBreakDay(date: Date, vacationBlocks: VacationBlock[] | null | undefined): boolean {
  if (!vacationBlocks || vacationBlocks.length === 0) return false;
  const dateStr = toDateStr(date);
  for (const b of vacationBlocks) {
    if (dateStr >= b.start_date && dateStr <= b.end_date) return true;
  }
  return false;
}

/**
 * Normalize a goal's school_days. The DB column defaults to Mon-Fri at
 * insert, but legacy rows or hand-edits can land here as null or [], in
 * which case we fall back to the same Mon-Fri default rather than
 * silently project zero lessons forever.
 */
export function normalizeSchoolDays(input: string[] | null | undefined): string[] {
  if (!input || input.length === 0) return ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return input;
}

/**
 * Is the given calendar date a school day for this goal? Wrapper around
 * isSchoolDayIdx that handles the string-label → bool[] conversion + the
 * empty-array fallback. Use this at the day-walk boundary so callers
 * never need to know the day-index convention.
 */
export function isSchoolDay(date: Date, schoolDays: string[] | null | undefined): boolean {
  return isSchoolDayIdx(date, schoolDaysToBool(normalizeSchoolDays(schoolDays)));
}

/**
 * Project the next `daysAhead` calendar days of lessons for one goal.
 * Returns one entry per (school day, lesson slot) pair, in queue order.
 *
 * Inclusive on `fromDate`: if today is a school day and the goal isn't
 * finished, today's lessons are first in the result.
 *
 * Stops when total_lessons is reached. Returns [] when the goal is done.
 *
 * If `vacationBlocks` is supplied, any candidate date that falls inside
 * a block (start_date <= date <= end_date) is treated as NOT a school
 * day — the system never schedules onto a break, regardless of what
 * school_days says. Mom can still manually mark lessons complete on
 * break days; that path goes through recomputeCurrentLesson and isn't
 * gated by this projector.
 *
 * `completedTodayCount` is the number of lessons for THIS goal whose
 * completed_at falls within the user's local calendar day for fromDate.
 * On the first day of the projection, slots start at
 * (current_lesson - completedTodayCount + 1) and emit `perDay` slots,
 * so the lessons already done today are included in today's view as
 * checked cards, and marking another complete does not pull a new
 * lesson onto today. Default 0 preserves the prior behavior for callers
 * projecting from a past or future date (catch-up modal, calendar/week
 * views projecting forward only).
 */
export function computeNextLessonsForGoal(
  goal: CurriculumGoalConfig,
  fromDate: Date,
  daysAhead: number,
  vacationBlocks?: VacationBlock[],
  completedTodayCount: number = 0,
): ProjectedLesson[] {
  if (daysAhead <= 0) return [];
  if (goal.current_lesson >= goal.total_lessons) return [];

  const schoolDaysBool = schoolDaysToBool(normalizeSchoolDays(goal.school_days));
  const perDay = Math.max(1, goal.lessons_per_day);
  const out: ProjectedLesson[] = [];

  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  const fromDateStr = toDateStr(cursor);
  const endDate = new Date(cursor);
  endDate.setDate(endDate.getDate() + daysAhead);

  // Honor goal.start_date (Bug B, 2026-05-03). If the goal hasn't begun yet,
  // jump the cursor to start_date so lesson 1 lands on the chosen first day,
  // not on today. The visible-range filter then keeps only the lessons that
  // fall inside the rendered window. fromDateStr stays anchored to today so
  // the completedTodayCount adjustment only fires on day 0.
  if (goal.start_date) {
    const startMid = new Date(goal.start_date + "T00:00:00");
    if (startMid.getTime() > cursor.getTime()) {
      cursor.setTime(startMid.getTime());
    }
  }

  // The "next" lesson_number is current_lesson + 1 (current_lesson is the
  // count of completed lessons; lesson_number is 1-indexed in the row).
  // On the first day this is overridden to include lessons already
  // completed today, so today's slot count stays stable across a
  // mark-complete (the completed lesson stays visible as a checked card).
  let nextLesson = goal.current_lesson + 1;

  let safety = 0;
  while (cursor < endDate && nextLesson <= goal.total_lessons && safety < 3650) {
    if (isSchoolDayIdx(cursor, schoolDaysBool) && !isBreakDay(cursor, vacationBlocks)) {
      const dateStr = toDateStr(cursor);
      const isFirstDay = dateStr === fromDateStr;
      let lessonStart = isFirstDay
        ? Math.max(1, goal.current_lesson - completedTodayCount + 1)
        : nextLesson;
      for (let s = 0; s < perDay && lessonStart <= goal.total_lessons; s++) {
        out.push({ goal_id: goal.id, lesson_number: lessonStart, date: dateStr });
        lessonStart++;
      }
      nextLesson = lessonStart;
    }
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }

  return out;
}

/**
 * Compute the calendar date the goal will finish on, projecting forward
 * from `fromDate`. Returns null if the goal is already complete.
 *
 * Vacation blocks push the finish date out: each break day that falls
 * inside the projection window pushes the finish by one school-day-
 * worth of lessons. A 7-day break with lessons_per_day=1 means finish
 * moves out by 7 calendar days (the lessons that would have landed
 * inside the break get pushed past it).
 *
 * `completedTodayCount` mirrors the projector: lessons completed today
 * have already used some of today's quota, so today contributes
 * (perDay - completedToday) usable slots, clamped at 0 if the day's
 * quota is met. Without this, finishing a lesson would shift the finish
 * date earlier by one school day every time, because remaining shrinks
 * but today still contributes a full perDay slots.
 */
export function computeFinishDate(
  goal: CurriculumGoalConfig,
  fromDate: Date = new Date(),
  vacationBlocks?: VacationBlock[],
  completedTodayCount: number = 0,
): Date | null {
  if (goal.current_lesson >= goal.total_lessons) return null;

  const schoolDaysBool = schoolDaysToBool(normalizeSchoolDays(goal.school_days));
  const perDay = Math.max(1, goal.lessons_per_day);
  const remaining = goal.total_lessons - goal.current_lesson;

  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  const fromDateStr = toDateStr(cursor);
  let lastSchoolDay: Date | null = null;
  let slotsRemaining = remaining;
  let safety = 0;

  while (slotsRemaining > 0 && safety < 3650) {
    if (isSchoolDayIdx(cursor, schoolDaysBool) && !isBreakDay(cursor, vacationBlocks)) {
      const isFirstDay = toDateStr(cursor) === fromDateStr;
      const slotsThisDay = isFirstDay
        ? Math.max(0, perDay - completedTodayCount)
        : perDay;
      if (slotsThisDay > 0) {
        const consumed = Math.min(slotsThisDay, slotsRemaining);
        slotsRemaining -= consumed;
        lastSchoolDay = new Date(cursor);
      }
    }
    if (slotsRemaining > 0) cursor.setDate(cursor.getDate() + 1);
    safety++;
  }

  return lastSchoolDay;
}

/**
 * Across all of a family's curriculum goals, what should appear on Today?
 *
 *   - Each goal's first projected school day equals today (or skips today
 *     if today isn't a school day for that goal, OR today is a break day).
 *   - lessons_per_day on the goal controls how many slots come back.
 *   - Goals that are complete contribute nothing.
 *
 * The same `today` Date is reused for every goal so the answer is stable
 * within one render — callers don't need to clone.
 *
 * `completedTodayPerGoal` keys lessons completed today (in the user's
 * local timezone) by curriculum_goal_id. Today's slot list for each
 * goal is anchored to (current_lesson - completedTodayCount + 1) for
 * `lessons_per_day` slots, so completed-today lessons stay visible as
 * checked cards and the queue does not pull a fresh lesson onto today
 * every time mom marks one complete (the production hotfix this
 * parameter exists for). Default empty preserves prior behavior for
 * callers that don't have the count handy.
 */
export function computeTodayLessons(
  goals: CurriculumGoalConfig[],
  today: Date,
  vacationBlocks?: VacationBlock[],
  completedTodayPerGoal?: Map<string, number>,
): ProjectedLesson[] {
  const out: ProjectedLesson[] = [];
  for (const goal of goals) {
    const completed = completedTodayPerGoal?.get(goal.id) ?? 0;
    // Project a single calendar day. computeNextLessonsForGoal will return
    // [] if today isn't a school day for this goal — exactly what we want.
    const projected = computeNextLessonsForGoal(goal, today, 1, vacationBlocks, completed);
    out.push(...projected);
  }
  return out;
}

/**
 * For the catch-up modal: list the lessons that *would have been* due in
 * the gap between `gapStartDate` and `today` (exclusive of today). The
 * caller passes the goal as it stood at the start of the gap (i.e. with
 * its pre-gap `current_lesson`) — projection walks forward from there.
 *
 * Returns one entry per (school day in the gap, lesson slot). Result is
 * grouped by date in display order so the modal can render a checklist
 * grouped by day.
 *
 * Vacation blocks exclude break days from the gap so the modal never
 * asks "did you do lessons during your beach trip?" — only the school
 * days mom actually missed get checkboxes. If the entire gap is inside
 * a break, this returns [] and the modal does not appear at all.
 */
export function computeGapLessonsForGoal(
  goal: CurriculumGoalConfig,
  gapStartDate: Date,
  today: Date,
  vacationBlocks?: VacationBlock[],
): ProjectedLesson[] {
  const start = new Date(gapStartDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
  if (days === 0) return [];
  return computeNextLessonsForGoal(goal, start, days, vacationBlocks);
}

// ─── Single shared "pick next available date" (Invariant 8) ───────────────
//
// The May 3 regression was caused by saveVacationBlock and skipRestOfToday
// each running their own per-row cursor walk with no occupancy tracking.
// Going forward, every place that picks a date for an incomplete lesson
// goes through `pickNextAvailableDate`. There is one definition of "next
// school day with capacity" in this codebase. Drift = bug.
//
// `fromDate` is exclusive — the helper returns the first valid date strictly
// after it. Callers that want to stack additional lessons onto the returned
// date should pass `addDays(returned, -1)` as the next `fromDate` so the
// occupancy check (not the cursor) decides whether the same day is reused.

export interface VacationRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD inclusive
}

export interface PickArgs {
  fromDate: string;                  // strict-greater-than starting point (YYYY-MM-DD)
  schoolDays: number[];              // ISO dows: 1=Mon..7=Sun
  lessonsPerDay: number;             // 1..10
  vacations: VacationRange[];
  occupancy: Map<string, number>;    // mutated as we allocate
}

/**
 * Returns YYYY-MM-DD for the next school day strictly after `fromDate`
 * with capacity remaining (per `lessonsPerDay`) and not inside any
 * vacation block. Mutates `occupancy` to reflect the allocation.
 *
 * Source of truth for "next school day with capacity" — see
 * docs/CURRICULUM-SCHEDULING.md Invariant 8.
 */
export function pickNextAvailableDate(args: PickArgs): string {
  const lpd = Math.max(1, Math.min(10, args.lessonsPerDay || 1));
  let cursor = addDays(args.fromDate, 1);

  for (let i = 0; i < 10_000; i++) {
    const dow = isoDowFromYmd(cursor);
    const inSchoolDay = args.schoolDays.includes(dow);
    const inVacation = args.vacations.some((v) => cursor >= v.start && cursor <= v.end);
    if (inSchoolDay && !inVacation) {
      const used = args.occupancy.get(cursor) ?? 0;
      if (used < lpd) {
        args.occupancy.set(cursor, used + 1);
        return cursor;
      }
    }
    cursor = addDays(cursor, 1);
  }
  throw new Error(
    `pickNextAvailableDate ran past 10000 iterations from ${args.fromDate}. Bad input (likely empty schoolDays or lpd<=0).`,
  );
}

/**
 * Plan a re-spread for a list of incomplete lessons being moved.
 *
 * Used by:
 *   - vacation_blocks insert "shift" mode (saveVacationBlock)
 *   - "Skip rest of today" (skipRestOfToday)
 *   - Wizard saveEdit reshuffle when schedule fields changed
 *
 * Pure: no DB access. Caller writes `updates` and attaches the appropriate
 * `scheduled_source` (Invariant 10). Input order within each goal is preserved.
 *
 * Per-goal occupancy seeded from `staying` (lessons of that goal that are
 * NOT being moved) so the planner never bunches a moved lesson onto a date
 * already at capacity. Backfill rows must NOT appear in `toReshuffle`;
 * caller filters them out (Invariant 3).
 */
export interface PlanRescheduleArgs {
  /**
   * Lessons being moved. Within each goal, the planner sorts by
   * `lesson_number` ascending before placing — so calendar-date order
   * always matches lesson_number order (Invariant 1, "Lessons NEVER appear
   * out of order"). Entries without a lesson_number fall to the end and
   * keep their input order; one-off lessons (no curriculum_goal_id) won't
   * have one and route through the synthetic NO_GOAL_KEY bucket.
   */
  toReshuffle: { id: string; curriculum_goal_id: string; lesson_number?: number | null }[];
  /** Lessons of any goal that stay where they are; seeds per-goal occupancy. */
  staying: { curriculum_goal_id: string; date: string }[];
  /** Per-goal config keyed by curriculum_goal_id. */
  goalConfigs: Map<string, { school_days: string[] | null; lessons_per_day: number }>;
  /** Exclusive starting point for the cursor walk (YYYY-MM-DD). */
  startAfterDate: string;
  /** All of the user's vacation blocks. Moves never land inside one. */
  vacations: VacationRange[];
}

export interface PlanRescheduleResult {
  updates: { id: string; newDate: string }[];
}

export function planRescheduleLessons(args: PlanRescheduleArgs): PlanRescheduleResult {
  const updates: { id: string; newDate: string }[] = [];

  // Group `toReshuffle` by goal, capturing original input index so entries
  // missing a lesson_number remain in their input order after the sort.
  type Entry = { id: string; lesson_number: number | null; idx: number };
  const byGoal = new Map<string, Entry[]>();
  args.toReshuffle.forEach((l, idx) => {
    const list = byGoal.get(l.curriculum_goal_id) ?? [];
    list.push({ id: l.id, lesson_number: l.lesson_number ?? null, idx });
    byGoal.set(l.curriculum_goal_id, list);
  });

  for (const [goalId, lessons] of byGoal) {
    const config = args.goalConfigs.get(goalId);
    if (!config) continue; // can't place without config; caller's bug
    const isoSchoolDays = schoolDayLabelsToIso(config.school_days);
    const lpd = Math.max(1, config.lessons_per_day || 1);

    // Sort by lesson_number ASC (nulls last in input order). Without this,
    // a caller that handed in lessons in arbitrary order could place
    // lesson 6 onto June 15 and lesson 7 onto June 16... but if lesson 7
    // came first in the input it would land on June 15 instead, breaking
    // Invariant 1.
    lessons.sort((a, b) => {
      const aHas = a.lesson_number != null;
      const bHas = b.lesson_number != null;
      if (aHas && bHas) return (a.lesson_number as number) - (b.lesson_number as number);
      if (aHas) return -1;
      if (bHas) return 1;
      return a.idx - b.idx;
    });

    // Per-goal occupancy: count `staying` lessons of this goal at each date.
    const occupancy = new Map<string, number>();
    for (const s of args.staying) {
      if (s.curriculum_goal_id !== goalId) continue;
      occupancy.set(s.date, (occupancy.get(s.date) ?? 0) + 1);
    }

    let cursor = args.startAfterDate;
    for (const lesson of lessons) {
      const newDate = pickNextAvailableDate({
        fromDate: cursor,
        schoolDays: isoSchoolDays,
        lessonsPerDay: lpd,
        vacations: args.vacations,
        occupancy,
      });
      updates.push({ id: lesson.id, newDate });
      // Allow stacking on the same day until lpd is hit. pickNextAvailableDate's
      // internal cursor begins at fromDate+1, so passing `newDate-1` lets the
      // occupancy check (not the cursor) decide reuse.
      cursor = addDays(newDate, -1);
    }
  }

  return { updates };
}

/**
 * Invariant 6 enforcement helper. `curriculum_goals.completed_at` is
 * monotonic — once set, it stays set. Returns the value to write given
 * the current persisted value and a candidate "would set this if null"
 * value. Use whenever code computes a new completed_at.
 */
export function monotonicCompletedAt(
  prev: string | null | undefined,
  candidate: string | null | undefined,
): string | null {
  if (prev) return prev;
  return candidate ?? null;
}

/**
 * Vercel-toggleable kill switch for the queue rescheduler. When this returns
 * false, the trigger sites (saveVacationBlock, skipRestOfToday, wizard
 * saveEdit reshuffle) short-circuit the lesson re-spread but still perform
 * their primary action (insert the vacation row, save the wizard form).
 *
 * Set NEXT_PUBLIC_SCHEDULER_QUEUE_ENABLED=false in Vercel env vars to
 * disable. Default 'true'. The NEXT_PUBLIC_ prefix is required because the
 * trigger sites are client components.
 */
export function isQueueEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_SCHEDULER_QUEUE_ENABLED ?? "true") !== "false";
}
