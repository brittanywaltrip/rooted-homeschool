"use client";

import { useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { recomputeCurrentLesson, toDateStr } from "@/app/lib/scheduler";
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
};

export function usePlanLessonActions<T extends MinimalLesson>(opts: UsePlanLessonActionsOpts<T>) {
  const {
    lessons, monthLessons,
    setLessons, setMonthLessons, setAllLessons,
    effectiveUserId, onSkipUndo, onNeedsDateChoice, onLessonCompleted,
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
   * Write one completion on one day. Every completing path in this hook ends
   * here, and this is the only place it calls completeLessonOnDate.
   */
  const completeWithChoice = useCallback(async (
    id: string,
    dateStr: string,
    choice: CompletionChoice,
  ) => {
    if (inFlightRef.current.has(id)) return;
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
    } finally {
      inFlightRef.current.delete(id);
    }
  }, [findLesson, setLessons, setMonthLessons, effectiveUserId, onLessonCompleted]);

  const toggleLesson = useCallback(async (id: string, current: boolean) => {
    if (inFlightRef.current.has(id)) return;
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
        return;
      }
      await completeWithChoice(id, todayStr, "today");
      return;
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
      await supabase
        .from("lessons")
        .update({
          completed: false,
          completed_at: null,
          is_backfill: false,
          queue_pinned: false,
          scheduled_source: "manual_uncomplete",
        })
        .eq("id", id);
      if (lesson?.curriculum_goal_id) {
        await recomputeCurrentLesson(supabase, lesson.curriculum_goal_id);
      }
    } finally {
      inFlightRef.current.delete(id);
    }
  }, [findLesson, setLessons, setMonthLessons, onNeedsDateChoice, completeWithChoice]);

  const deleteLesson = useCallback(async (id: string) => {
    setLessons(prev => prev.filter(l => l.id !== id));
    await supabase.from("lessons").delete().eq("id", id);
  }, [setLessons]);

  const skipLesson = useCallback(async (lesson: T) => {
    const originalDate = lesson.scheduled_date ?? lesson.date;
    if (!originalDate) return;
    const originalScheduled = lesson.scheduled_date;
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
    const { error } = await supabase
      .from("lessons")
      .update({ scheduled_date: null })
      .eq("id", lesson.id);
    if (error) {
      const restore = (l: T): T => l.id === lesson.id
        ? { ...l, scheduled_date: originalScheduled }
        : l;
      setLessons(prev => prev.map(restore));
      setMonthLessons(prev => prev.map(restore));
      if (setAllLessons) setAllLessons(prev => prev.map(restore));
      throw new Error(error.message);
    }
    onSkipUndo?.(lesson.id, originalDate);
  }, [setLessons, setMonthLessons, setAllLessons, onSkipUndo]);

  return { toggleLesson, completeWithChoice, deleteLesson, skipLesson };
}
