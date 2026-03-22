"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHILD_COLORS = [
  "#5c7f63", "#7a9e7e", "#4a7a8a",
  "#5a5c8a", "#c4956a", "#c4697a",
];

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
  "Outside the US",
];

const GRADE_OPTIONS = [
  "Pre-K", "Kindergarten",
  "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade",
  "6th Grade", "7th Grade", "8th Grade",
  "9th Grade", "10th Grade", "11th Grade", "12th Grade",
];

const SUBJECT_CHIPS = [
  "Math", "Reading", "Writing", "Language Arts", "Spelling", "Phonics",
  "Science", "History", "Geography", "Art", "Music", "Bible",
  "Physical Education", "Foreign Language", "Logic",
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
  schoolDays: boolean[]; // Mon–Sun
  finishDate: string;
  childUid: number;
};

type ScheduleRow = { date: string; title: string };

let seq = 0;
const mkChild = (): ChildDraft => ({
  uid: ++seq, name: "", color: CHILD_COLORS[0], grade: "",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function generateSchedule(draft: CurriculumDraft): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let lessonNum = 1;
  let safety = 0;
  while (lessonNum <= draft.totalLessons && safety < 3650) {
    const dayIdx = (cursor.getDay() + 6) % 7; // Mon=0, Sun=6
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
      <h2 className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-3 leading-snug" style={{ fontFamily: "Georgia, serif" }}>
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

function SkipLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-center text-sm text-[#b5aca4] hover:text-[#7a6f65] transition-colors mt-3 py-1"
    >
      Skip for now →
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

// ─── Progress dots ────────────────────────────────────────────────────────────

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1,2,3,4,5,6,7].map((s) => (
        <div
          key={s}
          className="rounded-full transition-all duration-300"
          style={{
            width: 8,
            height: 8,
            backgroundColor:
              s < step  ? "#5c7f63" :
              s === step ? "#3d5c42" : "#e8e2d9",
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
      left:     Math.random() * 100,
      delay:    Math.random() * 2,
      duration: 2.5 + Math.random() * 2.5,
      color:    CONF_COLORS[Math.floor(Math.random() * CONF_COLORS.length)],
      w:        6 + Math.random() * 7,
      rotate:   Math.random() * 360,
    }))
  ).current;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute top-0 rounded-sm"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.w * 0.5,
            backgroundColor: p.color,
            opacity: 0,
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

// ─── Step 1 — Welcome ─────────────────────────────────────────────────────────

function StepWelcome({ firstName, onNext }: { firstName: string; onNext: () => void }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "linear-gradient(155deg, #1a3d24 0%, #2a5533 45%, #3d7a50 80%, #4d8f63 100%)" }}
    >
      {/* Dot texture overlay */}
      <div className="absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

      <ProgressDots step={1} />

      <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full animate-[fadeUp_0.7s_ease-out_forwards]">
        <style>{`
          @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
          @keyframes drawStem { from { stroke-dashoffset: 90; } to { stroke-dashoffset: 0; } }
          @keyframes popLeaf { from { opacity:0; transform:scale(0) rotate(-15deg); } to { opacity:1; transform:scale(1) rotate(0deg); } }
          @keyframes popLeafR { from { opacity:0; transform:scale(0) rotate(15deg); } to { opacity:1; transform:scale(1) rotate(0deg); } }
          @keyframes popBud { from { opacity:0; transform:scale(0); } to { opacity:1; transform:scale(1); } }
        `}</style>

        {/* Animated plant SVG */}
        <svg width="110" height="130" viewBox="0 0 110 130" className="mb-8" aria-hidden>
          <ellipse cx="55" cy="118" rx="30" ry="8" fill="#1a3d24" opacity="0.4" />
          <path d="M55 115 Q55 80 55 40"
            stroke="#7aaa78" strokeWidth="4" strokeLinecap="round" fill="none"
            style={{ strokeDasharray: 90, strokeDashoffset: 90, animation: "drawStem 1s ease-out 0.4s forwards" }} />
          <ellipse cx="38" cy="80" rx="20" ry="9"
            fill="#5c9460" transform="rotate(-35, 38, 80)"
            style={{ transformOrigin: "55px 80px", opacity: 0, animation: "popLeaf 0.45s ease-out 1.1s forwards" }} />
          <ellipse cx="72" cy="64" rx="20" ry="9"
            fill="#7aaa78" transform="rotate(25, 72, 64)"
            style={{ transformOrigin: "55px 64px", opacity: 0, animation: "popLeafR 0.45s ease-out 1.3s forwards" }} />
          <ellipse cx="34" cy="52" rx="14" ry="7"
            fill="#4a8055" transform="rotate(-25, 34, 52)"
            style={{ transformOrigin: "55px 52px", opacity: 0, animation: "popLeaf 0.4s ease-out 1.5s forwards" }} />
          <circle cx="55" cy="38" r="9" fill="#a0cc9a"
            style={{ transformOrigin: "55px 38px", opacity: 0, animation: "popBud 0.4s ease-out 1.7s forwards" }} />
          <circle cx="55" cy="38" r="5" fill="#c8e8c0"
            style={{ transformOrigin: "55px 38px", opacity: 0, animation: "popBud 0.4s ease-out 1.9s forwards" }} />
        </svg>

        <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#a0cc9a] mb-4">
          Welcome to Rooted
        </p>
        <h1
          className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight"
          style={{ fontFamily: "Georgia, serif" }}
        >
          {firstName ? `Hello, ${firstName}! 🌿` : "Welcome! 🌿"}
        </h1>
        <p className="text-[#c8ddb8] text-base sm:text-lg leading-relaxed mb-2 max-w-xs">
          Your calm, beautiful homeschool companion.
        </p>
        <p className="text-[#a0cc9a] text-sm leading-relaxed mb-10 max-w-xs">
          Let&apos;s get you set up in 2 minutes.
        </p>

        <button
          onClick={onNext}
          className="flex items-center gap-2.5 px-9 py-4 rounded-2xl bg-white text-[#2d5c38] font-semibold text-lg hover:bg-[#f5fbf5] transition-all shadow-2xl hover:scale-105 active:scale-100"
        >
          Let&apos;s Go →
        </button>
      </div>
    </div>
  );
}

