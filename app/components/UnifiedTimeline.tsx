"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Pencil, Trash2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };
type Lesson = { id: string; title: string; completed: boolean; child_id: string; subjects: { name: string; color: string | null } | null; icon_emoji?: string | null };
type Activity = { id: string; name: string; emoji: string; duration_minutes: number; scheduled_start_time: string | null; child_ids: string[]; completed: boolean };
type Appointment = { id: string; title: string; emoji: string; time: string | null; duration_minutes: number; location: string | null; notes?: string | null; child_ids: string[]; completed: boolean; instance_date: string };

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
  upcomingDays?: { date: string; count: number }[];
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

function fmtApptTime(t: string | null): string {
  if (!t) return "All day";
  const parts = t.split(":");
  if (parts.length < 2) return "All day";
  const h24 = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return m > 0 ? `${h}:${String(m).padStart(2, "0")} ${ampm}` : `${h} ${ampm}`;
}

// ─── Smart Status Messages ──────────────────────────────────────────────────

type StatusCategory = "allDone" | "apptSoon" | "almostDone" | "fellBehind" | "pastHalf" | "earlyProgress" | "morningEmpty" | "morningBig" | "morningMed" | "morningLight" | "evening" | "fallback";

const STATUS_MESSAGES: Record<StatusCategory, ((...args: string[]) => string)[]> = {
  allDone: [
    () => "Go ahead and do nothing. You earned it. \u{1F389}",
    () => "We did it. Barely\u2026 but we did it! \u{1F605}",
    () => "Done done. Like, actually done. Go sit down. \u{1F6CB}\uFE0F",
    () => "Everything\u2019s checked off. Someone deserves chocolate. \u{1F36B}",
    () => "Finished! The rest of the day is yours. \u2728",
    () => "That\u2019s a wrap, mama. \u{1F31F}",
  ],
  apptSoon: [
    (n) => `Quick \u2014 pretend you were already ready for ${n}. \u{1F602}`,
    (n) => `Time to gather everyone and everything for ${n}. \u{1FAE0}`,
    (n, m) => `${n} in ${m} min \u2014 shoes. Keys. Kids. Go. \u{1F45F}`,
    (n, _m, t) => `Heads up \u2014 ${n} at ${t}. You\u2019ve got this. \u{1F4AA}`,
  ],
  almostDone: [
    () => "This is the part where we power through. \u{1F4AA}",
    (_d, l) => `So close. Just ${l} more. Don\u2019t stop now. \u{1F3C1}`,
    () => "Almost there \u2014 the couch is calling your name. \u{1F6CB}\uFE0F",
    () => "One more. ONE. You can do one. \u{1F4AA}",
  ],
  fellBehind: [
    (_d, l) => `Still ${l} open \u2014 no judgment. Some days are like that. \u{1F49B}`,
    () => "Behind? Same. It\u2019s fine. Do what you can. \u{1F49B}",
    () => "Skip what you need to. Nobody\u2019s grading you. \u{1F937}\u200D\u2640\uFE0F",
    (_d, l) => `${l} left but honestly\u2026 there\u2019s always tomorrow. \u{1F49B}`,
  ],
  pastHalf: [
    (_d, l) => `Over halfway \u2014 ${l} more and we\u2019re free. \u{1F64C}`,
    () => "One task at a time\u2026 look at you go. \u{1F3C3}\u200D\u2640\uFE0F\u{1F4A8}",
    (d, l) => `${d} down, ${l} to go. The end is in sight. \u{1F440}`,
    () => "More done than not done. That\u2019s called winning. \u{1F3C6}",
  ],
  earlyProgress: [
    () => "Not you being productive today \u{1F440}",
    (d) => `Off to a good start \u2014 ${d} down already. \u2705`,
    () => "Look who\u2019s checking things off \u{1F485}",
    (d) => `${d} done. We\u2019re locked in. \u{1F512}`,
  ],
  morningEmpty: [
    () => "No plans. Just vibes. \u2728",
    () => "Nothing scheduled. The kids don\u2019t need to know. \u{1F92B}",
    () => "Empty schedule. Do something chaotic or do nothing at all. \u{1F602}",
    () => "Free day. This feels illegal. \u{1F602}",
  ],
  morningBig: [
    () => "Okay but like\u2026 why did we schedule all this? \u{1F605}",
    () => "We planned a lot today. Who is \u2018we\u2019 exactly? \u{1F914}",
    (_d, _l, _t2, tot) => `${tot} things today\u2026 bold of us. \u{1F62C}`,
    () => "Big day ahead \u2014 I believe in you. \u2615",
    () => "Today\u2019s schedule said \u2018hold my coffee.\u2019 \u2615",
    () => "Somebody was feeling ambitious last night. \u{1F605}",
  ],
  morningMed: [
    (_d, _l, _t2, tot) => `${tot} things. Totally doable. Probably. \u{1F604}`,
    (_d, _l, _t2, tot) => `Not too bad today \u2014 ${tot} things and we\u2019re out. \u270C\uFE0F`,
    () => "Manageable day. Famous last words. \u{1F602}",
  ],
  morningLight: [
    (_d, _l, _t2, tot) => `Only ${tot} today. Is this a trick? \u{1F440}`,
    () => "Light day. Don\u2019t tell the kids \u2014 they\u2019ll want to go somewhere. \u{1F92B}",
    (_d, _l, _t2, tot) => `Just ${tot} things. You might actually eat lunch sitting down. \u{1F37D}\uFE0F`,
  ],
  evening: [
    () => "It\u2019s okay to call it for the night. Today was enough. \u{1F319}",
    () => "You did what you could. You showed up and that\u2019s what counts. \u{1F49B}",
    () => "Close the books. There is always tomorrow. \u{1F319}",
  ],
  fallback: [
    () => "Here\u2019s the plan for today. \u{1F4CB}",
    () => "One thing at a time \u2014 you\u2019ve got this. \u{1F4AA}",
    () => "Let\u2019s just do the next thing. \u2705",
  ],
};

