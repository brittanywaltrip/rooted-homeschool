"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

type LessonRow = {
  date: string | null;
  scheduled_date: string | null;
  child_id: string | null;
  hours: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function startOfWeekStr(offsetWeeks = 0): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1) + offsetWeeks * 7);
  d.setHours(0, 0, 0, 0);
  return toDateStr(d);
}

function getStreak(activeDates: Set<string>): { current: number; best: number } {
  // Current streak — walk back from today; if today has no lesson, check from yesterday
  let current = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  // Try from today first
  const temp = new Date(cursor);
  while (activeDates.has(toDateStr(temp))) {
    current++;
    temp.setDate(temp.getDate() - 1);
  }
  // If today has no lessons, check yesterday-based streak
  if (current === 0) {
    cursor.setDate(cursor.getDate() - 1);
    while (activeDates.has(toDateStr(cursor))) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  // Best streak — scan all sorted dates
  const sorted = [...activeDates].sort();
  let best = 0;
  let running = 0;
  let prev: Date | null = null;
  for (const ds of sorted) {
    const d = new Date(ds + "T12:00:00");
    if (prev) {
      const diffDays = Math.round((d.getTime() - prev.getTime()) / 86400000);
      running = diffDays === 1 ? running + 1 : 1;
    } else {
      running = 1;
    }
    best = Math.max(best, running);
    prev = d;
  }

  return { current, best };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const { effectiveUserId } = usePartner();

  const [children,        setChildren]        = useState<Child[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>("all");
  const [lessons,         setLessons]         = useState<LessonRow[]>([]);
  const [booksCount,      setBooksCount]       = useState(0);
  const [loading,         setLoading]         = useState(true);

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;

    const [{ data: kids }, { data: lessonsData }, { data: bookEvents }] = await Promise.all([
      supabase.from("children").select("id, name, color")
        .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase.from("lessons").select("date, scheduled_date, child_id, hours")
        .eq("user_id", effectiveUserId).eq("completed", true),
      supabase.from("app_events").select("id")
        .eq("user_id", effectiveUserId).eq("type", "book_read"),
    ]);

    setChildren(kids ?? []);
    setLessons((lessonsData as LessonRow[]) ?? []);
    setBooksCount(bookEvents?.length ?? 0);
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived stats ─────────────────────────────────────────────────────────

  const filtered = selectedChildId === "all"
    ? lessons
    : lessons.filter((l) => l.child_id === selectedChildId);

  const activeDates = new Set(
    filtered.map((l) => l.date ?? l.scheduled_date).filter(Boolean) as string[]
  );

  const { current: currentStreak, best: bestStreak } = getStreak(activeDates);

  const totalActiveDays = activeDates.size;
  const totalHours = filtered.reduce((sum, l) => sum + (l.hours ?? 0), 0);

  // This week vs last week
  const thisWeekStart = startOfWeekStr(0);
  const lastWeekStart = startOfWeekStr(-1);

  const thisWeekLessons = filtered.filter((l) => {
    const d = l.date ?? l.scheduled_date;
    return d && d >= thisWeekStart;
  }).length;

  const lastWeekLessons = filtered.filter((l) => {
    const d = l.date ?? l.scheduled_date;
    return d && d >= lastWeekStart && d < thisWeekStart;
  }).length;

  const weekDiff = thisWeekLessons - lastWeekLessons;
  const weekMax  = Math.max(thisWeekLessons, lastWeekLessons, 1);

  // Lessons by day of week
  const dayTotals = [0, 0, 0, 0, 0, 0, 0];
  filtered.forEach((l) => {
    const d = l.date ?? l.scheduled_date;
    if (d) dayTotals[new Date(d + "T12:00:00").getDay()]++;
  });
  const maxDayCount    = Math.max(...dayTotals, 1);
  const mostActiveDay  = dayTotals.reduce((best, v, i) => (v > dayTotals[best] ? i : best), 0);

  // Last 30 days activity
  const today30 = toDateStr(new Date());
  const last30: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = toDateStr(d);
    last30.push({ date: ds, count: filtered.filter((l) => (l.date ?? l.scheduled_date) === ds).length });
  }
  const maxDay30 = Math.max(...last30.map((d) => d.count), 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl animate-pulse">💡</span>
          <p className="text-sm text-[#7a6f65]">Crunching your data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl px-5 py-7 space-y-6">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Patterns &amp; Trends
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Insights 💡</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Streaks, active days, and how this week compares to last.
        </p>
      </div>

      {/* Child filter */}
      {children.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedChildId("all")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              selectedChildId === "all"
                ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63] hover:text-[#5c7f63]"
            }`}
          >
            All Children
          </button>
          {children.map((child) => (
            <button
              key={child.id}
              onClick={() => setSelectedChildId(child.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedChildId === child.id
                  ? "text-white border-transparent"
                  : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:text-[#2d2926]"
              }`}
              style={selectedChildId === child.id ? { backgroundColor: child.color ?? "#5c7f63" } : {}}
            >
              {child.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Streak cards ───────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-[#fff8ed] to-[#fef3dc] border border-[#f5c97a]/40 rounded-2xl p-5 text-center">
          <div className="text-3xl mb-1">🔥</div>
          <p className="text-3xl font-bold text-[#c4956a]">{currentStreak}</p>
          <p className="text-sm font-medium text-[#8b6f47] mt-0.5">Current streak</p>
          <p className="text-[10px] text-[#b5aca4] mt-1">
            {currentStreak === 0 ? "Start learning today!" : `${currentStreak} day${currentStreak !== 1 ? "s" : ""} in a row`}
          </p>
        </div>
        <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5 text-center">
          <div className="text-3xl mb-1">🏆</div>
          <p className="text-3xl font-bold text-[#3d5c42]">{bestStreak}</p>
          <p className="text-sm font-medium text-[#5c7f63] mt-0.5">Best streak</p>
          <p className="text-[10px] text-[#b5aca4] mt-1">Personal record</p>
        </div>
      </div>

      {/* ── Summary numbers ────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active days",  value: totalActiveDays,   emoji: "📅" },
          { label: "Total hours",  value: totalHours % 1 === 0 ? `${totalHours}h` : `${totalHours.toFixed(1)}h`, emoji: "⏱️" },
          { label: "Books read",   value: booksCount,        emoji: "📖" },
        ].map(({ label, value, emoji }) => (
          <div key={label} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
            <div className="text-xl mb-1">{emoji}</div>
            <p className="text-xl font-bold text-[#2d2926]">{value}</p>
            <p className="text-[10px] text-[#7a6f65] mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* ── This week vs last week ──────────────────── */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-5">
          This Week vs Last Week
        </h2>
        <div className="flex items-end justify-center gap-8">
          {/* Last week bar */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-xl font-bold text-[#b5aca4]">{lastWeekLessons}</p>
            <div className="w-12 bg-[#f0ede8] rounded-t-lg overflow-hidden flex items-end" style={{ height: 60 }}>
              <div
                className="w-full rounded-t-lg bg-[#d4c9be] transition-all duration-700"
                style={{ height: lastWeekLessons > 0 ? `${Math.round((lastWeekLessons / weekMax) * 56) + 4}px` : "3px" }}
              />
            </div>
            <p className="text-xs text-[#b5aca4]">Last week</p>
          </div>

          {/* Arrow/badge */}
          <div className="pb-10">
            {weekDiff > 0 && (
              <span className="text-sm font-bold text-[#5c7f63] bg-[#e8f0e9] px-3 py-1.5 rounded-full">
                +{weekDiff} ↑
              </span>
            )}
            {weekDiff < 0 && (
              <span className="text-sm font-bold text-[#8b6f47] bg-[#f5ede0] px-3 py-1.5 rounded-full">
                {weekDiff} ↓
              </span>
            )}
            {weekDiff === 0 && (
              <span className="text-sm font-bold text-[#7a6f65] bg-[#f0ede8] px-3 py-1.5 rounded-full">
                → same
              </span>
            )}
          </div>

          {/* This week bar */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-xl font-bold text-[#2d2926]">{thisWeekLessons}</p>
            <div className="w-12 bg-[#e8f0e9] rounded-t-lg overflow-hidden flex items-end" style={{ height: 60 }}>
              <div
                className="w-full rounded-t-lg bg-[#5c7f63] transition-all duration-700"
                style={{ height: thisWeekLessons > 0 ? `${Math.round((thisWeekLessons / weekMax) * 56) + 4}px` : "3px" }}
              />
            </div>
            <p className="text-xs text-[#7a6f65] font-medium">This week</p>
          </div>
        </div>
      </div>

      {/* ── Most active day of week ─────────────────── */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">
            Activity by Day of Week
          </h2>
          {dayTotals[mostActiveDay] > 0 && (
            <span className="text-xs text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full font-medium">
              Most active: {DAY_NAMES[mostActiveDay]}
            </span>
          )}
        </div>
        <div className="flex items-end gap-2">
          {dayTotals.map((count, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="w-full flex items-end" style={{ height: 56 }}>
                <div
                  className="w-full rounded-t-md transition-all duration-500"
                  style={{
                    height: count > 0 ? `${Math.round((count / maxDayCount) * 52) + 4}px` : "3px",
                    backgroundColor: i === mostActiveDay && count > 0 ? "#5c7f63" : "#d4ead6",
                    opacity: count === 0 ? 0.5 : 1,
                  }}
                />
              </div>
              <span className="text-[9px] font-medium text-[#b5aca4]">{DAY_NAMES[i]}</span>
              {count > 0 && (
                <span className="text-[9px] font-bold text-[#7a6f65]">{count}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Last 30 days sparkline ──────────────────── */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65]">
            Last 30 Days
          </h2>
          <span className="text-xs text-[#b5aca4]">
            {last30.filter((d) => d.count > 0).length} active days
          </span>
        </div>
        <div className="flex items-end gap-px" style={{ height: 48 }}>
          {last30.map((day) => (
            <div
              key={day.date}
              className="flex-1 rounded-sm transition-all duration-300"
              title={`${day.date}: ${day.count} lesson${day.count !== 1 ? "s" : ""}`}
              style={{
                height: day.count > 0 ? `${Math.round((day.count / maxDay30) * 44) + 4}px` : "3px",
                backgroundColor: day.date === today30 ? "#c4956a" : day.count > 0 ? "#5c7f63" : "#f0ede8",
                opacity: day.count === 0 ? 0.6 : 1,
                alignSelf: "flex-end",
              }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-[9px] text-[#c8bfb5]">
          <span>30 days ago</span>
          <span className="text-[#c4956a] font-semibold">Today</span>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center -mt-2">
          <span className="text-4xl mb-3">🌱</span>
          <p className="font-medium text-[#2d2926] mb-2">No data yet</p>
          <p className="text-sm text-[#7a6f65] max-w-xs leading-relaxed">
            Complete lessons on the Today page and they&apos;ll appear here as streaks and trends.
          </p>
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}
