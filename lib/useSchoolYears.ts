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
    setActive(rows.find(r => r.status === "active") ?? null);
    setUpcoming(rows.find(r => r.status === "upcoming") ?? null);
    setArchived(rows.filter(r => r.status === "archived"));
    setLoading(false);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  return { active, upcoming, archived, loading, reload };
}
