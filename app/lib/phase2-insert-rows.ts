// The ONE place a Phase 2 lesson insert row is shaped.
//
// WHY THIS FILE EXISTS
// schedule_commit is SECURITY DEFINER: it derives the owner from auth.uid()
// and sets user_id itself. On 2026-09-20 the builder nonetheless put
// `user_id: effectiveUserId` into every insert row, and the RPC's key allowlist
// (correctly) does not accept it, so EVERY Phase 2 save that inserted lessons
// was refused:
//
//   400 {"code":"22023","message":"14 unknown key(s) in the inserted rows"}
//
// "14" was not fourteen distinct keys. The check counts key OCCURRENCES across
// all rows, so it was 14 rows carrying one bad key each, and the number grew
// with the lesson count, which made it read like a much larger problem.
//
// The fix is not to widen the allowlist. A caller-supplied owner on a definer
// insert is the same shape as the checkout-session provenance bug, where
// caller-controlled identity was written into a record the server later
// trusted. The server owns ownership. Clients do not send it.
//
// Nothing caught this because the SQL harness built its insert rows from the
// allowlist's own key names, so it validated the function against the same
// assumption the function was written from. Only the real client calling the
// real function could find it, which is why these builders are exported and
// tested rather than written inline in the page.
//
// No "@/" import at module scope: node --test strips types, it does not resolve
// path aliases.

/**
 * Fields the SERVER owns. A client may never send these to schedule_commit.
 * user_id is the live one; the list is a list so the next one is a one-line
 * change rather than a new concept.
 */
export const SERVER_OWNED_FIELDS = ['user_id'] as const;

export interface ForwardInsertArgs {
  childId: string;
  goalId: string;
  lessonNumber: number;
  queuePosition: number | null;
  curriculumName: string;
  date: string;
}

export interface BackfillInsertArgs extends ForwardInsertArgs {
  minutes: number;
}

/** The exact shape schedule_commit accepts for a forward row. */
export interface ForwardInsertRow {
  // Index signature so a row is assignable to the RPC payload type without a
  // cast. Every declared field is still checked.
  [key: string]: unknown;
  child_id: string;
  curriculum_goal_id: string;
  lesson_number: number;
  queue_position: number | null;
  title: string;
  scheduled_date: string;
  date: string;
  scheduled_source: string;
  completed: boolean;
  hours: number;
}

/** A backfill row additionally carries its completion. */
export interface BackfillInsertRow extends ForwardInsertRow {
  completed_at: string;
  is_backfill: boolean;
  minutes_spent: number;
}

/** Title is composed in one place so forward and backfill rows cannot drift. */
function lessonTitle(curriculumName: string, lessonNumber: number): string {
  return `${curriculumName.trim()} — Lesson ${lessonNumber}`;
}

/** A forward (not yet taught) lesson row. */
export function buildForwardInsertRow(a: ForwardInsertArgs): ForwardInsertRow {
  return {
    child_id: a.childId,
    curriculum_goal_id: a.goalId,
    lesson_number: a.lessonNumber,
    queue_position: a.queuePosition,
    title: lessonTitle(a.curriculumName, a.lessonNumber),
    scheduled_date: a.date,
    date: a.date,
    // `wizard_create` covers both forward AND backfill rows per Invariant 10
    // in docs/CURRICULUM-SCHEDULING.md.
    scheduled_source: 'wizard_create',
    completed: false,
    hours: 0,
  };
}

/** A historical (already taught) row, backfilled behind current_lesson. */
export function buildBackfillInsertRow(a: BackfillInsertArgs): BackfillInsertRow {
  return {
    child_id: a.childId,
    curriculum_goal_id: a.goalId,
    lesson_number: a.lessonNumber,
    queue_position: a.queuePosition,
    title: lessonTitle(a.curriculumName, a.lessonNumber),
    scheduled_date: a.date,
    date: a.date,
    scheduled_source: 'wizard_create',
    completed: true,
    // Noon UTC, matching logPastDayLessons.ts and recalibrate.ts. `T12:00:00`
    // with no Z is browser-local noon, which serializes to the PREVIOUS
    // calendar day east of UTC, and reports bucket on completed_at.slice(0,10).
    completed_at: `${a.date}T12:00:00Z`,
    is_backfill: true,
    minutes_spent: a.minutes,
    hours: a.minutes / 60,
  };
}

/**
 * Refuse to send a server-owned field to schedule_commit.
 *
 * Defence in depth, and the answer to "could another client path reintroduce
 * this". It runs inside commitGoalSave, so every caller is covered rather than
 * every caller having to remember.
 */
export function assertNoServerOwnedFields(
  rows: ReadonlyArray<Record<string, unknown>>,
  context: string,
): void {
  const offenders = new Set<string>();
  for (const row of rows) {
    for (const f of SERVER_OWNED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(row, f)) offenders.add(f);
    }
  }
  if (offenders.size > 0) {
    throw new Error(
      `${context}: insert rows carry server-owned field(s) [${[...offenders].join(', ')}]. ` +
        'schedule_commit derives ownership from auth.uid() and rejects these, and a ' +
        'caller-supplied owner on a SECURITY DEFINER insert must never be trusted.',
    );
  }
}
