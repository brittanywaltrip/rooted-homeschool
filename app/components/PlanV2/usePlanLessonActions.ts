"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { recomputeCurrentLesson } from "@/app/lib/scheduler";
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
    setLessons(prev => prev.map(l => l.id === id ? { ...l, completed: !current } : l));
    setMonthLessons(prev => prev.map(l => l.id === id ? { ...l, completed: !current } : l));
    await supabase.from("lessons").update({
      completed: !current,
      completed_at: !current ? new Date().toISOString() : null,
    }).eq("id", id);
    const lesson = lessons.find(l => l.id === id) ?? monthLessons.find(l => l.id === id);
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
    const clear = (l: T): T => l.id === lesson.id ? { ...l, scheduled_date: null, date: null } : l;
    setLessons(prev => prev.map(clear));
    setMonthLessons(prev => prev.map(clear));
    if (setAllLessons) setAllLessons(prev => prev.map(clear));
    await supabase.from("lessons").update({ scheduled_date: null, date: null }).eq("id", lesson.id);
    onSkipUndo?.(lesson.id, originalDate);
  }, [setLessons, setMonthLessons, setAllLessons, onSkipUndo]);

  return { toggleLesson, deleteLesson, skipLesson };
}
