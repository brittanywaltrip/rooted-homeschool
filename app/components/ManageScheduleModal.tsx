"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

const ACCENT = "#7C3AED";
const ACCENT_BG = "#f5f0ff";
const ACCENT_BORDER = "#c4b5fd";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Child = { id: string; name: string; color: string | null };
type Appointment = {
  id: string; title: string; emoji: string; date: string; time: string | null;
  duration_minutes: number; location: string | null; child_ids: string[];
  is_recurring: boolean; recurrence_rule: { frequency: string; days: number[] } | null;
  completed: boolean; instance_date?: string;
};
type Activity = {
  id: string; name: string; emoji: string; frequency: string; days: number[];
  duration_minutes: number; scheduled_start_time: string | null; child_ids: string[];
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAddAppt: () => void;
  onChanged: () => void;
  children: Child[];
}

function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateStr(offset: number): string {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatDateShort(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function freqLabel(appt: Appointment): string {
  if (!appt.is_recurring || !appt.recurrence_rule) return "";
  const r = appt.recurrence_rule;
  const freq = r.frequency === "weekly" ? "Weekly" : r.frequency === "biweekly" ? "Every 2 weeks" : "Monthly";
  const days = (r.days ?? []).map((d: number) => DAY_NAMES[d]).join(", ");
  return days ? `${freq} · ${days}` : freq;
}
function actFreqLabel(a: Activity): string {
  const freq = a.frequency === "weekly" ? "Weekly" : a.frequency === "biweekly" ? "Every 2 weeks" : "Monthly";
  const days = (a.days ?? []).map((d: number) => DAY_NAMES[d]).join(", ");
  return days ? `${freq} · ${days}` : freq;
}

export default function ManageScheduleModal({ isOpen, onClose, onAddAppt, onChanged, children }: Props) {
  const [tab, setTab] = useState<"recurring" | "upcoming" | "past">("recurring");
  const [recurringAppts, setRecurringAppts] = useState<Appointment[]>([]);
  const [upcomingAppts, setUpcomingAppts] = useState<Appointment[]>([]);
  const [pastAppts, setPastAppts] = useState<Appointment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; type: "appt" | "activity" } | null>(null);

  const loadAll = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const token = session.access_token;
    setLoading(true);

    const [upcomingRes, recurringRes, pastRes, actRes] = await Promise.all([
      // Upcoming 30 days (default — no date param)
      fetch("/api/appointments", { headers: { Authorization: `Bearer ${token}` } }),
      // All recurring appointments (direct query, not expanded)
      supabase.from("appointments").select("*").eq("user_id", user.id).eq("is_recurring", true)
        .order("created_at", { ascending: false }),
      // Past: completed in last 7 days
      supabase.from("appointments").select("*").eq("user_id", user.id).eq("completed", true)
        .gte("date", dateStr(-7)).order("date", { ascending: false }),
      // Recurring activities
      supabase.from("activities").select("id, name, emoji, frequency, days, duration_minutes, scheduled_start_time, child_ids")
        .eq("user_id", user.id).eq("is_active", true),
    ]);

    // Recurring: direct from DB (not expanded)
    setRecurringAppts((recurringRes.data ?? []) as Appointment[]);

    if (upcomingRes.ok) {
      const all: Appointment[] = await upcomingRes.json();
      setUpcomingAppts(all.filter(a => !a.completed));
    }

    setPastAppts((pastRes.data ?? []) as Appointment[]);
    setActivities((actRes.data ?? []) as Activity[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (isOpen) { setTab("recurring"); loadAll(); } }, [isOpen, loadAll]);

  async function handleDelete(id: string, type: "appt" | "activity") {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    if (type === "appt") {
      await fetch("/api/appointments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id }),
      });
    } else {
      await supabase.from("activities").delete().eq("id", id);
    }
    setDeleteConfirm(null);
    onChanged();
    loadAll();
  }

  if (!isOpen) return null;

  const TABS: { key: typeof tab; label: string }[] = [
    { key: "recurring", label: "Recurring" },
    { key: "upcoming", label: "Upcoming" },
    { key: "past", label: "Past" },
  ];

  function renderChildChips(childIds: string[]) {
    if (childIds.length === 0) return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: ACCENT_BG, color: ACCENT }}>Me</span>;
    return childIds.map((id) => {
      const c = children.find((ch) => ch.id === id);
      if (!c) return null;
      return <span key={id} className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white" style={{ background: c.color || ACCENT }}>{c.name}</span>;
    });
  }

  function renderRow(item: { id: string; emoji: string; title: string; sub: string; badge: "appt" | "activity"; location?: string | null; childIds: string[]; type: "appt" | "activity" }) {
    const isAppt = item.badge === "appt";
    const isDeleting = deleteConfirm?.id === item.id;
    return (
      <div key={item.id} className="flex items-start gap-3 px-4 py-3">
        <span className="text-base shrink-0 mt-0.5">{item.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#2d2926] truncate">{item.title}</span>
            <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
              style={isAppt
                ? { background: ACCENT_BG, color: ACCENT, border: `1px solid ${ACCENT_BORDER}` }
                : { background: "#e8f0e9", color: "#2D5A3D", border: "1px solid #c2dbc5" }}>
              {isAppt ? "Appt" : "Activity"}
            </span>
          </div>
          <p className="text-xs text-[#7a6f65] mt-0.5">{item.sub}</p>
          {item.location && <p className="text-[11px] text-[#b5aca4] mt-0.5">📍 {item.location}</p>}
          <div className="flex flex-wrap gap-1 mt-1">{renderChildChips(item.childIds)}</div>
        </div>
        <div className="shrink-0 flex items-center gap-1 mt-0.5">
          {isDeleting ? (
            <>
              <button type="button" onClick={() => handleDelete(item.id, item.type)} className="text-[11px] font-medium text-red-500 px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100">Delete</button>
              <button type="button" onClick={() => setDeleteConfirm(null)} className="text-[11px] text-[#7a6f65] px-2 py-1">Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setDeleteConfirm({ id: item.id, type: item.type })} className="w-7 h-7 rounded-full flex items-center justify-center text-[#c8c0b8] hover:text-red-400 hover:bg-red-50 transition-colors">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[92vh] bg-[#faf8f4] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col z-10">
        {/* Header */}
        <div className="shrink-0 border-b border-[#e8e2d9] px-5 py-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>Manage schedule</h2>
          <button onClick={onClose} className="text-[#b5aca4] hover:text-[#7a6f65] transition-colors p-1"><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex border-b border-[#e8e2d9]">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex-1 text-center py-2.5 text-[13px] font-medium transition-colors relative"
              style={{ color: tab === t.key ? ACCENT : "#7a6f65" }}>
              {t.label}
              {tab === t.key && <span className="absolute bottom-0 left-1/4 right-1/4 h-[2px] rounded-full" style={{ background: ACCENT }} />}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-[#b5aca4] text-center py-12">Loading...</p>
          ) : tab === "recurring" ? (
            <div className="divide-y divide-[#f0ede8]">
              {recurringAppts.length === 0 && activities.length === 0 ? (
                <p className="text-sm text-[#b5aca4] text-center py-12">No recurring items yet</p>
              ) : (
                <>
                  {recurringAppts.map((a) => renderRow({ id: a.id, emoji: a.emoji, title: a.title, sub: freqLabel(a) + (a.time ? ` · ${formatTime12(a.time)}` : ""), badge: "appt", location: a.location, childIds: a.child_ids, type: "appt" }))}
                  {activities.map((a) => renderRow({ id: a.id, emoji: a.emoji || "📝", title: a.name, sub: actFreqLabel(a) + (a.scheduled_start_time ? ` · ${formatTime12(a.scheduled_start_time)}` : "") + ` · ${a.duration_minutes >= 60 ? `${(a.duration_minutes / 60).toFixed(a.duration_minutes % 60 ? 1 : 0)} hr` : `${a.duration_minutes} min`}`, badge: "activity", location: null, childIds: a.child_ids, type: "activity" }))}
                </>
              )}
            </div>
          ) : tab === "upcoming" ? (
            <div className="divide-y divide-[#f0ede8]">
              {upcomingAppts.length === 0 ? (
                <p className="text-sm text-[#b5aca4] text-center py-12">No upcoming appointments</p>
              ) : (
                upcomingAppts.map((a) => renderRow({ id: a.id, emoji: a.emoji, title: a.title, sub: `${formatDateShort(a.instance_date ?? a.date)}${a.time ? ` · ${formatTime12(a.time)}` : " · All day"}`, badge: "appt", location: a.location, childIds: a.child_ids, type: "appt" }))
              )}
            </div>
          ) : (
            <div className="divide-y divide-[#f0ede8]">
              {pastAppts.length === 0 ? (
                <p className="text-sm text-[#b5aca4] text-center py-12">No completed appointments this week</p>
              ) : (
                pastAppts.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-3 opacity-50">
                    <span className="text-base shrink-0 mt-0.5">{a.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-[#2d2926] line-through">{a.title}</span>
                      <p className="text-xs text-[#7a6f65] mt-0.5">{formatDateShort(a.date)}{a.time ? ` · ${formatTime12(a.time)}` : ""}</p>
                    </div>
                    <span className="text-[10px] text-[#b5aca4] mt-1">Done</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Floating add button */}
        <div className="shrink-0 p-4 border-t border-[#e8e2d9]">
          <button type="button" onClick={() => { onClose(); onAddAppt(); }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-medium transition-colors"
            style={{ background: ACCENT }}>
            <Plus size={16} /> New appointment
          </button>
        </div>
      </div>
    </div>
  );
}
