"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHILD_COLORS = [
  "#5c7f63", "#7a9e7e", "#4a7a8a",
  "#5a5c8a", "#c4956a", "#c4697a",
];

const GRADE_OPTIONS = [
  "Pre-K", "Kindergarten",
  "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade",
  "6th Grade", "7th Grade", "8th Grade",
  "9th Grade", "10th Grade", "11th Grade", "12th Grade",
];

const SUBJECT_CHIPS = ["Math", "Reading", "Language Arts", "Science", "History", "Art", "Other"];

const SUBJECT_TILES: { name: string; emoji: string }[] = [
  { name: "Math",              emoji: "🔢" },
  { name: "Reading",           emoji: "📖" },
  { name: "Language Arts",     emoji: "✏️" },
  { name: "Science",           emoji: "🔬" },
  { name: "History",           emoji: "🏛️" },
  { name: "Art",               emoji: "🎨" },
  { name: "Music",             emoji: "🎵" },
  { name: "PE",                emoji: "⚽" },
  { name: "Bible / Faith",     emoji: "📿" },
  { name: "Writing",           emoji: "📝" },
  { name: "Foreign Language",  emoji: "🌍" },
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── Types ────────────────────────────────────────────────────────────────────

type ChildDraft = {
  uid: number;
  name: string;
  color: string;
  grade: string;
};

type CurriculumDraft = {
  curricName: string;
  subjects: string[];
  totalLessons: number;
  schoolDays: boolean[];
  childUid: number;
};

type ScheduleRow = { date: string; title: string };

type ChildSchedule = {
  childUid: number;
  draft: CurriculumDraft;
  schedule: ScheduleRow[];
};

let seq = 0;
const mkChild = (index = 0): ChildDraft => ({
  uid: ++seq, name: "", color: CHILD_COLORS[index % CHILD_COLORS.length], grade: "",
});

const freshDraft = (childUid: number): CurriculumDraft => ({
  curricName: "", subjects: [], totalLessons: 0,
  schoolDays: [true, true, true, true, true, false, false],
  childUid,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function generateSchedule(draft: CurriculumDraft): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  if (!draft.totalLessons || draft.totalLessons <= 0) return rows;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let lessonNum = 1;
  let safety = 0;
  while (lessonNum <= draft.totalLessons && safety < 3650) {
    const dayIdx = (cursor.getDay() + 6) % 7;
    if (draft.schoolDays[dayIdx]) {
      rows.push({ date: toDateStr(cursor), title: `${draft.curricName.trim()} — Lesson ${lessonNum}` });
      lessonNum++;
    }
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }
  return rows;
}

// ─── Shared layout ────────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`w-full max-w-md mx-auto bg-[#fefcf9] rounded-3xl shadow-xl border border-[#f0ede8] p-8 sm:p-10 ${className}`}>
      {children}
    </div>
  );
}

function StepHeading({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="text-center mb-8">
      {eyebrow && (
        <p className="text-xs font-semibold tracking-[0.25em] uppercase text-[#7a9e7e] mb-3">{eyebrow}</p>
      )}
      <h2 className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-3 leading-snug" style={{ fontFamily: "var(--font-display)" }}>
        {title}
      </h2>
      {sub && <p className="text-sm text-[#7a6f65] leading-relaxed">{sub}</p>}
    </div>
  );
}

function ContinueBtn({ label = "Continue →", onClick, disabled = false }: { label?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full py-4 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-base transition-all hover:shadow-md active:scale-[0.98]"
    >
      {label}
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start mb-2 text-sm text-[#7a6f65] hover:text-[#2d2926] transition-colors flex items-center gap-1"
    >
      ← Back
    </button>
  );
}

function ProgressDots({ step, total = 6 }: { step: number; total?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div
          key={s}
          className="rounded-full transition-all duration-300"
          style={{
            width: 8, height: 8,
            backgroundColor: s < step ? "#5c7f63" : s === step ? "#3d5c42" : "#e8e2d9",
          }}
        />
      ))}
    </div>
  );
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

const CONF_COLORS = ["#5c7f63","#7aaa78","#c9a84c","#c4956a","#7a9e7e","#4a7a8a","#f0d99b","#c4697a"];

function Confetti() {
  const pieces = useRef(
    Array.from({ length: 50 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 2.5 + Math.random() * 2.5,
      color: CONF_COLORS[Math.floor(Math.random() * CONF_COLORS.length)],
      w: 6 + Math.random() * 7,
      rotate: Math.random() * 360,
    }))
  ).current;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute top-0 rounded-sm"
          style={{
            left: `${p.left}%`, width: p.w, height: p.w * 0.5,
            backgroundColor: p.color, opacity: 0,
            animation: `confFall ${p.duration}s ${p.delay}s ease-in infinite`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
      <style>{`
        @keyframes confFall {
          0%   { opacity:1; transform: translateY(-8px) rotate(0deg); }
          100% { opacity:0; transform: translateY(100vh) rotate(540deg); }
        }
      `}</style>
    </div>
  );
}

