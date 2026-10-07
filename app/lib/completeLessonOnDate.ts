import type { SupabaseClient } from "@supabase/supabase-js";

/* ============================================================================
 * completeLessonOnDate — the one place a lesson is marked done.
 *
 * INVARIANT 16. A completion is dated by the person, once, through this
 * helper. The date shown at the moment of tapping is the date stored.
 *
 * Before this existed, "I did this lesson" wrote a different date depending on
 * which screen the tap happened on. Today's page pinned every completion to
 * today; the Plan page kept a past-dated row on its planned day and pinned a
 * today-or-future one to today; the month checklist wrote the day the family
 * picked. So a family who checked off Wednesday's lesson on Friday got Friday
 * from one screen and Wednesday from another, for the same lesson, on the same
 * afternoon. Families who have to produce an attendance record could not tell
 * which of the two their own app believed.
 *
 * The rule this encodes: Rooted always shows the date it is about to write,
 * and asks only when that date is not obviously today. Every surface funnels
 * here, so there is exactly one answer to "what does a completion look like".
 *
 * DEPTH. These writes are issued by a client, so they land at
 * pg_trigger_depth() = 1 and trg_lessons_block_server_side_completion (Invariant
 * 15) is not involved. That guard exists to stop a TRIGGER claiming a family
 * did work. A person tapping a lesson is exactly what it means to leave alone.
 * ==========================================================================*/

/**
 * Which day the family chose, in their words:
 *   today   — "I did this today" (the default, and the only silent one)
 *   planned — "I did this on the day it was planned for"
 *   picked  — "I did this on some other day", chosen from the date field
 */
export type CompletionChoice = "today" | "planned" | "picked";

/**
 * Where the tap happened. Analytics only; it never changes what is written.
 *
 * "recovery" and "prior_card" are the two prompts that propose dates the family
 * did not pick themselves. Both now show every date before writing it, so they
 * are consent surfaces like the rest rather than bulk stamps.
 */
export type CompletionSurface =
  | "today"
  | "missed"
  | "plan"
  | "month"
  | "extra"
  | "recovery"
  | "prior_card";

/** Invariant 10: every write to lessons.date names its source. */
export type CompletionSource =
  | "completion_today"
  | "completion_planned"
  | "completion_picked";

export interface CompletionPayload {
  completed: true;
  completed_at: string;
  date: string;
  scheduled_date: string;
  scheduled_source: CompletionSource;
  /**
   * A day the family named is history, so the projector must not re-spread it
   * (Invariant 3). Only an unremarkable "I did it today" leaves this false.
   */
  is_backfill: boolean;
  /**
   * A family-chosen day is a manual placement (Invariant 12), so the
   * reconciler and the orphan cleanup both leave the row where it was put.
   * The cleanup skips pinned rows as of migration 20260907000000.
   */
  queue_pinned: boolean;
}

const SOURCE_BY_CHOICE: Record<CompletionChoice, CompletionSource> = {
  today: "completion_today",
  planned: "completion_planned",
  picked: "completion_picked",
};

/**
 * What a completion looks like, as columns. Pure, so the rule can be tested
 * without a database and without a browser.
 *
 * `completed_at` is the one field with a decision in it:
 *
 *   - "today" stamps the real instant, because that is when it happened.
 *   - any earlier day stamps NOON UTC of that day, matching
 *     logPastDayLessons.ts and recalibrate.ts. Attendance in
 *     app/dashboard/reports buckets on completed_at.slice(0, 10), and local
 *     noon serializes to the previous calendar day east of UTC.
 *   - a day at or after today can never stamp a future instant, so it falls
 *     back to now. A family may keep a lesson on Thursday and tell us today
 *     that they did it; the row keeps Thursday, but the timestamp cannot claim
 *     a moment that has not happened. (The clamp from 97ed329, kept.)
 */
export function buildCompletionPayload(args: {
  /** YYYY-MM-DD the completion is being filed under. */
  dateStr: string;
  choice: CompletionChoice;
  /** YYYY-MM-DD in the family's own timezone. */
  todayStr: string;
  /** Injectable for tests. Defaults to the real clock. */
  now?: Date;
}): CompletionPayload {
  const { dateStr, choice, todayStr } = args;
  const now = args.now ?? new Date();
  const isFutureOrToday = dateStr >= todayStr;
  const completedAt =
    choice === "today" || isFutureOrToday
      ? now.toISOString()
      : `${dateStr}T12:00:00Z`;
  const chosenDay = choice !== "today";
  return {
    completed: true,
    completed_at: completedAt,
    date: dateStr,
    scheduled_date: dateStr,
    scheduled_source: SOURCE_BY_CHOICE[choice],
    is_backfill: chosenDay,
    queue_pinned: chosenDay,
  };
}

