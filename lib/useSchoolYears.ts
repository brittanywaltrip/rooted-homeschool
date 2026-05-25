"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

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

// The userId parameter is kept for backwards compatibility with existing
// call sites but is no longer consumed — reload() resolves the user via
// supabase.auth.getUser() so the hook works on initial mount before any
// outer context (e.g. PartnerContext) has populated.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useSchoolYears(_userId?: string | null): SchoolYears {
  const [active, setActive] = useState<SchoolYear | null>(null);
  const [upcoming, setUpcoming] = useState<SchoolYear | null>(null);
  const [archived, setArchived] = useState<SchoolYear[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from("school_years")
      .select("*")
      .order("start_date", { ascending: false });

    const rows = (data ?? []) as SchoolYear[];
    const today = new Date().toISOString().slice(0, 10);
    const currentActive = rows.find(r => r.status === "active");
    const currentUpcoming = rows.find(r => r.status === "upcoming");

    if (currentActive && currentActive.end_date < today && !currentUpcoming) {
      await supabase.from("school_years")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", currentActive.id);
      const { data: refreshed } = await supabase
        .from("school_years").select("*").order("start_date", { ascending: false });
      const freshRows = (refreshed ?? []) as SchoolYear[];
      setActive(freshRows.find(r => r.status === "active") ?? null);
      setUpcoming(freshRows.find(r => r.status === "upcoming") ?? null);
      setArchived(freshRows.filter(r => r.status === "archived"));
      setLoading(false);
      return;
    }

    if (currentUpcoming && currentUpcoming.start_date <= today) {
      if (currentActive) {
        await supabase.from("school_years")
          .update({ status: "archived", updated_at: new Date().toISOString() })
          .eq("id", currentActive.id);
      }
      await supabase.from("school_years")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", currentUpcoming.id);
      const { data: refreshed } = await supabase
        .from("school_years").select("*").order("start_date", { ascending: false });
      const freshRows = (refreshed ?? []) as SchoolYear[];
      setActive(freshRows.find(r => r.status === "active") ?? null);
      setUpcoming(freshRows.find(r => r.status === "upcoming") ?? null);
      setArchived(freshRows.filter(r => r.status === "archived"));
      setLoading(false);
      return;
    }

    setActive(currentActive ?? null);
    setUpcoming(currentUpcoming ?? null);
    setArchived(rows.filter(r => r.status === "archived"));
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { active, upcoming, archived, loading, reload };
}
