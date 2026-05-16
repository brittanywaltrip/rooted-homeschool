"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { recomputeCurrentLesson, toDateStr } from "@/app/lib/scheduler";
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
};

export function usePlanLessonActions<T extends MinimalLesson>(opts: UsePlanLessonActionsOpts<T>) {
  const {
    lessons, monthLessons,
    setLessons, setMonthLessons, setAllLessons,
    effectiveUserId, onSkipUndo,
  } = opts;

  const toggleLesson = useCallback(async (id: string, current: boolean) => {
    const lesson = lessons.find(l => l.id === id) ?? monthLessons.find(l => l.id === id);
    const completingNow = !current;
    // If a future-dated lesson is being marked complete, pin its
    // scheduled_date and date to today. The lesson was DONE today, so
    // its date should be today. Leaving it at tomorrow makes the row
    // look like it was completed before it was scheduled and pulls the
    // Plan / Today views out of sync. Only applied on the
    // complete-direction; toggling back to incomplete leaves dates
    // untouched (the user might be undoing a misclick on a real future
    // lesson). lesson_number is left alone. The queue position is
    // governed by completed lesson_numbers + current_lesson, not date.
    const todayStr = toDateStr(new Date());
    const pinDateToToday =
      completingNow &&
      !!lesson &&
      lesson.scheduled_date != null &&
      lesson.scheduled_date > todayStr;
    const patch = (l: T): T =>
      l.id !== id
        ? l
        : pinDateToToday
          ? { ...l, completed: completingNow, scheduled_date: todayStr, date: todayStr }
          : { ...l, completed: completingNow };
    setLessons(prev => prev.map(patch));
    setMonthLessons(prev => prev.map(patch));
    const update: Record<string, unknown> = {
      completed: completingNow,
      completed_at: completingNow ? new Date().toISOString() : null,
    };
    if (pinDateToToday) {
      update.scheduled_date = todayStr;
      update.date = todayStr;
    }
    await supabase.from("lessons").update(update).eq("id", id);
    if (lesson?.curriculum_goal_id) {
      await recomputeCurrentLesson(supabase, lesson.curriculum_goal_id);
    }
    if (!current && effectiveUserId) {
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
  }, [lessons, monthLessons, setLessons, setMonthLessons, effectiveUserId]);

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

  return { toggleLesson, deleteLesson, skipLesson };
}
