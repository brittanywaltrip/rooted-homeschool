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

type Child = { id: string; name: string; color: string | null };

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
        .select("id, title, child_id, scheduled_date, notes, subjects(name, color)")
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
        .select("id, title, child_id, scheduled_date, notes, subjects(name, color)")
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
              {upcoming.map((a) => (
                <div
                  key={`${a.id}-${a.instance_date ?? a.date}`}
                  className="rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5"
                  style={{ background: "linear-gradient(135deg, #f5f0ff, #ede5ff)", border: "1.5px solid #e8deff" }}
                >
                  <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[#5b21b6] truncate">{a.title}</span>
                      <span className="text-[9px] font-medium uppercase tracking-[0.5px] px-[7px] py-0.5 rounded-md bg-[#7C3AED] text-white shrink-0">
                        Appt
                      </span>
                    </div>
                    <p className="text-[11px] text-[#8a8580] mt-0.5">
                      {fmtRelDate(a.instance_date ?? a.date)}, <span className="font-semibold">{fmtApptTime(a.time)}</span>
                      {a.location && ` · \u{1F4CD} ${a.location}`}
                    </p>
                  </div>
                  {a.child_ids.length > 0 &&
                    (() => {
                      const c = kids.find((ch) => ch.id === a.child_ids[0]);
                      return c ? (
                        <span className="text-[11px] font-medium text-[#b5aca4] bg-[#f0ece6] px-2 py-0.5 rounded-lg shrink-0">{c.name}</span>
                      ) : null;
                    })()}
                </div>
              ))}
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
                    {lessonsForDay.map((l) => (
                      <div
                        key={l.id}
                        className="rounded-xl mb-1.5"
                        style={{ background: "linear-gradient(135deg, #f0faf3, #e8f5ec)", border: "1.5px solid #cef0d4" }}
                      >
                        <div className="flex items-center gap-2.5 p-2.5">
                          <span className="text-lg shrink-0">📚</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-medium text-[#2D5A3D] truncate">{l.title}</span>
                            </div>
                            <p className="text-[11px] text-[#8a8580] mt-0.5">
                              {l.subjects?.name ?? ""}
                              {l.subjects?.name && l.child_id ? " · " : ""}
                              {(() => {
                                const c = kids.find((ch) => ch.id === l.child_id);
                                return c ? c.name : "";
                              })()}
                            </p>
                            {editingNoteId !== l.id && l.notes && (
                              <p className="text-[10px] text-[#6b6560] italic mt-1 line-clamp-2">{l.notes}</p>
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
                                  className="w-full min-h-[44px] max-h-[80px] rounded-lg border border-[#cef0d4] bg-white p-2 text-[11px] text-[#3c3a37] resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/30"
                                />
                                <div className="flex items-center gap-2 mt-1">
                                  <button onClick={() => saveUpcomingNote(l.id)} className="bg-[#2D5A3D] text-white text-[10px] font-semibold px-2 py-0.5 rounded-lg">
                                    Save
                                  </button>
                                  <button onClick={cancelEditNote} className="text-[10px] text-[#8a8580] font-medium">
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : l.notes ? (
                              <button onClick={() => startEditNote(l.id, l.notes)} className="flex items-center gap-1 text-[10px] text-[#2D5A3D] font-medium">
                                <Pencil size={9} /> Edit note
                              </button>
                            ) : (
                              <button onClick={() => startEditNote(l.id, null)} className="text-[10px] text-[#5c7f63] font-medium hover:text-[#2D5A3D] transition-colors">
                                + Add a note...
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                );
              })()}
            </>
          )
        ) : tab === "recurring" ? (
          recurring.length === 0 ? (
            <p className="text-[13px] text-[#b5aca4] text-center py-4">No recurring appointments</p>
          ) : (
            recurring.map((a) => (
              <div
                key={a.id}
                className="bg-white rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5"
                style={{ border: "1.5px solid #f0ece6" }}
              >
                <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[#2a2520] truncate">{a.title}</span>
                  </div>
                  <p className="text-[11px] text-[#8a8580] mt-0.5">
                    {freqLabel(a)}
                    {a.location ? ` · \u{1F4CD} ${a.location}` : ""}
                  </p>
                </div>
                {a.child_ids.length > 0 &&
                  (() => {
                    const c = kids.find((ch) => ch.id === a.child_ids[0]);
                    return c ? (
                      <span className="text-[11px] font-medium text-[#7C3AED] bg-[#f5f0ff] px-2 py-0.5 rounded-lg shrink-0">{c.name}</span>
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
            ))
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
                return (
                  <div
                    key={`ap-${a.id}`}
                    className="bg-white rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5 opacity-50"
                    style={{ border: "1.5px solid #f0ece6" }}
                  >
                    <span className="text-lg shrink-0">{a.emoji || "📅"}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-[#999] line-through truncate">{a.title}</span>
                      <p className="text-[11px] text-[#bbb] mt-0.5">
                        {fmtRelDate(a.date)}
                        {a.location ? ` · \u{1F4CD} ${a.location}` : ""}
                      </p>
                    </div>
                    {a.child_ids.length > 0 &&
                      (() => {
                        const c = kids.find((ch) => ch.id === a.child_ids[0]);
                        return c ? (
                          <span className="text-[11px] font-medium text-[#b5aca4] bg-[#f0ece6] px-2 py-0.5 rounded-lg shrink-0">{c.name}</span>
                        ) : null;
                      })()}
                  </div>
                );
              }
              const l = row.lesson;
              const c = kids.find((k) => k.id === l.child_id);
              const subBits = [l.subjects?.name, fmtRelDate(l.scheduled_date)].filter(Boolean);
              return (
                <div
                  key={`l-${l.id}`}
                  className="bg-white rounded-xl p-2.5 mb-1.5 flex items-center gap-2.5 opacity-50"
                  style={{ border: "1.5px solid #f0ece6" }}
                >
                  <span className="text-lg shrink-0">✓</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-[#999] line-through truncate">{l.title}</span>
                    <p className="text-[11px] text-[#bbb] mt-0.5">{subBits.join(" · ")}</p>
                  </div>
                  {c && kids.length > 1 && (
                    <span className="text-[11px] font-medium text-[#b5aca4] bg-[#f0ece6] px-2 py-0.5 rounded-lg shrink-0">{c.name}</span>
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
