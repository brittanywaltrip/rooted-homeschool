"use client";

// Upcoming / Recurring / Past tabs that render below the Today schedule.
// Extracted from app/components/UnifiedTimeline.tsx as part of the Today
// page redesign so the rest of UnifiedTimeline can be deleted. No visual
// or behavioral changes — pure code move.
//
// This component runs its own queries (independent of the parent's
// loadData) on mount, then keeps that state local. If the parent
// re-mounts it, the queries re-fire — current behavior.

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Pencil } from "lucide-react";
import { tintFromHex, darkenHex } from "@/lib/color-tint";
import { resolveLessonSubject } from "@/lib/lesson-subject";

type Child = { id: string; name: string; color: string | null };

// ─── Kid-color skin helpers ──────────────────────────────────────────────────
// Mirrors the pattern in TodayItemCard / TodayKidSection so a card looks the
// same whether it's "today" or "upcoming/recurring/past" — same kid is the
// same kid regardless of which tab.
const FALLBACK_KID_COLOR = "#7a6f65";
// Whole-family / multi-kid items use the Everyone palette from
// TodayEveryoneSection. Kept in sync by hand — these are rendered in
// dashed gray, not tinted with any kid's color.
const EVERYONE_BG = "#EAE7DD";
const EVERYONE_BORDER = "1px dashed #888780";
const EVERYONE_TITLE = "#2C2C2A";
const EVERYONE_SUBTLE = "#5C5C58";

type CardSkin = {
  background: string;
  border: string;
  titleColor: string;
  subtleColor: string;
  pillBg: string;
  pillText: string;
};

function skinForChildIds(childIds: string[] | null | undefined, kids: Child[]): CardSkin {
  const isEveryone = !childIds || childIds.length === 0 || childIds.length > 1;
  if (isEveryone) {
    return {
      background: EVERYONE_BG,
      border: EVERYONE_BORDER,
      titleColor: EVERYONE_TITLE,
      subtleColor: EVERYONE_SUBTLE,
      pillBg: "white",
      pillText: EVERYONE_TITLE,
    };
  }
  const kid = kids.find((c) => c.id === childIds![0]);
  const color = kid?.color ?? FALLBACK_KID_COLOR;
  return {
    background: tintFromHex(color, 0.25),
    border: "none",
    titleColor: darkenHex(color, 0.45),
    subtleColor: darkenHex(color, 0.30),
    // Pill sits ON the tinted card. Slightly stronger tint to stand off
    // (35%), darker text for contrast.
    pillBg: tintFromHex(color, 0.35),
    pillText: darkenHex(color, 0.55),
  };
}

type TabAppt = {
  id: string;
  title: string;
  emoji: string;
  date: string;
  time: string | null;
  location: string | null;
  child_ids: string[];
  is_recurring: boolean;
  recurrence_rule: { frequency: string; days: number[] } | null;
  completed: boolean;
  instance_date?: string;
};

