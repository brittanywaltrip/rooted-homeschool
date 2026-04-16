"use client";

import { useState, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };
type Lesson = { id: string; title: string; completed: boolean; child_id: string; subjects: { name: string; color: string | null } | null };
type Activity = { id: string; name: string; emoji: string; duration_minutes: number; scheduled_start_time: string | null; child_ids: string[]; completed: boolean };
type Appointment = { id: string; title: string; emoji: string; time: string | null; duration_minutes: number; location: string | null; child_ids: string[]; completed: boolean; instance_date: string };

export type TimelineItem =
  | { kind: "lesson"; lesson: Lesson; timeMinutes: number | null }
  | { kind: "activity"; activity: Activity; timeMinutes: number | null }
  | { kind: "appointment"; appointment: Appointment; timeMinutes: number | null };

interface Props {
  lessons: Lesson[];
  activities: Activity[];
  appointments: Appointment[];
  children: Child[];
  onToggleLesson: (id: string, completed: boolean) => void;
  onToggleActivity: (activity: Activity) => void;
  onToggleAppointment: (id: string, completed: boolean) => void;
  onLogExtra: () => void;
  onManage: () => void;
  onAddAppt: () => void;
  isPartner: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTime(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function fmtTime(mins: number): string {
  let h = Math.floor(((mins % 1440) + 1440) % 1440 / 60);
  const m = ((mins % 1440) + 1440) % 1440 % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtDur(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins % 60 === 0) return `${mins / 60} hr`;
  return `${(mins / 60).toFixed(1)} hr`;
}

// ─── Progress Arc ────────────────────────────────────────────────────────────

function ProgressArc({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const r = 32, stroke = 5, circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center">
      <svg width={80} height={80} className="-rotate-90">
        <circle cx={40} cy={40} r={r} fill="none" stroke="#e8e5e0" strokeWidth={stroke} />
        <circle cx={40} cy={40} r={r} fill="none" stroke="#2D5A3D" strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-500" />
      </svg>
      <span className="absolute mt-[26px] text-[18px] font-medium text-[#2d2926]">{pct}%</span>
      <p className="text-[11px] text-[#7a6f65] -mt-1">{done} of {total} done</p>
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────

const BADGE_STYLES = {
  lesson:      { bg: "#e8f0e9", color: "#2D5A3D", border: "#c2dbc5", label: "Lesson" },
  activity:    { bg: "#fef3e0", color: "#a16207", border: "#f0c878", label: "Activity" },
  appointment: { bg: "#f5f0ff", color: "#7C3AED", border: "#c4b5fd", label: "Appt" },
};

function Badge({ kind }: { kind: "lesson" | "activity" | "appointment" }) {
  const s = BADGE_STYLES[kind];
  return (
    <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function UnifiedTimeline({
  lessons, activities, appointments, children,
  onToggleLesson, onToggleActivity, onToggleAppointment,
  onLogExtra, onManage, onAddAppt, isPartner,
}: Props) {
  const [nowMinutes, setNowMinutes] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });

  useEffect(() => {
    const interval = setInterval(() => { const d = new Date(); setNowMinutes(d.getHours() * 60 + d.getMinutes()); }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Build unified items
  const items: TimelineItem[] = [
    ...lessons.map(l => ({ kind: "lesson" as const, lesson: l, timeMinutes: null as number | null })),
    ...activities.map(a => ({ kind: "activity" as const, activity: a, timeMinutes: parseTime(a.scheduled_start_time) })),
    ...appointments.map(a => ({ kind: "appointment" as const, appointment: a, timeMinutes: parseTime(a.time) })),
  ];

  const totalItems = items.length;
  const doneItems = items.filter(i =>
    i.kind === "lesson" ? i.lesson.completed
    : i.kind === "activity" ? i.activity.completed
    : i.appointment.completed
  ).length;

  // Split timed vs anytime
  const timed = items.filter(i => i.timeMinutes != null).sort((a, b) => a.timeMinutes! - b.timeMinutes!);
  const anytime = items.filter(i => i.timeMinutes == null).sort((a, b) => {
    const aDone = a.kind === "lesson" ? a.lesson.completed : a.kind === "activity" ? a.activity.completed : a.appointment.completed;
    const bDone = b.kind === "lesson" ? b.lesson.completed : b.kind === "activity" ? b.activity.completed : b.appointment.completed;
    if (aDone !== bDone) return aDone ? 1 : -1;
    return 0;
  });

  if (totalItems === 0) return null;

  function isDone(item: TimelineItem): boolean {
    return item.kind === "lesson" ? item.lesson.completed : item.kind === "activity" ? item.activity.completed : item.appointment.completed;
  }

  function handleTap(item: TimelineItem) {
    if (isPartner) return;
    if (item.kind === "lesson") onToggleLesson(item.lesson.id, item.lesson.completed);
    else if (item.kind === "activity") onToggleActivity(item.activity);
    else onToggleAppointment(item.appointment.id, item.appointment.completed);
  }

  function renderItem(item: TimelineItem, isPast: boolean) {
    const done = isDone(item);
    const key = item.kind === "lesson" ? `l-${item.lesson.id}` : item.kind === "activity" ? `a-${item.activity.id}` : `ap-${item.appointment.id}`;
    const title = item.kind === "lesson" ? item.lesson.title : item.kind === "activity" ? item.activity.name : item.appointment.title;
    const emoji = item.kind === "lesson" ? null : item.kind === "activity" ? item.activity.emoji : item.appointment.emoji;
    const opacity = (isPast && !done) ? "opacity-60" : done ? "opacity-50" : "";

    const sub = item.kind === "lesson"
      ? [item.lesson.subjects?.name, children.find(c => c.id === item.lesson.child_id)?.name].filter(Boolean).join(" · ")
      : item.kind === "activity"
        ? [fmtDur(item.activity.duration_minutes), ...item.activity.child_ids.map(id => children.find(c => c.id === id)?.name).filter(Boolean)].join(" · ")
        : [
            item.appointment.location ? `📍 ${item.appointment.location}` : null,
            item.appointment.child_ids.length === 0 ? "Me" : item.appointment.child_ids.map(id => children.find(c => c.id === id)?.name).filter(Boolean).join(", "),
          ].filter(Boolean).join(" · ");

    return (
      <button key={key} type="button" onClick={() => handleTap(item)}
        className={`w-full flex items-center gap-3 py-2.5 px-1 text-left transition-all ${opacity}`}>
        {/* Checkbox */}
        <div className={`w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
          done ? "border-[#2D5A3D] bg-[#2D5A3D]" : "border-[#d4d0ca]"
        }`}>
          {done && (
            <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-none">
              <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {emoji && <span className="text-sm shrink-0">{emoji}</span>}
            <p className={`text-[14px] font-medium truncate ${done ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>{title}</p>
            <Badge kind={item.kind} />
          </div>
          {sub && <p className="text-[11px] text-[#7a6f65] truncate mt-0.5">{sub}</p>}
        </div>
      </button>
    );
  }

  // Find NOW position index in timed items
  const nowInsertIdx = timed.findIndex(i => (i.timeMinutes ?? 0) > nowMinutes);
  const nowIdx = nowInsertIdx === -1 ? timed.length : nowInsertIdx;

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between px-0.5 -mb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Today&apos;s schedule</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onManage} className="flex items-center gap-1 text-[11px] font-medium text-white rounded-full px-3 py-1 transition-opacity hover:opacity-80" style={{ background: "#7C3AED" }}>
            📅 Manage
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden mt-2">
        {/* Progress arc + actions */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="relative flex items-center justify-center">
            <ProgressArc done={doneItems} total={totalItems} />
          </div>
          <div className="flex items-center gap-2">
            {!isPartner && (
              <>
                <button type="button" onClick={onAddAppt} className="text-[11px] font-medium text-[#7C3AED] bg-[#f5f0ff] px-2.5 py-1.5 rounded-lg">+ Appt</button>
                <button type="button" onClick={onLogExtra} className="text-[13px] text-[#5c7f63] hover:text-[var(--g-deep)] font-medium transition-colors">+ Log extra</button>
              </>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="px-4 pb-4">
          {/* Timed section */}
          {timed.length > 0 && (
            <div className="relative">
              <div className="absolute left-[9px] top-[14px] bottom-[14px] w-[2px] bg-[#e8e5e0]" />

              {timed.map((item, idx) => {
                const isPast = (item.timeMinutes ?? 0) < nowMinutes;
                const showNow = idx === nowIdx;
                return (
                  <div key={item.kind === "lesson" ? `l-${item.lesson.id}` : item.kind === "activity" ? `a-${item.activity.id}` : `ap-${item.appointment.id}`}>
                    {showNow && (
                      <div className="flex items-center gap-2 my-1 relative z-10">
                        <div className="w-[20px] flex justify-center"><div className="w-2 h-2 rounded-full bg-[#ef4444]" /></div>
                        <div className="flex-1 h-[1.5px] bg-[#ef4444]" />
                        <span className="text-[10px] font-medium text-[#ef4444] shrink-0">{fmtTime(nowMinutes)}</span>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-medium text-[#b5aca4] w-[50px] text-right shrink-0 pt-3">{fmtTime(item.timeMinutes!)}</span>
                      <div className="flex-1">{renderItem(item, isPast)}</div>
                    </div>
                  </div>
                );
              })}

              {/* NOW line at bottom if all timed items are past */}
              {nowIdx === timed.length && timed.length > 0 && (
                <div className="flex items-center gap-2 my-1 relative z-10">
                  <div className="w-[20px] flex justify-center"><div className="w-2 h-2 rounded-full bg-[#ef4444]" /></div>
                  <div className="flex-1 h-[1.5px] bg-[#ef4444]" />
                  <span className="text-[10px] font-medium text-[#ef4444] shrink-0">{fmtTime(nowMinutes)}</span>
                </div>
              )}
            </div>
          )}

          {/* Anytime section */}
          {anytime.length > 0 && (
            <>
              {timed.length > 0 && (
                <div className="flex items-center gap-2 my-2 px-1">
                  <div className="flex-1 h-px bg-[#e8e5e0]" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#b5aca4]">Anytime</span>
                  <div className="flex-1 h-px bg-[#e8e5e0]" />
                </div>
              )}
              <div className="divide-y divide-[#f5f3ef]">
                {anytime.map((item) => (
                  <div key={item.kind === "lesson" ? `l-${item.lesson.id}` : item.kind === "activity" ? `a-${item.activity.id}` : `ap-${item.appointment.id}`}>
                    {renderItem(item, false)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
