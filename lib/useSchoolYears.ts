"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { planSchoolYearRows, todayLocalYmd } from "@/app/lib/school-year";

export type SchoolYear = {
  id: string;
  user_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "active" | "upcoming" | "archived";
  created_at: string;
  updated_at: string;
};

export type SchoolYears = {
  active: SchoolYear | null;
  upcoming: SchoolYear | null;
  archived: SchoolYear[];
  loading: boolean;
  reload: () => Promise<void>;
};

/**
 * The family's school years, sorted by planSchoolYearRows in
 * app/lib/school-year.ts, which is also where "this year" is defined.
 *
 * The one write this hook makes is promoting an upcoming year on its start
 * date. It never ends a year: a year closes only when the family closes it
 * through /dashboard/close-year. It used to archive the active year on any
 * reload once its end_date had passed, which skipped the close route's real
 * work (subjects left active, grades not advanced, no keepsake) and then hid
 * the Close card.
 *
 * Reads only `userId`'s rows. Until the caller has a user id the hook stays
 * loading, so no card flashes on a result that belongs to nobody.
 */
export function useSchoolYears(userId?: string | null): SchoolYears {
  const [active, setActive] = useState<SchoolYear | null>(null);
  const [upcoming, setUpcoming] = useState<SchoolYear | null>(null);
  const [archived, setArchived] = useState<SchoolYear[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    const read = () =>
      supabase
        .from("school_years")
        .select("*")
        .eq("user_id", userId)
        .order("start_date", { ascending: false });

    const { data } = await read();
    let plan = planSchoolYearRows((data ?? []) as SchoolYear[], todayLocalYmd());

    if (plan.promote) {
      const now = new Date().toISOString();
      if (plan.promote.archiveId) {
        await supabase.from("school_years")
          .update({ status: "archived", updated_at: now })
          .eq("id", plan.promote.archiveId);
      }
      await supabase.from("school_years")
        .update({ status: "active", updated_at: now })
        .eq("id", plan.promote.activateId);
      const { data: refreshed } = await read();
      plan = planSchoolYearRows((refreshed ?? []) as SchoolYear[], todayLocalYmd());
    }

    setActive(plan.active);
    setUpcoming(plan.upcoming);
    setArchived(plan.archived);
    setLoading(false);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  return { active, upcoming, archived, loading, reload };
}
