// The answers to the catch-up question, for Today and Plan alike.
//
// The question is "did you do these?" about the lessons app/lib/missed-work.ts
// computes. Yes records each checked lesson on the day the family agreed to
// and settles the goals they left something unchecked on; No settles every
// offered goal. Either way the remaining lessons move to their new days as the
// family's own action, and the answer is recorded (catchup_answered_on) so the
// same days are not asked about again. Re-dating alone never answers it.
//
// Moved here from app/dashboard/page.tsx unchanged in what it writes, so Plan
// can offer the same answers without a second copy.

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { recomputeCurrentLesson, resyncGoalsForParent, PARENT_RESPREAD_SOURCE } from "./scheduler.ts";
import { completeLessonOnDate, buildCompletionPayload } from "./completeLessonOnDate.ts";
import { goalsWithUncheckedRows, type MissedEntry, type RecoveryRow } from "./recoverySelection.ts";
import { captureSupabaseError } from "../../lib/sentry-error.ts";

export interface MissedAnswerDeps {
  supabase: SupabaseClient;
  userId: string;
  /** YYYY-MM-DD in the family's timezone. */
  todayStr: string;
  /** Exactly what the prompt offered. */
  entriesByGoal: Map<string, MissedEntry[]>;
  goals: Array<{ id: string; curriculum_name: string; subject_label: string | null; child_id: string | null }>;
  /** The family's subjects, to link an inserted row to one by name. */
  subjects: Array<{ id: string; name: string }>;
  track: (event: string, props: Record<string, unknown>) => void;
}

/**
 * Settle goals' catch-up: the family has answered for them, so stop offering
 * the same window back. computeGapLessonsForGoal never reads a lesson row, so
 * re-dating rows alone could not stop it; recording the answer does.
 */
export async function markCatchupAnswered(d: Pick<MissedAnswerDeps, "supabase" | "userId" | "todayStr">, goalIds: string[]) {
  if (goalIds.length === 0) return;
  // One statement, scoped by goal id AND user id (RLS already restricts it).
  const { error } = await d.supabase
    .from("curriculum_goals")
    .update({ catchup_answered_on: d.todayStr })
    .in("id", goalIds)
    .eq("user_id", d.userId);
  if (error) {
    // Non-fatal. The completions just confirmed are already written; failing
    // here only means the prompt may ask again.
    captureSupabaseError("Catch-up answer not recorded", error, {
      level: "warning",
      tags: { fn: "markCatchupAnswered" },
      extra: { goalIds },
    });
  }
}

