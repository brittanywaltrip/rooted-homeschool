"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const SUBJECT_CHIPS = ["Math", "Reading", "Language Arts", "Science", "History", "Art", "Other"];
const CORE_CHIPS = SUBJECT_CHIPS.slice(0, -1); // all except "Other"

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
  lessonsDone: number;  // lessons already completed before starting (0 = from beginning)
  schoolDays: boolean[]; // Mon–Sun
  finishDate: string;
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
  curricName: "", subjects: [], totalLessons: 0, lessonsDone: 0,
  schoolDays: [true, true, true, true, true, false, false],
  finishDate: "", childUid,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function generateSchedule(draft: CurriculumDraft): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let lessonNum = (draft.lessonsDone ?? 0) + 1;
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

function getNextSchoolDay(schoolDays: boolean[]): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let safety = 0;
  do {
    d.setDate(d.getDate() + 1);
    safety++;
  } while (!schoolDays[(d.getDay() + 6) % 7] && safety < 14);
  return d;
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

function SkipLink({ label = "Skip for now →", onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-center text-sm text-[#b5aca4] hover:text-[#7a6f65] transition-colors mt-3 py-1"
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
        <StepHeading eyebrow="Step 2 of 7" title="What should we call your family?" />
        <div className="mb-6">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => onChange(e.target.value.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" "))}
            placeholder="e.g. The Smith Family"
            autoFocus
            style={{ textTransform: "capitalize" }}
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
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
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
          <option value="">Grade</option>
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
        {children.length < 8 ? (
          <button
            type="button"
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[#c8ddb8] bg-[#f0f7f0] hover:bg-[#e8f2e8] text-sm font-medium text-[#5c7f63] transition-colors mb-6"
          >
            <Plus size={15} /> Add another child
          </button>
        ) : (
          <p className="text-xs text-[#b5aca4] text-center mb-6">
            You&apos;ve added 8 children — add more in Settings after setup.
          </p>
        )}
        <ContinueBtn onClick={handleNext} />
      </Card>
    </div>
  );
}

// ─── Curriculum Library ───────────────────────────────────────────────────────

type LibraryCurric = {
  name: string;
  subject: string; // must match one of FILTER_SUBJECTS (except "All")
  lessons: number;
  days: boolean[]; // Mon–Sun
};

const MF   : boolean[] = [true,true,true,true,true,false,false];   // Mon–Fri
const MWF  : boolean[] = [true,false,true,false,true,false,false]; // Mon/Wed/Fri
const MTTF : boolean[] = [true,true,true,true,false,false,false];  // Mon–Thu

const FILTER_SUBJECTS = ["All","Math","Reading","Language Arts","Science","History","Bible"];