// ─── Step 2 — Family Name ─────────────────────────────────────────────────────

function StepFamilyName({
  value, onChange, onNext, onBack,
}: {
  value: string;
  onChange: (s: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <BackBtn onClick={onBack} />
      <ProgressDots step={2} />
      <Card>
        <StepHeading
          eyebrow="Step 2 of 7"
          title="What should we call your family?"
        />
        <div className="mb-6">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. The Smith Family"
            autoFocus
            className="w-full px-4 py-3.5 rounded-2xl border border-[#e8e2d9] bg-white text-[#2d2926] text-sm focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
          />
        </div>
        <ContinueBtn onClick={onNext} disabled={!value.trim()} />
      </Card>
    </div>
  );
}

// ─── Step 3 — State ───────────────────────────────────────────────────────────

function StepState({
  value, onChange, onNext, onSkip, onBack,
}: {
  value: string;
  onChange: (s: string) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <BackBtn onClick={onBack} />
      <ProgressDots step={3} />
      <Card>
        <StepHeading
          eyebrow="Step 3 of 7"
          title="Where do you homeschool?"
          sub="Helps us give you relevant tips and resources."
        />
        <div className="mb-6">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl border border-[#e8e2d9] bg-white text-[#2d2926] text-sm focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237a6f65' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center" }}
          >
            <option value="">Select your state…</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <ContinueBtn onClick={onNext} disabled={!value} label={value ? "Continue →" : "Select a state to continue"} />
        <SkipLink onClick={onSkip} />
      </Card>
    </div>
  );
}

// ─── Step 4 — Children ────────────────────────────────────────────────────────

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
        {/* Color initial bubble preview */}
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold"
          style={{ backgroundColor: child.color }}
        >
          {child.name ? child.name.charAt(0).toUpperCase() : "?"}
        </div>

        {/* Name */}
        <input
          type="text"
          value={child.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Child's name"
          autoFocus={child.uid === 1}
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
        />

        {showRemove && (
          <button type="button" onClick={onRemove}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#c8bfb5] hover:text-red-400 hover:bg-red-50 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Grade + Color row */}
      <div className="flex items-center gap-3 pl-14">
        <select
          value={child.grade}
          onChange={(e) => onChange({ grade: e.target.value })}
          className="flex-1 px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-xs text-[#2d2926] focus:outline-none focus:border-[#5c7f63] transition appearance-none"
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

function StepChildren({
  children, onChange, onAdd, onRemove, onNext, onBack,
}: {
  children: ChildDraft[];
  onChange: (uid: number, patch: Partial<ChildDraft>) => void;
  onAdd: () => void;
  onRemove: (uid: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [showError, setShowError] = useState(false);
  const hasValid = children.some((c) => c.name.trim().length > 0);

  function handleNext() {
    if (!hasValid) { setShowError(true); return; }
    onNext();
  }

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <BackBtn onClick={onBack} />
      <ProgressDots step={4} />
      <Card>
        <StepHeading
          eyebrow="Step 4 of 7"
          title="Who are you homeschooling?"
          sub="Add your children to get started. You can always add more in Settings."
        />

        <div className="space-y-3 mb-4">
          {children.map((child) => (
            <ChildRow
              key={child.uid}
              child={child}
              onChange={(patch) => onChange(child.uid, patch)}
              onRemove={() => onRemove(child.uid)}
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
            onClick={onAdd}
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

// ─── Step 5 — Curriculum ──────────────────────────────────────────────────────

function StepCurriculum({
  children, draft, onChange, onBuild, onSkip, onBack,
}: {
  children: ChildDraft[];
  draft: CurriculumDraft;
  onChange: (patch: Partial<CurriculumDraft>) => void;
  onBuild: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const canBuild = draft.curricName.trim().length > 0 && draft.subjects.length > 0 && draft.totalLessons > 0;
  const validChildren = children.filter((c) => c.name.trim());

  function toggleSubject(s: string) {
    const cur = draft.subjects;
    onChange({ subjects: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] });
  }

  function toggleDay(i: number) {
    const days = [...draft.schoolDays];
    days[i] = !days[i];
    onChange({ schoolDays: days });
  }

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-start px-5 py-12 overflow-y-auto">
      <BackBtn onClick={onBack} />
      <ProgressDots step={5} />
      <Card className="mb-8">
        <StepHeading
          eyebrow="Step 5 of 7"
          title="Set up your first curriculum"
          sub="We'll build your lesson schedule automatically."
        />

        {/* Which child (if multiple) */}
        {validChildren.length > 1 && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">For which child?</label>
            <select
              value={draft.childUid}
              onChange={(e) => onChange({ childUid: Number(e.target.value) })}
              className="w-full px-4 py-3 rounded-2xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] transition appearance-none"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237a6f65' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center" }}
            >
              {validChildren.map((c) => (
                <option key={c.uid} value={c.uid}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Curriculum name */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">Curriculum Name</label>
          <input
            type="text"
            value={draft.curricName}
            onChange={(e) => onChange({ curricName: e.target.value })}
            placeholder="e.g. Math with Saxon, All About Reading…"
            className="w-full px-4 py-3 rounded-2xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
          />
        </div>

        {/* Subjects */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">Subject(s)</label>
          <div className="flex flex-wrap gap-2">
            {SUBJECT_CHIPS.map((s) => {
              const sel = draft.subjects.includes(s);
              return (
                <button
                  key={s} type="button" onClick={() => toggleSubject(s)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                  style={{
                    backgroundColor: sel ? "#5c7f63" : "#f8f5f0",
                    color: sel ? "white" : "#5c5248",
                    borderColor: sel ? "#5c7f63" : "#e8e2d9",
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Total lessons */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">Total Lessons</label>
          <input
            type="number"
            min={1}
            max={500}
            value={draft.totalLessons || ""}
            onChange={(e) => onChange({ totalLessons: Math.max(1, parseInt(e.target.value) || 0) })}
            placeholder="e.g. 36"
            className="w-full px-4 py-3 rounded-2xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
          />
        </div>

        {/* School days */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">School Days</label>
          <div className="flex gap-2">
            {DAY_LABELS.map((d, i) => (
              <button
                key={d} type="button" onClick={() => toggleDay(i)}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all"
                style={{
                  backgroundColor: draft.schoolDays[i] ? "#5c7f63" : "#f8f5f0",
                  color: draft.schoolDays[i] ? "white" : "#9e958d",
                  borderColor: draft.schoolDays[i] ? "#5c7f63" : "#e8e2d9",
                }}
              >
                {d.charAt(0)}
              </button>
            ))}
          </div>
        </div>

        {/* Finish date (optional) */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">
            Target Finish Date <span className="font-normal normal-case text-[#b5aca4]">(optional)</span>
          </label>
          <input
            type="date"
            value={draft.finishDate}
            onChange={(e) => onChange({ finishDate: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
          />
        </div>

        <ContinueBtn
          onClick={onBuild}
          disabled={!canBuild}
          label={canBuild ? "Build my schedule →" : "Fill in the fields above"}
        />
        <button
          type="button"
          onClick={onSkip}
          className="block w-full text-center text-sm text-[#b5aca4] hover:text-[#7a6f65] transition-colors mt-3 py-1"
        >
          I&apos;ll set this up later →
        </button>
      </Card>
    </div>
  );
}

// ─── Step 6 — Schedule Preview ────────────────────────────────────────────────

function StepSchedulePreview({
  schedule, childColor, onNext, onBack,
}: {
  schedule: ScheduleRow[];
  childColor: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const preview = schedule.slice(0, 7);

  function fmtDate(d: string) {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-12 relative overflow-hidden"
      style={{ background: "linear-gradient(155deg, #faf8f4 0%, #f0f7f0 50%, #e8f2e8 100%)" }}
    >
      <Confetti />
      <BackBtn onClick={onBack} />
      <ProgressDots step={6} />

      <div className="relative z-10 w-full max-w-md mx-auto">
        <div className="text-center mb-6">
          <p className="text-xs font-semibold tracking-[0.25em] uppercase text-[#7a9e7e] mb-2">Step 6 of 7</p>
          <h2 className="text-3xl font-bold text-[#2d2926] leading-snug mb-2" style={{ fontFamily: "Georgia, serif" }}>
            Your first week is ready! 🌱
          </h2>
          <p className="text-sm text-[#7a6f65]">Here&apos;s what the first few lessons look like.</p>
        </div>

        <div className="bg-[#fefcf9] rounded-3xl border border-[#e8e2d9] overflow-hidden mb-6 shadow-lg">
          {preview.map((row, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-5 py-3.5 border-b border-[#f0ede8] last:border-0"
            >
              <div
                className="w-2 rounded-full shrink-0 self-stretch"
                style={{ backgroundColor: childColor, minHeight: "20px" }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#2d2926] truncate">{row.title}</p>
                <p className="text-xs text-[#9e958d]">{fmtDate(row.date)}</p>
              </div>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2"
                style={{ borderColor: "#c8bfb5" }}
              />
            </div>
          ))}
          {schedule.length > 7 && (
            <div className="px-5 py-3 text-xs text-[#b5aca4] text-center">
              +{schedule.length - 7} more lessons scheduled
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onNext}
          className="w-full py-4 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold text-base transition-all hover:shadow-md active:scale-[0.98]"
        >
          Looks great! Let&apos;s go →
        </button>
      </div>
    </div>
  );
}

// ─── Step 7 — Add to Home Screen ──────────────────────────────────────────────

function StepAddToHomeScreen({ saving, onDone }: { saving: boolean; onDone: () => void }) {
  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <ProgressDots step={7} />
      <Card>
        <StepHeading
          eyebrow="One last thing 🌿"
          title="Add Rooted to your home screen"
          sub="This way you'll never forget to log your day. It takes 10 seconds and feels like a real app."
        />

        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="bg-[#f8f5f0] rounded-2xl p-4 border border-[#ede8de]">
            <p className="text-lg mb-2">🍎</p>
            <p className="text-xs font-bold text-[#2d2926] mb-2">iPhone</p>
            <ol className="text-xs text-[#7a6f65] space-y-1 leading-relaxed">
              <li>Open in <span className="font-medium text-[#2d2926]">Safari</span></li>
              <li>Tap the Share button <span className="font-medium">⬆️</span></li>
              <li>Tap <span className="font-medium text-[#2d2926]">&quot;Add to Home Screen&quot;</span></li>
              <li>Tap <span className="font-medium text-[#2d2926]">Add</span></li>
            </ol>
          </div>
          <div className="bg-[#f8f5f0] rounded-2xl p-4 border border-[#ede8de]">
            <p className="text-lg mb-2">🤖</p>
            <p className="text-xs font-bold text-[#2d2926] mb-2">Android</p>
            <ol className="text-xs text-[#7a6f65] space-y-1 leading-relaxed">
              <li>Open in <span className="font-medium text-[#2d2926]">Chrome</span></li>
              <li>Tap the menu <span className="font-medium">⋮</span></li>
              <li>Tap <span className="font-medium text-[#2d2926]">&quot;Add to Home Screen&quot;</span></li>
              <li>Tap <span className="font-medium text-[#2d2926]">Add</span></li>
            </ol>
          </div>
        </div>

        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="w-full py-4 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-semibold text-base transition-all hover:shadow-md active:scale-[0.98]"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Setting up your space…
            </span>
          ) : "Done — let's grow! →"}
        </button>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [ready,   setReady]   = useState(false);
  const [step,    setStep]    = useState(1);
  const [userId,  setUserId]  = useState("");
  const [saving,  setSaving]  = useState(false);

  // Auth-sourced
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");

  // Per-step state
  const [familyDisplayName, setFamilyDisplayName] = useState("");
  const [selectedState,     setSelectedState]     = useState("");
  const [children,          setChildren]          = useState<ChildDraft[]>([mkChild()]);

  // Curriculum
  const [curricDraft, setCurricDraft] = useState<CurriculumDraft>({
    curricName:   "",
    subjects:     [],
    totalLessons: 0,
    schoolDays:   [true, true, true, true, true, false, false],
    finishDate:   "",
    childUid:     1,
  });
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);

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
      const ln = user.user_metadata?.last_name ?? "";
      setFirstName(fn);
      setLastName(ln);
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

  // ── Build schedule (Step 5 → 6) ──────────────────────────────────────────

  function handleBuildSchedule() {
    const rows = generateSchedule(curricDraft);
    setSchedule(rows);
    setStep(6);
  }

  // ── Complete onboarding (Step 7 "Done") ──────────────────────────────────

  const complete = useCallback(async () => {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";

    // Insert children
    const validKids = children.filter((c) => c.name.trim().length > 0);
    const insertedChildren: { uid: number; id: string }[] = [];
    for (const [i, child] of validKids.entries()) {
      const { data: inserted } = await supabase
        .from("children")
        .insert({
          user_id:    userId,
          name:       child.name.trim(),
          color:      child.color,
          sort_order: i + 1,
          archived:   false,
          name_key:   child.name.trim().toLowerCase().replace(/\s+/g, "_"),
        })
        .select("id")
        .single();
      if (inserted) insertedChildren.push({ uid: child.uid, id: (inserted as { id: string }).id });
    }

    // If curriculum was generated, save goals + lessons
    if (schedule.length > 0 && curricDraft.curricName.trim()) {
      const targetChild = insertedChildren.find((c) => c.uid === curricDraft.childUid) ?? insertedChildren[0];
      const childId = targetChild?.id ?? null;

      // Get or create subject
      let subjectId: string | null = null;
      if (curricDraft.subjects.length > 0) {
        const subjectName = curricDraft.subjects[0];
        const { data: existingSub } = await supabase
          .from("subjects")
          .select("id")
          .eq("user_id", userId)
          .eq("name", subjectName)
          .maybeSingle();
        if (existingSub) {
          subjectId = (existingSub as { id: string }).id;
        } else {
          const { data: newSub } = await supabase
            .from("subjects")
            .insert({ user_id: userId, name: subjectName })
            .select("id")
            .single();
          subjectId = newSub ? (newSub as { id: string }).id : null;
        }
      }

      // School day name strings
      const dayNames = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
      const schoolDayNames = dayNames.filter((_, i) => curricDraft.schoolDays[i]);

      // Create curriculum goal
      const { data: goal } = await supabase
        .from("curriculum_goals")
        .insert({
          user_id:         userId,
          child_id:        childId,
          curriculum_name: curricDraft.curricName.trim(),
          subject_label:   curricDraft.subjects[0] ?? null,
          total_lessons:   curricDraft.totalLessons,
          current_lesson:  0,
          target_date:     curricDraft.finishDate || null,
          school_days:     schoolDayNames,
        })
        .select("id")
        .single();

      if (goal) {
        const rows = schedule.map((row, idx) => ({
          user_id:            userId,
          child_id:           childId,
          subject_id:         subjectId,
          title:              row.title,
          date:               row.date,
          scheduled_date:     row.date,
          completed:          false,
          hours:              0,
          curriculum_goal_id: (goal as { id: string }).id,
          lesson_number:      idx + 1,
        }));
        for (let i = 0; i < rows.length; i += 100) {
          await supabase.from("lessons").insert(rows.slice(i, i + 100));
        }
      }
    }

    // Update profile
    const profilePatch: Record<string, unknown> = { onboarded: true };
    if (familyDisplayName.trim()) profilePatch.display_name = familyDisplayName.trim();
    if (selectedState)            profilePatch.state         = selectedState;

    await fetch("/api/profile/update", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body:    JSON.stringify(profilePatch),
    });

    router.push("/dashboard");
    setSaving(false);
  }, [children, userId, schedule, curricDraft, familyDisplayName, selectedState, router]);

  // ─────────────────────────────────────────────────────────────────────────

  // Suppress unused variable warning for lastName (used for familyDisplayName pre-fill only)
  void lastName;

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex items-center justify-center">
        <span className="text-4xl animate-[pulse_1.5s_ease-in-out_infinite]">🌱</span>
      </div>
    );
  }

  if (step === 1) return <StepWelcome firstName={firstName} onNext={() => setStep(2)} />;
  if (step === 2) return (
    <StepFamilyName
      value={familyDisplayName} onChange={setFamilyDisplayName}
      onNext={() => setStep(3)}
      onBack={() => setStep(1)}
    />
  );
  if (step === 3) return (
    <StepState
      value={selectedState} onChange={setSelectedState}
      onNext={() => setStep(4)} onSkip={() => setStep(4)}
      onBack={() => setStep(2)}
    />
  );
  if (step === 4) return (
    <StepChildren
      children={children}
      onChange={updateChild}
      onAdd={() => setChildren((p) => [...p, mkChild()])}
      onRemove={removeChild}
      onNext={() => setStep(5)}
      onBack={() => setStep(3)}
    />
  );
  if (step === 5) return (
    <StepCurriculum
      children={children}
      draft={curricDraft}
      onChange={(patch) => setCurricDraft((prev) => ({ ...prev, ...patch }))}
      onBuild={handleBuildSchedule}
      onSkip={() => setStep(7)}
      onBack={() => setStep(4)}
    />
  );
  if (step === 6) {
    const childObj = children.find((c) => c.uid === curricDraft.childUid) ?? children[0];
    return (
      <StepSchedulePreview
        schedule={schedule}
        childColor={childObj?.color ?? "#5c7f63"}
        onNext={() => setStep(7)}
        onBack={() => setStep(5)}
      />
    );
  }
  return <StepAddToHomeScreen saving={saving} onDone={complete} />;
}
