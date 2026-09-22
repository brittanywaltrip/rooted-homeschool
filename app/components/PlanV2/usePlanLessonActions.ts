"use client";

import { useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  recomputeCurrentLesson,
  resyncGoalsForParent,
  toDateStr,
  PARENT_RESPREAD_SOURCE,
  COMPLETION_RESPREAD_FAILED_NOTE,
} from "@/app/lib/scheduler";
import {
  completeLessonOnDate,
  needsDateChoice,
  type CompletionChoice,
  type LessonCompletedEvent,
} from "@/app/lib/completeLessonOnDate";
import { onLogAction } from "@/app/lib/onLogAction";

/* ============================================================================
 * usePlanLessonActions — shared lesson handlers for the Plan page.
 *
 * Both the legacy plan/page.tsx and the new PlanV2 components consume this
 * hook so the toggle / delete / skip logic lives in one place. The hook is
 * dependency-injected: the caller provides its state setters and arrays, and
 * gets back stable callback handlers. This keeps state ownership with the
 * page component while the handlers themselves are reusable.
 *
 * Behaviour matches the original inline handlers in plan/page.tsx with one
 * addition: the analytics fire-and-forget call is wrapped in try/catch per
 * the global rule that a logging failure must never block a user action.
 * DB writes are NOT wrapped — a failed write is a user-visible failure.
 * ==========================================================================*/

type MinimalLesson = {
  id: string;
  completed: boolean;
  child_id: string | null;
  curriculum_goal_id?: string | null;
  scheduled_date: string | null;
  date: string | null;
};

export type UsePlanLessonActionsOpts<T extends MinimalLesson> = {
  lessons: T[];
  monthLessons: T[];
  setLessons: React.Dispatch<React.SetStateAction<T[]>>;
  setMonthLessons: React.Dispatch<React.SetStateAction<T[]>>;
  setAllLessons?: React.Dispatch<React.SetStateAction<T[]>>;
  effectiveUserId: string | undefined;
  /** Called after skipLesson succeeds so the page can show its undo UI. */
  onSkipUndo?: (lessonId: string, originalDate: string) => void;
  /**
   * Invariant 16. A completion whose day is not today has to be shown to the
   * family before it is written, and the chooser is UI the host owns. When
   * this is supplied, `toggleLesson` asks instead of writing and the host
   * calls `completeWithChoice` with the answer. Without it the hook keeps the
   * old behaviour, which is what the legacy plan page still relies on.
   */
  onNeedsDateChoice?: (lesson: T, plannedDate: string, todayStr: string) => void;
  /** Fires once per completion, after the write lands. */
  onLessonCompleted?: (event: LessonCompletedEvent, lesson: T) => void;
  /**
   * A completion or un-completion moved the queue pointer and the rest of the
   * curriculum was re-dated. The host reloads so Plan shows the new dates.
   */
  onScheduleRedated?: () => void;
  /** The re-date after a completion did not fully land. The host says so. */
  onRedateFailed?: (message: string) => void;
};