const CURRICULUM_LIBRARY: LibraryCurric[] = [
  // ── Math ──────────────────────────────────────────────────────────────────
  { name: "Saxon Math",                             subject: "Math",          lessons: 120, days: MF   },
  { name: "Math-U-See",                             subject: "Math",          lessons: 120, days: MF   },
  { name: "The Good and the Beautiful Math",        subject: "Math",          lessons: 120, days: MF   },
  { name: "Singapore Math",                         subject: "Math",          lessons:  90, days: MF   },
  { name: "RightStart Mathematics",                 subject: "Math",          lessons: 120, days: MTTF },
  { name: "Teaching Textbooks",                     subject: "Math",          lessons: 120, days: MF   },
  { name: "Beast Academy",                          subject: "Math",          lessons:  80, days: MF   },
  { name: "Horizons Math",                          subject: "Math",          lessons: 160, days: MF   },
  { name: "Abeka Math",                             subject: "Math",          lessons: 170, days: MF   },
  { name: "Life of Fred",                           subject: "Math",          lessons:  60, days: MWF  },
  { name: "CTCMath",                                subject: "Math",          lessons: 100, days: MF   },
  { name: "Math Mammoth",                           subject: "Math",          lessons: 100, days: MF   },
  { name: "Shiller Math",                           subject: "Math",          lessons:  80, days: MF   },
  // ── Reading ───────────────────────────────────────────────────────────────
  { name: "All About Reading",                      subject: "Reading",       lessons:  60, days: MTTF },
  { name: "The Good and the Beautiful Reading",     subject: "Reading",       lessons: 120, days: MF   },
  { name: "Explode the Code",                       subject: "Reading",       lessons:  80, days: MF   },
  { name: "Teach Your Child to Read in 100 Easy Lessons", subject: "Reading", lessons: 100, days: MF  },
  { name: "Bob Books",                              subject: "Reading",       lessons:  60, days: MTTF },
  { name: "Sonlight Reading",                       subject: "Reading",       lessons:  36, days: MF   },
  { name: "Progressive Phonics",                    subject: "Reading",       lessons:  60, days: MF   },
  { name: "Pathway Readers",                        subject: "Reading",       lessons: 160, days: MF   },
  { name: "Logic of English Foundations",           subject: "Reading",       lessons:  40, days: MF   },
  { name: "Reading Eggs",                           subject: "Reading",       lessons: 100, days: MF   },
  // ── Language Arts ─────────────────────────────────────────────────────────
  { name: "All About Spelling",                     subject: "Language Arts", lessons:  48, days: MTTF },
  { name: "The Good and the Beautiful Language Arts", subject: "Language Arts", lessons: 120, days: MF },
  { name: "First Language Lessons",                 subject: "Language Arts", lessons: 100, days: MF   },
  { name: "Easy Grammar",                           subject: "Language Arts", lessons: 140, days: MF   },
  { name: "IEW",                                    subject: "Language Arts", lessons:  30, days: MWF  },
  { name: "Writing With Ease",                      subject: "Language Arts", lessons:  36, days: MF   },
  { name: "Rod and Staff English",                  subject: "Language Arts", lessons: 170, days: MF   },
  { name: "Writing & Rhetoric",                     subject: "Language Arts", lessons:  30, days: MWF  },
  { name: "Brave Writer",                           subject: "Language Arts", lessons:  36, days: MF   },
  { name: "Classical Writing",                      subject: "Language Arts", lessons:  30, days: MWF  },
  { name: "Spelling You See",                       subject: "Language Arts", lessons:  36, days: MF   },
  { name: "Sequential Spelling",                    subject: "Language Arts", lessons: 180, days: MF   },
  // ── Science ───────────────────────────────────────────────────────────────
  { name: "Apologia Science",                       subject: "Science",       lessons:  96, days: MF   },
  { name: "Elemental Science",                      subject: "Science",       lessons:  36, days: MF   },
  { name: "Real Science Odyssey",                   subject: "Science",       lessons:  36, days: MF   },
  { name: "Mystery Science",                        subject: "Science",       lessons:  40, days: MF   },
  { name: "God's Design for Science",               subject: "Science",       lessons:  96, days: MF   },
  { name: "Noeo Science",                           subject: "Science",       lessons:  36, days: MF   },
  { name: "The Good and the Beautiful Science",     subject: "Science",       lessons: 120, days: MF   },
  { name: "Building Foundations of Scientific Understanding", subject: "Science", lessons: 100, days: MF },
  { name: "Supercharged Science",                   subject: "Science",       lessons:  50, days: MF   },
  { name: "Nancy Larson Science",                   subject: "Science",       lessons:  60, days: MF   },
  // ── History ───────────────────────────────────────────────────────────────
  { name: "Story of the World",                     subject: "History",       lessons:  42, days: MF   },
  { name: "Sonlight History",                       subject: "History",       lessons:  36, days: MF   },
  { name: "Mystery of History",                     subject: "History",       lessons:  84, days: MF   },
  { name: "Beautiful Feet Books",                   subject: "History",       lessons:  30, days: MF   },
  { name: "The Good and the Beautiful History",     subject: "History",       lessons: 120, days: MF   },
  { name: "Tapestry of Grace",                      subject: "History",       lessons: 180, days: MF   },
  { name: "Veritas Press History",                  subject: "History",       lessons: 160, days: MF   },
  { name: "Trail Guide to Learning",                subject: "History",       lessons:  36, days: MF   },
  { name: "A History of US",                        subject: "History",       lessons:  50, days: MF   },
  { name: "Notgrass History",                       subject: "History",       lessons:  90, days: MF   },
  // ── Bible ─────────────────────────────────────────────────────────────────
  { name: "Grapevine Studies",                      subject: "Bible",         lessons:  30, days: MF   },
  { name: "Apologia Who Is God?",                   subject: "Bible",         lessons:  30, days: MF   },
  { name: "The Good and the Beautiful Bible",       subject: "Bible",         lessons: 120, days: MF   },
  { name: "Bible Study Guide for All Ages",         subject: "Bible",         lessons: 160, days: MF   },
  { name: "Positive Action Bible",                  subject: "Bible",         lessons:  36, days: MF   },
  { name: "Veritas Press Bible",                    subject: "Bible",         lessons: 160, days: MF   },
  { name: "Heart of Wisdom",                        subject: "Bible",         lessons:  36, days: MF   },
  { name: "Abeka Bible",                            subject: "Bible",         lessons: 170, days: MF   },
  { name: "Memoria Press Bible",                    subject: "Bible",         lessons:  30, days: MWF  },
];

// ─── Step 5 — Curriculum ──────────────────────────────────────────────────────

