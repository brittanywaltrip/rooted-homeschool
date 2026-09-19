// ─── Invariant 10, as a type ────────────────────────────────────────────────
//
// "Every UPDATE or INSERT to lessons.date must set lessons.scheduled_source."
// docs/CURRICULUM-SCHEDULING.md has said so since May 2026. It was never
// enforced, and by September 2026 eleven write paths were moving a lesson's
// dates while naming no source at all.
//
// That is not a tidiness problem. A row whose stored source is 'queue_resync'
// and whose date is changed by a write that names no source is, at the
// database boundary, INDISTINGUISHABLE from the automatic reconciler doing the
// same thing. Identical writes cannot be classified, so no trigger, audit or
// repair can tell a parent's tap from a stale tab's background rewrite. Intent
// has to be in the write protocol or it does not exist.
//
// This module is the vocabulary. app/lib/scheduled-source.test.ts is the
// enforcement: it sweeps every lessons write in the repo and fails on any that
// sets a non-null date column without naming itself.

/**
 * Sources that describe a COMPLETION: a person said work happened.
 * See buildCompletionPayload in app/lib/completeLessonOnDate.ts.
 */
export const COMPLETION_SOURCES = [
  "completion_today",
  "completion_planned",
  "completion_picked",
  "completion_pin",
  // Legacy name, misleading: nothing about it is a reschedule. It marks an
  // EXISTING queue row completed on a day the family chose, keeping
  // lesson_number and queue_position (buildPastDateCompletionPayload,
  // app/lib/scheduler.ts). That is a completion, so it classifies here and not
  // as archive/backfill. Renaming the written value is a separate change:
  // production rows carry it, and no reader compares against it.
  "catchup_resched",
] as const;

/**
 * Sources that describe a PARENT MOVING A LESSON. Every one of these is a
 * deliberate human action on a specific row or set of rows.
 */
export const PARENT_ACTION_SOURCES = [
  "plan_move",          // dragged or rescheduled on the Plan page
  "plan_move_undo",     // undid that move from the Plan toast
  "manual_reschedule",  // Today: moved one lesson to a date they picked
  "manual_uncomplete",  // unchecked a completed lesson (does not move dates)
  "reschedule_undo",    // Today: undid any reschedule from the toast
  "skip_undo",          // put a skipped lesson back on the calendar
  "catchup_spread",     // "add missed lessons to upcoming school days"
  "catchup_pushback",   // "push everything back N days"
  "catchup_push_all",   // pushed today's lessons and everything after them
  "catchup_double_up",  // "doubled up tomorrow"
  "day_reschedule_uncomplete", // moved ALL of today forward; un-completes
  "extra_log",          // logged a lesson beyond the day's plan
  "edit_split",         // a lesson split across days
  "continuation",       // the second half of a split lesson
] as const;

/**
 * Sources that describe SETUP or a BULK RESHAPE the parent asked for.
 */
export const SETUP_SOURCES = [
  "wizard_create",
  "wizard_edit",
  "vacation_resched",
  "recalibrate_estimate", // synthesized dates from "I'm actually on lesson X"
] as const;

/**
 * Rows that are ARCHIVE, not queue: history entered after the fact that never
 * occupied a queue slot. Both carry no queue_position of their own.
 *
 * Do not add a source here merely because it writes a past date. catchup_resched
 * does that and is a completion: it updates a real queue row in place.
 */
export const ARCHIVED_OR_BACKFILL_SOURCES = [
  "past_year",           // filing a past year, AND respreading/undoing one: the
                         // tag is what marks a year as filed, and three readers
                         // depend on it. See the note below.
  "completion_backfill", // "log past hours": NEW rows, outside the queue
] as const;

/**
 * Sources written with NO PERSON IN THE CALL STACK. This is the set a
 * containment brake cares about, and the reason the vocabulary exists: these
 * must never be confusable with anything above.
 */
export const AUTOMATIC_SOURCES = [
  "queue_resync",     // the projector aligning the scheduled_date cache
  "self_heal",
  "today_self_heal",
  "cleanup_sql",      // repair scripts
] as const;

/** Retired. Rows in production still carry these; nothing writes them. */
export const RETIRED_SOURCES = ["skip_today"] as const;

/**
 * WHY THERE IS NO SEPARATE past_year_respread.
 *
 * 'past_year' is not only provenance on these rows: it is the tag that MARKS a
 * year as filed, and three readers depend on it:
 *
 *   app/lib/past-year-respread.ts:121  refuses to respread a year any of whose
 *                                      lessons is not 'past_year'. A distinct
 *                                      respread tag would lock the year out of
 *                                      its own second respread and its undo.
 *   app/dashboard/years/page.tsx:53-55 detects a filed year by counting
 *                                      'past_year' rows against everything else.
 *   NOT_FILED_PAST_YEAR (past-year-dates.ts:26), read by app/lib/badge-data.ts
 *                                      and lib/badge-checks.ts: a filed year
 *                                      earns NO badges. Re-tagging respread
 *                                      rows would hand out badges for a year
 *                                      nobody lived in Rooted, which is the
 *                                      regression fixed on main 2026-09-14.
 *
 * So the respread re-stamps 'past_year'. That satisfies Invariant 10 (the write
 * names its source) without moving the row out of the filed set.
 */
