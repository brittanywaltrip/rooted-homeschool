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
   * Columns written alongside the completion that are not part of the date
   * rule: minutes_spent / hours, mostly. Never a date column and never
   * `completed` — those belong to the payload above and are applied last so a
   * caller cannot quietly override them.
   */
  extra?: Record<string, unknown>;
  /** Fires once, only after the write succeeds. */
  track?: (event: LessonCompletedEvent) => void;
  now?: Date;
}

export interface CompleteLessonResult {
  payload: CompletionPayload;
  error: { message: string } | null;
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
  const payload = buildCompletionPayload({
    dateStr: args.dateStr,
    choice: args.choice,
    todayStr: args.todayStr,
    now: args.now,
  });
  // Payload last: `extra` carries minutes and hours, never the date rule.
  const { error } = await supabase
    .from("lessons")
    .update({ ...(args.extra ?? {}), ...payload })
    .eq("id", args.lessonId);
  if (error) return { payload, error };
  args.track?.(
    buildLessonCompletedEvent({
      payload,
      choice: args.choice,
      surface: args.surface,
      lessonNumber: args.lessonNumber,
      subjectLabel: args.subjectLabel,
    }),
  );
  return { payload, error: null };
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
