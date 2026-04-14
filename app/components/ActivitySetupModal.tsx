"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };
type CurriculumGoal = {
  id: string;
  curriculum_name: string;
  scheduled_start_time?: string | null;
};

type ActivityType = {
  emoji: string;
  name: string;
  isCustom?: boolean;
};

type ActivityConfig = {
  emoji: string;
  name: string;
  frequency: "once" | "weekly" | "biweekly" | "monthly";
  days: number[];
  durationMinutes: number;
  customDuration: string;
  startTime: string;
  hasStartTime: boolean;
  childIds: string[];
  onceDate: string;
};

interface Props {
  onClose: () => void;
  onSaved: () => void;
  schoolYearId?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_ACTIVITIES: ActivityType[] = [
  { emoji: "\u{1F3EB}", name: "Co-op" },
  { emoji: "\u{1F3C3}", name: "Sports/PE" },
  { emoji: "\u{1F3B5}", name: "Music" },
  { emoji: "\u{1F4BB}", name: "Coding" },
  { emoji: "\u{1F3A8}", name: "Art Class" },
  { emoji: "\u{1F310}", name: "Language" },
  { emoji: "\u{1F4DD}", name: "Tutoring" },
];

const DAY_LABELS = ["M", "T", "W", "Th", "F", "Sa", "Su"];
const DAY_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DURATION_OPTIONS = [
  { label: "30m", value: 30 },
  { label: "1hr", value: 60 },
  { label: "2hr", value: 120 },
  { label: "3hr", value: 180 },
];

const FREQUENCY_OPTIONS: { label: string; value: "once" | "weekly" | "biweekly" | "monthly" }[] = [
  { label: "Just once", value: "once" },
  { label: "Weekly", value: "weekly" },
  { label: "Every other week", value: "biweekly" },
  { label: "Monthly", value: "monthly" },
];

function formatTime12(time24: string): string {
  if (!time24) return "";
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function addMinutesToTime(time24: string, mins: number): string {
  if (!time24) return "";
  const [h, m] = time24.split(":").map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function buildScheduleSummary(cfg: ActivityConfig): string {
  const dur =
    cfg.durationMinutes >= 60
      ? `${Math.floor(cfg.durationMinutes / 60)} hour${Math.floor(cfg.durationMinutes / 60) > 1 ? "s" : ""}${cfg.durationMinutes % 60 > 0 ? ` ${cfg.durationMinutes % 60}m` : ""}`
      : `${cfg.durationMinutes} min`;
  const time = cfg.hasStartTime && cfg.startTime ? ` at ${formatTime12(cfg.startTime)}` : "";

  if (cfg.frequency === "once") {
    const dateLabel = cfg.onceDate
      ? new Date(cfg.onceDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "today";
    return `${cfg.emoji} ${cfg.name}: ${dateLabel}${time} for ${dur}`;
  }

  const dayNames = cfg.days.map((d) => DAY_FULL[d]);
  const freq =
    cfg.frequency === "weekly"
      ? `every ${dayNames.join(", ")}`
      : cfg.frequency === "biweekly"
      ? `every other ${dayNames.join(", ")}`
      : `monthly on ${dayNames.join(", ")}`;
  return `${cfg.emoji} ${cfg.name}: ${freq}${time} for ${dur}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActivitySetupModal({ onClose, onSaved, schoolYearId }: Props) {
  const [step, setStep] = useState<"pick" | "configure" | "review">("pick");
  const [children, setChildren] = useState<Child[]>([]);
  const [curriculumGoals, setCurriculumGoals] = useState<CurriculumGoal[]>([]);
  const [userId, setUserId] = useState("");

  // Step 1 — pick
  const [selectedTypes, setSelectedTypes] = useState<ActivityType[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");

  // Step 2 — configure
  const [configs, setConfigs] = useState<ActivityConfig[]>([]);
  const [configIdx, setConfigIdx] = useState(0);

  // Step 3 — review
  const [showLessonTimes, setShowLessonTimes] = useState(false);
  const [lessonTimes, setLessonTimes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Load children + goals + user
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const [{ data: kids }, { data: goals }] = await Promise.all([
        supabase.from("children").select("id, name, color").eq("user_id", user.id).eq("archived", false).order("sort_order"),
        supabase.from("curriculum_goals").select("id, curriculum_name, scheduled_start_time").eq("user_id", user.id).order("created_at"),
      ]);
      setChildren(kids ?? []);
      setCurriculumGoals((goals as CurriculumGoal[]) ?? []);
      const timesInit: Record<string, string> = {};
      for (const g of (goals ?? []) as CurriculumGoal[]) {
        if (g.scheduled_start_time) timesInit[g.id] = g.scheduled_start_time;
      }
      setLessonTimes(timesInit);
    })();
  }, []);

  // ── Step 1 handlers ─────────────────────────────────────────────────────

  function toggleActivity(act: ActivityType) {
    setSelectedTypes((prev) => {
      const exists = prev.find((a) => a.name === act.name);
      if (exists) return prev.filter((a) => a.name !== act.name);
      return [...prev, act];
    });
  }

  function addCustomActivity() {
    if (!customName.trim()) return;
    const act: ActivityType = {
      emoji: customEmoji.trim() || "\u{1F4CB}",
      name: customName.trim(),
      isCustom: true,
    };
    setSelectedTypes((prev) => [...prev, act]);
    setCustomName("");
    setCustomEmoji("");
    setShowCustom(false);
  }

  function goToConfigure() {
    if (selectedTypes.length === 0) return;
    const todayDate = new Date();
    const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
    const initial: ActivityConfig[] = selectedTypes.map((t) => ({
      emoji: t.emoji,
      name: t.name,
      frequency: "weekly" as const,
      days: [],
      durationMinutes: 60,
      customDuration: "",
      startTime: "",
      hasStartTime: false,
      childIds: children.map((c) => c.id),
      onceDate: todayStr,
    }));
    setConfigs(initial);
    setConfigIdx(0);
    setStep("configure");
  }

  // ── Step 2 handlers ─────────────────────────────────────────────────────

  function updateConfig(patch: Partial<ActivityConfig>) {
    setConfigs((prev) =>
      prev.map((c, i) => (i === configIdx ? { ...c, ...patch } : c))
    );
  }

  function toggleDay(dayIdx: number) {
    const current = configs[configIdx].days;
    const next = current.includes(dayIdx)
      ? current.filter((d) => d !== dayIdx)
      : [...current, dayIdx];
    updateConfig({ days: next });
  }

  function toggleChild(childId: string) {
    const current = configs[configIdx].childIds;
    const next = current.includes(childId)
      ? current.filter((id) => id !== childId)
      : [...current, childId];
    updateConfig({ childIds: next });
  }

  function nextActivity() {
    if (configIdx < configs.length - 1) {
      setConfigIdx(configIdx + 1);
    } else {
      setStep("review");
    }
  }

  function prevActivity() {
    if (configIdx > 0) {
      setConfigIdx(configIdx - 1);
    } else {
      setStep("pick");
    }
  }

  // ── Step 3 — save ──────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      // Separate one-time vs recurring configs
      const recurringConfigs = configs.filter(c => c.frequency !== "once");
      const onceConfigs = configs.filter(c => c.frequency === "once");

      // Insert recurring activities
      if (recurringConfigs.length > 0) {
        const rows = recurringConfigs.map((cfg) => ({
          user_id: userId,
          name: cfg.name,
          emoji: cfg.emoji,
          frequency: cfg.frequency,
          days: cfg.days,
          duration_minutes: cfg.durationMinutes,
          scheduled_start_time: cfg.hasStartTime && cfg.startTime ? cfg.startTime : null,
          child_ids: cfg.childIds,
          is_active: true,
          school_year_id: schoolYearId || null,
        }));

        const { error } = await supabase.from("activities").insert(rows);
        if (error) {
          console.error("Failed to save recurring activities:", error);
          setSaving(false);
          return;
        }
      }

      // Handle one-time activities: create activity + immediate log
      for (const cfg of onceConfigs) {
        const { data: actRow, error: actErr } = await supabase.from("activities").insert({
          user_id: userId,
          name: cfg.name,
          emoji: cfg.emoji,
          frequency: "weekly",
          days: [],
          duration_minutes: cfg.durationMinutes,
          scheduled_start_time: cfg.hasStartTime && cfg.startTime ? cfg.startTime : null,
          child_ids: cfg.childIds,
          is_active: false, // Not recurring — mark inactive so it doesn't show on future days
          school_year_id: schoolYearId || null,
        }).select("id").single();

        if (actErr || !actRow) {
          console.error("Failed to save one-time activity:", actErr);
          continue;
        }

        // Create the activity_log for the specific date
        await supabase.from("activity_logs").insert({
          activity_id: actRow.id,
          user_id: userId,
          date: cfg.onceDate,
          minutes_spent: cfg.durationMinutes,
          completed: true,
          completed_at: new Date().toISOString(),
          school_year_id: schoolYearId || null,
        });
      }

      // Update curriculum goal times if toggled
      if (showLessonTimes) {
        for (const [goalId, time] of Object.entries(lessonTimes)) {
          if (time) {
            await supabase
              .from("curriculum_goals")
              .update({ scheduled_start_time: time })
              .eq("id", goalId);
          }
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to save activities:", err);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const cfg = configs[configIdx] ?? null;
  const effectiveDuration =
    cfg && cfg.customDuration
      ? parseInt(cfg.customDuration) || cfg.durationMinutes
      : cfg?.durationMinutes ?? 60;

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[92vh] bg-[#faf8f4] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-y-auto z-10">
        {/* Header */}
        <div className="sticky top-0 bg-[#faf8f4] border-b border-[#e8e2d9] px-5 py-4 flex items-center justify-between z-10">
          <h2
            className="text-base font-semibold text-[var(--g-deep)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {step === "pick" && "Add Activities"}
            {step === "configure" && `Set Up ${cfg?.emoji} ${cfg?.name}`}
            {step === "review" && "Review & Save"}
          </h2>
          <button
            onClick={onClose}
            className="text-[#b5aca4] hover:text-[#7a6f65] transition-colors p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {/* ══════════════════════════════════════════════════
              STEP 1 — Pick Activity Type
          ══════════════════════════════════════════════════ */}
          {step === "pick" && (
            <div>
              <p className="text-sm text-[#7a6f65] mb-4">
                Choose the activities your family does outside of curriculum.
              </p>

              {/* Grid */}
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                {PRESET_ACTIVITIES.map((act) => {
                  const selected = selectedTypes.some((a) => a.name === act.name);
                  return (
                    <button
                      key={act.name}
                      onClick={() => toggleActivity(act)}
                      className="flex items-center gap-2.5 rounded-xl p-3 text-left transition-all"
                      style={{
                        border: selected
                          ? "1.5px solid #2D5A3D"
                          : "1.5px solid #e0ddd8",
                        background: selected ? "#f0f6f1" : "white",
                      }}
                    >
                      <span className="text-xl">{act.emoji}</span>
                      <span
                        className="text-sm font-medium"
                        style={{ color: selected ? "#2D5A3D" : "#2d2926" }}
                      >
                        {act.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-[#8B7E74] mt-2 px-1">
                Logging a field trip? Use <strong>Capture a Memory</strong> for one-time activities like field trips — you can log hours there too!
              </p>

              {/* Custom activity cards already selected */}
              {selectedTypes
                .filter((a) => a.isCustom)
                .map((act) => (
                  <div
                    key={act.name}
                    className="flex items-center gap-2.5 rounded-xl p-3 mb-2 transition-all"
                    style={{ border: "1.5px solid #2D5A3D", background: "#f0f6f1" }}
                  >
                    <span className="text-xl">{act.emoji}</span>
                    <span className="text-sm font-medium text-[#2D5A3D] flex-1">
                      {act.name}
                    </span>
                    <button
                      onClick={() =>
                        setSelectedTypes((prev) =>
                          prev.filter((a) => a.name !== act.name)
                        )
                      }
                      className="text-[#b5aca4] hover:text-[#7a6f65] text-sm"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}

              {/* + Add custom */}
              {!showCustom ? (
                <button
                  onClick={() => setShowCustom(true)}
                  className="w-full rounded-xl p-3 text-sm font-medium text-[#5c7f63] text-center transition-colors hover:bg-[#f0f6f1]"
                  style={{ border: "1.5px dashed #e0ddd8" }}
                >
                  + Add custom activity
                </button>
              ) : (
                <div
                  className="rounded-xl p-3 space-y-2"
                  style={{ border: "1.5px dashed #e0ddd8", background: "white" }}
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Emoji"
                      value={customEmoji}
                      onChange={(e) => setCustomEmoji(e.target.value)}
                      className="w-14 text-center text-lg border border-[#e8e2d9] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#5c7f63]"
                      maxLength={4}
                    />
                    <input
                      type="text"
                      placeholder="Activity name"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="flex-1 text-sm border border-[#e8e2d9] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-[#5c7f63]"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={addCustomActivity}
                      disabled={!customName.trim()}
                      className="flex-1 text-sm font-medium py-1.5 rounded-lg bg-[#5c7f63] text-white disabled:opacity-40 hover:bg-[var(--g-deep)] transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setShowCustom(false);
                        setCustomName("");
                        setCustomEmoji("");
                      }}
                      className="text-sm text-[#7a6f65] px-3 py-1.5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Counter */}
              {selectedTypes.length > 0 && (
                <p className="text-xs text-[#5c7f63] font-medium text-center mt-4">
                  You selected {selectedTypes.length} activit{selectedTypes.length === 1 ? "y" : "ies"}
                </p>
              )}

              {/* Buttons */}
              <div className="flex items-center justify-between mt-6">
                <button
                  onClick={onClose}
                  className="text-sm text-[#7a6f65] hover:text-[#2d2926] transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={goToConfigure}
                  disabled={selectedTypes.length === 0}
                  className="px-5 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold transition-colors disabled:opacity-40"
                >
                  Set up activities &rarr;
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              STEP 2 — Configure Each Activity
          ══════════════════════════════════════════════════ */}
          {step === "configure" && cfg && (
            <div>
              <p className="text-xs text-[#b5aca4] font-medium mb-4">
                Activity {configIdx + 1} of {configs.length}
              </p>

              {/* Frequency */}
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] block mb-2">
                How often?
              </label>
              <div className="flex flex-wrap gap-2 mb-5">
                {FREQUENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateConfig({ frequency: opt.value })}
                    className={`rounded-full py-2 px-4 text-[13px] font-medium transition-all ${
                      cfg.frequency === opt.value
                        ? "bg-[#2D5A3D] text-white border border-[#2D5A3D]"
                        : "bg-white text-[#5C5346] border border-[#e8e5e0]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Which days (hidden for "once") */}
              {cfg.frequency !== "once" && (
                <>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] block mb-2">
                    Which days?
                  </label>
                  <div className="flex gap-2 mb-5 justify-center">
                    {DAY_LABELS.map((label, idx) => {
                      const active = cfg.days.includes(idx);
                      return (
                        <button
                          key={idx}
                          onClick={() => toggleDay(idx)}
                          className={`flex items-center justify-center text-xs font-medium transition-all ${
                            active
                              ? "bg-[#2D5A3D] text-white border border-[#2D5A3D]"
                              : "bg-white text-[#5C5346] border border-[#e8e5e0]"
                          }`}
                          style={{ width: 40, height: 40, borderRadius: "50%" }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Date picker for "once" */}
              {cfg.frequency === "once" && (
                <>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] block mb-2">
                    When?
                  </label>
                  <input
                    type="date"
                    value={cfg.onceDate}
                    onChange={(e) => updateConfig({ onceDate: e.target.value })}
                    className="w-full border-[1.5px] border-[#e8e5e0] rounded-xl py-3 px-3.5 text-[14px] bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 mb-5"
                  />
                </>
              )}

              {/* Duration */}
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] block mb-2">
                Duration
              </label>
              <div className="flex flex-wrap gap-2 mb-5">
                {DURATION_OPTIONS.map((opt) => {
                  const isSelected =
                    !cfg.customDuration && cfg.durationMinutes === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() =>
                        updateConfig({
                          durationMinutes: opt.value,
                          customDuration: "",
                        })
                      }
                      className={`rounded-full py-2 px-4 text-[13px] font-medium transition-all ${
                        isSelected
                          ? "bg-[#2D5A3D] text-white border border-[#2D5A3D]"
                          : "bg-white text-[#5C5346] border border-[#e8e5e0]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                {/* Custom */}
                {cfg.customDuration !== "" ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={cfg.customDuration}
                      onChange={(e) =>
                        updateConfig({
                          customDuration: e.target.value,
                          durationMinutes: parseInt(e.target.value) || 60,
                        })
                      }
                      className="w-16 text-[13px] text-center border border-[#2D5A3D] rounded-full px-2 py-2 bg-white focus:outline-none"
                      min={5}
                      autoFocus
                    />
                    <span className="text-[13px] text-[#8B7E74]">min</span>
                  </div>
                ) : (
                  <button
                    onClick={() => updateConfig({ customDuration: "45" })}
                    className="rounded-full py-2 px-4 text-[13px] font-medium text-[#8B7E74] transition-all border border-dashed border-[#e8e5e0]"
                  >
                    Custom
                  </button>
                )}
              </div>

              {/* Start time toggle */}
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74]">
                  Set a start time?
                </label>
                <button
                  onClick={() =>
                    updateConfig({ hasStartTime: !cfg.hasStartTime })
                  }
                  className="relative rounded-full transition-colors"
                  style={{
                    width: 40, height: 22,
                    background: cfg.hasStartTime ? "#2D5A3D" : "#e8e5e0",
                  }}
                >
                  <span
                    className="absolute top-[3px] bg-white rounded-full shadow transition-all"
                    style={{
                      width: 16, height: 16,
                      left: cfg.hasStartTime ? 21 : 3,
                    }}
                  />
                </button>
              </div>
              {cfg.hasStartTime && (
                <div className="mb-5">
                  <input
                    type="time"
                    value={cfg.startTime}
                    onChange={(e) => updateConfig({ startTime: e.target.value })}
                    className="text-sm border border-[#e8e2d9] rounded-xl px-3 py-2.5 bg-white text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                  />
                  {cfg.startTime && (
                    <p className="text-xs text-[#5c7f63] mt-1.5">
                      {formatTime12(cfg.startTime)} &ndash;{" "}
                      {formatTime12(addMinutesToTime(cfg.startTime, effectiveDuration))}{" "}
                      &middot; Auto-calculated from your {effectiveDuration >= 60 ? `${Math.floor(effectiveDuration / 60)}hr` : `${effectiveDuration}m`} duration
                    </p>
                  )}
                </div>
              )}
              {!cfg.hasStartTime && <div className="mb-5" />}

              {/* Which kids */}
              {children.length > 0 && (
                <>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] block mb-2">
                    Which kids?
                  </label>
                  <div className="flex flex-wrap gap-2 mb-5">
                    {children.map((child) => {
                      const selected = cfg.childIds.includes(child.id);
                      return (
                        <button
                          key={child.id}
                          onClick={() => toggleChild(child.id)}
                          className="rounded-full px-3.5 py-2 text-xs font-medium transition-all"
                          style={{
                            background: selected
                              ? child.color || "#2D5A3D"
                              : "white",
                            color: selected ? "white" : "#2d2926",
                            border: selected
                              ? `1.5px solid ${child.color || "#2D5A3D"}`
                              : "1.5px solid #e0ddd8",
                          }}
                        >
                          {child.name}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Smart preview */}
              {(cfg.frequency === "once" || cfg.days.length > 0) && (
                <div className="bg-[#f5f3ef] rounded-xl p-3 mb-5">
                  <p className="text-[13px] text-[#5C5346]">
                    {buildScheduleSummary({
                      ...cfg,
                      durationMinutes: effectiveDuration,
                    })}
                  </p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={prevActivity}
                  className="text-sm text-[#8B7E74] hover:text-[#2d2926] transition-colors"
                >
                  &larr; Back
                </button>
                <button
                  onClick={nextActivity}
                  className="px-6 py-3 rounded-xl bg-[#2D5A3D] hover:opacity-90 text-white text-sm font-semibold transition-colors"
                >
                  {configIdx < configs.length - 1
                    ? "Next activity \u2192"
                    : "Review \u2192"}
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              STEP 3 — Review & Save
          ══════════════════════════════════════════════════ */}
          {step === "review" && (
            <div>
              <p className="text-sm text-[#7a6f65] mb-4">
                Here&apos;s your activity schedule. You can edit any activity
                before saving.
              </p>

              {/* Summary cards */}
              <div className="space-y-3 mb-5">
                {configs.map((cfg, idx) => (
                  <div
                    key={idx}
                    className="bg-[#f5f3ef] rounded-xl p-4 flex items-start justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#2d2926]">
                        {cfg.emoji} {cfg.name}
                      </p>
                      <p className="text-xs text-[#7a6f65] mt-1">
                        {buildScheduleSummary(cfg)}
                      </p>
                      {cfg.childIds.length > 0 &&
                        cfg.childIds.length < children.length && (
                          <p className="text-xs text-[#b5aca4] mt-0.5">
                            {cfg.childIds
                              .map(
                                (id) =>
                                  children.find((c) => c.id === id)?.name
                              )
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                    </div>
                    <button
                      onClick={() => {
                        setConfigIdx(idx);
                        setStep("configure");
                      }}
                      className="text-xs font-medium text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors ml-3 shrink-0"
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>

              {/* Set lesson times toggle */}
              {curriculumGoals.length > 0 && (
                <div className="mb-5">
                  <div
                    className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors"
                    style={{
                      background: showLessonTimes ? "#f0f6f1" : "white",
                      border: showLessonTimes
                        ? "1px solid #c2dbc5"
                        : "1px solid #e8e2d9",
                    }}
                  >
                    <div>
                      <p className="text-sm font-medium text-[#2d2926]">
                        Set lesson times too?
                      </p>
                      <p className="text-xs text-[#7a6f65] mt-0.5">
                        Assign start times to your curriculum
                      </p>
                    </div>
                    <button
                      onClick={() => setShowLessonTimes(!showLessonTimes)}
                      className="relative rounded-full transition-colors"
                      style={{
                        width: 40, height: 22,
                        background: showLessonTimes ? "#2D5A3D" : "#e8e5e0",
                      }}
                    >
                      <span
                        className="absolute top-[3px] bg-white rounded-full shadow transition-all"
                        style={{ width: 16, height: 16, left: showLessonTimes ? 21 : 3 }}
                      />
                    </button>
                  </div>

                  {showLessonTimes && (
                    <div className="mt-3 space-y-2">
                      {curriculumGoals.map((goal) => (
                        <div
                          key={goal.id}
                          className="flex items-center gap-3 bg-white rounded-xl border border-[#e8e2d9] px-3 py-2.5"
                        >
                          <p className="text-sm text-[#2d2926] flex-1 truncate">
                            {goal.curriculum_name}
                          </p>
                          <input
                            type="time"
                            value={lessonTimes[goal.id] || ""}
                            onChange={(e) =>
                              setLessonTimes((prev) => ({
                                ...prev,
                                [goal.id]: e.target.value,
                              }))
                            }
                            className="text-sm border border-[#e8e2d9] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#5c7f63] w-28"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Buttons */}
              <div className="flex flex-col gap-2 mt-6">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full py-3 rounded-xl bg-[#2D5A3D] hover:opacity-90 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving\u2026" : "Save schedule \u2713"}
                </button>
                <button
                  onClick={() => {
                    setConfigIdx(configs.length - 1);
                    setStep("configure");
                  }}
                  className="text-sm text-[#8B7E74] hover:text-[#2d2926] transition-colors text-center"
                >
                  &larr; Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
