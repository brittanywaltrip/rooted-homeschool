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

  // ── Get child colors for a day's richness bars ──────────────────────────────

  function getChildBars(dateStr: string): { childId: string; color: string; height: number }[] {
    const activity = dayMap.get(dateStr);
    if (!activity) return [];

    const childCounts = new Map<string, number>();
    for (const l of activity.lessons) {
      const cid = l.child_id ?? "__none__";
      childCounts.set(cid, (childCounts.get(cid) ?? 0) + 1);
    }
    for (const ev of [...activity.memories, ...activity.fieldTrips]) {
      const cid = getEventChildId(ev) ?? "__none__";
      childCounts.set(cid, (childCounts.get(cid) ?? 0) + 1);
    }

    return Array.from(childCounts.entries()).map(([cid, count]) => {
      const child = children.find((c) => c.id === cid);
      return {
        childId: cid,
        color: child?.color ?? "#7a6f65",
        height: count >= 3 ? 12 : count >= 2 ? 8 : 4,
      };
    });
  }

  // ── Type dots for a day ─────────────────────────────────────────────────────

  function getTypeDots(dateStr: string): { color: string; label: string }[] {
    const activity = dayMap.get(dateStr);
    if (!activity) return [];
    const dots: { color: string; label: string }[] = [];
    if (activity.lessons.length > 0) dots.push({ color: "#3d5c42", label: "lessons" });
    if (activity.memories.length > 0) dots.push({ color: "#d4920a", label: "memories" });
    if (activity.fieldTrips.length > 0) dots.push({ color: "#6b3fa0", label: "field trips" });
    return dots;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl px-4 pt-4 pb-10 space-y-5" style={{ background: "#faf9f6" }}>

      {/* ── Back link ──────────────────────────────────────── */}
      <Link
        href="/dashboard/plan"
        className="inline-flex items-center gap-1 text-xs text-[#7a6f65] hover:text-[#3d5c42] transition-colors"
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
                ? "bg-[#3d5c42] text-white"
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
        <div>
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
              const bars = getChildBars(dateStr);
              const dots = getTypeDots(dateStr);

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDay(selectedDay === dateStr ? null : dateStr)}
                  className={`min-h-[72px] rounded-xl p-1.5 flex flex-col border transition-all text-left ${
                    isSelected
                      ? "border-[#3d5c42] bg-[#f2f9f3] ring-1 ring-[#3d5c42]/20"
                      : isToday
                      ? "border-[#5c7f63] bg-[#f8fcf8]"
                      : vacation
                      ? "border-[#c8ddf0] bg-[#dceefb]"
                      : "border-[#e8e2d9] bg-white hover:bg-[#faf8f4]"
                  }`}
                >
                  {/* Date number */}
                  <div className="flex items-center justify-between w-full mb-1">
                    <span
                      className={`text-[11px] font-bold leading-none ${
                        isToday
                          ? "w-5 h-5 rounded-full bg-[#3d5c42] text-white flex items-center justify-center"
                          : vacation
                          ? "text-[#4a7caa]"
                          : "text-[#2d2926]"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {vacation && (
                      <span className="text-[8px] text-[#4a7caa] font-medium truncate max-w-[40px]">
                        {vacation.name}
                      </span>
                    )}
                  </div>

                  {/* Richness bars */}
                  {bars.length > 0 && (
                    <div className="flex gap-0.5 w-full mb-1">
                      {bars.map((bar) => (
                        <div
                          key={bar.childId}
                          className="flex-1 rounded-sm"
                          style={{
                            backgroundColor: bar.color,
                            height: `${bar.height}px`,
                            opacity: vacation ? 0.4 : 0.7,
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Type dots */}
                  {dots.length > 0 && (
                    <div className="flex gap-1 mt-auto">
                      {dots.map((dot) => (
                        <div
                          key={dot.label}
                          className="w-[5px] h-[5px] rounded-full"
                          style={{ backgroundColor: dot.color }}
                        />
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
            <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: c.color ?? "#5c7f63" }} />
            <span>{c.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-[6px] h-[6px] rounded-full bg-[#3d5c42]" />
          <span>Lessons</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-[6px] h-[6px] rounded-full bg-[#d4920a]" />
          <span>Memory / Photo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-[6px] h-[6px] rounded-full bg-[#6b3fa0]" />
          <span>Field trip</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm bg-[#dceefb] border border-[#c8ddf0]" />
          <span>Vacation</span>
        </div>
      </div>

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
                  <span className="text-[10px] font-semibold bg-[#e8f0e9] text-[#3d5c42] px-2 py-0.5 rounded-full">
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
                      <div className="w-[5px] h-[5px] rounded-full bg-[#3d5c42] shrink-0" />
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
                      <div className="w-[5px] h-[5px] rounded-full bg-[#d4920a] shrink-0" />
                      <span className="text-xs text-[#8b6820]">
                        {ev.payload?.title ?? ev.payload?.caption ?? "Memory logged"}
                      </span>
                    </div>
                  ))}

                  {/* Field trips */}
                  {group.fieldTrips.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 pl-8">
                      <div className="w-[5px] h-[5px] rounded-full bg-[#6b3fa0] shrink-0" />
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