export function usePlanLessonActions<T extends MinimalLesson>(opts: UsePlanLessonActionsOpts<T>) {
  const {
    lessons, monthLessons,
    setLessons, setMonthLessons, setAllLessons,
    effectiveUserId, onSkipUndo, onNeedsDateChoice, onLessonCompleted,
    onScheduleRedated, onRedateFailed,
  } = opts;

  // Lessons with a write in flight. A second tap on the same circle while the
  // first is still writing is IGNORED, not queued: on a slow connection a
  // family taps again, and two completions racing for one row is how a row
  // reads done, then not done, then done. Same guard the past-year confirm
  // button uses.
  const inFlightRef = useRef<Set<string>>(new Set());

  const findLesson = useCallback(
    (id: string): T | undefined =>
      lessons.find(l => l.id === id) ?? monthLessons.find(l => l.id === id),
    [lessons, monthLessons],
  );

  /**
   * After a completion or un-completion moved the pointer: re-date the rest
   * of that curriculum as the family's own action, so Plan's stored dates
   * match what Today projects. The automatic page-load reconciler is off
   * (NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED=false), so without this Plan kept the
   * old dates. The completion itself is never undone for a failed re-date.
   */
  const redateAfter = useCallback(async (goalId: string | null | undefined, kind: "completion" | "uncompletion") => {
    if (!goalId || !effectiveUserId) return;
    const res = await resyncGoalsForParent(supabase, effectiveUserId, [goalId], PARENT_RESPREAD_SOURCE[kind]);
    if (!res.ok) onRedateFailed?.(COMPLETION_RESPREAD_FAILED_NOTE);
    if (res.written > 0 || !res.ok) onScheduleRedated?.();
  }, [effectiveUserId, onRedateFailed, onScheduleRedated]);

  /**
   * Write one completion on one day. Every completing path in this hook ends
   * here, and this is the only place it calls completeLessonOnDate.
   */
  const completeWithChoice = useCallback(async (
    id: string,
    dateStr: string,
    choice: CompletionChoice,
  ): Promise<boolean> => {
    // false: a write for this lesson is already in flight and this tap was
    // dropped. The caller must not log, toast or celebrate a tap that wrote
    // nothing.
    if (inFlightRef.current.has(id)) return false;
    inFlightRef.current.add(id);
    try {
      const lesson = findLesson(id);
      const todayStr = toDateStr(new Date());
      // Optimistic: the row moves to the day it is being filed under, so the
      // calendar agrees with the toast before the write lands.
      const patch = (l: T): T =>
        l.id !== id ? l : { ...l, completed: true, scheduled_date: dateStr, date: dateStr };
      setLessons(prev => prev.map(patch));
      setMonthLessons(prev => prev.map(patch));

      const { error } = await completeLessonOnDate(supabase, {
        lessonId: id,
        dateStr,
        choice,
        todayStr,
        surface: "plan",
        lessonNumber: (lesson as { lesson_number?: number | null } | undefined)?.lesson_number ?? null,
        subjectLabel:
          (lesson as { curriculum_goals?: { subject_label?: string | null } | null } | undefined)
            ?.curriculum_goals?.subject_label ?? null,
        track: (event) => {
          if (lesson) onLessonCompleted?.(event, lesson);
        },
      });
      if (error) {
        // Roll the optimistic patch back so the row does not read as done.
        const revert = (l: T): T => (l.id !== id ? l : { ...l, completed: false });
        setLessons(prev => prev.map(revert));
        setMonthLessons(prev => prev.map(revert));
        throw new Error(error.message);
      }

      if (lesson?.curriculum_goal_id) {
        await recomputeCurrentLesson(supabase, lesson.curriculum_goal_id);
        await redateAfter(lesson.curriculum_goal_id, "completion");
      }
      if (effectiveUserId) {
        try {
          onLogAction({
            userId: effectiveUserId,
            childId: lesson?.child_id ?? undefined,
            actionType: "lesson",
          });
        } catch {
          /* analytics must never block a user action */
        }
      }
      return true;
    } finally {
      inFlightRef.current.delete(id);
    }
  }, [findLesson, setLessons, setMonthLessons, effectiveUserId, onLessonCompleted, redateAfter]);

  const toggleLesson = useCallback(async (id: string, current: boolean): Promise<boolean> => {
    if (inFlightRef.current.has(id)) return false;
    const lesson = findLesson(id);
    const completingNow = !current;
    const todayStr = toDateStr(new Date());

    if (completingNow) {
      // Invariant 16. The day this would be filed under is the row's own day.
      // When that is not today the family has not seen us choose it, so ask
      // (the host owns the chooser and calls completeWithChoice with the
      // answer). When it IS today, or there is no date at all, write today and
      // say so in the toast: no new step on the common case.
      //
      // This supersedes the old split where a past-dated row silently kept its
      // planned day while a today-or-future one was silently pinned to today.
      // Same tap, two different dates, depending on a comparison the family
      // could not see. See Invariant 16 in docs/CURRICULUM-SCHEDULING.md.
      const plannedDate = lesson?.scheduled_date ?? lesson?.date ?? null;
      if (lesson && onNeedsDateChoice && needsDateChoice(plannedDate, todayStr)) {
        onNeedsDateChoice(lesson, plannedDate as string, todayStr);
        return false;
      }
      return completeWithChoice(id, todayStr, "today");
    }

    // ── Uncomplete. Unchanged (Invariant 7 territory). ──────────────────────
    const patch = (l: T): T => (l.id !== id ? l : { ...l, completed: false });
    setLessons(prev => prev.map(patch));
    setMonthLessons(prev => prev.map(patch));
    // Un-completing hands the row back to the queue, so it must stop looking
    // like history. `is_backfill` is what a chosen-day completion sets (see
    // buildCompletionPayload), and syncProjectedScheduledDates skips
    // is_backfill rows — so a row logged on a day that already passed and then
    // unchecked kept that past date forever: the reconciler would never roll it
    // forward, and every load read it as missed. `queue_pinned` comes off for
    // the same reason: a pin outlives the completion that justified it and
    // would freeze the row where the projector can no longer move it. The date
    // columns are still left untouched here; moving them is the reconciler's
    // job, not this write's.
    inFlightRef.current.add(id);
    try {
      // Confirmed: an error, or a row the database left alone, puts the check
      // back and is reported to the caller like a failed completion.
      const { data: undone, error } = await supabase
        .from("lessons")
        .update({
          completed: false,
          completed_at: null,
          is_backfill: false,
          queue_pinned: false,
          scheduled_source: "manual_uncomplete",
        })
        .eq("id", id)
        .select("id");
      if (error || (undone ?? []).length !== 1) {
        const revert = (l: T): T => (l.id !== id ? l : { ...l, completed: true });
        setLessons(prev => prev.map(revert));
        setMonthLessons(prev => prev.map(revert));
        throw new Error(error?.message ?? "The lesson could not be unmarked");
      }
      if (lesson?.curriculum_goal_id) {
        await recomputeCurrentLesson(supabase, lesson.curriculum_goal_id);
        await redateAfter(lesson.curriculum_goal_id, "uncompletion");
      }
      return true;
    } finally {
      inFlightRef.current.delete(id);
    }
  }, [findLesson, setLessons, setMonthLessons, onNeedsDateChoice, completeWithChoice, redateAfter]);

  const deleteLesson = useCallback(async (id: string) => {
    setLessons(prev => prev.filter(l => l.id !== id));
    await supabase.from("lessons").delete().eq("id", id);
  }, [setLessons]);

  const skipLesson = useCallback(async (lesson: T) => {
    const originalDate = lesson.scheduled_date ?? lesson.date;
    if (!originalDate) return;
    const originalScheduled = lesson.scheduled_date;
    // Skip means "we are not doing this lesson, move on". The row is kept and
    // marked skipped: the projector steps over its slot, so the next lesson
    // takes its day, and the Today reconciler never dates it again. Before the
    // skipped column this cleared scheduled_date and nothing else, the row was
    // still an ordinary unpinned queue row, and the next Today load re-dated
    // it straight back onto the calendar. queue_pinned comes off so a skipped
    // lesson that had been dragged is not also a pin.
    //
    // Only `scheduled_date` is cleared. `date` has a NOT NULL constraint
    // on the lessons table — including it in the update payload returned
    // a 400 every time and was the root cause of "Skip does nothing".
    // After the write, `scheduled_date IS NULL` makes the lesson fall
    // outside usePlanV2Data's `gte/lte scheduled_date` window on reload,
    // so the calendar drops it. `date` is left untouched for history.
    const clear = (l: T): T => l.id === lesson.id ? { ...l, scheduled_date: null } : l;
    setLessons(prev => prev.map(clear));
    setMonthLessons(prev => prev.map(clear));
    if (setAllLessons) setAllLessons(prev => prev.map(clear));
    // Capture the Supabase error explicitly — the JS client returns
    // { data, error } and doesn't throw on RLS/constraint failures, so a
    // missed error here was silently leaving the DB unchanged while the
    // optimistic UI cleared. On error, roll the optimistic state back so
    // the lesson reappears in place and surface the failure to the caller
    // (which shows a flashNotice).
    // Confirmed: a row the database leaves alone comes back missing from the
    // representation with no error, and counts as a failure too.
    const { data: skippedRows, error } = await supabase
      .from("lessons")
      .update({ skipped: true, scheduled_date: null, queue_pinned: false })
      .eq("id", lesson.id)
      .select("id");
    if (error || (skippedRows ?? []).length !== 1) {
      const restore = (l: T): T => l.id === lesson.id
        ? { ...l, scheduled_date: originalScheduled }
        : l;
      setLessons(prev => prev.map(restore));
      setMonthLessons(prev => prev.map(restore));
      if (setAllLessons) setAllLessons(prev => prev.map(restore));
      throw new Error(error?.message ?? "The skip did not land");
    }
    onSkipUndo?.(lesson.id, originalDate);
  }, [setLessons, setMonthLessons, setAllLessons, onSkipUndo]);

  return { toggleLesson, completeWithChoice, deleteLesson, skipLesson };
}