/** The analytics shape every surface reports. One event, one completion. */
export interface LessonCompletedEvent {
  lesson_number: number | null;
  subject_label: string | null;
  /** The date actually stored, never the date the tap happened on. */
  lesson_date: string;
  date_choice: CompletionChoice;
  surface: CompletionSurface;
}

export function buildLessonCompletedEvent(args: {
  payload: CompletionPayload;
  choice: CompletionChoice;
  surface: CompletionSurface;
  lessonNumber?: number | null;
  subjectLabel?: string | null;
}): LessonCompletedEvent {
  return {
    lesson_number: args.lessonNumber ?? null,
    subject_label: args.subjectLabel ?? null,
    lesson_date: args.payload.date,
    date_choice: args.choice,
    surface: args.surface,
  };
}

export interface CompleteLessonArgs {
  lessonId: string;
  dateStr: string;
  choice: CompletionChoice;
  todayStr: string;
  surface: CompletionSurface;
  lessonNumber?: number | null;
  subjectLabel?: string | null;
  /**
   * The time recorded with the completion. Only these two columns are ever
   * written from it (completionTimeFields); anything else a caller passes is
   * dropped, so it can never carry a date, a pin, a source or a slot.
   */
  extra?: CompletionTimeFields;
  /** Fires once, only after the write succeeds. */
  track?: (event: LessonCompletedEvent) => void;
  now?: Date;
}

/** The time columns a completion may write alongside itself. */
export interface CompletionTimeFields {
  minutes_spent?: number | null;
  hours?: number | null;
}

/** Keep only minutes_spent and hours, whatever the caller passed. */
export function completionTimeFields(extra: unknown): CompletionTimeFields {
  const out: CompletionTimeFields = {};
  if (!extra || typeof extra !== "object") return out;
  const e = extra as Record<string, unknown>;
  if ("minutes_spent" in e && (e.minutes_spent === null || typeof e.minutes_spent === "number")) out.minutes_spent = e.minutes_spent as number | null;
  if ("hours" in e && (e.hours === null || typeof e.hours === "number")) out.hours = e.hours as number | null;
  return out;
}

/**
 * Where a lesson sits, as read just before a completion is written. The write
 * is conditioned on every one of these still holding, so a move, a pin, a skip
 * or a slot change in another tab between the read and the write makes the
 * completion refuse (placement_changed) instead of landing on a lesson the
 * family did not see.
 */
type StoredPlacement = {
  curriculum_goal_id: string | null;
  queue_position: number | null;
  scheduled_date: string | null;
  queue_pinned: boolean | null;
  skipped: boolean | null;
};

export type CompletionErrorCode = "not_found" | "placement_changed";

export interface CompleteLessonResult {
  /** What was written for a queue lesson; null when completed in place. */
  payload: CompletionPayload | null;
  /** The day the completion is filed under, as stored on the row. */
  filedDate: string;
  /** True for a curriculum lesson with no queue slot (completesInPlace). */
  inPlace: boolean;
  /** code is a CompletionErrorCode when this function refused, or the database's own code. */
  error: { message: string; code?: CompletionErrorCode | string } | null;
}

/**
 * A curriculum lesson with no queue slot is completed WHERE IT STANDS.
 *
 * Its date is the only placement it has (the projector never places it), so a
 * completion must not move it, and its pin and source are the family's own
 * record of how it got there. Reopening it restores exactly the same row
 * (reopen_lesson, 20261006000000). Completion therefore writes `completed` and
 * `completed_at` and nothing else: no date, no source, no pin, no backfill flag,
 * and never a queue slot. It is filed under its own day, so there is nothing to
 * choose and the date chooser is not shown for it.
 *
 * One-off lessons (no curriculum) keep the ordinary rule.
 */
export function completesInPlace(lesson: {
  curriculum_goal_id?: string | null;
  queue_position?: number | null;
  scheduled_date?: string | null;
}): boolean {
  return !!lesson.curriculum_goal_id && lesson.queue_position === null && !!lesson.scheduled_date;
}

/** completed_at for an in-place completion filed under `filedDate`, by the same rule as buildCompletionPayload's "planned". */
export function inPlaceCompletedAt(filedDate: string, todayStr: string, now: Date = new Date()): string {
  return filedDate >= todayStr ? now.toISOString() : `${filedDate}T12:00:00Z`;
}

/**
 * Mark one lesson complete on one day. The single writer of
 * `lessons.completed = true` for a lesson a person tapped.
 *
 * The analytics event fires only on success and only once, which is what makes
 * a family's history reconstructable from their taps: every completion has a
 * row and an event that agree on the date.
 */
