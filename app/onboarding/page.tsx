"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Plus, ArrowRight, X } from "lucide-react";
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

const FINISH_CHECKS = [
  "Your family is set up",
  "Children added",
  "Garden is growing",
  "Ready to log your first lesson",
];

// ─── Types ────────────────────────────────────────────────────────────────────

type ChildDraft = {
  uid: number;
  name: string;
  color: string;
  photoFile: File | null;
  preview: string | null;
};

let seq = 0;
const mkChild = (): ChildDraft => ({
  uid: ++seq, name: "", color: CHILD_COLORS[0], photoFile: null, preview: null,
});

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

// ─── Progress dots ────────────────────────────────────────────────────────────

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1,2,3,4,5].map((s) => (
        <div
          key={s}
          className="rounded-full transition-all duration-300"
          style={{
            width:  s === step ? 24 : 8,
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

function StepWelcome({ familyName, onNext }: { familyName: string; onNext: () => void }) {
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
          {/* Soil mound */}
          <ellipse cx="55" cy="118" rx="30" ry="8" fill="#1a3d24" opacity="0.4" />
          {/* Stem */}
          <path d="M55 115 Q55 80 55 40"
            stroke="#7aaa78" strokeWidth="4" strokeLinecap="round" fill="none"
            style={{ strokeDasharray: 90, strokeDashoffset: 90, animation: "drawStem 1s ease-out 0.4s forwards" }} />
          {/* Left leaf */}
          <ellipse cx="38" cy="80" rx="20" ry="9"
            fill="#5c9460" transform="rotate(-35, 38, 80)"
            style={{ transformOrigin: "55px 80px", opacity: 0, animation: "popLeaf 0.45s ease-out 1.1s forwards" }} />
          {/* Right leaf */}
          <ellipse cx="72" cy="64" rx="20" ry="9"
            fill="#7aaa78" transform="rotate(25, 72, 64)"
            style={{ transformOrigin: "55px 64px", opacity: 0, animation: "popLeafR 0.45s ease-out 1.3s forwards" }} />
          {/* Left small leaf */}
          <ellipse cx="34" cy="52" rx="14" ry="7"
            fill="#4a8055" transform="rotate(-25, 34, 52)"
            style={{ transformOrigin: "55px 52px", opacity: 0, animation: "popLeaf 0.4s ease-out 1.5s forwards" }} />
          {/* Bud */}
          <circle cx="55" cy="38" r="9"
            fill="#a0cc9a"
            style={{ transformOrigin: "55px 38px", opacity: 0, animation: "popBud 0.4s ease-out 1.7s forwards" }} />
          <circle cx="55" cy="38" r="5" fill="#c8e8c0"
            style={{ transformOrigin: "55px 38px", opacity: 0, animation: "popBud 0.4s ease-out 1.9s forwards" }} />
        </svg>

        <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#a0cc9a] mb-4">
          Welcome to Rooted
        </p>
        <h1
          className="text-4xl sm:text-5xl font-bold text-white mb-5 leading-tight"
          style={{ fontFamily: "Georgia, serif" }}
        >
          {familyName ? `Hello, ${familyName}! 🌿` : "Welcome! 🌿"}
        </h1>
        <p className="text-[#c8ddb8] text-base sm:text-lg leading-relaxed mb-10 max-w-xs">
          Your calm, beautiful homeschool companion. Let&apos;s get you set up in 2 minutes.
        </p>

        <button
          onClick={onNext}
          className="flex items-center gap-2.5 px-9 py-4 rounded-2xl bg-white text-[#2d5c38] font-semibold text-lg hover:bg-[#f5fbf5] transition-all shadow-2xl hover:shadow-3xl hover:scale-105 active:scale-100"
        >
          Let&apos;s Go <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 2 — State ───────────────────────────────────────────────────────────

function StepState({
  value, onChange, onNext, onSkip,
}: {
  value: string;
  onChange: (s: string) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <ProgressDots step={2} />
      <Card>
        <StepHeading
          eyebrow="Step 2 of 5"
          title="Where do you homeschool?"
          sub="We'll help you stay on track with your state's requirements."
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

// ─── Step 3 — Family Photo ────────────────────────────────────────────────────

function StepFamilyPhoto({
  preview, onFile, onNext, onSkip,
}: {
  preview: string | null;
  onFile: (f: File) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <ProgressDots step={3} />
      <Card>
        <StepHeading
          eyebrow="Step 3 of 5"
          title="Add a photo of your family"
          sub="It shows in your sidebar and on shareable updates — making everything feel personal."
        />

        <div className="flex flex-col items-center mb-8">
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className="group relative w-32 h-32 rounded-full overflow-hidden border-[3px] border-dashed border-[#c8ddb8] bg-[#edf5ed] flex items-center justify-center hover:border-[#5c7f63] hover:bg-[#e4f0e4] transition-all"
          >
            {preview ? (
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-[#7aaa78] group-hover:text-[#5c7f63] transition-colors">
                <Camera size={30} />
                <span className="text-xs font-medium">Upload</span>
              </div>
            )}
            {preview && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={22} className="text-white" />
              </div>
            )}
          </button>
          <input ref={ref} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          {preview && (
            <p className="text-xs text-[#7a9e7e] mt-3 font-medium">Looking great! Tap to change.</p>
          )}
        </div>

        <ContinueBtn
          onClick={onNext}
          disabled={!preview}
          label={preview ? "Continue →" : "Upload a photo to continue"}
        />
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
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="bg-[#f8f5f0] rounded-2xl p-4 space-y-3 border border-[#ede8de]">
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="group relative w-12 h-12 rounded-full overflow-hidden shrink-0 border-2 border-dashed border-[#c8ddb8] bg-[#edf5ed] flex items-center justify-center hover:border-[#5c7f63] transition-colors"
        >
          {child.preview ? (
            <img src={child.preview} alt="" className="w-full h-full object-cover" />
          ) : child.name ? (
            <div className="w-full h-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: child.color }}>
              {child.name.charAt(0).toUpperCase()}
            </div>
          ) : (
            <Camera size={14} className="text-[#7aaa78] group-hover:text-[#5c7f63] transition-colors" />
          )}
        </button>
        <input ref={ref} type="file" accept="image/*" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onChange({ photoFile: f, preview: URL.createObjectURL(f) });
          }} />

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

      {/* Color picker */}
      <div className="flex items-center gap-2 pl-15" style={{ paddingLeft: 60 }}>
        <span className="text-[11px] text-[#b5aca4] mr-1 font-medium">Color</span>
        {CHILD_COLORS.map((c) => (
          <button
            key={c} type="button" onClick={() => onChange({ color: c })}
            className="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 focus:outline-none"
            style={{ backgroundColor: c, borderColor: child.color === c ? "#2d2926" : "transparent" }}
          >
            {child.color === c && <Check size={10} className="text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepChildren({
  children, onChange, onAdd, onRemove, onNext, onSkip,
}: {
  children: ChildDraft[];
  onChange: (uid: number, patch: Partial<ChildDraft>) => void;
  onAdd: () => void;
  onRemove: (uid: number) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const hasValid = children.some((c) => c.name.trim().length > 0);

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center px-5 py-12">
      <ProgressDots step={4} />
      <Card>
        <StepHeading
          eyebrow="Step 4 of 5"
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

        {children.length < 8 && (
          <button
            type="button"
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[#c8ddb8] bg-[#f0f7f0] hover:bg-[#e8f2e8] text-sm font-medium text-[#5c7f63] transition-colors mb-6"
          >
            <Plus size={15} /> Add another child
          </button>
        )}

        <ContinueBtn onClick={onNext} disabled={!hasValid} />
        <SkipLink onClick={onSkip} />
      </Card>
    </div>
  );
}

// ─── Step 5 — All Set ─────────────────────────────────────────────────────────

function StepAllSet({
  familyName, saving, onComplete,
}: {
  familyName: string;
  saving: boolean;
  onComplete: () => void;
}) {
  const [visible, setVisible] = useState(0);

  // Stagger the checkmarks in
  useEffect(() => {
    FINISH_CHECKS.forEach((_, i) => {
      setTimeout(() => setVisible((v) => Math.max(v, i + 1)), 600 + i * 350);
    });
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "linear-gradient(155deg, #faf8f4 0%, #f0f7f0 50%, #e8f2e8 100%)" }}
    >
      <Confetti />
      <ProgressDots step={5} />

      <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full">
        {/* Animated tree */}
        <svg width="120" height="140" viewBox="0 0 120 140" className="mb-8" aria-hidden>
          <style>{`
            @keyframes trunkUp { from { stroke-dashoffset: 50; } to { stroke-dashoffset: 0; } }
            @keyframes crownIn { from { opacity:0; transform:scale(0.3); } to { opacity:1; transform:scale(1); } }
          `}</style>
          {/* Trunk */}
          <path d="M60 130 Q58 100 60 70"
            stroke="#7a6044" strokeWidth="6" strokeLinecap="round" fill="none"
            style={{ strokeDasharray: 60, strokeDashoffset: 60, animation: "trunkUp 0.8s ease-out 0.2s forwards" }} />
          {/* Crown layers */}
          <ellipse cx="60" cy="85" rx="38" ry="30" fill="#4a8055"
            style={{ transformOrigin: "60px 85px", opacity: 0, animation: "crownIn 0.5s ease-out 0.9s forwards" }} />
          <ellipse cx="60" cy="68" rx="30" ry="26" fill="#5c9460"
            style={{ transformOrigin: "60px 68px", opacity: 0, animation: "crownIn 0.5s ease-out 1.1s forwards" }} />
          <ellipse cx="60" cy="52" rx="22" ry="20" fill="#7aaa78"
            style={{ transformOrigin: "60px 52px", opacity: 0, animation: "crownIn 0.5s ease-out 1.3s forwards" }} />
          <ellipse cx="60" cy="38" rx="14" ry="13" fill="#9fc99d"
            style={{ transformOrigin: "60px 38px", opacity: 0, animation: "crownIn 0.45s ease-out 1.5s forwards" }} />
          {/* Highlights */}
          <ellipse cx="50" cy="58" rx="7" ry="5" fill="#a8d8a0" opacity="0.6"
            style={{ transformOrigin: "50px 58px", opacity: 0, animation: "crownIn 0.3s ease-out 1.7s forwards" }} />
        </svg>

        <p className="text-xs font-semibold tracking-[0.25em] uppercase text-[#7a9e7e] mb-3">Step 5 of 5</p>
        <h2 className="text-3xl sm:text-4xl font-bold text-[#2d2926] mb-2 leading-tight" style={{ fontFamily: "Georgia, serif" }}>
          Your Rooted home is ready!
        </h2>
        {familyName && (
          <p className="text-lg font-semibold mb-6" style={{ color: "#5c7f63", fontFamily: "Georgia, serif" }}>
            Welcome, {familyName}. 🌿
          </p>
        )}

        {/* Staggered checklist */}
        <ul className="w-full text-left space-y-3 mb-8">
          {FINISH_CHECKS.map((item, i) => (
            <li
              key={i}
              className="flex items-center gap-3 transition-all duration-500"
              style={{ opacity: visible > i ? 1 : 0, transform: visible > i ? "translateX(0)" : "translateX(-12px)" }}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300"
                style={{ backgroundColor: visible > i ? "#e8f0e9" : "#f0ede8" }}
              >
                {visible > i && <Check size={12} className="text-[#5c7f63]" strokeWidth={3} />}
              </div>
              <span className="text-sm font-medium text-[#2d2926]">✓ {item}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={onComplete}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-semibold text-lg transition-all hover:shadow-lg hover:scale-[1.02] active:scale-100 mb-4"
        >
          {saving ? (
            <><div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" /> Setting up your space…</>
          ) : (
            <>Start My Journey <ArrowRight size={19} /></>
          )}
        </button>

        <p className="text-sm text-[#7a6f65] bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-4 py-3 leading-relaxed">
          🗓️ <span className="font-medium">Tip:</span> Head to <span className="text-[#5c7f63] font-medium">Plan</span> to schedule your first week of lessons.
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [ready,      setReady]      = useState(false);
  const [step,       setStep]       = useState(1);
  const [userId,     setUserId]     = useState("");
  const [familyName, setFamilyName] = useState("");
  const [saving,     setSaving]     = useState(false);

  // Per-step state
  const [selectedState,      setSelectedState]      = useState("");
  const [familyPhotoFile,    setFamilyPhotoFile]    = useState<File | null>(null);
  const [familyPhotoPreview, setFamilyPhotoPreview] = useState<string | null>(null);
  const [children,           setChildren]           = useState<ChildDraft[]>([mkChild()]);

  // ── Auth + onboarded check ────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, onboarded")
        .eq("id", user.id)
        .maybeSingle();

      // Only skip onboarding when explicitly marked complete
      if ((profile as { onboarded?: boolean | null } | null)?.onboarded === true) {
        router.replace("/dashboard");
        return;
      }

      setFamilyName(profile?.display_name ?? user.user_metadata?.family_name ?? "");
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

  // ── Complete onboarding ───────────────────────────────────────────────────

  const complete = useCallback(async () => {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";

    // Upload family photo
    let familyPhotoUrl: string | null = null;
    if (familyPhotoFile) {
      const ext  = familyPhotoFile.name.split(".").pop() ?? "jpg";
      const path = `${userId}/family.${ext}`;
      await supabase.storage.from("family-photos").upload(path, familyPhotoFile, { contentType: familyPhotoFile.type, upsert: true });
      familyPhotoUrl = supabase.storage.from("family-photos").getPublicUrl(path).data.publicUrl;
    }

    // Upload child photos + insert children
    const validKids = children.filter((c) => c.name.trim().length > 0);
    for (const [i, child] of validKids.entries()) {
      let avatar_url: string | undefined;
      if (child.photoFile) {
        const ext  = child.photoFile.name.split(".").pop() ?? "jpg";
        const path = `${userId}/child-${Date.now()}-${i}.${ext}`;
        await supabase.storage.from("memories").upload(path, child.photoFile, { contentType: child.photoFile.type, upsert: true });
        avatar_url = supabase.storage.from("memories").getPublicUrl(path).data.publicUrl;
      }
      const row: Record<string, unknown> = {
        user_id:    userId,
        name:       child.name.trim(),
        color:      child.color,
        sort_order: i + 1,
        archived:   false,
        name_key:   child.name.trim().toLowerCase().replace(/\s+/g, "_"),
      };
      if (avatar_url) row.avatar_url = avatar_url;
      await supabase.from("children").insert(row);
    }

    // Update profile: family photo, state, onboarded = true
    const profilePatch: Record<string, unknown> = { onboarded: true };
    if (familyPhotoUrl)  profilePatch.family_photo_url = familyPhotoUrl;
    if (selectedState)   profilePatch.state            = selectedState;

    await fetch("/api/profile/update", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body:    JSON.stringify(profilePatch),
    });

    router.push("/dashboard");
  }, [familyPhotoFile, userId, children, selectedState, router]);

  // ─────────────────────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex items-center justify-center">
        <span className="text-4xl animate-[pulse_1.5s_ease-in-out_infinite]">🌱</span>
      </div>
    );
  }

  if (step === 1) return <StepWelcome familyName={familyName} onNext={() => setStep(2)} />;
  if (step === 2) return (
    <StepState
      value={selectedState} onChange={setSelectedState}
      onNext={() => setStep(3)} onSkip={() => setStep(3)}
    />
  );
  if (step === 3) return (
    <StepFamilyPhoto
      preview={familyPhotoPreview}
      onFile={(f) => { setFamilyPhotoFile(f); setFamilyPhotoPreview(URL.createObjectURL(f)); }}
      onNext={() => setStep(4)} onSkip={() => setStep(4)}
    />
  );
  if (step === 4) return (
    <StepChildren
      children={children}
      onChange={updateChild} onAdd={() => setChildren((p) => [...p, mkChild()])} onRemove={removeChild}
      onNext={() => setStep(5)} onSkip={() => setStep(5)}
    />
  );

  return <StepAllSet familyName={familyName} saving={saving} onComplete={complete} />;
}