type TabLesson = {
  id: string;
  title: string;
  child_id: string;
  scheduled_date: string;
  notes?: string | null;
  subjects: { name: string; color: string | null } | null;
  curriculum_goals?: { subject_label: string | null } | null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

export default function InlineScheduleTabs({
  children: kids,
  onManage,
  isPartner,
}: {
  children: Child[];
  onManage: () => void;
  isPartner: boolean;
}) {
  const [tab, setTab] = useState<"upcoming" | "recurring" | "past">("upcoming");
  const [upcoming, setUpcoming] = useState<TabAppt[]>([]);
  const [recurring, setRecurring] = useState<TabAppt[]>([]);
  const [past, setPast] = useState<TabAppt[]>([]);
  const [upcomingLessons, setUpcomingLessons] = useState<TabLesson[]>([]);
  const [pastLessons, setPastLessons] = useState<TabLesson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  function startEditNote(lessonId: string, currentNotes: string | null | undefined) {
    setEditingNoteId(lessonId);
    setEditingNoteText(currentNotes ?? "");
    setTimeout(() => noteTextareaRef.current?.focus(), 0);
  }
  function cancelEditNote() {
    setEditingNoteId(null);
    setEditingNoteText("");
  }
  async function saveUpcomingNote(lessonId: string) {
    const trimmed = editingNoteText.trim();
    const value = trimmed.length > 0 ? trimmed : null;
    await supabase.from("lessons").update({ notes: value }).eq("id", lessonId);
    setUpcomingLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, notes: value } : l)));
    setEditingNoteId(null);
    setEditingNoteText("");
  }

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
        supabase
          .from("appointments")
          .select("*")
          .eq("user_id", user.id)
          .eq("completed", true)
          .gte("date", (() => {
            const d = new Date();
            d.setDate(d.getDate() - 7);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          })())
          .order("date", { ascending: false }),
      ]);
      if (upRes.ok) {
        const all: TabAppt[] = await upRes.json();
        setUpcoming(all.filter((a) => !a.completed).slice(0, 7));
      }
      setRecurring((recRes.data ?? []) as TabAppt[]);
      setPast((pastRes.data ?? []) as TabAppt[]);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const threeDaysOut = new Date();
      threeDaysOut.setDate(threeDaysOut.getDate() + 3);
      const fmtD = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const { data: lessonData } = await supabase
        .from("lessons")
        .select("id, title, child_id, scheduled_date, notes, subjects(name, color), curriculum_goals(subject_label)")
        .eq("user_id", user.id)
        .eq("completed", false)
        .gte("scheduled_date", fmtD(tomorrow))
        .lte("scheduled_date", fmtD(threeDaysOut))
        .order("scheduled_date")
        .order("title");
      setUpcomingLessons((lessonData ?? []) as unknown as TabLesson[]);

      const sevenAgo = new Date();
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const { data: pastLessonData } = await supabase
        .from("lessons")
        .select("id, title, child_id, scheduled_date, notes, subjects(name, color), curriculum_goals(subject_label)")
        .eq("user_id", user.id)
        .eq("completed", true)
        .gte("scheduled_date", fmtD(sevenAgo))
        .order("scheduled_date", { ascending: false })
        .order("title");
      setPastLessons((pastLessonData ?? []) as unknown as TabLesson[]);

      setLoaded(true);
    })();
  }, []);

  async function handleDelete(id: string) {
    setDeleteConfirm(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch("/api/appointments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id }),
    });
    setUpcoming((prev) => prev.filter((a) => a.id !== id));
    setRecurring((prev) => prev.filter((a) => a.id !== id));
    setPast((prev) => prev.filter((a) => a.id !== id));
  }

  function fmtRelDate(d: string): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="flex-1 py-3 text-center text-[12px] font-medium cursor-pointer transition-all"
            style={{
              color: tab === t.key ? "#2D5A3D" : "#b5aca4",
              borderBottom: tab === t.key ? "2.5px solid #2D5A3D" : "2.5px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="px-3 py-3 max-h-[200px] overflow-y-auto bg-[#fafaf8]">
        {!loaded ? (
          <p className="text-[12px] text-[#b5aca4] text-center py-3">Loading...</p>
        ) : tab === "upcoming" ? (
          upcoming.length === 0 && upcomingLessons.length === 0 ? (
            <p className="text-[13px] text-[#b5aca4] text-center py-4">Nothing coming up. Enjoy the break! ☀️</p>
          ) : (
            <>
              {upcoming.map((a) => {
                const skin = skinForChildIds(a.child_ids, kids);
                return (
                  <div
                    key={`${a.id}-${a.instance_date ?? a.date}`}
                    className="rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5"
                    style={{ background: skin.background, border: skin.border }}
                  >
                    <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium truncate" style={{ color: skin.titleColor }}>{a.title}</span>
                        <span className="text-[9px] font-medium uppercase tracking-[0.5px] px-[7px] py-0.5 rounded-md text-white shrink-0" style={{ background: skin.titleColor }}>
                          Appt
                        </span>
                      </div>
                      <p className="text-[11px] mt-0.5" style={{ color: skin.subtleColor }}>
                        {fmtRelDate(a.instance_date ?? a.date)}, <span className="font-semibold">{fmtApptTime(a.time)}</span>
                        {a.location && ` · \u{1F4CD} ${a.location}`}
                      </p>
                    </div>
                    {a.child_ids.length > 0 &&
                      (() => {
                        const c = kids.find((ch) => ch.id === a.child_ids[0]);
                        return c ? (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg shrink-0" style={{ background: skin.pillBg, color: skin.pillText }}>{c.name}</span>
                        ) : null;
                      })()}
                  </div>
                );
              })}
              {upcomingLessons.length > 0 && (() => {
                const byDate = new Map<string, TabLesson[]>();
                for (const l of upcomingLessons) {
                  const d = l.scheduled_date;
                  if (!byDate.has(d)) byDate.set(d, []);
                  byDate.get(d)!.push(l);
                }
                const firstDate = Array.from(byDate.keys())[0];
                if (!firstDate) return null;
                const lessonsForDay = byDate.get(firstDate)!;
                const dateLabel = fmtRelDate(firstDate);
                return (
                  <>
                    <div className="flex items-center gap-2 my-2">
                      <div className="flex-1 h-px bg-[#e8e3dc]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#b5aca4]">
                        {dateLabel} · {lessonsForDay.length} lesson{lessonsForDay.length !== 1 ? "s" : ""}
                      </span>
                      <div className="flex-1 h-px bg-[#e8e3dc]" />
                    </div>
                    {lessonsForDay.map((l) => {
                      const skin = skinForChildIds(l.child_id ? [l.child_id] : null, kids);
                      return (
                        <div
                          key={l.id}
                          className="rounded-xl mb-1.5"
                          style={{ background: skin.background, border: skin.border }}
                        >
                          <div className="flex items-center gap-2.5 p-2.5">
                            <span className="text-lg shrink-0">📚</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-medium truncate" style={{ color: skin.titleColor }}>{l.title}</span>
                              </div>
                              <p className="text-[11px] mt-0.5" style={{ color: skin.subtleColor }}>
                                {(() => {
                                  const subjName = resolveLessonSubject(l.subjects?.name, l.curriculum_goals?.subject_label);
                                  const childName = (() => { const c = kids.find((ch) => ch.id === l.child_id); return c ? c.name : ""; })();
                                  return `${subjName ?? ""}${subjName && childName ? " · " : ""}${childName}`;
                                })()}
                              </p>
                              {editingNoteId !== l.id && l.notes && (
                                <p className="text-[10px] italic mt-1 line-clamp-2" style={{ color: skin.subtleColor }}>{l.notes}</p>
                              )}
                            </div>
                          </div>
                          {!isPartner && (
                            <div className="px-2.5 pb-2">
                              {editingNoteId === l.id ? (
                                <div>
                                  <textarea
                                    ref={noteTextareaRef}
                                    value={editingNoteText}
                                    onChange={(e) => setEditingNoteText(e.target.value)}
                                    placeholder="Prep items, extra activities, reminders..."
                                    className="w-full min-h-[44px] max-h-[80px] rounded-lg border bg-white p-2 text-[11px] text-[#3c3a37] resize-none focus:outline-none"
                                    style={{ borderColor: skin.titleColor }}
                                  />
                                  <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => saveUpcomingNote(l.id)} className="text-white text-[10px] font-semibold px-2 py-0.5 rounded-lg" style={{ background: skin.titleColor }}>
                                      Save
                                    </button>
                                    <button onClick={cancelEditNote} className="text-[10px] text-[#8a8580] font-medium">
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : l.notes ? (
                                <button onClick={() => startEditNote(l.id, l.notes)} className="flex items-center gap-1 text-[10px] font-medium" style={{ color: skin.titleColor }}>
                                  <Pencil size={9} /> Edit note
                                </button>
                              ) : (
                                <button onClick={() => startEditNote(l.id, null)} className="text-[10px] font-medium transition-colors" style={{ color: skin.titleColor }}>
                                  + Add a note...
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </>
          )
        ) : tab === "recurring" ? (
          recurring.length === 0 ? (
            <p className="text-[13px] text-[#b5aca4] text-center py-4">No recurring appointments</p>
          ) : (
            recurring.map((a) => {
              const skin = skinForChildIds(a.child_ids, kids);
              return (
                <div
                  key={a.id}
                  className="rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5"
                  style={{ background: skin.background, border: skin.border }}
                >
                  <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium truncate" style={{ color: skin.titleColor }}>{a.title}</span>
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: skin.subtleColor }}>
                      {freqLabel(a)}
                      {a.location ? ` · \u{1F4CD} ${a.location}` : ""}
                    </p>
                  </div>
                  {a.child_ids.length > 0 &&
                    (() => {
                      const c = kids.find((ch) => ch.id === a.child_ids[0]);
                      return c ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg shrink-0" style={{ background: skin.pillBg, color: skin.pillText }}>{c.name}</span>
                      ) : null;
                    })()}
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button" onClick={onManage} className="opacity-40 hover:opacity-100 transition-opacity">
                      ✏️
                    </button>
                    {deleteConfirm === a.id ? (
                      <>
                        <button type="button" onClick={() => handleDelete(a.id)} className="text-[9px] font-medium text-red-500 px-1.5 py-0.5 rounded bg-red-50">
                          Del
                        </button>
                        <button type="button" onClick={() => setDeleteConfirm(null)} className="text-[9px] text-[#7a6f65] px-1">
                          ✕
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setDeleteConfirm(a.id)} className="opacity-40 hover:opacity-100 transition-opacity">
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )
        ) : past.length === 0 && pastLessons.length === 0 ? (
          <p className="text-[13px] text-[#b5aca4] text-center py-4">No completed lessons or appointments in the last 7 days.</p>
        ) : (
          (() => {
            type PastRow =
              | { kind: "appt"; date: string; appt: TabAppt }
              | { kind: "lesson"; date: string; lesson: TabLesson };
            const rows: PastRow[] = [
              ...past.map((a) => ({ kind: "appt" as const, date: a.date, appt: a })),
              ...pastLessons.map((l) => ({ kind: "lesson" as const, date: l.scheduled_date, lesson: l })),
            ].sort((a, b) => b.date.localeCompare(a.date));
            return rows.map((row) => {
              if (row.kind === "appt") {
                const a = row.appt;
                const skin = skinForChildIds(a.child_ids, kids);
                return (
                  <div
                    key={`ap-${a.id}`}
                    className="rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5 opacity-55"
                    style={{ background: skin.background, border: skin.border }}
                  >
                    <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium line-through truncate" style={{ color: skin.titleColor }}>{a.title}</span>
                      <p className="text-[11px] mt-0.5" style={{ color: skin.subtleColor }}>
                        {fmtRelDate(a.date)}
                        {a.location ? ` · \u{1F4CD} ${a.location}` : ""}
                      </p>
                    </div>
                    {a.child_ids.length > 0 &&
                      (() => {
                        const c = kids.find((ch) => ch.id === a.child_ids[0]);
                        return c ? (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg shrink-0" style={{ background: skin.pillBg, color: skin.pillText }}>{c.name}</span>
                        ) : null;
                      })()}
                  </div>
                );
              }
              const l = row.lesson;
              const c = kids.find((k) => k.id === l.child_id);
              const skin = skinForChildIds(l.child_id ? [l.child_id] : null, kids);
              const subBits = [resolveLessonSubject(l.subjects?.name, l.curriculum_goals?.subject_label), fmtRelDate(l.scheduled_date)].filter(Boolean);
              return (
                <div
                  key={`l-${l.id}`}
                  className="rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5 opacity-55"
                  style={{ background: skin.background, border: skin.border }}
                >
                  <span className="text-lg shrink-0">✓</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium line-through truncate" style={{ color: skin.titleColor }}>{l.title}</span>
                    <p className="text-[11px] mt-0.5" style={{ color: skin.subtleColor }}>{subBits.join(" · ")}</p>
                  </div>
                  {c && kids.length > 1 && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg shrink-0" style={{ background: skin.pillBg, color: skin.pillText }}>{c.name}</span>
                  )}
                </div>
              );
            });
          })()
        )}
      </div>
    </>
  );
}
