"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };
type Lesson = { id: string; title: string; completed: boolean; child_id: string; subjects: { name: string; color: string | null } | null; icon_emoji?: string | null };
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
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusCat, setStatusCat] = useState<StatusCategory | null>(null);
  const prevMsgRef = useRef<string | null>(null);

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
    const opacity = (isPast && !done) ? "opacity-60" : done ? "opacity-50" : "";
    const sub = item.kind === "lesson"
      ? [item.lesson.subjects?.name, children.find(c => c.id === item.lesson.child_id)?.name].filter(Boolean).join(" \u00b7 ")
      : item.kind === "activity"
        ? [fmtDur(item.activity.duration_minutes), ...item.activity.child_ids.map(id => children.find(c => c.id === id)?.name).filter(Boolean)].join(" \u00b7 ")
        : [item.appointment.location ? `\u{1F4CD} ${item.appointment.location}` : null, item.appointment.child_ids.length === 0 ? "Me" : item.appointment.child_ids.map(id => children.find(c => c.id === id)?.name).filter(Boolean).join(", ")].filter(Boolean).join(" \u00b7 ");

    return (
      <button type="button" onClick={() => handleTap(item)}
        className={`w-full flex items-center gap-3 py-2.5 px-1 text-left transition-all duration-300 ${opacity}`}>
        <div className={`w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${done ? "border-[#2D5A3D] bg-[#2D5A3D]" : "border-[#d4d0ca]"}`}>
          {done && <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-none"><path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
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

  const nowIdx = (() => { const i = timed.findIndex(i => (i.timeMinutes ?? 0) > nowMinutes); return i === -1 ? timed.length : i; })();
  const leftCount = totalItems - doneItems;

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between px-0.5 -mb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Today&apos;s schedule</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#b5aca4]">{doneItems} of {totalItems} done</span>
          <button type="button" onClick={onManage} className="flex items-center gap-1 text-[11px] font-medium text-white rounded-full px-3 py-1 transition-opacity hover:opacity-80" style={{ background: "#7C3AED" }}>
            📅 Manage
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden mt-2">
        {/* Status line + actions */}
        <div className="px-5 pt-4 pb-2">
          {statusMsg && <p className="text-sm text-[#7a6f65] mb-2 transition-opacity duration-300">{statusMsg}</p>}
          {!isPartner && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={onAddAppt} className="text-[11px] font-medium text-[#7C3AED] bg-[#f5f0ff] px-2.5 py-1.5 rounded-lg">+ Appt</button>
              <button type="button" onClick={onLogExtra} className="text-[13px] text-[#5c7f63] hover:text-[var(--g-deep)] font-medium transition-colors">+ Log extra</button>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="px-4 pb-4">
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
              {nowIdx === timed.length && timed.length > 0 && (
                <div className="flex items-center gap-2 my-1 relative z-10">
                  <div className="w-[20px] flex justify-center"><div className="w-2 h-2 rounded-full bg-[#ef4444]" /></div>
                  <div className="flex-1 h-[1.5px] bg-[#ef4444]" />
                  <span className="text-[10px] font-medium text-[#ef4444] shrink-0">{fmtTime(nowMinutes)}</span>
                </div>
              )}
            </div>
          )}

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
