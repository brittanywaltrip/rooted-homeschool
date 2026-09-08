/* ============================================================================
 * The recovery prompt's selection rules.
 *
 * Plain module, no JSX: these are decisions about what a family is being asked
 * to agree to, and they are worth testing directly rather than by grepping the
 * component that renders them. `node --test` runs strip-only, so a .tsx import
 * cannot be loaded from the test file at all.
 * ==========================================================================*/

export type MissedEntry = {
  /** The goal this gap entry belongs to. */
  goal_id: string;
  // The "lesson_number" emitted by computeNextLessonsForGoal is actually a
  // queue slot index (current_lesson + N). Field name kept for parity with
  // ProjectedLesson + the existing CatchUpEntry shape. Under no-manual-move
  // it equals the canonical lesson_number; after a Plan move it diverges.
  lesson_number: number;
  /** YYYY-MM-DD, the gap school day this lesson would have been due. */
  date: string;
};

/** One row the family left checked, with the date they agreed to. */
export type RecoveryRow = {
  goal_id: string;
  lesson_number: number;
  date: string;
  /** "planned" = the gap day Rooted proposed; "picked" = they changed it. */
  choice: "planned" | "picked";
};

/**
 * More than this many distinct school days in one goal's gap and the family did
 * not forget to log: something else is wrong (a start date, pacing, a break
 * nobody recorded). Those rows start UNCHECKED — the one place the default
 * flips, because a wrong yes there rewrites two weeks of a family's records.
 */
export const RECOVERY_SPAN_CAP = 10;

/** Collapse a goal's rows once the whole prompt is longer than this. */
export const COLLAPSE_OVER = 6;

/**
 * How many distinct school days a goal's entries touch.
 *
 * DISTINCT days, not entries. A 2/day goal puts two entries on one date, so
 * counting entries would trip the cap at five school days and tell a family
 * they had taken a break they had not. The question the cap asks is how much
 * CALENDAR the gap covers.
 */
export function schoolDaySpan(entries: MissedEntry[]): number {
  return new Set(entries.map((e) => e.date)).size;
}

export function isOverCap(entries: MissedEntry[]): boolean {
  return schoolDaySpan(entries) > RECOVERY_SPAN_CAP;
}

export const entryKey = (e: Pick<MissedEntry, "goal_id" | "lesson_number">) =>
  `${e.goal_id}|${e.lesson_number}`;

/**
 * Which rows start checked.
 *
 * Everything, so an honest yes is still one tap — except under a goal whose gap
 * is past the cap, where the family has to opt in per row.
 */
export function initialCheckedKeys(
  entriesByGoal: Map<string, MissedEntry[]>,
  goalIds: string[],
): Set<string> {
  const out = new Set<string>();
  for (const goalId of goalIds) {
    const entries = entriesByGoal.get(goalId) ?? [];
    if (isOverCap(entries)) continue;
    for (const e of entries) out.add(entryKey(e));
  }
  return out;
}

/**
 * Turn the prompt's state into the rows that will actually be written.
 *
 * Unchecked rows are dropped: they are not written and not rescheduled either,
 * they stay exactly as they were. A row whose date the family changed is
 * "picked"; one they left alone is "planned". That distinction is what lets the
 * record say whose date it was.
 */
export function buildRecoveryRows(args: {
  entriesByGoal: Map<string, MissedEntry[]>;
  goalIds: string[];
  checked: Set<string>;
  editedDates: Record<string, string>;
}): RecoveryRow[] {
  const rows: RecoveryRow[] = [];
  for (const goalId of args.goalIds) {
    for (const e of args.entriesByGoal.get(goalId) ?? []) {
      const key = entryKey(e);
      if (!args.checked.has(key)) continue;
      const edited = args.editedDates[key];
      rows.push({
        goal_id: e.goal_id,
        lesson_number: e.lesson_number,
        date: edited ?? e.date,
        choice: edited && edited !== e.date ? "picked" : "planned",
      });
    }
  }
  return rows;
}

/* ── Unchecking is an answer ─────────────────────────────────────────────────
 *
 * A row the family unchecks means "we did not do this one". Leaving it exactly
 * as it was made that answer worthless: the gap is recomputed on the next Today
 * load from (last completion + 1 day) forward, so the same lessons come back
 * with the same past dates, session after session. A family who skipped a week
 * got asked every day until they found "No, reschedule them".
 *
 * Note what does NOT fix this. The lesson ROWS are already re-projected forward
 * by reconcileGoalScheduleCache on every load, so the work really has moved
 * ahead in the plan. But computeGapLessonsForGoal never reads a lesson row — it
 * projects from the goal's config between two dates — so no amount of re-dating
 * rows changes what the prompt asks about. The gap is a function of
 * (last completion, current_lesson, school_days, today) and nothing else.
 *
 * What fixes it is recording that the question was ANSWERED for that goal, and
 * clamping the next gap window to start after that answer. The lessons stay
 * upcoming work; they simply stop being offered as overdue.
 * ────────────────────────────────────────────────────────────────────────── */

/** localStorage key holding the day a goal's catch-up prompt was answered. */
export const CATCHUP_ANSWERED_PREFIX = 'rooted_catchup_answered_';

export function catchupAnsweredKey(goalId: string): string {
  return `${CATCHUP_ANSWERED_PREFIX}${goalId}`;
}

/**
 * Where the next gap window may start, given the day this goal was last
 * answered for.
 *
 * The day AFTER the answer, mirroring how the last-completion anchor works: a
 * completion on the 4th means the gap starts on the 5th, and an answer on the
 * 4th means the same. Without the +1 the prompt re-asks about the very day it
 * was answered on.
 *
 * Returns whichever is later, so an answer can only ever narrow the window.
 */
export function gapStartAfterAnswer(anchor: Date, answeredYmd: string | null): Date {
  if (!answeredYmd) return anchor;
  const [y, m, d] = answeredYmd.split('-').map(Number);
  if (!y || !m || !d) return anchor;
  const after = new Date(y, m - 1, d);
  after.setHours(0, 0, 0, 0);
  after.setDate(after.getDate() + 1);
  return after > anchor ? after : anchor;
}

/**
 * The goals the family left something unchecked on — the ones whose remaining
 * lessons are being moved ahead rather than recorded.
 *
 * `written` is what buildRecoveryRows produced, so this is exactly "offered
 * minus written", per goal.
 */
export function goalsWithUncheckedRows(args: {
  entriesByGoal: Map<string, MissedEntry[]>;
  goalIds: string[];
  written: Array<{ goal_id: string; lesson_number: number }>;
}): string[] {
  const writtenKeys = new Set(args.written.map((r) => entryKey(r)));
  const out: string[] = [];
  for (const goalId of args.goalIds) {
    const entries = args.entriesByGoal.get(goalId) ?? [];
    if (entries.some((e) => !writtenKeys.has(entryKey(e)))) out.push(goalId);
  }
  return out;
}

/**
 * The primary button's words.
 *
 * It names both halves of what is about to happen, because both are real
 * changes to the family's plan. "Mark 4 done, move 5 ahead" is the whole
 * sentence; "Mark 4 done" would hide the other five.
 */
export function confirmButtonLabel(checkedCount: number, uncheckedCount: number): string {
  if (checkedCount === 0) return 'Nothing selected';
  if (uncheckedCount === 0) return `Mark ${checkedCount} done on these days`;
  return `Mark ${checkedCount} done, move ${uncheckedCount} ahead`;
}
