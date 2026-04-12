"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

type Lesson = {
  id: string;
  title: string;
  completed: boolean;
  child_id: string | null;
  date: string | null;
  scheduled_date: string | null;
  subjects: { name: string; color: string | null } | null;
};

type AppEvent = {
  id: string;
  type: string;
  created_at: string;
  payload: {
    title?: string;
    child_id?: string;
    date?: string;
    description?: string;
    photo_url?: string;
    caption?: string;
  } | null;
};

type VacationBlock = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};

type DayActivity = {
  lessons: Lesson[];
  memories: AppEvent[];
  fieldTrips: AppEvent[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isInVacation(dateStr: string, blocks: VacationBlock[]): VacationBlock | null {
  return blocks.find((b) => dateStr >= b.start_date && dateStr <= b.end_date) ?? null;
}

function getEventDate(ev: AppEvent): string {
  return ev.payload?.date ?? ev.created_at.slice(0, 10);
}

function getEventChildId(ev: AppEvent): string | null {
  return ev.payload?.child_id ?? null;
}

function getSeasonalTint(month: number): string {
  if (month === 11 || month <= 1) return "rgba(120, 168, 224, 0.06)"; // Dec/Jan/Feb — cool blue-gray
  if (month >= 2 && month <= 4)   return "rgba(122, 158, 126, 0.06)"; // Mar/Apr/May — soft green
  if (month >= 5 && month <= 7)   return "rgba(224, 160, 64, 0.06)";  // Jun/Jul/Aug — warm amber
  return "rgba(200, 120, 80, 0.06)";                                   // Sep/Oct/Nov — warm rust
}

const DOW_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MEMORY_TYPES = ["memory_book", "memory_photo", "memory_project", "memory_activity"];
const FIELD_TRIP_TYPES = ["memory_field_trip"];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { effectiveUserId } = usePartner();
  const todayStr = toDateStr(new Date());

  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [children, setChildren] = useState<Child[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [vacations, setVacations] = useState<VacationBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = "Calendar \u00b7 Rooted"; }, []);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);

    const ms = new Date(monthStart);
    const me = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const s = toDateStr(ms);
    const e = toDateStr(me);

    const [
      { data: kids },
      { data: bySched },
      { data: byDate },
      { data: appEvents },
      { data: vacs },
    ] = await Promise.all([
      supabase.from("children").select("id, name, color").eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId)
        .gte("scheduled_date", s)
        .lte("scheduled_date", e),
      supabase
        .from("lessons")
        .select("id, title, completed, child_id, date, scheduled_date, subjects(name, color)")
        .eq("user_id", effectiveUserId)
        .is("scheduled_date", null)
        .gte("date", s)
        .lte("date", e),
      supabase
        .from("app_events")
        .select("id, type, created_at, payload")
        .eq("user_id", effectiveUserId)
        .in("type", [...MEMORY_TYPES, ...FIELD_TRIP_TYPES])
        .gte("created_at", s + "T00:00:00")
        .lte("created_at", e + "T23:59:59"),
      supabase
        .from("vacation_blocks")
        .select("id, name, start_date, end_date")
        .eq("user_id", effectiveUserId)
        .order("start_date"),
    ]);

    setChildren(kids ?? []);
    setLessons([
      ...((bySched as unknown as Lesson[]) ?? []),
      ...((byDate as unknown as Lesson[]) ?? []),
    ]);
    setEvents((appEvents as unknown as AppEvent[]) ?? []);
    setVacations((vacs as VacationBlock[]) ?? []);
    setLoading(false);
  }, [monthStart, effectiveUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (selectedDay && detailRef.current) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    }
  }, [selectedDay]);

  // ── Month navigation ────────────────────────────────────────────────────────

  function prevMonth() {
    setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    setSelectedDay(null);
  }
  function nextMonth() {
    setMonthStart((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    setSelectedDay(null);
  }

  // ── Build day activity map ──────────────────────────────────────────────────

  const dayMap = new Map<string, DayActivity>();

  function ensureDay(key: string): DayActivity {
    if (!dayMap.has(key)) dayMap.set(key, { lessons: [], memories: [], fieldTrips: [] });
    return dayMap.get(key)!;
  }

  for (const l of lessons) {
    const key = l.scheduled_date ?? l.date ?? "";
    if (!key) continue;
    if (selectedChild && l.child_id !== selectedChild) continue;
    ensureDay(key).lessons.push(l);
  }

  for (const ev of events) {
    const key = getEventDate(ev);
    const childId = getEventChildId(ev);
    if (selectedChild && childId !== selectedChild) continue;
    if (FIELD_TRIP_TYPES.includes(ev.type)) {
      ensureDay(key).fieldTrips.push(ev);
    } else {
      ensureDay(key).memories.push(ev);
    }
  }

  // ── Build calendar grid ─────────────────────────────────────────────────────

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // ── Derived: child dots for a day ───────────────────────────────────────────

  function getChildDots(dateStr: string): { childId: string; color: string }[] {
    const activity = dayMap.get(dateStr);
    if (!activity) return [];

    const seen = new Set<string>();
    const dots: { childId: string; color: string }[] = [];

    for (const l of activity.lessons) {
      const cid = l.child_id ?? "__none__";
      if (!seen.has(cid)) {
        seen.add(cid);
        const child = children.find((c) => c.id === cid);
        dots.push({ childId: cid, color: child?.color ?? "#7a6f65" });
      }
    }
    for (const ev of [...activity.memories, ...activity.fieldTrips]) {
      const cid = getEventChildId(ev) ?? "__none__";
      if (!seen.has(cid)) {
        seen.add(cid);
        const child = children.find((c) => c.id === cid);
        dots.push({ childId: cid, color: child?.color ?? "#7a6f65" });
      }
    }

    return dots.slice(0, 5);
  }

  // ── Derived: emoji indicators for a day ─────────────────────────────────────

  function getEmojiIndicators(dateStr: string): { emoji: string; count: number; badgeColor: string }[] {
    const activity = dayMap.get(dateStr);
    if (!activity) return [];
    const indicators: { emoji: string; count: number; badgeColor: string }[] = [];
    if (activity.fieldTrips.length > 0) {
      indicators.push({ emoji: "\uD83D\uDE8C", count: activity.fieldTrips.length, badgeColor: "#6b3fa0" });
    }
    if (activity.memories.length > 0) {
      indicators.push({ emoji: "\uD83D\uDCF8", count: activity.memories.length, badgeColor: "#d4920a" });
    }
    return indicators;
  }

  // ── Derived: has memory (golden day glow) ───────────────────────────────────

  function hasMemory(dateStr: string): boolean {
    const activity = dayMap.get(dateStr);
    return (activity?.memories.length ?? 0) > 0;
  }

  // ── Month summary ───────────────────────────────────────────────────────────

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const isCurrentOrPastMonth = monthStart <= now;

  const monthSummary = (() => {
    if (!isCurrentOrPastMonth) return null;

    // Count school days (Mon-Fri, not in vacation)
    let schoolDays = 0;
    let activeDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue; // weekend
      const ds = toDateStr(date);
      if (isInVacation(ds, vacations)) continue;
      schoolDays++;
      if (dayMap.has(ds) && dayMap.get(ds)!.lessons.length > 0) {
        activeDays++;
      }
    }
    return { activeDays, schoolDays };
  })();

  // ── Get day detail for selected day ─────────────────────────────────────────

  const selectedDayActivity: DayActivity | null = selectedDay ? (dayMap.get(selectedDay) ?? { lessons: [], memories: [], fieldTrips: [] }) : null;

  // Group selected day activity by child
  function groupByChild(activity: DayActivity) {
    const map = new Map<string, { child: Child | null; lessons: Lesson[]; memories: AppEvent[]; fieldTrips: AppEvent[] }>();
    const allKey = "__all__";

    for (const l of activity.lessons) {
      const k = l.child_id ?? allKey;
      if (!map.has(k)) map.set(k, { child: children.find((c) => c.id === k) ?? null, lessons: [], memories: [], fieldTrips: [] });
      map.get(k)!.lessons.push(l);
    }
    for (const ev of activity.memories) {
      const k = getEventChildId(ev) ?? allKey;
      if (!map.has(k)) map.set(k, { child: children.find((c) => c.id === k) ?? null, lessons: [], memories: [], fieldTrips: [] });
      map.get(k)!.memories.push(ev);
    }
    for (const ev of activity.fieldTrips) {
      const k = getEventChildId(ev) ?? allKey;
      if (!map.has(k)) map.set(k, { child: children.find((c) => c.id === k) ?? null, lessons: [], memories: [], fieldTrips: [] });
      map.get(k)!.fieldTrips.push(ev);
    }
    return Array.from(map.values());
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl px-4 pt-4 pb-10 space-y-5" style={{ background: "#faf9f6" }}>

      {/* ── Back link ──────────────────────────────────────── */}
      <Link
        href="/dashboard/plan"
        className="inline-flex items-center gap-1 text-xs text-[#7a6f65] hover:text-[var(--g-deep)] transition-colors"
      >
        <ChevronLeft size={13} /> Plan
      </Link>

      {/* ── 1. Header ──────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890] mb-1">Family Calendar</p>
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-xl font-bold text-[#2d2926] min-w-[180px] text-center">{monthLabel}</h1>
          <button
            onClick={nextMonth}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* ── 2. Child Filter Pills ──────────────────────────── */}
      {children.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setSelectedChild(null)}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
              !selectedChild
                ? "bg-[var(--g-deep)] text-white"
                : "bg-white text-[#7a6f65] border border-[#e8e2d9] hover:bg-[#f0ede8]"
            }`}
          >
            All
          </button>
          {children.map((child) => (
            <button
              key={child.id}
              onClick={() => setSelectedChild(selectedChild === child.id ? null : child.id)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                selectedChild === child.id
                  ? "text-white"
                  : "bg-white border border-[#e8e2d9] hover:bg-[#f0ede8]"
              }`}
              style={
                selectedChild === child.id
                  ? { backgroundColor: child.color ?? "#5c7f63" }
                  : { color: child.color ?? "#5c7f63" }
              }
            >
              {child.name}
            </button>
          ))}
        </div>
      )}

      {/* ── 3. Month Grid ──────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-3xl animate-pulse">📅</span>
        </div>
      ) : (
        <div className="rounded-2xl p-2" style={{ backgroundColor: getSeasonalTint(month) }}>
          {/* Day of week headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DOW_HEADERS.map((d) => (
              <div key={d} className="text-center text-[9px] font-bold uppercase tracking-widest text-[#b5aca4] py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} className="min-h-[72px]" />;

              const dateStr = toDateStr(day);
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDay;
              const vacation = isInVacation(dateStr, vacations);
              const childDots = getChildDots(dateStr);
              const emojis = getEmojiIndicators(dateStr);
              const isGoldenDay = !isToday && hasMemory(dateStr);

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDay(selectedDay === dateStr ? null : dateStr)}
                  className={`min-h-[72px] rounded-xl p-1.5 flex flex-col border transition-all text-left ${
                    isSelected
                      ? "border-[var(--g-deep)] bg-[#f2f9f3] ring-1 ring-[var(--g-deep)]/20"
                      : isToday
                      ? "border-[#5c7f63] bg-[#f8fcf8]"
                      : vacation
                      ? "border-[#c8ddf0] bg-[#dceefb]"
                      : "border-[#e8e2d9] bg-white hover:bg-[#faf8f4]"
                  }`}
                >
                  {/* Date number row */}
                  <div className="flex items-center justify-between w-full mb-1">
                    <span
                      className={`text-[11px] font-bold leading-none ${
                        isToday
                          ? "w-5 h-5 rounded-full bg-[var(--g-deep)] text-white flex items-center justify-center"
                          : isGoldenDay
                          ? "w-5 h-5 rounded-full flex items-center justify-center text-[#8b6820]"
                          : vacation
                          ? "text-[#4a7caa]"
                          : "text-[#2d2926]"
                      }`}
                      style={isGoldenDay && !isToday ? { backgroundColor: "#fef3e8" } : undefined}
                    >
                      {vacation && !isToday && !isGoldenDay ? (
                        <span style={{ opacity: 0.3 }}>{day.getDate()}</span>
                      ) : (
                        day.getDate()
                      )}
                    </span>
                    {vacation && (
                      <span className="text-[8px] text-[#4a7caa] font-medium truncate max-w-[40px] flex items-center gap-0.5">
                        <span className="text-[9px]">{"\uD83C\uDF34"}</span>
                        {vacation.name}
                      </span>
                    )}
                  </div>

                  {/* Child dots */}
                  {childDots.length > 0 && (
                    <div className="flex flex-wrap gap-[3px] mb-1" style={{ opacity: vacation ? 0.4 : 1 }}>
                      {childDots.map((dot) => (
                        <div
                          key={dot.childId}
                          className="w-[5px] h-[5px] rounded-full"
                          style={{ backgroundColor: dot.color }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Emoji indicators */}
                  {emojis.length > 0 && (
                    <div className="flex gap-1 mt-auto items-center" style={{ opacity: vacation ? 0.4 : 1 }}>
                      {emojis.map((ind) => (
                        <span key={ind.emoji} className="relative leading-none">
                          <span className="text-[10px]">{ind.emoji}</span>
                          {ind.count > 1 && (
                            <span
                              className="absolute -top-1 -right-2 text-[7px] font-bold text-white rounded-full w-[12px] h-[12px] flex items-center justify-center leading-none"
                              style={{ backgroundColor: ind.badgeColor }}
                            >
                              {ind.count}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 4. Legend ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-[#7a6f65]">
        {children.map((c) => (
          <div key={c.id} className="flex items-center gap-1.5">
            <div className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: c.color ?? "#5c7f63" }} />
            <span>{c.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] leading-none">{"\uD83D\uDCF8"}</span>
          <span>Memory (golden day)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] leading-none">{"\uD83D\uDE8C"}</span>
          <span>Field trip</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] leading-none">{"\uD83C\uDF34"}</span>
          <span>Vacation</span>
        </div>
      </div>

      {/* ── Month Summary Line ──────────────────────────────── */}
      {monthSummary && (
        <p className="text-xs text-center text-[#7a6f65] italic px-4 py-2">
          Your family learned together on {monthSummary.activeDays} of {monthSummary.schoolDays} school days this month {"\uD83C\uDF31"}
        </p>
      )}

      {/* ── 5. Day Detail Sheet ─────────────────────────────── */}
      {selectedDay && selectedDayActivity && (
        <div ref={detailRef} className="bg-white rounded-xl border border-[#e8e2d9] p-5 space-y-4">
          {/* Header */}
          <div>
            <p className="text-sm font-bold text-[#2d2926]">
              {new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
            {(selectedDayActivity.lessons.length > 0 ||
              selectedDayActivity.memories.length > 0 ||
              selectedDayActivity.fieldTrips.length > 0) && (
              <div className="flex gap-2 mt-1 flex-wrap">
                {selectedDayActivity.lessons.length > 0 && (
                  <span className="text-[10px] font-semibold bg-[#e8f0e9] text-[var(--g-deep)] px-2 py-0.5 rounded-full">
                    {selectedDayActivity.lessons.length} lesson{selectedDayActivity.lessons.length !== 1 ? "s" : ""}
                  </span>
                )}
                {selectedDayActivity.memories.length > 0 && (
                  <span className="text-[10px] font-semibold bg-[#fef5e0] text-[#8b6820] px-2 py-0.5 rounded-full">
                    {selectedDayActivity.memories.length} {selectedDayActivity.memories.length !== 1 ? "memories" : "memory"}
                  </span>
                )}
                {selectedDayActivity.fieldTrips.length > 0 && (
                  <span className="text-[10px] font-semibold bg-[#f0e8f8] text-[#6b3fa0] px-2 py-0.5 rounded-full">
                    {selectedDayActivity.fieldTrips.length} field trip{selectedDayActivity.fieldTrips.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Content by child */}
          {selectedDayActivity.lessons.length === 0 &&
           selectedDayActivity.memories.length === 0 &&
           selectedDayActivity.fieldTrips.length === 0 ? (
            <p className="text-sm text-[#b5aca4] text-center py-4">Nothing logged this day</p>
          ) : (
            <div className="space-y-4">
              {groupByChild(selectedDayActivity).map((group, i) => (
                <div key={group.child?.id ?? `unassigned-${i}`} className="space-y-2">
                  {/* Child header */}
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                      style={{ backgroundColor: group.child?.color ?? "#7a6f65" }}
                    >
                      {(group.child?.name ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-semibold text-[#2d2926]">
                      {group.child?.name ?? "Unassigned"}
                    </span>
                  </div>

                  {/* Lessons */}
                  {group.lessons.map((l) => (
                    <div key={l.id} className="flex items-center gap-2 pl-8">
                      <div className="w-[5px] h-[5px] rounded-full bg-[var(--g-deep)] shrink-0" />
                      <span className={`text-xs ${l.completed ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                        {l.title}
                      </span>
                      {l.subjects?.name && (
                        <span className="text-[9px] font-medium text-[#7a6f65] bg-[#f0ede8] px-1.5 py-0.5 rounded-full">
                          {l.subjects.name}
                        </span>
                      )}
                    </div>
                  ))}

                  {/* Memories */}
                  {group.memories.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 pl-8">
                      <span className="text-[10px] leading-none shrink-0">{"\uD83D\uDCF8"}</span>
                      <span className="text-xs text-[#8b6820]">
                        {ev.payload?.title ?? ev.payload?.caption ?? "Memory logged"}
                      </span>
                    </div>
                  ))}

                  {/* Field trips */}
                  {group.fieldTrips.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 pl-8">
                      <span className="text-[10px] leading-none shrink-0">{"\uD83D\uDE8C"}</span>
                      <span className="text-xs text-[#6b3fa0]">
                        {ev.payload?.title ?? "Field trip"}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
