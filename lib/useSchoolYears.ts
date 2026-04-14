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

export function useSchoolYears(userId: string | null): SchoolYears {
  const [active, setActive] = useState<SchoolYear | null>(null);
  const [upcoming, setUpcoming] = useState<SchoolYear | null>(null);
  const [archived, setArchived] = useState<SchoolYear[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const { data } = await supabase
      .from("school_years")
      .select("*")
      .eq("user_id", userId)
      .order("start_date", { ascending: false });

    const rows = (data ?? []) as SchoolYear[];
    const today = new Date().toISOString().slice(0, 10);
    const currentActive = rows.find(r => r.status === "active");
    const currentUpcoming = rows.find(r => r.status === "upcoming");

    // Auto-archive active year if its end_date has passed and no upcoming to promote
    if (currentActive && currentActive.end_date < today && !currentUpcoming) {
      await supabase.from("school_years")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", currentActive.id);
      const { data: refreshed } = await supabase
        .from("school_years").select("*").eq("user_id", userId).order("start_date", { ascending: false });
      const freshRows = (refreshed ?? []) as SchoolYear[];
      setActive(freshRows.find(r => r.status === "active") ?? null);
      setUpcoming(freshRows.find(r => r.status === "upcoming") ?? null);
      setArchived(freshRows.filter(r => r.status === "archived"));
      setLoading(false);
      return;
    }

    // Auto-promote upcoming → active when its start_date arrives
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
        .from("school_years").select("*").eq("user_id", userId).order("start_date", { ascending: false });
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
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  return { active, upcoming, archived, loading, reload };
}
