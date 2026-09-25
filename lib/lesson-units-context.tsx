"use client";

/* ============================================================================
 * The unit wording of the family's curricula ("Week 12.3"), for any screen
 * that shows a lesson number. lib/lesson-label.ts does the arithmetic; this
 * loads which curricula have a setting and hands it to the screen.
 *
 * ONE narrow read, deliberately separate from every existing lesson and
 * curriculum query: a select that named the new columns on a database without
 * them would fail WHOLE and take Today or Plan down with it. This read fails
 * alone and quietly, and a failed read means "no units", which is exactly how
 * every curriculum read before the setting existed. So the app can ship before
 * or after its migration, and a missing column can only ever cost the words,
 * never a lesson.
 *
 * Each page that shows lessons wraps itself in <LessonUnitsProvider>; the
 * dashboard layout is an auth file and is left alone. A Schedule Builder save
 * announces itself with the "rooted:curricula-updated" event and every mounted
 * provider re-reads.
 * ==========================================================================*/

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { captureSupabaseError } from "@/lib/sentry-error";
import { lessonUnitMap, type LessonUnit } from "@/lib/lesson-label";
import { usePartner } from "@/lib/partner-context";

export const CURRICULA_UPDATED_EVENT = "rooted:curricula-updated";

type LessonUnits = {
  /** The wording for a curriculum, or null for "Lesson N". */
  unitFor: (goalId: string | null | undefined) => LessonUnit | null;
};

const LessonUnitsContext = createContext<LessonUnits>({ unitFor: () => null });

/**
 * `userId` defaults to the family being viewed (usePartner().effectiveUserId),
 * so a co-teacher sees the owner's wording.
 */
export function LessonUnitsProvider({ userId: explicitUserId, children }: { userId?: string | null; children: React.ReactNode }) {
  const { effectiveUserId } = usePartner();
  const userId = explicitUserId ?? effectiveUserId;
  const [units, setUnits] = useState<Map<string, LessonUnit>>(() => new Map());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const read = () => {
      void supabase
        .from("curriculum_goals")
        .select("id, lesson_unit_label, lessons_per_unit")
        .eq("user_id", userId)
        .not("lesson_unit_label", "is", null)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            // A database without the columns lands here (42703). Default wording.
            captureSupabaseError("lesson units read failed", error, { level: "warning", extra: { fn: "LessonUnitsProvider" } });
            setUnits(new Map());
            return;
          }
          setUnits(lessonUnitMap((data ?? []) as { id: string; lesson_unit_label: string | null; lessons_per_unit: number | null }[]));
        });
    };
    read();
    window.addEventListener(CURRICULA_UPDATED_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(CURRICULA_UPDATED_EVENT, read);
    };
  }, [userId]);

  const value = useMemo<LessonUnits>(() => ({
    unitFor: (goalId) => (goalId ? units.get(goalId) ?? null : null),
  }), [units]);

  return <LessonUnitsContext.Provider value={value}>{children}</LessonUnitsContext.Provider>;
}

/** The wording lookup for the page this component is on. */
export function useLessonUnits(): LessonUnits {
  return useContext(LessonUnitsContext);
}