export async function completeLessonOnDate(
  supabase: SupabaseClient,
  args: CompleteLessonArgs,
): Promise<CompleteLessonResult> {
  // Decided from the stored row, not the caller's copy of it, so a stale screen
  // can never move or unpin a lesson that has no queue slot.
  const { data: stored, error: readErr } = await supabase
    .from("lessons")
    .select("curriculum_goal_id, queue_position, scheduled_date, queue_pinned, skipped")
    .eq("id", args.lessonId)
    .maybeSingle();
  if (readErr) return { payload: null, filedDate: args.dateStr, inPlace: false, error: readErr };
  const row = stored as StoredPlacement | null;
  if (!row) {
    return { payload: null, filedDate: args.dateStr, inPlace: false, error: { message: "lesson not found", code: "not_found" } };
  }
  const time = completionTimeFields(args.extra);
  const changed = { message: "lesson changed before it could be completed", code: "placement_changed" as const };

  if (completesInPlace(row)) {
    const filedDate = row.scheduled_date as string;
    const completedAt = inPlaceCompletedAt(filedDate, args.todayStr, args.now);
    const { data: written, error } = await guardPlacement(
      supabase.from("lessons").update({ ...time, completed: true, completed_at: completedAt }).eq("id", args.lessonId),
      row,
    ).select("id");
    if (error) return { payload: null, filedDate, inPlace: true, error };
    if (!written || written.length !== 1) return { payload: null, filedDate, inPlace: true, error: changed };
    const choice: CompletionChoice = filedDate === args.todayStr ? "today" : "planned";
    args.track?.({
      lesson_number: args.lessonNumber ?? null,
      subject_label: args.subjectLabel ?? null,
      lesson_date: filedDate,
      date_choice: choice,
      surface: args.surface,
    });
    return { payload: null, filedDate, inPlace: true, error: null };
  }

  const payload = buildCompletionPayload({
    dateStr: args.dateStr,
    choice: args.choice,
    todayStr: args.todayStr,
    now: args.now,
  });
  // Payload last: the time fields never carry the date rule.
  const { data: written, error } = await guardPlacement(
    supabase.from("lessons").update({ ...time, ...payload }).eq("id", args.lessonId),
    row,
  ).select("id");
  if (error) return { payload, filedDate: payload.date, inPlace: false, error };
  if (!written || written.length !== 1) return { payload, filedDate: payload.date, inPlace: false, error: changed };
  args.track?.(
    buildLessonCompletedEvent({
      payload,
      choice: args.choice,
      surface: args.surface,
      lessonNumber: args.lessonNumber,
      subjectLabel: args.subjectLabel,
    }),
  );
  return { payload, filedDate: payload.date, inPlace: false, error: null };
}

/** Condition an update on the placement read before it (null via IS, values via =). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function guardPlacement<Q extends { eq: (c: string, v: any) => Q; is: (c: string, v: null) => Q }>(q: Q, row: StoredPlacement): Q {
  // An absent column reads as null: the guard then refuses rather than match on undefined.
  const eqOrIs = (query: Q, column: string, value: string | number | boolean | null | undefined): Q =>
    value == null ? query.is(column, null) : query.eq(column, value);
  let out = eqOrIs(q, "curriculum_goal_id", row.curriculum_goal_id);
  out = eqOrIs(out, "queue_position", row.queue_position);
  out = eqOrIs(out, "scheduled_date", row.scheduled_date);
  out = eqOrIs(out, "queue_pinned", row.queue_pinned);
  out = eqOrIs(out, "skipped", row.skipped);
  return out;
}

/**
 * Does this completion need to ask?
 *
 * Only when the day it would file under is not today. A lesson sitting on
 * today is the common case and must stay one tap; anything else is a date the
 * family has not seen us choose, so we show it to them first.
 */
export function needsDateChoice(
  plannedDate: string | null | undefined,
  todayStr: string,
): boolean {
  if (!plannedDate) return false;
  return plannedDate !== todayStr;
}

/** The two answers the bulk chooser offers for a whole selection. */
export type BulkCompletionChoice = "planned" | "today";

/**
 * How "Mark these N done" files each lesson, once the family has answered for
 * the batch. Each lesson becomes exactly the completion a single check-off of
 * that lesson with the same answer would write, so bulk and single can never
 * disagree about a row.
 *
 *   "today"   every lesson is filed today.
 *   "planned" each lesson on its own planned day. A lesson planned for today is
 *             filed as an ordinary "today" completion (the single chooser does
 *             not even offer "planned" for it), and one with no day at all is
 *             filed today, because there is no planned day to keep.
 */
export function planBulkCompletion(
  lessons: readonly { id: string; scheduled_date?: string | null; date?: string | null }[],
  choice: BulkCompletionChoice,
  todayStr: string,
): { lessonId: string; dateStr: string; choice: CompletionChoice }[] {
  return lessons.map((l) => {
    const planned = l.scheduled_date ?? l.date ?? null;
    if (choice === "today" || !planned || planned === todayStr) {
      return { lessonId: l.id, dateStr: todayStr, choice: "today" };
    }
    return { lessonId: l.id, dateStr: planned, choice: "planned" };
  });
}
