"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Types ───────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  token: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCENT = "#7C3AED";
const ACCENT_BG = "#f5f0ff";
const ACCENT_BORDER = "#c4b5fd";

const PRESETS = [
  { emoji: "🩺", name: "Doctor" },
  { emoji: "🦷", name: "Dentist" },
  { emoji: "🧠", name: "Therapy" },
  { emoji: "👁️", name: "Eye Doctor" },
  { emoji: "📋", name: "Evaluation" },
  { emoji: "🏫", name: "School Meeting" },
  { emoji: "🎵", name: "Lessons/Class" },
  { emoji: "✨", name: "Custom" },
];

const DURATION_OPTIONS = [
  { label: "30m", value: 30 },
  { label: "1hr", value: 60 },
  { label: "1.5hr", value: 90 },
  { label: "2hr", value: 120 },
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

const FREQ_OPTIONS: { label: string; value: "weekly" | "biweekly" | "monthly" }[] = [
  { label: "Weekly", value: "weekly" },
  { label: "Every 2 weeks", value: "biweekly" },
  { label: "Monthly", value: "monthly" },
];

function formatTime12(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AppointmentWizard({ isOpen, onClose, onSaved, token }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [children, setChildren] = useState<Child[]>([]);

  // Step 1
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [emoji, setEmoji] = useState("📅");
  const [title, setTitle] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");
  const [customTitle, setCustomTitle] = useState("");

  // Step 2
  const [date, setDate] = useState(todayStr());
  const [allDay, setAllDay] = useState(true);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [customDuration, setCustomDuration] = useState("");
  const [location, setLocation] = useState("");
  const [justMe, setJustMe] = useState(true);
  const [childIds, setChildIds] = useState<string[]>([]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<"weekly" | "biweekly" | "monthly">("weekly");
  const [days, setDays] = useState<number[]>([]);
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("children").select("id, name, color")
        .eq("user_id", user.id).eq("archived", false).order("sort_order");
      setChildren(data ?? []);
    })();
    // Reset state on open
    setStep(1); setSelectedType(null); setEmoji("📅"); setTitle("");
    setCustomEmoji(""); setCustomTitle(""); setDate(todayStr());
    setAllDay(true); setTime(""); setDuration(60); setCustomDuration("");
    setLocation(""); setJustMe(true); setChildIds([]); setIsRecurring(false);
    setFrequency("weekly"); setDays([]); setNotes(""); setSaving(false); setSaved(false);
  }, [isOpen]);

  if (!isOpen) return null;

  function pickType(preset: typeof PRESETS[number]) {
    setSelectedType(preset.name);
    if (preset.name !== "Custom") {
      setEmoji(preset.emoji);
      setTitle(preset.name);
    }
  }

  function goToStep2() {
    if (selectedType === "Custom") {
      setEmoji(customEmoji.trim() || "📅");
      setTitle(customTitle.trim());
    }
    setStep(2);
  }

  const canProceedStep1 = selectedType && (selectedType !== "Custom" || customTitle.trim());
  function toggleChild(id: string) {
    setJustMe(false);
    setChildIds((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);
  }

  function selectJustMe() { setJustMe(true); setChildIds([]); }
  function toggleDay(idx: number) { setDays((prev) => prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx]); }
  const effectiveDuration = customDuration ? (parseInt(customDuration) || 60) : duration;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title, emoji, date,
          time: allDay ? null : (time || null),
          duration_minutes: effectiveDuration,
          location: location.trim() || null,
          notes: notes.trim() || null,
          child_ids: justMe ? [] : childIds,
          is_recurring: isRecurring,
          recurrence_rule: isRecurring ? { frequency, days } : null,
        }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
        setTimeout(() => { setSaved(false); onClose(); }, 900);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  const dateLabel = date ? new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const timeLabel = allDay ? "All day" : (time ? formatTime12(time) : "No time set");
  const whoLabel = justMe ? "Just me" : (childIds.length === 0 ? "No one selected" : childIds.map((id) => children.find((c) => c.id === id)?.name).filter(Boolean).join(", "));

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[92vh] bg-[#faf8f4] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-y-auto z-10">
        {/* Header */}
        <div className="sticky top-0 bg-[#faf8f4] border-b border-[#e8e2d9] px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: ACCENT_BG, color: ACCENT, border: `1px solid ${ACCENT_BORDER}` }}>
              Appt
            </span>
            <h2 className="text-base font-medium text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
              {step === 1 && "New appointment"}
              {step === 2 && `${emoji} ${title}`}
              {step === 3 && "Review"}
            </h2>
          </div>
          <button onClick={onClose} className="text-[#b5aca4] hover:text-[#7a6f65] transition-colors p-1"><X size={20} /></button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-5 pt-3 pb-1">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex-1 h-1 rounded-full transition-colors" style={{ background: step >= s ? ACCENT : "#e8e2d9" }} />
          ))}
        </div>

        <div className="p-5">
          {/* ═══ STEP 1 — Type Picker ═══ */}
          {step === 1 && (
            <div>
              <p className="text-sm text-[#7a6f65] mb-4">What kind of appointment?</p>
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                {PRESETS.map((p) => {
                  const active = selectedType === p.name;
                  return (
                    <button key={p.name} onClick={() => pickType(p)}
                      className="flex items-center gap-2.5 rounded-xl p-3 text-left transition-all"
                      style={{ border: active ? `1.5px solid ${ACCENT}` : "1.5px solid #e0ddd8", background: active ? ACCENT_BG : "white" }}>
                      <span className="text-xl">{p.emoji}</span>
                      <span className="text-sm font-medium" style={{ color: active ? ACCENT : "#2d2926" }}>{p.name}</span>
                    </button>
                  );
                })}
              </div>

              {selectedType === "Custom" && (
                <div className="rounded-xl p-3 space-y-2 mb-4" style={{ border: "1.5px dashed #e0ddd8", background: "white" }}>
                  <div className="flex gap-2">
                    <input type="text" placeholder="Emoji" value={customEmoji} onChange={(e) => setCustomEmoji(e.target.value)}
                      className="w-14 text-center text-lg border border-[#e8e2d9] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#7C3AED]" maxLength={4} />
                    <input type="text" placeholder="Appointment name" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)}
                      className="flex-1 text-sm border border-[#e8e2d9] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-[#7C3AED]" autoFocus />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mt-6">
                <button onClick={onClose} className="text-sm text-[#7a6f65] hover:text-[#2d2926] transition-colors">Cancel</button>
                <button onClick={goToStep2} disabled={!canProceedStep1}
                  className="px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-40" style={{ background: ACCENT }}>
                  Next &rarr;
                </button>
              </div>
            </div>
          )}

          {/* ═══ STEP 2 — Details ═══ */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Date */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74] block mb-1.5">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="w-full border-[1.5px] border-[#e8e5e0] rounded-xl py-3 px-3.5 text-[14px] bg-white text-[#2d2926] focus:outline-none focus:border-[#7C3AED]" />
              </div>

              {/* Time */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74]">Time</label>
                  <button onClick={() => setAllDay(!allDay)} className="relative rounded-full transition-colors" style={{ width: 40, height: 22, background: allDay ? ACCENT : "#e8e5e0" }}>
                    <span className="absolute top-[3px] bg-white rounded-full shadow transition-all" style={{ width: 16, height: 16, left: allDay ? 21 : 3 }} />
                  </button>
                </div>
                {allDay ? (
                  <p className="text-xs text-[#7a6f65]">All-day appointment</p>
                ) : (
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                    className="text-sm border border-[#e8e2d9] rounded-xl px-3 py-2.5 bg-white text-[#2d2926] focus:outline-none focus:border-[#7C3AED]" />
                )}
              </div>

              {/* Duration */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74] block mb-1.5">Duration</label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map((opt) => (
                    <button key={opt.value} onClick={() => { setDuration(opt.value); setCustomDuration(""); }}
                      className={`rounded-full py-2 px-4 text-[13px] font-medium transition-all ${!customDuration && duration === opt.value ? "text-white border" : "bg-white text-[#5C5346] border border-[#e8e5e0]"}`}
                      style={!customDuration && duration === opt.value ? { background: ACCENT, borderColor: ACCENT } : undefined}>
                      {opt.label}
                    </button>
                  ))}
                  {customDuration !== "" ? (
                    <div className="flex items-center gap-1.5">
                      <input type="number" value={customDuration} onChange={(e) => setCustomDuration(e.target.value)}
                        className="w-16 text-[13px] text-center rounded-full px-2 py-2 bg-white focus:outline-none" style={{ border: `1.5px solid ${ACCENT}` }} min={5} autoFocus />
                      <span className="text-[13px] text-[#8B7E74]">min</span>
                    </div>
                  ) : (
                    <button onClick={() => setCustomDuration("45")} className="rounded-full py-2 px-4 text-[13px] font-medium text-[#8B7E74] border border-dashed border-[#e8e5e0]">Custom</button>
                  )}
                </div>
              </div>

              {/* Location */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74] block mb-1.5">Location (optional)</label>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., Dr. Smith's office"
                  className="w-full border-[1.5px] border-[#e8e5e0] rounded-xl py-3 px-3.5 text-[14px] bg-white text-[#2d2926] placeholder:text-[#c8c0b8] focus:outline-none focus:border-[#7C3AED]" />
              </div>

              {/* Who */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74] block mb-1.5">Who is this for?</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={selectJustMe}
                    className="rounded-full px-3.5 py-2 text-xs font-medium transition-all"
                    style={{ background: justMe ? ACCENT : "white", color: justMe ? "white" : "#2d2926", border: justMe ? `1.5px solid ${ACCENT}` : "1.5px solid #e0ddd8" }}>
                    Just me
                  </button>
                  {children.map((c) => {
                    const sel = childIds.includes(c.id);
                    return (
                      <button key={c.id} onClick={() => toggleChild(c.id)}
                        className="rounded-full px-3.5 py-2 text-xs font-medium transition-all"
                        style={{ background: sel ? (c.color || ACCENT) : "white", color: sel ? "white" : "#2d2926", border: sel ? `1.5px solid ${c.color || ACCENT}` : "1.5px solid #e0ddd8" }}>
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Recurring */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74]">Recurring?</label>
                  <button onClick={() => setIsRecurring(!isRecurring)} className="relative rounded-full transition-colors" style={{ width: 40, height: 22, background: isRecurring ? ACCENT : "#e8e5e0" }}>
                    <span className="absolute top-[3px] bg-white rounded-full shadow transition-all" style={{ width: 16, height: 16, left: isRecurring ? 21 : 3 }} />
                  </button>
                </div>
                {isRecurring && (
                  <div className="space-y-3 mt-2">
                    <div className="flex flex-wrap gap-2">
                      {FREQ_OPTIONS.map((opt) => (
                        <button key={opt.value} onClick={() => setFrequency(opt.value)}
                          className={`rounded-full py-2 px-4 text-[13px] font-medium transition-all ${frequency === opt.value ? "text-white border" : "bg-white text-[#5C5346] border border-[#e8e5e0]"}`}
                          style={frequency === opt.value ? { background: ACCENT, borderColor: ACCENT } : undefined}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 justify-center">
                      {DAY_LABELS.map((label, idx) => {
                        const active = days.includes(idx);
                        return (
                          <button key={idx} onClick={() => toggleDay(idx)}
                            className="flex items-center justify-center text-xs font-medium transition-all"
                            style={{ width: 38, height: 38, borderRadius: "50%", background: active ? ACCENT : "white", color: active ? "white" : "#5C5346", border: active ? `1.5px solid ${ACCENT}` : "1.5px solid #e8e5e0" }}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74] block mb-1.5">Notes (optional)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember..."
                  rows={2} className="w-full border-[1.5px] border-[#e8e5e0] rounded-xl py-3 px-3.5 text-[14px] bg-white text-[#2d2926] placeholder:text-[#c8c0b8] focus:outline-none focus:border-[#7C3AED] resize-none" />
              </div>

              {/* Nav */}
              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep(1)} className="text-sm text-[#8B7E74] hover:text-[#2d2926] transition-colors">&larr; Back</button>
                <button onClick={() => setStep(3)} disabled={!date}
                  className="px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-40" style={{ background: ACCENT }}>
                  Review &rarr;
                </button>
              </div>
            </div>
          )}

          {/* ═══ STEP 3 — Review ═══ */}
          {step === 3 && (
            <div>
              {saved ? (
                <div className="py-10 text-center">
                  <span className="text-4xl">{emoji}</span>
                  <p className="text-lg font-medium text-[#2d2926] mt-3" style={{ fontFamily: "var(--font-display)" }}>Saved!</p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl p-4 space-y-2 mb-6" style={{ background: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}` }}>
                    <p className="text-base font-medium text-[#2d2926]">{emoji} {title}</p>
                    <p className="text-sm text-[#5C5346]">{dateLabel} &middot; {timeLabel}</p>
                    {effectiveDuration && <p className="text-sm text-[#5C5346]">{effectiveDuration >= 60 ? `${(effectiveDuration / 60).toFixed(effectiveDuration % 60 ? 1 : 0)} hr` : `${effectiveDuration} min`}</p>}
                    {location && <p className="text-sm text-[#7a6f65]">📍 {location}</p>}
                    <p className="text-sm text-[#7a6f65]">👤 {whoLabel}</p>
                    {isRecurring && <p className="text-sm text-[#7a6f65]">🔄 {FREQ_OPTIONS.find((f) => f.value === frequency)?.label}{days.length > 0 ? ` on ${days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}` : ""}</p>}
                    {notes && <p className="text-sm text-[#7a6f65] italic">&ldquo;{notes}&rdquo;</p>}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button onClick={handleSave} disabled={saving}
                      className="w-full py-3 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50" style={{ background: ACCENT }}>
                      {saving ? "Saving..." : "Save appointment"}
                    </button>
                    <button onClick={() => setStep(2)} className="text-sm text-[#8B7E74] hover:text-[#2d2926] transition-colors text-center">&larr; Back</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