function pickRandom(arr: ((...args: string[]) => string)[], exclude: string | null, ...args: string[]): string {
  const candidates = arr.map(fn => fn(...args));
  const filtered = exclude ? candidates.filter(m => m !== exclude) : candidates;
  return (filtered.length > 0 ? filtered : candidates)[Math.floor(Math.random() * (filtered.length > 0 ? filtered : candidates).length)];
}

function getCategory(total: number, done: number, hour: number, soonAppt: { name: string; minutes: number; time: string } | null): StatusCategory {
  const left = total - done;
  const isMorning = hour < 12;
  if (total > 0 && left === 0) return "allDone";
  if (soonAppt) return "apptSoon";
  if (left > 0 && left <= 2 && done > 0) return "almostDone";
  if (hour >= 14 && left > total / 2 && total > 0) return "fellBehind";
  if (done > 0 && done >= total / 2 && left > 2) return "pastHalf";
  if (done > 0 && done < total / 2) return "earlyProgress";
  if (isMorning && done === 0 && total === 0) return "morningEmpty";
  if (isMorning && done === 0 && total >= 5) return "morningBig";
  if (isMorning && done === 0 && total >= 3) return "morningMed";
  if (isMorning && done === 0 && total >= 1) return "morningLight";
  if (hour >= 18 && left > 0) return "evening";
  return "fallback";
}

// ─── Badge ───────────────────────────────────────────────────────────────────

const BADGE_STYLES = {
  lesson:      { bg: "#2D5A3D", color: "white", label: "Lesson" },
  activity:    { bg: "#a16207", color: "white", label: "Activity" },
  appointment: { bg: "#7C3AED", color: "white", label: "Appt" },
};