// ─── Step 1 — Family Name + Children ─────────────────────────────────────────

function ChildRow({
  child, onChange, onRemove, showRemove,
}: {
  child: ChildDraft;
  onChange: (patch: Partial<ChildDraft>) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  return (
    <div className="bg-[#f8f5f0] rounded-2xl p-4 space-y-3 border border-[#ede8de]">
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold"
          style={{ backgroundColor: child.color }}
        >
          {child.name ? child.name.charAt(0).toUpperCase() : "?"}
        </div>
        <input
          type="text"
          value={child.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onBlur={(e) => onChange({ name: e.target.value.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") })}
          placeholder="Child's name"
          autoFocus={child.uid === 1}
          style={{ textTransform: "capitalize" }}
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
        />
        {showRemove && (
          <button type="button" onClick={onRemove}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#c8bfb5] hover:text-red-400 hover:bg-red-50 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 pl-14">
        <select
          value={child.grade}
          onChange={(e) => onChange({ grade: e.target.value })}
          className="flex-1 px-3 pr-8 py-2 rounded-xl border border-[#e8e2d9] bg-white text-xs text-[#2d2926] focus:outline-none focus:border-[#5c7f63] transition appearance-none"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237a6f65' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}
        >
          <option value="">Grade (optional)</option>
          {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <div className="flex items-center gap-1.5 shrink-0">
          {CHILD_COLORS.map((c) => (
            <button
              key={c} type="button" onClick={() => onChange({ color: c })}
              className="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 focus:outline-none"
              style={{ backgroundColor: c, borderColor: child.color === c ? "#2d2926" : "transparent" }}
            >
              {child.color === c && <Check size={8} className="text-white" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Step 0 — Opening ───────────────────────────────────────────────────────

function StepOpening({ onNext }: { onNext: () => void }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: "#1a3d24" }}
    >
      <div className="flex flex-col items-center text-center max-w-sm w-full">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/50 mb-6">
          Rooted
        </p>
        <div className="w-10 h-px bg-white/20 mb-8" />
        <h1
          className="text-3xl sm:text-[2.5rem] font-bold text-white mb-5 leading-snug"
          style={{ fontFamily: "var(--font-display)" }}
        >
          The homeschool years go by so fast.
        </h1>
        <p className="text-white/60 text-base leading-relaxed mb-12 max-w-xs">
          Rooted helps you plan your days, capture the moments, and hold onto it all.
        </p>
        <button
          type="button"
          onClick={onNext}
          className="px-9 py-4 rounded-2xl bg-white text-[#1a3d24] hover:bg-white/90 font-semibold text-lg transition-all shadow-2xl hover:scale-105 active:scale-100"
        >
          Let&apos;s get started →
        </button>
      </div>
    </div>
  );
}

// ─── Step 1 — Family & Kids ─────────────────────────────────────────────────

function StepFamilyAndKids({
  familyName, onFamilyNameChange,
  children, onChildChange, onAddChild, onRemoveChild,
  onNext,
}: {
  familyName: string;
  onFamilyNameChange: (v: string) => void;
  children: ChildDraft[];
  onChildChange: (uid: number, patch: Partial<ChildDraft>) => void;
  onAddChild: () => void;
  onRemoveChild: (uid: number) => void;
  onNext: () => void;
}) {
  const [showError, setShowError] = useState(false);
  const hasValid = children.some((c) => c.name.trim().length > 0);

  function handleNext() {
    if (!hasValid) { setShowError(true); return; }
    onNext();
  }

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <ProgressDots step={1} />
      <Card>
        <StepHeading
          eyebrow="Step 1 of 6"
          title="Tell us about your family"
          sub="We'll use this to personalize your experience."
        />

        {/* Family name */}
        <div className="mb-6">
          <label className="text-xs font-medium text-[#7a6f65] block mb-2">Family name (optional)</label>
          <input
            type="text"
            value={familyName}
            onChange={(e) => onFamilyNameChange(e.target.value)}
            placeholder="e.g. The Smith Family"
            className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
          />
        </div>

        {/* Children */}
        <label className="text-xs font-medium text-[#7a6f65] block mb-2">Your children</label>
        <div className="space-y-3 mb-4">
          {children.map((child) => (
            <ChildRow
              key={child.uid}
              child={child}
              onChange={(patch) => onChildChange(child.uid, patch)}
              onRemove={() => onRemoveChild(child.uid)}
              showRemove={children.length > 1}
            />
          ))}
        </div>

        {showError && !hasValid && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-3">
            Please add at least one child to continue.
          </p>
        )}

        {children.length < 8 && (
          <button
            type="button"
            onClick={onAddChild}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[#c8ddb8] bg-[#f0f7f0] hover:bg-[#e8f2e8] text-sm font-medium text-[#5c7f63] transition-colors mb-6"
          >
            <Plus size={15} /> Add another child
          </button>
        )}

        <ContinueBtn onClick={handleNext} />
      </Card>
    </div>
  );
}

// ─── Step 2 — First Memory Photo ─────────────────────────────────────────────

function StepFirstMemory({
  onNext, onSkip, onBack, userId,
}: {
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
  userId: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleFile(file: File) {
    setPhotoFile(file);
    setPreviewUrl(URL.createObjectURL(file));

    // Upload immediately
    setSaving(true);
    const path = `${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error } = await supabase.storage
      .from("memory-photos")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (!error) {
      const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
      const today = toDateStr(new Date());
      await supabase.from("app_events").insert({
        user_id: userId,
        type: "memory_photo",
        payload: {
          photo_url: urlData.publicUrl,
          title: "Our first memory",
          date: today,
        },
      });
      setSaved(true);
    }
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <BackBtn onClick={onBack} />
      <ProgressDots step={2} />
      <Card>
        <StepHeading
          eyebrow="Step 2 of 6"
          title="Capture your first memory 📸"
          sub="A photo of your setup, a project, anything from your homeschool. It only takes a second."
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (e.target) e.target.value = "";
            if (f) handleFile(f);
          }}
        />

        {!previewUrl ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-3 py-12 rounded-2xl border-2 border-dashed border-[#c8ddb8] bg-[#f0f7f0] hover:bg-[#e8f2e8] hover:border-[#5c7f63] transition-all mb-6"
          >
            <div className="w-16 h-16 rounded-full bg-[#5c7f63] flex items-center justify-center shadow-lg">
              <Camera size={28} className="text-white" />
            </div>
            <span className="text-base font-semibold text-[#5c7f63]">Take or choose a photo</span>
            <span className="text-xs text-[#7a6f65]">Tap to open your camera or photo library</span>
          </button>
        ) : (
          <div className="mb-6 space-y-4">
            <div className="relative rounded-2xl overflow-hidden">
              <img src={previewUrl} alt="Your first memory" className="w-full max-h-64 object-cover" />
              {saving && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-white border-t-transparent animate-spin" />
                </div>
              )}
              {!saving && (
                <button
                  onClick={() => { setPhotoFile(null); setPreviewUrl(null); setSaved(false); }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {saved && (
              <div className="bg-[#e8f0e9] border border-[#c8ddb8] rounded-2xl px-4 py-3 text-center">
                <p className="text-sm font-semibold text-[#3d5c42]">
                  Beautiful! Your story starts here. 🌱
                </p>
              </div>
            )}
          </div>
        )}

        {saved ? (
          <ContinueBtn label="Next →" onClick={onNext} />
        ) : (
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-center text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors py-3 font-medium"
          >
            Skip for now →
          </button>
        )}
      </Card>
    </div>
  );
}

// ─── Step 3 — School Days ────────────────────────────────────────────────────

function StepSchoolDays({
  schoolDays, onChange, onNext, onBack,
}: {
  schoolDays: boolean[];
  onChange: (days: boolean[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  function toggleDay(idx: number) {
    const next = [...schoolDays];
    next[idx] = !next[idx];
    onChange(next);
  }

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <BackBtn onClick={onBack} />
      <ProgressDots step={3} />
      <Card>
        <StepHeading
          eyebrow="Step 3 of 6"
          title="Which days do you do school?"
          sub="This helps us schedule your lessons automatically."
        />

        <div className="grid grid-cols-7 gap-2 mb-8">
          {DAY_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleDay(i)}
              className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all ${
                schoolDays[i]
                  ? "border-[#5c7f63] bg-[#e8f0e9]"
                  : "border-[#e8e2d9] bg-white hover:border-[#c8bfb5]"
              }`}
            >
              <span className={`text-xs font-bold ${schoolDays[i] ? "text-[#3d5c42]" : "text-[#b5aca4]"}`}>
                {label}
              </span>
              {schoolDays[i] && (
                <div className="w-4 h-4 rounded-full bg-[#5c7f63] flex items-center justify-center">
                  <Check size={10} className="text-white" strokeWidth={3} />
                </div>
              )}
            </button>
          ))}
        </div>

        <ContinueBtn onClick={onNext} />
      </Card>
    </div>
  );
}

// ─── Step 4 — Subjects ──────────────────────────────────────────────────────

function StepSubjects({
  childNames, selectedSubjects, onChange, onNext, onSkip, onBack,
}: {
  childNames: string[];
  selectedSubjects: string[];
  onChange: (subjects: string[]) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [customSubject, setCustomSubject] = useState("");

  function toggle(name: string) {
    onChange(
      selectedSubjects.includes(name)
        ? selectedSubjects.filter((s) => s !== name)
        : [...selectedSubjects, name]
    );
  }

  function addCustom() {
    const trimmed = customSubject.trim();
    if (trimmed && !selectedSubjects.includes(trimmed)) {
      onChange([...selectedSubjects, trimmed]);
    }
    setCustomSubject("");
  }

  const prompt = childNames.length === 1
    ? `What does ${childNames[0]} study?`
    : "What subjects does your family study?";

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <BackBtn onClick={onBack} />
      <ProgressDots step={4} total={6} />
      <Card>
        <StepHeading
          eyebrow="Step 4 of 6"
          title={prompt}
          sub="Tap all that apply — you can change these later."
        />

        <div className="grid grid-cols-3 gap-2 mb-4">
          {SUBJECT_TILES.map((tile) => {
            const active = selectedSubjects.includes(tile.name);
            return (
              <button
                key={tile.name}
                type="button"
                onClick={() => toggle(tile.name)}
                className={`flex flex-col items-center gap-1.5 py-3.5 px-2 rounded-2xl border-2 transition-all text-center ${
                  active
                    ? "border-[#5c7f63] bg-[#e8f0e9]"
                    : "border-[#e8e2d9] bg-white hover:border-[#c8bfb5]"
                }`}
              >
                <span className="text-xl">{tile.emoji}</span>
                <span className={`text-[11px] font-medium leading-tight ${active ? "text-[#3d5c42]" : "text-[#7a6f65]"}`}>
                  {tile.name}
                </span>
                {active && (
                  <div className="w-4 h-4 rounded-full bg-[#5c7f63] flex items-center justify-center">
                    <Check size={10} className="text-white" strokeWidth={3} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Add your own */}
        <div className="flex gap-2 mb-6">
          <input
            type="text"
            value={customSubject}
            onChange={(e) => setCustomSubject(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
            placeholder="Add your own..."
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!customSubject.trim()}
            className="px-4 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Custom subject pills */}
        {selectedSubjects.filter((s) => !SUBJECT_TILES.some((t) => t.name === s)).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {selectedSubjects.filter((s) => !SUBJECT_TILES.some((t) => t.name === s)).map((s) => (
              <span key={s} className="text-xs font-medium bg-[#e8f0e9] text-[#3d5c42] px-3 py-1.5 rounded-full flex items-center gap-1.5">
                {s}
                <button type="button" onClick={() => toggle(s)} className="hover:text-red-500 transition-colors">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <ContinueBtn
          onClick={onNext}
          disabled={selectedSubjects.length === 0}
          label={`Continue with ${selectedSubjects.length} subject${selectedSubjects.length !== 1 ? "s" : ""} →`}
        />
        <button
          type="button"
          onClick={onSkip}
          className="w-full text-center text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors py-3 mt-2 font-medium"
        >
          Skip for now →
        </button>
      </Card>
    </div>
  );
}

// ─── Curriculum Library (simplified) ─────────────────────────────────────────

type LibraryCurric = { name: string; subject: string; lessons: number; days: boolean[] };

const MF: boolean[] = [true,true,true,true,true,false,false];
const MWF: boolean[] = [true,false,true,false,true,false,false];
const MTTF: boolean[] = [true,true,true,true,false,false,false];

const FILTER_SUBJECTS = ["All","Math","Reading","Language Arts","Science","History","Bible"];

const CURRICULUM_LIBRARY: LibraryCurric[] = [
  { name: "Saxon Math",                              subject: "Math",          lessons: 120, days: MF   },
  { name: "Math-U-See",                              subject: "Math",          lessons: 120, days: MF   },
  { name: "The Good and the Beautiful Math",          subject: "Math",          lessons: 120, days: MF   },
  { name: "Singapore Math",                           subject: "Math",          lessons:  90, days: MF   },
  { name: "RightStart Mathematics",                   subject: "Math",          lessons: 120, days: MTTF },
  { name: "Teaching Textbooks",                       subject: "Math",          lessons: 120, days: MF   },
  { name: "Beast Academy",                            subject: "Math",          lessons:  80, days: MF   },
  { name: "Horizons Math",                            subject: "Math",          lessons: 160, days: MF   },
  { name: "Abeka Math",                               subject: "Math",          lessons: 170, days: MF   },
  { name: "Life of Fred",                             subject: "Math",          lessons:  60, days: MWF  },
  { name: "CTCMath",                                  subject: "Math",          lessons: 100, days: MF   },
  { name: "Math Mammoth",                             subject: "Math",          lessons: 100, days: MF   },
  { name: "Shiller Math",                             subject: "Math",          lessons:  80, days: MF   },
  { name: "All About Reading",                        subject: "Reading",       lessons:  60, days: MTTF },
  { name: "The Good and the Beautiful Reading",       subject: "Reading",       lessons: 120, days: MF   },
  { name: "Explode the Code",                         subject: "Reading",       lessons:  80, days: MF   },
  { name: "Teach Your Child to Read in 100 Easy Lessons", subject: "Reading", lessons: 100, days: MF   },
  { name: "Bob Books",                                subject: "Reading",       lessons:  60, days: MTTF },
  { name: "Sonlight Reading",                         subject: "Reading",       lessons:  36, days: MF   },
  { name: "All About Spelling",                       subject: "Language Arts", lessons:  48, days: MTTF },
  { name: "The Good and the Beautiful Language Arts",  subject: "Language Arts", lessons: 120, days: MF   },
  { name: "First Language Lessons",                   subject: "Language Arts", lessons: 100, days: MF   },
  { name: "Easy Grammar",                             subject: "Language Arts", lessons: 140, days: MF   },
  { name: "IEW",                                      subject: "Language Arts", lessons:  30, days: MWF  },
  { name: "Apologia Science",                         subject: "Science",       lessons:  96, days: MF   },
  { name: "Elemental Science",                        subject: "Science",       lessons:  36, days: MF   },
  { name: "Mystery Science",                          subject: "Science",       lessons:  40, days: MF   },
  { name: "The Good and the Beautiful Science",       subject: "Science",       lessons: 120, days: MF   },
  { name: "Story of the World",                       subject: "History",       lessons:  42, days: MF   },
  { name: "Sonlight History",                         subject: "History",       lessons:  36, days: MF   },
  { name: "Mystery of History",                       subject: "History",       lessons:  84, days: MF   },
  { name: "The Good and the Beautiful History",       subject: "History",       lessons: 120, days: MF   },
  { name: "Grapevine Studies",                        subject: "Bible",         lessons:  30, days: MF   },
  { name: "The Good and the Beautiful Bible",         subject: "Bible",         lessons: 120, days: MF   },
];

// ─── Step 4 — Curriculum (Optional) ──────────────────────────────────────────

function StepCurriculum({
  schoolDays, validChildren,
  onAddCurriculum, onSkip, onBack,
}: {
  schoolDays: boolean[];
  validChildren: ChildDraft[];
  onAddCurriculum: (draft: CurriculumDraft, schedule: ScheduleRow[]) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<"pick" | "form">("pick");
  const [filterSubject, setFilterSubject] = useState("All");
  const [search, setSearch] = useState("");

  // Form state
  const [curricName, setCurricName] = useState("");
  const [subject, setSubject] = useState("");
  const [totalLessons, setTotalLessons] = useState("");
  const [childUid, setChildUid] = useState(validChildren[0]?.uid ?? 0);
  const [added, setAdded] = useState<string[]>([]);

  const filtered = useMemo(() => {
    let list = CURRICULUM_LIBRARY;
    if (filterSubject !== "All") list = list.filter((c) => c.subject === filterSubject);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [filterSubject, search]);

  function pickFromLibrary(item: LibraryCurric) {
    setCurricName(item.name);
    setSubject(item.subject);
    setTotalLessons(String(item.lessons));
    setMode("form");
  }

  function handleAdd() {
    if (!curricName.trim()) return;
    const draft: CurriculumDraft = {
      curricName: curricName.trim(),
      subjects: subject ? [subject] : [],
      totalLessons: parseInt(totalLessons) || 0,
      schoolDays,
      childUid,
    };
    const schedule = generateSchedule(draft);
    onAddCurriculum(draft, schedule);
    setAdded((prev) => [...prev, curricName.trim()]);
    // Reset for next
    setCurricName("");
    setSubject("");
    setTotalLessons("");
    setMode("pick");
  }

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <BackBtn onClick={onBack} />
      <ProgressDots step={5} />
      <Card className="!max-w-lg">
        <StepHeading
          eyebrow="Step 5 of 6"
          title="Want to add your curriculum now?"
          sub="You can always do this later from your Plan page."
        />

        {/* Added curricula badges */}
        {added.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {added.map((name) => (
              <span key={name} className="text-xs font-medium bg-[#e8f0e9] text-[#3d5c42] px-3 py-1.5 rounded-full">
                ✓ {name}
              </span>
            ))}
          </div>
        )}

        {mode === "pick" ? (
          <>
            {/* Search */}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search curricula..."
              className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] mb-3"
            />

            {/* Subject filters */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {FILTER_SUBJECTS.map((s) => (
                <button key={s} type="button" onClick={() => setFilterSubject(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    filterSubject === s ? "bg-[#5c7f63] text-white" : "bg-[#f0ede8] text-[#7a6f65] hover:bg-[#e8e2d9]"
                  }`}>
                  {s}
                </button>
              ))}
            </div>

            {/* Library list */}
            <div className="max-h-48 overflow-y-auto space-y-1.5 mb-4 border border-[#e8e2d9] rounded-xl p-2">
              {filtered.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => pickFromLibrary(item)}
                  disabled={added.includes(item.name)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    added.includes(item.name)
                      ? "bg-[#e8f0e9] text-[#5c7f63] opacity-60"
                      : "hover:bg-[#f0f7f0] text-[#2d2926]"
                  }`}
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="text-[10px] text-[#b5aca4] ml-2">{item.subject} · {item.lessons} lessons</span>
                </button>
              ))}
            </div>

            {/* Manual entry link */}
            <button
              type="button"
              onClick={() => setMode("form")}
              className="w-full text-center text-sm text-[#5c7f63] hover:text-[#3d5c42] font-medium mb-6 py-2"
            >
              + Add something not listed
            </button>
          </>
        ) : (
          /* Manual / pre-filled form */
          <div className="space-y-4 mb-6">
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1">Curriculum name</label>
              <input
                type="text" value={curricName} onChange={(e) => setCurricName(e.target.value)}
                placeholder="e.g. Saxon Math"
                className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1">Subject</label>
              <div className="flex flex-wrap gap-2">
                {SUBJECT_CHIPS.map((s) => (
                  <button key={s} type="button" onClick={() => setSubject(s === subject ? "" : s)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      subject === s ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1">Total lessons (optional)</label>
              <input
                type="number" value={totalLessons} onChange={(e) => setTotalLessons(e.target.value)}
                placeholder="e.g. 120"
                className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]"
              />
            </div>
            {validChildren.length > 1 && (
              <div>
                <label className="text-xs font-medium text-[#7a6f65] block mb-1">For which child?</label>
                <div className="flex flex-wrap gap-2">
                  {validChildren.map((c) => (
                    <button key={c.uid} type="button" onClick={() => setChildUid(c.uid)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        childUid === c.uid ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"
                      }`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setMode("pick")}
                className="flex-1 py-3 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
                ← Back
              </button>
              <button type="button" onClick={handleAdd} disabled={!curricName.trim()}
                className="flex-1 py-3 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white text-sm font-semibold transition-colors">
                Add curriculum
              </button>
            </div>
          </div>
        )}

        {/* Two equal buttons */}
        <div className="space-y-3">
          {added.length > 0 && (
            <ContinueBtn label={`Done — ${added.length} added →`} onClick={onSkip} />
          )}
          <button
            type="button"
            onClick={onSkip}
            className="w-full py-4 rounded-2xl bg-[#e8f0e9] hover:bg-[#d4ead6] text-[#3d5c42] font-semibold text-base transition-all active:scale-[0.98]"
          >
            {added.length > 0 ? "Skip adding more →" : "Go to my dashboard →"}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Step 5 — Done ───────────────────────────────────────────────────────────

function StepDone({
  saving, onDone, noCurriculumNote,
}: {
  saving: boolean;
  onDone: () => void;
  noCurriculumNote: boolean;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "linear-gradient(155deg, #1a3d24 0%, #2a5533 45%, #3d7a50 80%, #4d8f63 100%)" }}
    >
      <Confetti />
      <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full">
        <span className="text-6xl mb-6">🌱</span>
        <h1
          className="text-3xl sm:text-4xl font-bold text-white mb-4 leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          You&apos;re all set!
        </h1>
        <p className="text-[#c8ddb8] text-base leading-relaxed mb-3 max-w-xs">
          Your homeschool is officially rooted. Time to watch it grow.
        </p>
        {noCurriculumNote && (
          <p className="text-[#a0cc9a] text-sm mb-4 max-w-xs">
            You can add your curriculum anytime from the Plan page. 🌿
          </p>
        )}

        {/* Founder closing moment */}
        <div className="mt-4 mb-8 flex flex-col items-center">
          <div
            className="w-14 h-14 rounded-full bg-[#2d5c38] flex items-center justify-center text-white text-xl font-bold shadow-lg mb-4"
            style={{ fontFamily: "var(--font-display)" }}
          >
            B
          </div>
          <p
            className="text-white/85 text-sm leading-relaxed italic mb-2 max-w-[280px]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            &ldquo;I built Rooted for families exactly like yours. If you ever have a question — just reply to any email from me. I read every one.&rdquo;
          </p>
          <p className="text-[#a0cc9a] text-xs font-semibold">— Brittany, founder 🌱</p>
        </div>

        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="flex items-center gap-2.5 px-9 py-4 rounded-2xl bg-white text-[#2d5c38] font-semibold text-lg hover:bg-[#f5fbf5] transition-all shadow-2xl hover:scale-105 active:scale-100 disabled:opacity-60"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-[#2d5c38] border-t-transparent animate-spin" />
              Setting up...
            </span>
          ) : (
            "Go to your dashboard →"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Auth-sourced
  const [firstName, setFirstName] = useState("");

  // Step 1 state
  const [familyDisplayName, setFamilyDisplayName] = useState("");
  const [children, setChildren] = useState<ChildDraft[]>([mkChild()]);

  // Step 3 state
  const [schoolDays, setSchoolDays] = useState<boolean[]>([true, true, true, true, true, false, false]);

  // Step 4 state (subjects)
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [skippedSubjects, setSkippedSubjects] = useState(false);

  // Step 5 state (curriculum)
  const [childSchedules, setChildSchedules] = useState<ChildSchedule[]>([]);
  const [noCurriculumNote, setNoCurriculumNote] = useState(false);

  // ── Auth + onboarded check ────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, onboarded")
        .eq("id", user.id)
        .maybeSingle();

      if ((profile as { onboarded?: boolean | null } | null)?.onboarded === true) {
        router.replace("/dashboard");
        return;
      }

      const fn = user.user_metadata?.first_name ?? "";
      const rawLn = user.user_metadata?.last_name ?? "";
      const ln = rawLn ? rawLn.charAt(0).toUpperCase() + rawLn.slice(1).toLowerCase() : "";
      setFirstName(fn);
      setFamilyDisplayName(profile?.display_name ?? (ln ? `The ${ln} Family` : ""));
      setUserId(user.id);
      setReady(true);
    });
  }, [router]);

  // ── Children helpers ──────────────────────────────────────────────────────

  const updateChild = useCallback((uid: number, patch: Partial<ChildDraft>) => {
    setChildren((prev) => prev.map((c) => c.uid === uid ? { ...c, ...patch } : c));
  }, []);

  const removeChild = useCallback((uid: number) => {
    setChildren((prev) => prev.filter((c) => c.uid !== uid));
  }, []);

  // ── Curriculum handler ────────────────────────────────────────────────────

  function handleAddCurriculum(draft: CurriculumDraft, schedule: ScheduleRow[]) {
    setChildSchedules((prev) => [...prev, { childUid: draft.childUid, draft, schedule }]);
  }

  // ── Complete onboarding ───────────────────────────────────────────────────

  const complete = useCallback(async () => {
    setSaving(true);
    setSaveError("");
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";

    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser || currentUser.id !== userId) {
      setSaveError("Something went wrong. Please try again.");
      setSaving(false);
      return;
    }

    // Insert children
    const validKids = children.filter((c) => c.name.trim().length > 0);
    const insertedChildren: { uid: number; id: string }[] = [];
    for (const [i, child] of validKids.entries()) {
      const { data: inserted } = await supabase
        .from("children")
        .insert({
          user_id: userId,
          name: child.name.trim(),
          color: child.color,
          sort_order: i + 1,
          archived: false,
          name_key: child.name.trim().toLowerCase().replace(/\s+/g, "_"),
        })
        .select("id")
        .single();
      if (inserted) insertedChildren.push({ uid: child.uid, id: (inserted as { id: string }).id });
    }

    // Save subjects (from Step 4)
    if (selectedSubjects.length > 0) {
      for (const subjectName of selectedSubjects) {
        const { data: existing } = await supabase
          .from("subjects").select("id").eq("user_id", userId).eq("name", subjectName).maybeSingle();
        if (!existing) {
          await supabase.from("subjects").insert({ user_id: userId, name: subjectName });
        }
      }
    }

    // Save curriculum goals + lessons
    for (const cs of childSchedules) {
      if (cs.schedule.length === 0 || !cs.draft.curricName.trim()) continue;
      const targetChild = insertedChildren.find((c) => c.uid === cs.childUid) ?? insertedChildren[0];
      const childId = targetChild?.id ?? null;

      let subjectId: string | null = null;
      if (cs.draft.subjects.length > 0) {
        const subjectName = cs.draft.subjects[0];
        const { data: existingSub } = await supabase
          .from("subjects").select("id").eq("user_id", userId).eq("name", subjectName).maybeSingle();
        if (existingSub) {
          subjectId = (existingSub as { id: string }).id;
        } else {
          const { data: newSub } = await supabase
            .from("subjects").insert({ user_id: userId, name: subjectName }).select("id").single();
          subjectId = newSub ? (newSub as { id: string }).id : null;
        }
      }

      const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const schoolDayNames = dayNames.filter((_, i) => cs.draft.schoolDays[i]);
      const totalLessons = cs.schedule.length;

      const { data: goal, error: goalErr } = await supabase
        .from("curriculum_goals")
        .insert({
          user_id: userId,
          child_id: childId,
          curriculum_name: cs.draft.curricName.trim(),
          subject_label: cs.draft.subjects[0] ?? null,
          total_lessons: totalLessons,
          current_lesson: 0,
          target_date: null,
          school_days: schoolDayNames,
        })
        .select("id")
        .single();

      if (goalErr || !goal) continue;

      const rows = cs.schedule.map((row, idx) => ({
        user_id: userId,
        child_id: childId,
        subject_id: subjectId,
        title: row.title,
        date: row.date,
        scheduled_date: row.date,
        completed: false,
        hours: 0,
        curriculum_goal_id: (goal as { id: string }).id,
        lesson_number: idx + 1,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from("lessons").insert(rows.slice(i, i + 100));
      }
    }

    // Save school days to profile
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const schoolDayNames = dayNames.filter((_, i) => schoolDays[i]);

    // Update profile
    const profilePatch: Record<string, unknown> = {
      onboarded: true,
      school_days: schoolDayNames,
    };
    if (familyDisplayName.trim()) profilePatch.display_name = familyDisplayName.trim();

    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify(profilePatch),
    });

    router.push("/dashboard");
    setSaving(false);
  }, [children, userId, childSchedules, selectedSubjects, familyDisplayName, schoolDays, router]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex items-center justify-center">
        <span className="text-4xl animate-[pulse_1.5s_ease-in-out_infinite]">🌱</span>
      </div>
    );
  }

  if (step === 0) return <StepOpening onNext={() => setStep(1)} />;

  if (step === 1) return (
    <StepFamilyAndKids
      familyName={familyDisplayName}
      onFamilyNameChange={setFamilyDisplayName}
      children={children}
      onChildChange={updateChild}
      onAddChild={() => setChildren((p) => [...p, mkChild(p.length)])}
      onRemoveChild={removeChild}
      onNext={() => setStep(2)}
    />
  );

  if (step === 2) return (
    <StepFirstMemory
      onNext={() => setStep(3)}
      onSkip={() => setStep(3)}
      onBack={() => setStep(1)}
      userId={userId}
    />
  );

  if (step === 3) return (
    <StepSchoolDays
      schoolDays={schoolDays}
      onChange={setSchoolDays}
      onNext={() => setStep(4)}
      onBack={() => setStep(2)}
    />
  );

  if (step === 4) {
    const validKids = children.filter((c) => c.name.trim());
    const childNames = validKids.map((c) => c.name.trim());
    return (
      <StepSubjects
        childNames={childNames}
        selectedSubjects={selectedSubjects}
        onChange={setSelectedSubjects}
        onNext={() => setStep(5)}
        onSkip={() => { setSkippedSubjects(true); setStep(5); }}
        onBack={() => setStep(3)}
      />
    );
  }

  if (step === 5) {
    const validKids = children.filter((c) => c.name.trim());
    return (
      <StepCurriculum
        schoolDays={schoolDays}
        validChildren={validKids}
        onAddCurriculum={handleAddCurriculum}
        onSkip={() => {
          if (childSchedules.length === 0) setNoCurriculumNote(true);
          setStep(6);
        }}
        onBack={() => setStep(4)}
      />
    );
  }

  return (
    <>
      <StepDone
        saving={saving}
        onDone={complete}
        noCurriculumNote={noCurriculumNote}
      />
      {saveError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2.5rem)] max-w-sm">
          <div className="bg-red-600 text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-lg flex items-center justify-between gap-3">
            <span>{saveError}</span>
            <button type="button" onClick={() => setSaveError("")}
              className="shrink-0 text-white/80 hover:text-white transition-colors">
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
