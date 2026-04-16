"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useCelebration, CelebrationCheckbox, CelebrationToast } from "./CompletionCelebration";

const ACCENT = "#7C3AED";
const ACCENT_BG = "#f5f0ff";
const ACCENT_BORDER = "#c4b5fd";

type AppointmentRow = {
  id: string;
  title: string;
  emoji: string;
  date: string;
  time: string | null;
  duration_minutes: number;
  location: string | null;
  child_ids: string[];
  completed: boolean;
  instance_date: string;
};

type Child = { id: string; name: string; color: string | null };

interface Props {
  appointments: AppointmentRow[];
  children: Child[];
  getToken: () => Promise<string | null>;
  onChanged: () => void;
  onAddNew: () => void;
}

function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export default function AppointmentsSection({ appointments, children, getToken, onChanged, onAddNew }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { activeId, toast, toastOut, celebrate } = useCelebration();

  async function toggleCompleted(appt: AppointmentRow) {
    const completing = !appt.completed;
    if (completing) celebrate(appt.id);
    const token = await getToken();
    if (!token) return;
    await fetch("/api/appointments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: appt.id, completed: !appt.completed }),
    });
    onChanged();
  }

  // Sort: all-day first, then by time, completed last
  const sorted = [...appointments].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.time === null && b.time !== null) return -1;
    if (a.time !== null && b.time === null) return 1;
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return 0;
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-0.5">
        <button type="button" onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">Appointments</p>
          {appointments.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: ACCENT_BG, color: ACCENT }}>
              {appointments.filter((a) => !a.completed).length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onAddNew}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0ebff] transition-colors"
          style={{ color: ACCENT }}
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Collapsible body */}
      <div
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{ maxHeight: collapsed ? "0px" : "800px", opacity: collapsed ? 0 : 1 }}
      >
        {sorted.length === 0 ? (
          <button
            type="button"
            onClick={onAddNew}
            className="w-full bg-white border border-[#e8e5e0] rounded-2xl py-5 text-center hover:bg-[#faf8f4] transition-colors"
          >
            <p className="text-sm text-[#b5aca4]">No appointments today</p>
            <p className="text-xs mt-1" style={{ color: ACCENT }}>+ Add one</p>
          </button>
        ) : (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
            {sorted.map((appt) => {
              const childNames = appt.child_ids.length === 0
                ? null
                : appt.child_ids.map((id) => children.find((c) => c.id === id)).filter(Boolean);

              return (
                <div
                  key={`${appt.id}-${appt.instance_date}`}
                  className={`flex items-start gap-3 px-4 py-3 relative transition-all duration-300 ${appt.completed ? "opacity-50" : ""}`}
                >
                  {activeId === appt.id && <CelebrationToast toast={toast} toastOut={toastOut} />}
                  {/* Checkbox */}
                  <div className="mt-0.5">
                    <CelebrationCheckbox
                      checked={appt.completed}
                      onToggle={() => toggleCompleted(appt)}
                      itemId={appt.id}
                      accentColor={ACCENT}
                      celebrating={activeId === appt.id}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm shrink-0">{appt.emoji}</span>
                      <span className={`text-sm font-medium truncate ${appt.completed ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                        {appt.title}
                      </span>
                      <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ background: ACCENT_BG, color: ACCENT, border: `1px solid ${ACCENT_BORDER}` }}>
                        Appt
                      </span>
                    </div>

                    {/* Time */}
                    <p className="text-xs text-[#7a6f65] mt-0.5">
                      {appt.time ? formatTime12(appt.time) : "All day"}
                      {appt.duration_minutes && appt.time ? ` \u00b7 ${appt.duration_minutes >= 60 ? `${(appt.duration_minutes / 60).toFixed(appt.duration_minutes % 60 ? 1 : 0)} hr` : `${appt.duration_minutes} min`}` : ""}
                    </p>

                    {/* Location */}
                    {appt.location && (
                      <p className="text-[11px] text-[#b5aca4] mt-0.5">📍 {appt.location}</p>
                    )}

                    {/* Who */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {appt.child_ids.length === 0 ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: ACCENT_BG, color: ACCENT }}>
                          Me
                        </span>
                      ) : (
                        childNames?.map((c) => (
                          <span key={c!.id} className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
                            style={{ background: c!.color || ACCENT }}>
                            {c!.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