function Badge({ kind }: { kind: "lesson" | "activity" | "appointment" }) {
  const s = BADGE_STYLES[kind];
  return (
    <span className="text-[9px] font-medium uppercase tracking-[0.5px] px-[7px] py-0.5 rounded-md shrink-0"
      style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function UnifiedTimeline({
  lessons, activities, appointments, children,
  onToggleLesson, onToggleActivity, onToggleAppointment,
  onLogExtra, onManage, onAddAppt, isPartner, upcomingDays,
}: Props) {
  const [nowMinutes, setNowMinutes] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusCat, setStatusCat] = useState<StatusCategory | null>(null);
  const prevMsgRef = useRef<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // Find upcoming appointment within 60 min
  const soonAppt = (() => {
    for (const a of appointments) {
      if (a.completed) continue;
      const mins = parseTime(a.time);
      if (mins == null) continue;
      const diff = mins - nowMinutes;
      if (diff > 0 && diff <= 60) return { name: a.title, minutes: diff, time: fmtTime(mins) };
    }
    return null;
  })();

  const computeStatus = useCallback(() => {
    const hour = Math.floor(nowMinutes / 60);
    const cat = getCategory(totalItems, doneItems, hour, soonAppt);
    const left = totalItems - doneItems;
    const args = [String(doneItems), String(left), soonAppt?.time ?? "", String(totalItems)];
    if (cat === "apptSoon" && soonAppt) {
      args[0] = soonAppt.name; args[1] = String(soonAppt.minutes); args[2] = soonAppt.time;
    }
    return { cat, args };
  }, [nowMinutes, totalItems, doneItems, soonAppt]);

  // Update status only when category changes or done count changes
  useEffect(() => {
    const { cat, args } = computeStatus();
    if (cat !== statusCat || statusMsg === null) {
      const msg = pickRandom(STATUS_MESSAGES[cat], prevMsgRef.current, ...args);
      prevMsgRef.current = msg;
      setStatusCat(cat);
      setStatusMsg(msg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computeStatus, doneItems]);

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

  function getItemId(item: TimelineItem): string {
    return item.kind === "lesson" ? `l-${item.lesson.id}` : item.kind === "activity" ? `a-${item.activity.id}` : `ap-${item.appointment.id}`;
  }

  function handleTap(item: TimelineItem) {
    if (isPartner) return;
    if (item.kind === "lesson") onToggleLesson(item.lesson.id, item.lesson.completed);
    else if (item.kind === "activity") onToggleActivity(item.activity);
    else onToggleAppointment(item.appointment.id, item.appointment.completed);
  }

  function renderItem(item: TimelineItem, isPast: boolean) {
    const done = isDone(item);
    const title = item.kind === "lesson" ? item.lesson.title : item.kind === "activity" ? item.activity.name : item.appointment.title;
    const emoji = item.kind === "lesson" ? (item.lesson.icon_emoji || "\u{1F4DA}") : item.kind === "activity" ? item.activity.emoji : item.appointment.emoji;
    const isLesson = item.kind === "lesson" || item.kind === "activity";
    const sub = item.kind === "lesson"
      ? [item.lesson.subjects?.name, children.find(c => c.id === item.lesson.child_id)?.name].filter(Boolean).join(" \u00b7 ")
      : item.kind === "activity"
        ? [fmtDur(item.activity.duration_minutes), ...item.activity.child_ids.map(id => children.find(c => c.id === id)?.name).filter(Boolean)].join(" \u00b7 ")
        : [item.appointment.location ? `\u{1F4CD} ${item.appointment.location}` : null, item.appointment.child_ids.length === 0 ? "Me" : item.appointment.child_ids.map(id => children.find(c => c.id === id)?.name).filter(Boolean).join(", ")].filter(Boolean).join(" \u00b7 ");

    const checkColor = isLesson ? "#2D5A3D" : "#7C3AED";
    const cardBg = done ? "#fafaf8" : isLesson ? "linear-gradient(135deg, #f0faf3, #e8f5ec)" : "linear-gradient(135deg, #f5f0ff, #ede5ff)";
    const borderColor = done ? "#f0ece6" : isLesson ? "#cef0d4" : "#e8deff";
    const timeLabel = item.kind === "appointment" ? fmtApptTime(item.appointment.time) : null;
    const itemId = getItemId(item);
    const isExpanded = expandedId === itemId;

    return (
      <div className="rounded-[14px] mb-1.5 transition-all duration-200"
        style={{ background: cardBg, border: `1.5px solid ${borderColor}`, opacity: done ? 0.55 : isPast ? 0.75 : 1, boxShadow: isExpanded ? "0 2px 8px rgba(0,0,0,0.06)" : "none" }}>
        <div className="flex items-center gap-3 px-3.5 py-3">
          {/* Checkbox — toggles done */}
          <button type="button" onClick={() => handleTap(item)}
            className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 transition-all"
            style={{ border: done ? "none" : `2px solid ${checkColor}`, background: done ? checkColor : "white" }}>
            {done && <span className="text-white text-[12px] font-medium">{"\u2713"}</span>}
          </button>
          {/* Card content — tap to expand/collapse */}
          <button type="button" onClick={() => setExpandedId(isExpanded ? null : itemId)}
            className="flex-1 flex items-center gap-3 text-left min-w-0">
            <span className="text-xl shrink-0">{emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[14px] font-medium truncate ${done ? "line-through text-[#999]" : "text-[#2a2520]"}`} style={{ letterSpacing: "-0.2px" }}>{title}</span>
                <Badge kind={item.kind} />
              </div>
              {(sub || timeLabel) && (
                <p className={`text-[12px] truncate mt-0.5 ${done ? "text-[#bbb]" : "text-[#8a8580]"}`}>
                  {timeLabel && <span className="font-semibold">{timeLabel}</span>}
                  {timeLabel && sub ? " \u00b7 " : ""}
                  {sub}
                </p>
              )}
            </div>
          </button>
          {/* Chevron indicator */}
          <span className="text-[16px] text-[#c4beb6] shrink-0 transition-transform duration-200"
            style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}>{"\u203A"}</span>
        </div>

        {/* Expanded detail section */}
        {isExpanded && (
          <div className="px-3.5 pb-3">
            <div className="pt-2 mt-0 border-t border-[#e8e3dc]/50">
              {item.kind === "appointment" && (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] mb-2">
                    <span className="font-semibold text-[#5b21b6]">{fmtApptTime(item.appointment.time)}</span>
                    {item.appointment.duration_minutes > 0 && <span className="text-[#8a8580]">{fmtDur(item.appointment.duration_minutes)}</span>}
                    {item.appointment.location && <span className="text-[#8a8580]">{"\u{1F4CD}"} {item.appointment.location}</span>}
                  </div>
                  {item.appointment.child_ids.length > 0 && (
                    <div className="flex gap-1.5 mb-2">
                      {item.appointment.child_ids.map(id => {
                        const c = children.find(ch => ch.id === id);
                        return c ? <span key={id} className="text-[11px] font-medium text-[#7C3AED] bg-[#f5f0ff] px-2 py-0.5 rounded-lg">{c.name}</span> : null;
                      })}
                    </div>
                  )}
                  {item.appointment.notes && (
                    <div className="bg-white/50 rounded-lg p-2.5 mt-2 border-l-2 border-[#7C3AED]">
                      <p className="text-[13px] text-[#6b6560] italic">{item.appointment.notes}</p>
                    </div>
                  )}
                  {!isPartner && (
                    <div className="flex justify-end mt-2">
                      <button type="button" onClick={onManage} className="text-[12px] text-[#7C3AED] font-medium">{"\u270F\uFE0F"} Edit</button>
                    </div>
                  )}
                </>
              )}
              {item.kind === "lesson" && (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] mb-1">
                    {item.lesson.subjects?.name && <span className="text-[#2D5A3D] font-medium">{item.lesson.subjects.name}</span>}
                    {(() => { const c = children.find(ch => ch.id === item.lesson.child_id); return c ? <span className="text-[#8a8580]">{c.name}</span> : null; })()}
                  </div>
                  <p className="text-[14px] font-medium text-[#2a2520] mt-1">{item.lesson.title}</p>
                </>
              )}
              {item.kind === "activity" && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] mb-1">
                  <span className="text-[#8a8580]">{fmtDur(item.activity.duration_minutes)}</span>
                  {item.activity.child_ids.length > 0 && (
                    <span className="text-[#8a8580]">
                      {item.activity.child_ids.map(id => children.find(c => c.id === id)?.name).filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const nowIdx = (() => { const i = timed.findIndex(i => (i.timeMinutes ?? 0) > nowMinutes); return i === -1 ? timed.length : i; })();
  const leftCount = totalItems - doneItems;

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between px-0.5 -mb-1">
        <p className="text-[13px] font-medium uppercase tracking-[0.8px] text-[#8a8580]">Today&apos;s schedule</p>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#b5aca4]">{doneItems} of {totalItems} done</span>
          <button type="button" onClick={onManage} className="flex items-center gap-1 text-[12px] font-medium text-white rounded-full px-3.5 py-1.5 transition-opacity hover:opacity-80" style={{ background: "#2D5A3D" }}>
            📅 Manage
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl overflow-hidden mt-2" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)" }}>
        {/* Status line + actions */}
        <div className="px-[18px] pt-4 pb-3 border-b border-[#f0ece6]">
          {statusMsg && (
            <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 mb-2.5 transition-opacity duration-300" style={{ background: "linear-gradient(135deg, #f0faf3, #e8f5ec)" }}>
              <span className="text-sm text-[#2D5A3D] font-medium">{statusMsg}</span>
            </div>
          )}
          {!isPartner && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={onAddAppt} className="text-[12px] font-medium text-[#7C3AED] rounded-full px-3.5 py-1.5" style={{ background: "#f5f0ff", border: "1px solid #e8deff" }}>+ Appt</button>
              <button type="button" onClick={onLogExtra} className="text-[12px] font-medium text-[#7a6f65] rounded-full px-3.5 py-1.5" style={{ background: "#f5f2ed", border: "1px solid #e8e3dc" }}>+ Log an extra lesson</button>
            </div>
          )}
        </div>

        {/* Item list */}
        <div className="px-3 py-2.5">
          {[...timed, ...anytime].map((item) => {
            const isPast = item.timeMinutes != null && item.timeMinutes < nowMinutes;
            return (
              <div key={item.kind === "lesson" ? `l-${item.lesson.id}` : item.kind === "activity" ? `a-${item.activity.id}` : `ap-${item.appointment.id}`}>
                {renderItem(item, isPast)}
              </div>
            );
          })}
        </div>

        {/* Inline schedule tabs */}
        <InlineScheduleTabs children={children} onManage={onManage} />
      </div>
    </div>
  );
}

// ─── Inline Schedule Tabs ────────────────────────────────────────────────────

type TabAppt = { id: string; title: string; emoji: string; date: string; time: string | null; location: string | null; child_ids: string[]; is_recurring: boolean; recurrence_rule: { frequency: string; days: number[] } | null; completed: boolean; instance_date?: string };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function InlineScheduleTabs({ children: kids, onManage }: { children: { id: string; name: string; color: string | null }[]; onManage: () => void }) {
  const [tab, setTab] = useState<"upcoming" | "recurring" | "past">("upcoming");
  const [upcoming, setUpcoming] = useState<TabAppt[]>([]);
  const [recurring, setRecurring] = useState<TabAppt[]>([]);
  const [past, setPast] = useState<TabAppt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const token = session.access_token;
      const [upRes, recRes, pastRes] = await Promise.all([
        fetch("/api/appointments", { headers: { Authorization: `Bearer ${token}` } }),
        supabase.from("appointments").select("*").eq("user_id", user.id).eq("is_recurring", true).order("created_at", { ascending: false }),
        supabase.from("appointments").select("*").eq("user_id", user.id).eq("completed", true).gte("date", (() => { const d = new Date(); d.setDate(d.getDate() - 7); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })()).order("date", { ascending: false }),
      ]);
      if (upRes.ok) { const all: TabAppt[] = await upRes.json(); setUpcoming(all.filter(a => !a.completed).slice(0, 7)); }
      setRecurring((recRes.data ?? []) as TabAppt[]);
      setPast((pastRes.data ?? []) as TabAppt[]);
      setLoaded(true);
    })();
  }, []);

  async function handleDelete(id: string) {
    setDeleteConfirm(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch("/api/appointments", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ id }) });
    setUpcoming(prev => prev.filter(a => a.id !== id));
    setRecurring(prev => prev.filter(a => a.id !== id));
    setPast(prev => prev.filter(a => a.id !== id));
  }

  function fmtRelDate(d: string): string {
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(d + "T12:00:00");
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diff === 1) return "Tomorrow";
    if (diff >= 2 && diff <= 6) return target.toLocaleDateString("en-US", { weekday: "short" });
    return target.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function freqLabel(a: TabAppt): string {
    if (!a.recurrence_rule) return "";
    const r = a.recurrence_rule;
    const freq = r.frequency === "weekly" ? "Weekly" : r.frequency === "biweekly" ? "Every 2 weeks" : "Monthly";
    const days = (r.days ?? []).map((d: number) => DAY_NAMES[d]).join(", ");
    return days ? `${freq} · ${days}` : freq;
  }

  const TABS: { key: typeof tab; label: string }[] = [
    { key: "upcoming", label: "Upcoming" },
    { key: "recurring", label: "Recurring" },
    { key: "past", label: "Past" },
  ];

  return (
    <>
      <div className="flex border-t border-[#f0ece6]">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="flex-1 py-3 text-center text-[12px] font-medium cursor-pointer transition-all"
            style={{ color: tab === t.key ? "#2D5A3D" : "#b5aca4", borderBottom: tab === t.key ? "2.5px solid #2D5A3D" : "2.5px solid transparent" }}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="px-3 py-3 max-h-[200px] overflow-y-auto bg-[#fafaf8]">
        {!loaded ? (
          <p className="text-[12px] text-[#b5aca4] text-center py-3">Loading...</p>
        ) : tab === "upcoming" ? (
          upcoming.length === 0 ? (
            <p className="text-[13px] text-[#b5aca4] text-center py-4">Nothing coming up — enjoy the break! ☀️</p>
          ) : (
            upcoming.map(a => (
              <div key={`${a.id}-${a.instance_date ?? a.date}`} className="rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5" style={{ background: "linear-gradient(135deg, #f5f0ff, #ede5ff)", border: "1.5px solid #e8deff" }}>
                <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[#5b21b6] truncate">{a.title}</span>
                    <span className="text-[9px] font-medium uppercase tracking-[0.5px] px-[7px] py-0.5 rounded-md bg-[#7C3AED] text-white shrink-0">Appt</span>
                  </div>
                  <p className="text-[11px] text-[#8a8580] mt-0.5">
                    {fmtRelDate(a.instance_date ?? a.date)}, <span className="font-semibold">{fmtApptTime(a.time)}</span>
                    {a.location && ` · 📍 ${a.location}`}
                  </p>
                </div>
                {a.child_ids.length > 0 && (() => {
                  const c = kids.find(ch => ch.id === a.child_ids[0]);
                  return c ? <span className="text-[11px] font-medium text-[#b5aca4] bg-[#f0ece6] px-2 py-0.5 rounded-lg shrink-0">{c.name}</span> : null;
                })()}
              </div>
            ))
          )
        ) : tab === "recurring" ? (
          recurring.length === 0 ? (
            <p className="text-[13px] text-[#b5aca4] text-center py-4">No recurring appointments</p>
          ) : (
            recurring.map(a => (
              <div key={a.id} className="bg-white rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5" style={{ border: "1.5px solid #f0ece6" }}>
                <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[#2a2520] truncate">{a.title}</span>
                  </div>
                  <p className="text-[11px] text-[#8a8580] mt-0.5">{freqLabel(a)}{a.location ? ` · 📍 ${a.location}` : ""}</p>
                </div>
                {a.child_ids.length > 0 && (() => {
                  const c = kids.find(ch => ch.id === a.child_ids[0]);
                  return c ? <span className="text-[11px] font-medium text-[#7C3AED] bg-[#f5f0ff] px-2 py-0.5 rounded-lg shrink-0">{c.name}</span> : null;
                })()}
                <div className="flex gap-1.5 shrink-0">
                  <button type="button" onClick={onManage} className="opacity-40 hover:opacity-100 transition-opacity">✏️</button>
                  {deleteConfirm === a.id ? (
                    <>
                      <button type="button" onClick={() => handleDelete(a.id)} className="text-[9px] font-medium text-red-500 px-1.5 py-0.5 rounded bg-red-50">Del</button>
                      <button type="button" onClick={() => setDeleteConfirm(null)} className="text-[9px] text-[#7a6f65] px-1">✕</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setDeleteConfirm(a.id)} className="opacity-40 hover:opacity-100 transition-opacity">🗑️</button>
                  )}
                </div>
              </div>
            ))
          )
        ) : (
          past.length === 0 ? (
            <p className="text-[13px] text-[#b5aca4] text-center py-4">No past appointments yet</p>
          ) : (
            past.map(a => (
              <div key={a.id} className="bg-white rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5 opacity-50" style={{ border: "1.5px solid #f0ece6" }}>
                <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-[#999] line-through truncate">{a.title}</span>
                  <p className="text-[11px] text-[#bbb] mt-0.5">{fmtRelDate(a.date)}{a.location ? ` · 📍 ${a.location}` : ""}</p>
                </div>
                {a.child_ids.length > 0 && (() => {
                  const c = kids.find(ch => ch.id === a.child_ids[0]);
                  return c ? <span className="text-[11px] font-medium text-[#b5aca4] bg-[#f0ece6] px-2 py-0.5 rounded-lg shrink-0">{c.name}</span> : null;
                })()}
              </div>
            ))
          )
        )}
      </div>
    </>
  );
}
