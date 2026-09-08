import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { recomputeCurrentLesson } from "./scheduler";
import { buildCompletionPayload, type LessonCompletedEvent } from "./completeLessonOnDate";
import { captureSupabaseError } from "../../lib/sentry-error";

/**
 * "We did this, on that day."
 *
 * Rooted schedules by queue, not by calendar: reconcileGoalScheduleCache
 * re-dates every incomplete lesson forward from today on each page load. So a
 * school day that passed without being checked off ends up EMPTY on the Plan
 * calendar, and the family loses the ability to record that the work happened
 * on that day. This helper is the one write path that puts it back.
 *
 * Callers: the Plan page's past-day catch-up checklist (DayDetailPanel). The
 * Today page's Missed Lesson Recovery modal still owns its own copy of this
 * write for now; collapsing it onto this helper is the documented follow-up.
 *
 * Every completion is stamped at NOON UTC on the day the work happened, never
 * `now()`. Attendance in app/dashboard/reports/page.tsx buckets on
 * `completed_at.slice(0, 10)`, so a `now()` stamp marks the wrong day present
 * and leaves the real one empty. Noon UTC also matches what the catch-up modal
 * and healGoalIntegrity already write.
 */

export interface PastDayEntry {
  goal_id: string;
  /** Queue slot index (`queue_position`), matching ProjectedLesson.lesson_number. */
  lesson_number: number;
  /** YYYY-MM-DD — the day the family actually did the work. */
  date: string;
}

export interface LogPastDayResult {
  okCount: number;
  failedCount: number;
}

interface SubjectOption {
  id: string;
  name: string;
}

/**
 * Mark each entry complete on its own past date.
 *
 * Rows almost always already exist — the Schedule Builder pre-generates every
 * slot 1..total_lessons — so the common path is an UPDATE keyed on
 * (curriculum_goal_id, queue_position). The insert branch covers goals whose
 * rows predate queue_position or were pruned by the orphan-cleanup trigger.
 *
 * Never throws. A failed entry is counted and the loop continues, so one bad
 * row cannot swallow a whole day's catch-up.
 */