/** "Yes": record the rows left checked. Throws when something did not land. */
export async function answerMissedYes(d: MissedAnswerDeps, rows: RecoveryRow[]): Promise<void> {
  // The prompt can remain open while another tab completes or moves a lesson.
  // Check every selected row before settling the unanswered ones or writing a
  // completion, so an outdated prompt cannot rewrite that lesson's history.
  const existingBySlot = new Map<string, { id: string } | null>();
  for (const row of rows) {
    const key = `${row.goal_id}|${row.lesson_number}`;
    if (existingBySlot.has(key)) throw new Error("Your lessons changed since you opened this. Close this and try again.");
    const { data, error } = await d.supabase
      .from("lessons")
      .select("id, lesson_number, completed, skipped, queue_pinned")
      .eq("user_id", d.userId)
      .eq("curriculum_goal_id", row.goal_id)
      .eq("queue_position", row.lesson_number)
      .maybeSingle();
    if (error || (data && (data.completed || data.skipped || data.queue_pinned))) {
      throw new Error("Your lessons changed since you opened this. Close this and try again.");
    }
    if (data && data.lesson_number !== row.lesson_number) {
      throw new Error("This curriculum's lesson order has changed. Mark the lesson you did from Plan instead.");
    }
    existingBySlot.set(key, data ? { id: data.id as string } : null);
  }
  // Unchecking is an answer, so act on it. Goals the family left something
  // unchecked on are settled through the SAME helper "No, reschedule them"
  // uses: those lessons move ahead in the plan and stop being offered as
  // overdue. Without this the prompt returned next session with the same
  // past dates, so a family who skipped a week got asked daily.
  const offeredGoalIds = Array.from(d.entriesByGoal.keys());
  const reschedGoalIds = goalsWithUncheckedRows({
    entriesByGoal: d.entriesByGoal,
    goalIds: offeredGoalIds,
    written: rows,
  });
  await markCatchupAnswered(d, reschedGoalIds);
  const offeredCount = offeredGoalIds.reduce(
    (n, id) => n + (d.entriesByGoal.get(id) ?? []).length,
    0,
  );
  d.track("catchup_prompt_confirmed", {
    checked: rows.length,
    unchecked: offeredCount - rows.length,
    goals_rescheduled: reschedGoalIds.length,
  });

  // Only the rows the family left checked, each on the date they saw. A row
  // they unchecked is not written and is not rescheduled either: it stays
  // exactly as it was, and "No, reschedule them" is the way to move it.
  //
  // choice is "planned" when the date is the gap day we proposed and
  // "picked" when they changed it, so the record says whose date it was.
  const goalIds = Array.from(new Set(rows.map((r) => r.goal_id)));

  for (const row of rows) {
    // Match by (curriculum_goal_id, queue_position): the projection emits
    // queue slot indices (see ProjectedLesson), and queue_position is the
    // column Today already matches projection slots against. Rows are
    // pre-generated at creation; a missing one falls through to an insert.
    const existing = existingBySlot.get(`${row.goal_id}|${row.lesson_number}`);

    const goal = d.goals.find((g) => g.id === row.goal_id);

    if (existing) {
      await completeLessonOnDate(d.supabase, {
        lessonId: existing.id,
        dateStr: row.date,
        choice: row.choice,
        todayStr: d.todayStr,
        surface: "recovery",
        lessonNumber: row.lesson_number,
        subjectLabel: goal?.subject_label ?? null,
        track: (event) => d.track("lesson_completed", event as unknown as Record<string, unknown>),
      });
      continue;
    }

    const goalRow = await d.supabase
      .from("curriculum_goals")
      .select("child_id, subject_label, default_minutes")
      .eq("id", row.goal_id)
      .maybeSingle();
    if (goalRow.error) {
      captureSupabaseError("Missed-lesson recovery: goal read failed", goalRow.error, {
        tags: { fn: "acceptMissedRecovery" },
        extra: { goalId: row.goal_id },
      });
    }
    // child_id MUST come from the goal. Pre-fix this silently fell back to
    // null when the SELECT failed or returned nothing, inserting a lesson
    // with no child on a goal that has one (drift F: 6 prod rows across 3
    // families, created Jul 9-27). A lesson row with no child never renders
    // under a kid on Today or Plan and never reaches that child's
    // transcript, so a silent null is worse than a skipped row.
    //
    // Three independent sources, in order, because production kept hitting
    // "no child_id resolvable" on goals whose row genuinely has one:
    //   1. the goal object already in memory (missedGoals carries child_id
    //      from loadData's curriculum_goals select),
    //   2. the per-entry SELECT above,
    //   3. a narrow retry that reads child_id alone, covering a transient
    //      failure of the wider select.
    // Only when all three come back empty do we skip the insert.
    let childId =
      goal?.child_id ??
      (goalRow.data as { child_id?: string | null } | null)?.child_id ??
      null;
    if (!childId) {
      const retry = await d.supabase
        .from("curriculum_goals")
        .select("child_id")
        .eq("id", row.goal_id)
        .maybeSingle();
      if (retry.error) {
        captureSupabaseError("Missed-lesson recovery: child_id retry failed", retry.error, {
          tags: { fn: "acceptMissedRecovery" },
          extra: { goalId: row.goal_id },
        });
      }
      childId = (retry.data as { child_id?: string | null } | null)?.child_id ?? null;
    }
    if (!childId) {
      Sentry.captureMessage(
        `Missed-lesson recovery: no child_id resolvable for goal ${row.goal_id}; skipping insert`,
        { level: "error", tags: { fn: "acceptMissedRecovery" } },
      );
      continue;
    }
    // curriculum_goals has no subject_id column, only subject_label. The
    // real id comes from matching that label against the already-loaded
    // subjects state, same case-insensitive lookup saveEdit() uses.
    const goalSubjectLabel = (goalRow.data as { subject_label?: string | null } | null)?.subject_label ?? null;
    const matchedSubject = goalSubjectLabel?.trim()
      ? d.subjects.find((s) => s.name.toLowerCase() === goalSubjectLabel.trim().toLowerCase())
      : undefined;
    const defaultMinutes =
      (goalRow.data as { default_minutes?: number | null } | null)?.default_minutes ?? 30;
    // Same completion shape as the update branch above; the helper cannot be
    // used for a row that does not exist yet, so the payload is spread last
    // so the date rule wins over anything above it.
    const insertPayload = buildCompletionPayload({
      dateStr: row.date,
      choice: row.choice,
      todayStr: d.todayStr,
    });
    const { error: insertErr } = await d.supabase.from("lessons").insert({
      user_id: d.userId,
      curriculum_goal_id: row.goal_id,
      lesson_number: row.lesson_number,
      queue_position: row.lesson_number,
      title: `${goal?.subject_label ?? goal?.curriculum_name ?? "Lesson"}: Lesson ${row.lesson_number}`,
      child_id: childId,
      subject_id: matchedSubject?.id ?? null,
      minutes_spent: defaultMinutes,
      hours: defaultMinutes / 60,
      ...insertPayload,
    });
    if (insertErr) {
      captureSupabaseError("Missed-lesson recovery: insert failed", insertErr, {
        tags: { fn: "acceptMissedRecovery" },
        extra: { goalId: row.goal_id, slot: row.lesson_number },
      });
      continue;
    }
    d.track("lesson_completed", {
      lesson_number: row.lesson_number,
      subject_label: goalSubjectLabel,
      lesson_date: insertPayload.date,
      date_choice: row.choice,
      surface: "recovery" as const,
    });
  }

  for (const goalId of goalIds) {
    await recomputeCurrentLesson(d.supabase, goalId);
  }

  // Move the offered goals' remaining lessons to their new days, as the
  // family's own action (see answerMissedNo). After the completions
  // and the pointer recompute, so the projection starts from what they did.
  const moved = await resyncGoalsForParent(
    d.supabase, d.userId, offeredGoalIds, PARENT_RESPREAD_SOURCE.catchUp,
  );
  if (!moved.ok) {
    throw new Error("Your lessons were saved, but some upcoming ones couldn't be moved to their new days. Try again.");
  }
}

/**
 * "No, keep them in the plan": the family did not do any of these. Their
 * lessons move ahead first, as the family's own action; the answer is recorded
 * only once that has landed, so a failure leaves the question open. Throws on
 * failure.
 */
export async function answerMissedNo(d: Pick<MissedAnswerDeps, "supabase" | "userId" | "todayStr" | "entriesByGoal">): Promise<void> {
  const offered = Array.from(d.entriesByGoal.keys());
  const moved = await resyncGoalsForParent(d.supabase, d.userId, offered, PARENT_RESPREAD_SOURCE.catchUp);
  if (!moved.ok) {
    throw new Error("Some lessons couldn't be moved ahead. Try again, or check your connection.");
  }
  await markCatchupAnswered(d, offered);
}