function StepCurriculum({
  validChildren,
  curricChildUid,
  draft,
  completedChildUids,
  skippedChildUids,
  onChange,
  onChangeChild,
  onBuildChild,
  onDoneAll,
  onSkipChild,
  onSkipAll,
  onBack,
}: {
  validChildren: ChildDraft[];
  curricChildUid: number;
  draft: CurriculumDraft;
  completedChildUids: Set<number>;
  skippedChildUids: Set<number>;
  onChange: (patch: Partial<CurriculumDraft>) => void;
  onChangeChild: (uid: number) => void;
  onBuildChild: (uid: number, draft: CurriculumDraft, rows: ScheduleRow[]) => void;
  onDoneAll: (hasAnySchedule: boolean) => void;
  onSkipChild: (uid: number) => void;
  onSkipAll: () => void;
  onBack: () => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptChild, setPromptChild] = useState<ChildDraft | null>(null);

  // Screen A (picker) state
  const [screen, setScreen] = useState<"picker" | "manual">("picker");
  const [search, setSearch] = useState("");
  const [filterSubject, setFilterSubject] = useState("All");
  const [selectedCard, setSelectedCard] = useState<LibraryCurric | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [alreadyStarted, setAlreadyStarted] = useState(false);
  const [startingLesson, setStartingLesson] = useState<number | "">("");

  // Screen B (manual) state
  const [otherSubject, setOtherSubject] = useState("");
  const [otherPillActive, setOtherPillActive] = useState(
    () => draft.subjects.some((s) => !CORE_CHIPS.includes(s))
  );
  const touchMoved = useRef(false);
  const touchStartY = useRef(0);

  // 15s hint timer — only ticks on Screen A, resets when returning to picker
  useEffect(() => {
    if (screen !== "picker") return;
    const t = setTimeout(() => setHintVisible(true), 15000);
    return () => clearTimeout(t);
  }, [screen]);

  // Sync state when active child changes
  useEffect(() => {
    const hasOther = draft.subjects.some((s) => !CORE_CHIPS.includes(s));
    setOtherPillActive(hasOther);
    setOtherSubject(draft.subjects.find((s) => !CORE_CHIPS.includes(s)) ?? "");
    setScreen("picker");
    setSelectedCard(null);
    setSearch("");
    setFilterSubject("All");
    setHintVisible(false);
    setAlreadyStarted(false);
    setStartingLesson("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curricChildUid]);

  const useProgressLayout = validChildren.length >= 4;
  const singleChild      = validChildren.length === 1;
  const currentChild     = validChildren.find((c) => c.uid === curricChildUid) ?? validChildren[0];
  const currentIdx       = validChildren.findIndex((c) => c.uid === curricChildUid);
  const isFirstChild     = currentIdx === 0;

  const heading = singleChild || useProgressLayout
    ? `What are you teaching ${currentChild?.name ?? "your child"}?`
    : "Set up your first curriculum";

  // Library filtering
  const filteredLib = CURRICULUM_LIBRARY.filter((c) => {
    const matchFilter = filterSubject === "All" || c.subject === filterSubject;
    const matchSearch = !search.trim() || c.name.toLowerCase().includes(search.toLowerCase().trim());
    return matchFilter && matchSearch;
  });

  // Estimated finish date from days + lessons
  function calcFinishPreview(schoolDays: boolean[], lessons: number): string {
    if (lessons <= 0 || !schoolDays.some(Boolean)) return "";
    const daysPerWeek = schoolDays.filter(Boolean).length;
    const weeksNeeded = Math.ceil(lessons / daysPerWeek);
    const finish = new Date();
    finish.setDate(finish.getDate() + weeksNeeded * 7);
    return finish.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  // Select a library card → populate draft
  function handleSelectCard(card: LibraryCurric) {
    setSelectedCard(card);
    onChange({
      curricName:   card.name,
      totalLessons: card.lessons,
      subjects:     [card.subject],
      schoolDays:   [...card.days],
    });
  }

  function toggleDay(i: number) {
    const days = [...draft.schoolDays];
    days[i] = !days[i];
    onChange({ schoolDays: days });
  }

  // Subject helpers (Screen B)
  function toggleSubject(s: string) {
    if (s === "Other") {
      if (otherPillActive) {
        setOtherPillActive(false);
        setOtherSubject("");
        onChange({ subjects: draft.subjects.filter((x) => CORE_CHIPS.includes(x)) });
      } else {
        setOtherPillActive(true);
        setOtherSubject("");
      }
    } else {
      const cur = draft.subjects.filter((x) => CORE_CHIPS.includes(x));
      onChange({ subjects: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] });
    }
  }

  function handleOtherInput(val: string) {
    setOtherSubject(val);
    const coreSelected = draft.subjects.filter((x) => CORE_CHIPS.includes(x));
    onChange({ subjects: val.trim() ? [...coreSelected, val.trim()] : coreSelected });
  }

  // ── Chaining logic ────────────────────────────────────────────────────────

  function handleBuildClick() {
    const lessonsDone = alreadyStarted && typeof startingLesson === "number" && startingLesson >= 2
      ? startingLesson - 1
      : 0;
    const buildDraft = { ...draft, lessonsDone };
    const rows = generateSchedule(buildDraft);
    const finishDate = rows[rows.length - 1]?.date ?? "";
    const finalDraft = { ...buildDraft, finishDate };
    onChange({ lessonsDone, finishDate });
    onBuildChild(curricChildUid, finalDraft, rows);
    const newDone   = new Set([...completedChildUids, curricChildUid]);
    const exclude   = new Set([...newDone, ...skippedChildUids]);
    const remaining = validChildren.filter((c) => !exclude.has(c.uid));
    if (remaining.length > 0) {
      setPromptChild(remaining[0]);
      setShowPrompt(true);
    } else {
      onDoneAll(true);
    }
  }

  function handleSetupPromptChild() {
    if (!promptChild) return;
    onChangeChild(promptChild.uid);
    setShowPrompt(false);
  }

  function handleSkipPrompt() {
    if (!promptChild) return;
    onSkipChild(promptChild.uid);
    const newSkipped = new Set([...skippedChildUids, promptChild.uid]);
    const exclude    = new Set([...completedChildUids, curricChildUid, ...newSkipped]);
    const remaining  = validChildren.filter((c) => !exclude.has(c.uid));
    if (remaining.length > 0) {
      setPromptChild(remaining[0]);
    } else {
      setShowPrompt(false);
      onDoneAll(completedChildUids.size > 0);
    }
  }

  function handleSkipCurrentChild() {
    onSkipChild(curricChildUid);
    const newSkipped = new Set([...skippedChildUids, curricChildUid]);
    const exclude    = new Set([...completedChildUids, ...newSkipped]);
    const remaining  = validChildren.filter((c) => !exclude.has(c.uid));
    if (remaining.length > 0) {
      setPromptChild(remaining[0]);
      setShowPrompt(true);
    } else {
      onDoneAll(completedChildUids.size > 0);
    }
  }

  // ── Prompt card ────────────────────────────────────────────────────────────

  if (showPrompt && promptChild) {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
        <ProgressDots step={5} />
        <Card>
          <div className="text-center mb-8">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4"
              style={{ backgroundColor: promptChild.color }}
            >
              {promptChild.name.charAt(0).toUpperCase()}
            </div>
            <h2
              className="text-2xl font-bold text-[#2d2926] mb-3 leading-snug"
              style={{ fontFamily: "Georgia, serif" }}
            >
              Want to set up {promptChild.name}&apos;s curriculum too?
            </h2>
            <p className="text-sm text-[#7a6f65]">You can always do this later in Settings.</p>
          </div>
          <ContinueBtn
            label={`Set up ${promptChild.name}'s curriculum →`}
            onClick={handleSetupPromptChild}
          />
          <SkipLink label="Skip for now →" onClick={handleSkipPrompt} />
        </Card>
      </div>
    );
  }

  // ── Shared skip footer ────────────────────────────────────────────────────

  const SkipFooter = () => isFirstChild ? (
    <div className="mt-4 text-center">
      <p className="text-xs text-[#9e958d] leading-relaxed mb-2">
        Set up at least one curriculum so Rooted can build your schedule.
      </p>
      <button
        type="button"
        onClick={onSkipAll}
        className="text-xs text-[#c8bfb5] hover:text-[#9e958d] transition-colors py-1"
      >
        Skip all curriculum setup →
      </button>
    </div>
  ) : (
    <SkipLink label="Skip for now →" onClick={handleSkipCurrentChild} />
  );

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-start px-5 py-10 overflow-y-auto">
      <BackBtn onClick={screen === "manual" ? () => setScreen("picker") : onBack} />
      <ProgressDots step={5} />

      <div className="w-full max-w-md mx-auto">

        {/* Heading */}
        <div className="text-center mb-5">
          <p className="text-xs font-semibold tracking-[0.25em] uppercase text-[#7a9e7e] mb-2">Step 5 of 7</p>
          <h2
            className="text-2xl sm:text-3xl font-bold text-[#2d2926] leading-snug"
            style={{ fontFamily: "Georgia, serif" }}
          >
            {heading}
          </h2>
        </div>

        {/* Tab selector: 2–3 children */}
        {!singleChild && !useProgressLayout && (
          <div className="flex gap-2 mb-4 flex-wrap">
            {validChildren.map((c) => {
              const isActive = c.uid === curricChildUid;
              const isDone   = completedChildUids.has(c.uid);
              return (
                <button
                  key={c.uid} type="button" onClick={() => onChangeChild(c.uid)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: isActive ? c.color : "#f8f5f0",
                    color:           isActive ? "white" : "#5c5248",
                    borderColor:     isActive ? c.color : "#e8e2d9",
                  }}
                >
                  {isDone && <Check size={10} strokeWidth={3} />}
                  {c.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Progress layout: 4+ children */}
        {useProgressLayout && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ backgroundColor: currentChild?.color ?? "#5c7f63" }}
                >
                  {(currentChild?.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-semibold text-[#2d2926]">{currentChild?.name ?? "—"}</span>
              </div>
              <span className="text-xs text-[#b5aca4]">{currentIdx + 1} of {validChildren.length} children</span>
            </div>
            <div className="space-y-0.5 bg-[#f8f5f0] rounded-2xl p-3 border border-[#ede8de]">
              {validChildren.map((c) => {
                const isDone    = completedChildUids.has(c.uid);
                const isSkipped = skippedChildUids.has(c.uid);
                const isCurrent = c.uid === curricChildUid;
                const displayName = c.name.length > 8 ? c.name.slice(0, 7) + "…" : c.name;
                const fillPct   = isDone || isSkipped ? "100%" : isCurrent ? "33%" : "0%";
                const fillColor = isDone ? "#3d5c42" : isSkipped ? "#c8bfb5" : "#3d5c42";
                const icon      = isDone ? "✓" : isSkipped ? "–" : isCurrent ? "···" : "—";
                const iconColor = isDone ? "#3d5c42" : isSkipped ? "#c8bfb5" : isCurrent ? "#5c7f63" : "#e0d8d0";
                return (
                  <button
                    key={c.uid} type="button" onClick={() => onChangeChild(c.uid)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl transition-colors text-left"
                    style={{ backgroundColor: isCurrent ? "#e8f0e9" : "transparent" }}
                  >
                    <span className="text-xs shrink-0 truncate" style={{ width: "5rem", fontWeight: isCurrent ? 600 : 400, color: isCurrent ? "#2d2926" : "#7a6f65" }}>
                      {displayName}
                    </span>
                    <div className="flex-1 relative rounded-full overflow-hidden" style={{ height: 3, backgroundColor: "#e8e2d9" }}>
                      <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: fillPct, backgroundColor: fillColor }} />
                    </div>
                    <span className="text-xs shrink-0 font-mono" style={{ color: iconColor, width: "1.25rem", textAlign: "center" }}>
                      {icon}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {screen === "picker" ? (

          /* ── Screen A: Curriculum picker ─────────────────────────────────── */
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl border border-[#f0ede8] p-5 mb-6">

            {/* Search */}
            <div className="relative mb-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search curricula…"
                className="w-full pl-9 pr-4 py-2.5 rounded-2xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c8bfb5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </div>

            {/* Filter pills */}
            <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {FILTER_SUBJECTS.map((s) => (
                <button
                  key={s} type="button"
                  onClick={() => setFilterSubject(s)}
                  className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: filterSubject === s ? "#5c7f63" : "#f8f5f0",
                    color:           filterSubject === s ? "white" : "#5c5248",
                    borderColor:     filterSubject === s ? "#5c7f63" : "#e8e2d9",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Card list */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto mb-4 pr-0.5">
              {filteredLib.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-[#9e958d] mb-2">No curricula found.</p>
                  <button type="button" onClick={() => setScreen("manual")}
                    className="text-sm text-[#5c7f63] font-medium hover:underline">
                    Add yours manually →
                  </button>
                </div>
              ) : filteredLib.map((c) => {
                const isSelected = selectedCard?.name === c.name && selectedCard?.subject === c.subject;
                return (
                  <button
                    key={`${c.subject}-${c.name}`} type="button"
                    onClick={() => handleSelectCard(c)}
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl border text-left transition-all"
                    style={{
                      backgroundColor: isSelected ? "#f0f7f0" : "#fefcf9",
                      borderColor:     isSelected ? "#5c7f63" : "#e8e2d9",
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#2d2926] leading-tight">{c.name}</p>
                      <p className="text-xs text-[#9e958d] mt-0.5">{c.subject} · ~{c.lessons} lessons</p>
                    </div>
                    {isSelected && <Check size={16} className="text-[#5c7f63] shrink-0" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>

            {/* Schedule preview — only when card selected */}
            {selectedCard && (
              <div className="bg-[#f0f7f0] border border-[#c8ddb8] rounded-2xl p-4 mb-4">
                <p className="text-xs font-semibold text-[#5c7f63] uppercase tracking-wider mb-3">Schedule Preview</p>

                {/* Editable lesson count */}
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-[#5c7f63] uppercase tracking-wider mb-1.5">
                    Lessons
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={draft.totalLessons || ""}
                    onChange={(e) => onChange({ totalLessons: Math.max(1, parseInt(e.target.value) || 0) })}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="w-full px-4 py-2.5 rounded-2xl border border-[#c8ddb8] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                  />
                  <p className="mt-1 text-xs text-[#7a6f65] italic">Lesson count is estimated · adjust if needed</p>
                </div>

                {/* Where are you starting? */}
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-[#5c7f63] uppercase tracking-wider mb-1.5">
                    Where Are You Starting?
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setAlreadyStarted(false); setStartingLesson(""); }}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: !alreadyStarted ? "#5c7f63" : "#f8f5f0",
                        color:           !alreadyStarted ? "white" : "#9e958d",
                        borderColor:     !alreadyStarted ? "#5c7f63" : "#e8e2d9",
                      }}
                    >
                      From the beginning
                    </button>
                    <button
                      type="button"
                      onClick={() => setAlreadyStarted(true)}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: alreadyStarted ? "#5c7f63" : "#f8f5f0",
                        color:           alreadyStarted ? "white" : "#9e958d",
                        borderColor:     alreadyStarted ? "#5c7f63" : "#e8e2d9",
                      }}
                    >
                      Already started
                    </button>
                  </div>
                  {alreadyStarted && (
                    <div className="mt-2">
                      <label className="block text-xs text-[#5c7f63] mb-1">Starting at lesson</label>
                      <input
                        type="number"
                        min={2}
                        value={startingLesson}
                        onChange={(e) => setStartingLesson(e.target.value === "" ? "" : parseInt(e.target.value) || "")}
                        onWheel={(e) => e.currentTarget.blur()}
                        placeholder="e.g. 47"
                        className="w-full px-4 py-2.5 rounded-2xl border border-[#c8ddb8] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                      />
                      {typeof startingLesson === "number" && startingLesson >= 2 && (
                        <p className="mt-1 text-xs text-[#7a6f65] italic">
                          Lessons 1–{startingLesson - 1} will be marked as already done
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Day pills */}
                <div
                  className="flex gap-1.5 mb-2"
                  onTouchStart={(e) => { touchMoved.current = false; touchStartY.current = e.touches[0].clientY; }}
                  onTouchMove={(e) => { if (Math.abs(e.touches[0].clientY - touchStartY.current) > 5) touchMoved.current = true; }}
                >
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={d} type="button"
                      onClick={() => { if (touchMoved.current) return; toggleDay(i); }}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: draft.schoolDays[i] ? "#5c7f63" : "#f8f5f0",
                        color:           draft.schoolDays[i] ? "white" : "#9e958d",
                        borderColor:     draft.schoolDays[i] ? "#5c7f63" : "#e8e2d9",
                      }}
                    >
                      {d.charAt(0)}
                    </button>
                  ))}
                </div>

                {(() => {
                  const done = alreadyStarted && typeof startingLesson === "number" && startingLesson >= 2
                    ? startingLesson - 1 : 0;
                  const remaining = Math.max(0, draft.totalLessons - done);
                  const preview = calcFinishPreview(draft.schoolDays, remaining);
                  return preview ? (
                    <p className="text-xs text-[#5c7f63] font-medium">
                      ~Finishes {preview}
                    </p>
                  ) : null;
                })()}
              </div>
            )}

            {/* Build button */}
            <ContinueBtn
              onClick={handleBuildClick}
              disabled={!selectedCard || draft.totalLessons <= 0}
              label={selectedCard
                ? `Build ${currentChild?.name ?? "their"}'s schedule →`
                : "Select a curriculum above"}
            />
            <p className="text-xs text-[#7a6f65] italic text-center mt-1.5">
              Not sure about the count? Just tap Build — you can adjust lessons and pace in Plan anytime.
            </p>

            {/* Add my own link — hint appears after 15s */}
            <div className="mt-4 text-center">
              {hintVisible && (
                <p className="text-xs text-[#9e958d] mb-1">Don&apos;t see yours?</p>
              )}
              <button
                type="button"
                onClick={() => setScreen("manual")}
                className="text-xs text-[#b5aca4] hover:text-[#5c7f63] transition-colors font-medium"
              >
                Add my own curriculum →
              </button>
            </div>

            <SkipFooter />
          </div>

        ) : (

          /* ── Screen B: Manual entry ───────────────────────────────────────── */
          <div className="bg-[#fefcf9] rounded-3xl shadow-xl border border-[#f0ede8] p-5 sm:p-8 mb-6">

            <button
              type="button"
              onClick={() => setScreen("picker")}
              className="flex items-center gap-1.5 text-sm text-[#5c7f63] font-medium hover:underline mb-5"
            >
              ← Back to library
            </button>

            {/* Curriculum name */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">
                Curriculum Name
              </label>
              <input
                type="text"
                value={draft.curricName}
                onChange={(e) => onChange({ curricName: e.target.value })}
                onBlur={(e) => onChange({ curricName: e.target.value.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") })}
                placeholder="e.g. Math with Saxon, All About Reading…"
                autoFocus
                style={{ textTransform: "capitalize" }}
                className="w-full px-4 py-3 rounded-2xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
              />
            </div>

            {/* Subjects */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">
                Subject(s) <span className="font-normal normal-case text-[#b5aca4]">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {SUBJECT_CHIPS.map((s) => {
                  const sel = s === "Other" ? otherPillActive : draft.subjects.includes(s);
                  return (
                    <button
                      key={s} type="button" onClick={() => toggleSubject(s)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                      style={{
                        backgroundColor: sel ? "#5c7f63" : "#f8f5f0",
                        color:           sel ? "white" : "#5c5248",
                        borderColor:     sel ? "#5c7f63" : "#e8e2d9",
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              {otherPillActive && (
                <input
                  type="text"
                  value={otherSubject}
                  onChange={(e) => handleOtherInput(e.target.value)}
                  placeholder="e.g. Bible, Latin, Music…"
                  autoFocus
                  className="mt-2 w-full px-4 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
                />
              )}
            </div>

            {/* Total lessons */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">
                Total Lessons
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={draft.totalLessons || ""}
                onChange={(e) => onChange({ totalLessons: Math.max(1, parseInt(e.target.value) || 0) })}
                onWheel={(e) => e.currentTarget.blur()}
                placeholder="e.g. 36"
                className="w-full px-4 py-3 rounded-2xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition"
              />
            </div>

            {/* School days */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#7a6f65] mb-2 uppercase tracking-wider">
                School Days
              </label>
              <div
                className="flex gap-2"
                onTouchStart={(e) => { touchMoved.current = false; touchStartY.current = e.touches[0].clientY; }}
                onTouchMove={(e) => { if (Math.abs(e.touches[0].clientY - touchStartY.current) > 5) touchMoved.current = true; }}
              >
                {DAY_LABELS.map((d, i) => (
                  <button
                    key={d} type="button"
                    onClick={() => { if (touchMoved.current) return; toggleDay(i); }}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all"
                    style={{
                      backgroundColor: draft.schoolDays[i] ? "#5c7f63" : "#f8f5f0",
                      color:           draft.schoolDays[i] ? "white" : "#9e958d",
                      borderColor:     draft.schoolDays[i] ? "#5c7f63" : "#e8e2d9",
                    }}
                  >
                    {d.charAt(0)}
                  </button>
                ))}
              </div>
            </div>

            {/* Smart preview line */}
            {draft.curricName.trim() && draft.totalLessons > 0 && draft.schoolDays.some(Boolean) && (
              <div className="mb-4 px-4 py-3 bg-[#f0f7f0] border border-[#c8ddb8] rounded-2xl">
                <p className="text-xs text-[#5c7f63] font-medium">
                  ~Finishes {calcFinishPreview(draft.schoolDays, draft.totalLessons)}
                </p>
              </div>
            )}

            {/* Build button */}
            <ContinueBtn
              onClick={handleBuildClick}
              disabled={!draft.curricName.trim() || draft.totalLessons <= 0}
              label={draft.curricName.trim() && draft.totalLessons > 0
                ? `Build ${currentChild?.name ?? "their"}'s schedule →`
                : "Fill in the fields above"}
            />
            <p className="text-xs text-[#7a6f65] italic text-center mt-1.5">
              Not sure about the count? Just tap Build — you can adjust lessons and pace in Plan anytime.
            </p>

            <SkipFooter />
          </div>

        )}
      </div>
    </div>
  );
}

// ─── Step 6 — Today Preview ────────────────────────────────────────────────────

function StepTodayPreview({
  childSchedules,
  children,
  displayName,
  isPro,
  onNext,
  onBack,
}: {
  childSchedules: ChildSchedule[];
  children: ChildDraft[];
  displayName: string;
  isPro: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  const showUpgrade = !isPro && new Date() < new Date("2026-04-30");

  const todayDow = new Date().getDay();
  const isFriOrWeekend = todayDow === 5 || todayDow === 6 || todayDow === 0;
  const heading = isFriOrWeekend
    ? "Here's what Monday looks like 🌿"
    : "Here's what tomorrow looks like 🌿";

  const firstSchedule = childSchedules[0];
  const nextDay = firstSchedule
    ? getNextSchoolDay(firstSchedule.draft.schoolDays)
    : getNextSchoolDay([true, true, true, true, true, false, false]);
  const previewDateStr = nextDay
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();

  const previewItems = childSchedules
    .map((cs) => ({
      child: children.find((c) => c.uid === cs.childUid),
      lesson: cs.schedule[0],
      draft: cs.draft,
    }))
    .filter((item) => item.child && item.lesson);

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
            {heading}
          </h2>
          <p className="text-sm text-[#7a6f65]">Your homeschool is ready to grow.</p>
        </div>

        <div className="bg-[#fefcf9] rounded-3xl border border-[#e8e2d9] overflow-hidden mb-4 shadow-lg">
          <div className="px-5 pt-4 pb-3 border-b border-[#f0ede8]">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-[#b5aca4] uppercase mb-1">
              {previewDateStr}
            </p>
            <p className="text-base font-semibold text-[#2d2926]">
              Good morning{displayName ? `, ${displayName}` : ""}! 🌤️
            </p>
          </div>
          {previewItems.length > 0 ? (
            <div className="divide-y divide-[#f0ede8]">
              {previewItems.map(({ child, lesson }) => (
                <div key={child!.uid} className="flex items-center gap-3 px-5 py-3">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: child!.color }}
                  >
                    {child!.name.charAt(0).toUpperCase()}
                  </div>
                  <p className="flex-1 text-sm text-[#2d2926] truncate">{lesson!.title}</p>
                  <div className="w-5 h-5 rounded-full border-2 border-[#c8bfb5] shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-4 text-sm text-[#9e958d]">Your lessons will appear here each day.</div>
          )}
          <div className="px-5 py-3 border-t border-[#f0ede8]">
            <p className="text-xs text-[#b5aca4]">🌱 Your garden grows with every lesson.</p>
          </div>
        </div>

        {childSchedules.length > 0 && (
          <div className="space-y-1 mb-5">
            {childSchedules.map((cs) => {
              const child = children.find((c) => c.uid === cs.childUid);
              if (!child) return null;
              const subStr = cs.draft.subjects.join(", ");
              return (
                <p key={cs.childUid} className="text-xs text-[#7a6f65] text-center">
                  <span className="font-semibold" style={{ color: child.color }}>{child.name}</span>
                  {": "}
                  {cs.schedule.length} lessons scheduled
                  {subStr ? ` · ${subStr}` : ""}
                </p>
              );
            })}
          </div>
        )}

        {showUpgrade ? (
          <>
            <button
              type="button"
              onClick={() => window.open("/upgrade", "_blank")}
              className="w-full py-4 rounded-2xl bg-[#3d5c42] hover:bg-[#2d4a30] text-white font-semibold text-base transition-all hover:shadow-md active:scale-[0.98] mb-3"
            >
              Join as a Founding Family — $39/yr →
            </button>
            <button
              type="button"
              onClick={onNext}
              className="block w-full text-center text-sm text-[#b5aca4] hover:text-[#7a6f65] transition-colors py-1"
            >
              Continue with Free →
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="w-full py-4 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold text-base transition-all hover:shadow-md active:scale-[0.98]"
          >
            Looks great! Let&apos;s go →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Step 7 — Add to Home Screen ──────────────────────────────────────────────

function StepAddToHomeScreen({
  saving, onDone, onSkip, noCurriculumNote = false,
}: {
  saving: boolean;
  onDone: () => void;
  onSkip: () => void;
  noCurriculumNote?: boolean;
}) {
  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <ProgressDots step={7} />
      <Card>
        {noCurriculumNote && (
          <div className="bg-[#f0f7f0] border border-[#c8ddb8] rounded-2xl px-4 py-3 mb-6 text-center">
            <p className="text-sm text-[#5c7f63]">
              No worries — you can set up your curriculum any time in Plan. 🌱
            </p>
          </div>
        )}
        <StepHeading
          eyebrow="One last thing 🌿"
          title="Add Rooted to your home screen"
          sub="Add Rooted to your home screen for quick daily access."
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
        <button
          type="button"
          onClick={onSkip}
          disabled={saving}
          className="block w-full text-center text-sm text-[#b5aca4] hover:text-[#7a6f65] transition-colors mt-3 py-1 disabled:opacity-40"
        >
          Maybe later
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
  const [isPro,   setIsPro]   = useState(false);
  const [noCurriculumNote, setNoCurriculumNote] = useState(false);

  // Auth-sourced
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");

  // Per-step state
  const [familyDisplayName, setFamilyDisplayName] = useState("");
  const [selectedState,     setSelectedState]     = useState("");
  const [children,          setChildren]          = useState<ChildDraft[]>([mkChild()]);

  // Curriculum — multi-child
  const [childSchedules,      setChildSchedules]      = useState<ChildSchedule[]>([]);
  const [curricChildUid,      setCurricChildUid]      = useState(0);
  const [curricDraft,         setCurricDraft]         = useState<CurriculumDraft>(freshDraft(0));
  const [curricDraftsByChild, setCurricDraftsByChild] = useState<Record<number, CurriculumDraft>>({});
  const [skippedChildUids,    setSkippedChildUids]    = useState<Set<number>>(new Set());

  const completedChildUids = useMemo(
    () => new Set(childSchedules.map((cs) => cs.childUid)),
    [childSchedules],
  );

  // ── Auth + onboarded check ────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, onboarded, is_pro")
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
      setFamilyDisplayName(profile?.display_name ?? (ln ? `The ${ln.charAt(0).toUpperCase() + ln.slice(1).toLowerCase()} Family` : ""));
      setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
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

  // ── Step 4 → 5: initialize only on first entry ────────────────────────────

  function goToStep5() {
    const validKids = children.filter((c) => c.name.trim());
    if (validKids.length === 0) return;
    // Only reset draft on first entry (curricChildUid === 0 means never been to step 5)
    if (curricChildUid === 0) {
      const firstChild = validKids[0];
      setCurricChildUid(firstChild.uid);
      setCurricDraft(freshDraft(firstChild.uid));
    }
    setStep(5);
  }

  // ── Child tab/row switch — preserve & restore drafts ─────────────────────

  function handleChangeChild(uid: number) {
    const snapshot = curricDraft;
    setCurricDraftsByChild((prev) => ({ ...prev, [curricChildUid]: snapshot }));
    // Check saved draft, then check completed child's built draft, then fresh
    const saved = curricDraftsByChild[uid]
      ?? childSchedules.find((cs) => cs.childUid === uid)?.draft
      ?? freshDraft(uid);
    setCurricDraft(saved);
    setCurricChildUid(uid);
  }

  // ── Build & store one child's schedule ───────────────────────────────────

  function handleBuildChild(uid: number, draft: CurriculumDraft, rows: ScheduleRow[]) {
    setChildSchedules((prev) => {
      const filtered = prev.filter((cs) => cs.childUid !== uid);
      return [...filtered, { childUid: uid, draft, schedule: rows }];
    });
  }

  // ── Mark a child as skipped ───────────────────────────────────────────────

  function handleSkipChild(uid: number) {
    setSkippedChildUids((prev) => new Set([...prev, uid]));
  }

  // ── Step 6 gating: skip if no schedules were built ────────────────────────

  function handleDoneAll(hasAnySchedule: boolean) {
    // Also check existing childSchedules in case React batched the update
    if (hasAnySchedule || childSchedules.length > 0) {
      setStep(6);
    } else {
      setNoCurriculumNote(true);
      setStep(7);
    }
  }

  // ── Complete onboarding ───────────────────────────────────────────────────

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

    // Save curriculum goals + lessons for each child
    for (const cs of childSchedules) {
      if (cs.schedule.length === 0 || !cs.draft.curricName.trim()) continue;
      const targetChild = insertedChildren.find((c) => c.uid === cs.childUid) ?? insertedChildren[0];
      const childId = targetChild?.id ?? null;

      let subjectId: string | null = null;
      if (cs.draft.subjects.length > 0) {
        const subjectName = cs.draft.subjects[0];
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

      const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const schoolDayNames = dayNames.filter((_, i) => cs.draft.schoolDays[i]);

      const { data: goal } = await supabase
        .from("curriculum_goals")
        .insert({
          user_id:         userId,
          child_id:        childId,
          curriculum_name: cs.draft.curricName.trim(),
          subject_label:   cs.draft.subjects[0] ?? null,
          total_lessons:    cs.draft.totalLessons,
          current_lesson:   cs.draft.lessonsDone ?? 0,
          target_date:      cs.draft.finishDate || null,
          finish_line_date: cs.draft.finishDate || null,
          school_days:      schoolDayNames,
        })
        .select("id")
        .single();

      if (goal) {
        const rows = cs.schedule.map((row, idx) => ({
          user_id:            userId,
          child_id:           childId,
          subject_id:         subjectId,
          title:              row.title,
          date:               row.date,
          scheduled_date:     row.date,
          completed:          false,
          hours:              0,
          curriculum_goal_id: (goal as { id: string }).id,
          lesson_number:      (cs.draft.lessonsDone ?? 0) + idx + 1,
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
  }, [children, userId, childSchedules, familyDisplayName, selectedState, router]);

  // ─────────────────────────────────────────────────────────────────────────

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
      onAdd={() => setChildren((p) => [...p, mkChild(p.length)])}
      onRemove={removeChild}
      onNext={goToStep5}
      onBack={() => setStep(3)}
    />
  );

  if (step === 5) {
    const validKids = children.filter((c) => c.name.trim());
    return (
      <StepCurriculum
        validChildren={validKids}
        curricChildUid={curricChildUid}
        draft={curricDraft}
        completedChildUids={completedChildUids}
        skippedChildUids={skippedChildUids}
        onChange={(patch) => setCurricDraft((prev) => ({ ...prev, ...patch }))}
        onChangeChild={handleChangeChild}
        onBuildChild={handleBuildChild}
        onDoneAll={handleDoneAll}
        onSkipChild={handleSkipChild}
        onSkipAll={() => { setNoCurriculumNote(true); setStep(7); }}
        onBack={() => setStep(4)}
      />
    );
  }

  if (step === 6) return (
    <StepTodayPreview
      childSchedules={childSchedules}
      children={children}
      displayName={familyDisplayName || firstName}
      isPro={isPro}
      onNext={() => setStep(7)}
      onBack={() => setStep(5)}
    />
  );

  return (
    <StepAddToHomeScreen
      saving={saving}
      onDone={complete}
      onSkip={complete}
      noCurriculumNote={noCurriculumNote}
    />
  );
}