export async function logPastDayLessons(
  supabase: SupabaseClient,
  userId: string,
  entries: PastDayEntry[],
  subjects: SubjectOption[],
  /**
   * Invariant 16: one lesson_completed per completion, on every surface.
   * Optional so existing callers keep working; PlanV2 passes it.
   */
  opts?: { todayStr?: string; track?: (event: LessonCompletedEvent) => void },
): Promise<LogPastDayResult> {
  let okCount = 0;
  let failedCount = 0;
  const touchedGoalIds = new Set<string>();
  const todayStr = opts?.todayStr ?? new Date().toISOString().slice(0, 10);

  for (const entry of entries) {
    // The family named this day on the checklist, so it is a "picked" choice
    // and buildCompletionPayload is the one definition of what that writes:
    // noon UTC, is_backfill, queue_pinned. Same shape the chooser produces.
    const completionPayload = buildCompletionPayload({
      dateStr: entry.date,
      choice: "picked",
      todayStr,
    });
    try {
      const { data: existing, error: existingErr } = await supabase
        .from("lessons")
        .select("id")
        .eq("user_id", userId)
        .eq("curriculum_goal_id", entry.goal_id)
        .eq("queue_position", entry.lesson_number)
        .maybeSingle();

      if (existingErr) {
        captureSupabaseError("logPastDayLessons: existing-row read failed", existingErr, {
          tags: { fn: "logPastDayLessons" },
          extra: { goalId: entry.goal_id, slot: entry.lesson_number },
        });
        failedCount += 1;
        continue;
      }

      if (existing) {
        // The shared completion payload pins date + scheduled_date to the
        // chosen day, flags is_backfill so the projector never re-spreads the
        // row back onto today (Invariant 3), and pins the slot because a day
        // the family named is a manual placement (Invariant 12).
        const { error } = await supabase
          .from("lessons")
          .update(completionPayload)
          .eq("id", (existing as { id: string }).id);
        if (error) {
          captureSupabaseError("logPastDayLessons: update failed", error, {
            tags: { fn: "logPastDayLessons" },
            extra: { goalId: entry.goal_id, slot: entry.lesson_number },
          });
          failedCount += 1;
          continue;
        }
        okCount += 1;
        touchedGoalIds.add(entry.goal_id);
        opts?.track?.({
          lesson_number: entry.lesson_number,
          subject_label: null,
          lesson_date: completionPayload.date,
          date_choice: "picked",
          surface: "month",
        });
        continue;
      }

      // No row for this slot. Insert one, but only with a real child_id.
      const { data: goalRow, error: goalErr } = await supabase
        .from("curriculum_goals")
        .select("child_id, subject_label, curriculum_name, default_minutes")
        .eq("id", entry.goal_id)
        .maybeSingle();
      if (goalErr) {
        captureSupabaseError("logPastDayLessons: goal read failed", goalErr, {
          tags: { fn: "logPastDayLessons" },
          extra: { goalId: entry.goal_id },
        });
      }

      const goal = goalRow as {
        child_id?: string | null;
        subject_label?: string | null;
        curriculum_name?: string | null;
        default_minutes?: number | null;
      } | null;

      let childId = goal?.child_id ?? null;
      if (!childId) {
        const retry = await supabase
          .from("curriculum_goals")
          .select("child_id")
          .eq("id", entry.goal_id)
          .maybeSingle();
        if (retry.error) {
          captureSupabaseError("logPastDayLessons: child_id retry failed", retry.error, {
            tags: { fn: "logPastDayLessons" },
            extra: { goalId: entry.goal_id },
          });
        }
        childId = (retry.data as { child_id?: string | null } | null)?.child_id ?? null;
      }
      if (!childId) {
        // A lesson row with no child never renders under a kid on Today or
        // Plan and never reaches that child's transcript. A skipped row is
        // strictly better than a silently orphaned one.
        Sentry.captureMessage(
          `logPastDayLessons: no child_id resolvable for goal ${entry.goal_id}; skipping insert`,
          { level: "error", tags: { fn: "logPastDayLessons" } },
        );
        failedCount += 1;
        continue;
      }

      const goalSubjectLabel = goal?.subject_label ?? null;
      const matchedSubject = goalSubjectLabel && goalSubjectLabel.trim()
        ? subjects.find((s) => s.name.toLowerCase() === goalSubjectLabel.trim().toLowerCase())
        : undefined;
      const defaultMinutes = goal?.default_minutes ?? 30;

      // Same completion shape as the update branch. Spread last so the
      // date rule wins over anything above it.
      const { error: insertErr } = await supabase.from("lessons").insert({
        user_id: userId,
        curriculum_goal_id: entry.goal_id,
        lesson_number: entry.lesson_number,
        queue_position: entry.lesson_number,
        title: `${goalSubjectLabel ?? goal?.curriculum_name ?? "Lesson"}: Lesson ${entry.lesson_number}`,
        child_id: childId,
        subject_id: matchedSubject?.id ?? null,
        minutes_spent: defaultMinutes,
        hours: defaultMinutes / 60,
        ...completionPayload,
      });
      if (insertErr) {
        captureSupabaseError("logPastDayLessons: insert failed", insertErr, {
          tags: { fn: "logPastDayLessons" },
          extra: { goalId: entry.goal_id, slot: entry.lesson_number },
        });
        failedCount += 1;
        continue;
      }
      okCount += 1;
      touchedGoalIds.add(entry.goal_id);
      opts?.track?.({
        lesson_number: entry.lesson_number,
        subject_label: goalSubjectLabel,
        lesson_date: completionPayload.date,
        date_choice: "picked",
        surface: "month",
      });
    } catch (err) {
      captureSupabaseError("logPastDayLessons: entry threw", err, {
        tags: { fn: "logPastDayLessons" },
        extra: { goalId: entry.goal_id, slot: entry.lesson_number },
      });
      failedCount += 1;
    }
  }

  // Progress is recomputed from actual rows, once per goal, after all writes.
  for (const goalId of touchedGoalIds) {
    await recomputeCurrentLesson(supabase, goalId);
  }

  return { okCount, failedCount };
}
