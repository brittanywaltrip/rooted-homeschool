"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type SchoolYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
};

function formatMonthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function YearsArchivePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [years, setYears] = useState<SchoolYear[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setYears([]);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("school_years")
        .select("id, name, start_date, end_date, status")
        .eq("user_id", user.id)
        .order("start_date", { ascending: false });
      if (cancelled) return;
      setYears((data as SchoolYear[] | null) ?? []);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const allYears = years ?? [];
  const hasClosedYears = allYears.some((y) => y.status !== "active");

  return (
    <div style={{ background: "#F8F7F4", minHeight: "100vh" }}>
      <div className="max-w-2xl mx-auto px-6 pt-8 pb-12">
        <Link
          href="/dashboard/plan"
          className="text-sm text-[#5c7f63] hover:underline inline-block mb-6"
        >
          Back to Plan
        </Link>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-3">
          Past Years
        </p>
        <h1
          className="text-3xl text-[#1a2c22] mb-2"
          style={{ fontFamily: "'Cormorant Garamond', Georgia, serif" }}
        >
          Your archived years
        </h1>
        <p className="text-sm text-[#8B7E74] mb-8">
          Every year you close lives here. Tap one to revisit the keepsake.
        </p>

        {loading ? (
          <p className="text-sm text-[#7a6f65]">Loading...</p>
        ) : !hasClosedYears ? (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 text-center">
            <p className="text-base text-[#2D2A26]">No archived years yet.</p>
            <p className="text-sm text-[#8B7E74] mt-2">
              When you close a school year, it will appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {allYears.map((y) => {
              const isActive = y.status === "active";
              const badgeClass = isActive
                ? "bg-[#e8f0e9] text-[#2D5A3D] border-[#b8d0bc]"
                : "bg-[#f0ede8] text-[#5c5248] border-[#d4cfc9]";
              const card = (
                <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-medium text-[#1a2c22]">{y.name}</p>
                    <p className="text-xs text-[#8B7E74] mt-0.5">
                      {formatMonthYear(y.start_date)} to {formatMonthYear(y.end_date)}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 border shrink-0 ${badgeClass}`}
                  >
                    {isActive ? "Active" : "Closed"}
                  </span>
                </div>
              );
              return (
                <li key={y.id}>
                  {isActive ? (
                    card
                  ) : (
                    <Link
                      href={`/dashboard/year-end/${y.id}`}
                      className="block hover:opacity-90 transition-opacity"
                    >
                      {card}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