export type CompletionSourceName = (typeof COMPLETION_SOURCES)[number];
export type ParentActionSource = (typeof PARENT_ACTION_SOURCES)[number];
export type SetupSource = (typeof SETUP_SOURCES)[number];
export type AutomaticSource = (typeof AUTOMATIC_SOURCES)[number];
export type ArchivedOrBackfillSource = (typeof ARCHIVED_OR_BACKFILL_SOURCES)[number];
export type RetiredSource = (typeof RETIRED_SOURCES)[number];

export type ScheduledSource =
  | CompletionSourceName
  | ParentActionSource
  | SetupSource
  | ArchivedOrBackfillSource
  | AutomaticSource
  | RetiredSource;

export const ALL_SCHEDULED_SOURCES: readonly ScheduledSource[] = [
  ...COMPLETION_SOURCES,
  ...PARENT_ACTION_SOURCES,
  ...SETUP_SOURCES,
  ...ARCHIVED_OR_BACKFILL_SOURCES,
  ...AUTOMATIC_SOURCES,
  ...RETIRED_SOURCES,
];

// ─── Semantic classification, kept separate from containment policy ─────────
//
// These answer two DIFFERENT questions and must not be conflated:
//
//   classifyScheduledSource  what this value MEANS. Descriptive. An unknown or
//                            NULL value is "unknown" -- not "automatic".
//   shouldBlockAmbiguousScheduleWrite  what a containment guard should DO.
//                            Policy. Fails closed on unknown.
//
// An earlier version encoded the policy by defining isAutomaticSource as "not
// positively human", which made NULL, empty and every unrecognised legacy value
// report as automatic. That is a lie about the data: a row written before
// Invariant 10 was enforced has unknown provenance, not machine provenance, and
// an audit reading "automatic" off those rows would have drawn a false
// conclusion about how they got their dates.

export type SourceCategory =
  | "automatic"
  | "parent_action"
  | "completion"
  | "setup"
  | "archived_or_backfill"
  | "unknown";

function has(list: readonly string[], source: string): boolean {
  return list.includes(source);
}

/**
 * What this source MEANS. Purely descriptive.
 *
 * NULL, empty and any value this build does not recognise are "unknown".
 * Unknown is its own answer, never folded into another category.
 */
export function classifyScheduledSource(source: string | null | undefined): SourceCategory {
  if (source == null || source === "") return "unknown";
  if (has(AUTOMATIC_SOURCES, source)) return "automatic";
  if (has(COMPLETION_SOURCES, source)) return "completion";
  if (has(ARCHIVED_OR_BACKFILL_SOURCES, source)) return "archived_or_backfill";
  if (has(SETUP_SOURCES, source)) return "setup";
  if (has(PARENT_ACTION_SOURCES, source)) return "parent_action";
  if (has(RETIRED_SOURCES, source)) return "parent_action"; // skip_today was one
  return "unknown";
}

/** Explicitly known to have been written with no person in the call stack. */
export function isAutomaticSource(source: string | null | undefined): boolean {
  return classifyScheduledSource(source) === "automatic";
}

/** A parent moving a live lesson. Narrow: completions and setup are their own categories. */
export function isParentAction(source: string | null | undefined): boolean {
  return classifyScheduledSource(source) === "parent_action";
}

/**
 * Is this source a KNOWN, intentional, human-originated write?
 *
 * True for parent_action, completion, setup and archived_or_backfill.
 * False for automatic AND for unknown. This is the containment predicate, and
 * it is where fail-closed belongs: an unrecognised value is not vouched for.
 */
export function isKnownIntentionalSource(source: string | null | undefined): boolean {
  const c = classifyScheduledSource(source);
  return c === "parent_action" || c === "completion" || c === "setup" || c === "archived_or_backfill";
}

/**
 * Containment policy: should a guard refuse this write for lack of trustworthy
 * intent? FAIL-CLOSED -- true for automatic and for unknown alike.
 *
 * Named for the policy it encodes, so no caller mistakes it for a statement
 * about what the data IS.
 */
export function shouldBlockAmbiguousScheduleWrite(source: string | null | undefined): boolean {
  return !isKnownIntentionalSource(source);
}

// ─── Named constants ────────────────────────────────────────────────────────
//
// Call sites use these rather than repeating a raw string, so a typo is a
// compile error instead of a row nobody can classify. `_sourceNamesAreValid`
// below is the check: if any value here drifts out of the vocabulary above,
// tsc fails.

export const SOURCE = {
  CATCHUP_SPREAD: "catchup_spread",
  CATCHUP_PUSHBACK: "catchup_pushback",
  CATCHUP_PUSH_ALL: "catchup_push_all",
  CATCHUP_DOUBLE_UP: "catchup_double_up",
  DAY_RESCHEDULE_UNCOMPLETE: "day_reschedule_uncomplete",
  MANUAL_RESCHEDULE: "manual_reschedule",
  RESCHEDULE_UNDO: "reschedule_undo",
  PLAN_MOVE_UNDO: "plan_move_undo",
  SKIP_UNDO: "skip_undo",
  COMPLETION_BACKFILL: "completion_backfill",
  PAST_YEAR: "past_year",
} as const;

/** Compile-time only: every SOURCE value must be a known ScheduledSource. */
const _sourceNamesAreValid: Record<keyof typeof SOURCE, ScheduledSource> = SOURCE;
void _sourceNamesAreValid;
