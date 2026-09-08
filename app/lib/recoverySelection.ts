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
