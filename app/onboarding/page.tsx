"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Camera, Plus, Check, X, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type ChildDraft = {
  uid: number;
  name: string;
  color: string;
  photoFile: File | null;
  photoPreview: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = [
  "#5c7f63", "#7a9e7e", "#4a7a8a",
  "#5a5c8a", "#c4956a", "#c4697a",
];

const CHECKLIST = [
  "Log daily lessons in your Garden",
  "Track books your kids are reading",
  "Capture photos and memories",
  "Generate beautiful shareable family updates",
  "View progress charts and reports",
  "Access curated homeschool resources",
];

let uidSeq = 0;
const newChild = (): ChildDraft => ({
  uid: ++uidSeq, name: "", color: COLORS[0], photoFile: null, photoPreview: null,
});

// ─── Confetti ─────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ["#5c7f63", "#7aaa78", "#c9a84c", "#c4956a", "#7a9e7e", "#4a7a8a", "#f0d99b"];

function Confetti() {
  const pieces = useRef(
    Array.from({ length: 44 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 2.5,
      duration: 3 + Math.random() * 2.5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 6 + Math.random() * 7,
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
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.5,
            backgroundColor: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `onbConfetti ${p.duration}s ${p.delay}s ease-in infinite`,
            opacity: 0,
          }}
        />
      ))}
      <style>{`
        @keyframes onbConfetti {
          0%   { transform: translateY(-10px) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
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
      style={{ background: "linear-gradient(155deg, #1e4228 0%, #2d5c38 50%, #4a8a5c 100%)" }}
    >
      {/* Subtle dot texture */}
      <div
        className="absolute inset-0 opacity-10"
        style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "28px 28px" }}
      />

      <div className="relative z-10 flex flex-col items-center text-center max-w-sm">
        {/* Animated plant */}
        <div className="relative w-36 h-36 mb-8 flex items-end justify-center" aria-hidden>
          <style>{`
            @keyframes stemGrow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
            @keyframes leafPop  { from { transform: scale(0) rotate(-20deg); opacity: 0; }
                                   to   { transform: scale(1) rotate(0deg);  opacity: 1; } }
            @keyframes leafPopR { from { transform: scale(0) rotate(20deg);  opacity: 0; }
                                   to   { transform: scale(1) rotate(0deg);  opacity: 1; } }
          `}</style>
          {/* Stem */}
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 rounded-full origin-bottom"
            style={{ height: 72, background: "linear-gradient(#7aaa78, #3d6044)", animation: "stemGrow 0.8s ease-out forwards" }}
          />
          {/* Left leaf */}
          <div
            className="absolute rounded-full origin-bottom-right"
            style={{ width: 36, height: 56, background: "radial-gradient(ellipse at 60% 40%, #7aaa78, #3d6044)", bottom: 36, left: "calc(50% - 52px)", transform: "rotate(-30deg)", animation: "leafPop 0.5s 0.7s ease-out both" }}
          />
          {/* Right leaf */}
          <div
            className="absolute rounded-full origin-bottom-left"
            style={{ width: 36, height: 56, background: "radial-gradient(ellipse at 40% 40%, #7aaa78, #3d6044)", bottom: 50, left: "calc(50% + 16px)", transform: "rotate(30deg)", animation: "leafPopR 0.5s 0.9s ease-out both" }}
          />
          {/* Top leaf */}
          <div
            className="absolute rounded-full"
            style={{ width: 30, height: 48, background: "radial-gradient(ellipse at 50% 40%, #a0cc9a, #5c9460)", bottom: 72, left: "calc(50% - 15px)", animation: "leafPop 0.5s 1.1s ease-out both" }}
          />
        </div>

        <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#a0cc9a] mb-3">
          Welcome to Rooted
        </p>
        <h1 className="text-4xl font-bold text-white mb-4 leading-tight" style={{ fontFamily: "Georgia, serif" }}>
          {familyName ? `Hello, ${familyName}! 🌿` : "Welcome! 🌿"}
        </h1>
        <p className="text-[#c8ddb8] text-base leading-relaxed mb-10">
          Let&apos;s personalize your space in just a few steps.
        </p>

        <button
          onClick={onNext}
          className="flex items-center gap-2 px-8 py-4 rounded-2xl text-base font-semibold text-[#2d5c38] bg-white hover:bg-[#f0faf0] transition-all shadow-xl hover:shadow-2xl hover:scale-105 active:scale-100"
        >
          Let&apos;s Go <ArrowRight size={18} />
        </button>
      </div>

      {/* Step indicators */}
      <div className="absolute bottom-8 flex gap-2">
        {[1,2,3,4].map((s) => (
          <div key={s} className="rounded-full transition-all" style={{ width: s === 1 ? 20 : 6, height: 6, backgroundColor: s === 1 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)" }} />
        ))}
      </div>
    </div>
  );
}

// ─── Step 2 — Family Photo ────────────────────────────────────────────────────

function StepPhoto({
  preview, onFile, onNext, onSkip,
}: {
  preview: string | null;
  onFile: (f: File) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-6">
      <ProgressDots step={2} />

      <div className="w-full max-w-sm mt-8">
        <p className="text-xs font-semibold tracking-[0.25em] uppercase text-[#7a9e7e] mb-2 text-center">Step 2 of 4</p>
        <h2 className="text-3xl font-bold text-[#2d2926] mb-2 text-center" style={{ fontFamily: "Georgia, serif" }}>
          Add a family photo
        </h2>
        <p className="text-sm text-[#7a6f65] mb-10 text-center leading-relaxed">
          This will show in your sidebar and on your shareable family updates.
        </p>

        {/* Upload circle */}
        <div className="flex justify-center mb-8">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-36 h-36 rounded-full overflow-hidden border-2 border-dashed border-[#c8ddb8] bg-[#e8f0e9] flex items-center justify-center relative hover:border-[#5c7f63] hover:bg-[#dceedd] transition-colors group"
          >
            {preview ? (
              <img src={preview} alt="Family photo" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Camera size={28} className="text-[#7aaa78] group-hover:text-[#5c7f63] transition-colors" />
                <span className="text-xs text-[#7a9e7e] font-medium">Upload Photo</span>
              </div>
            )}
            {preview && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={24} className="text-white" />
              </div>
            )}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />

        <button
          onClick={onNext}
          disabled={!preview}
          className="w-full py-3.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-base transition-colors mb-3"
        >
          {preview ? "Continue →" : "Upload to Continue"}
        </button>
        <button onClick={onSkip} className="w-full text-center text-sm text-[#b5aca4] hover:text-[#7a6f65] transition-colors py-1">
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ─── Step 3 — Children ────────────────────────────────────────────────────────

function ChildCard({
  child, userId, onChange, onRemove, showRemove,
}: {
  child: ChildDraft;
  userId: string;
  onChange: (updated: Partial<ChildDraft>) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const avatarRef = useRef<HTMLInputElement>(null);

  function pickAvatar(f: File) {
    const url = URL.createObjectURL(f);
    onChange({ photoFile: f, photoPreview: url });
  }

  return (
    <div className="bg-white border border-[#e8e2d9] rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        {/* Avatar circle */}
        <button
          type="button"
          onClick={() => avatarRef.current?.click()}
          className="w-11 h-11 rounded-full overflow-hidden border-2 border-dashed border-[#c8ddb8] bg-[#e8f0e9] flex items-center justify-center shrink-0 hover:border-[#5c7f63] transition-colors group"
        >
          {child.photoPreview ? (
            <img src={child.photoPreview} alt="" className="w-full h-full object-cover" />
          ) : child.name ? (
            <span
              className="text-sm font-bold text-white"
              style={{ backgroundColor: child.color, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {child.name.charAt(0).toUpperCase()}
            </span>
          ) : (
            <Camera size={14} className="text-[#7aaa78]" />
          )}
        </button>
        <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickAvatar(f); }} />

        {/* Name input */}
        <input
          type="text"
          value={child.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Child's name"
          className="flex-1 px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
        />

        {showRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#b5aca4] hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Color picker */}
      <div className="flex gap-2 pl-14">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange({ color: c })}
            className="w-7 h-7 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110"
            style={{ backgroundColor: c, borderColor: child.color === c ? "#2d2926" : "transparent" }}
          >
            {child.color === c && <Check size={12} className="text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepChildren({
  children, userId, onChange, onAdd, onRemove, onNext, onSkip,
}: {
  children: ChildDraft[];
  userId: string;
  onChange: (uid: number, patch: Partial<ChildDraft>) => void;
  onAdd: () => void;
  onRemove: (uid: number) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const hasValid = children.some((c) => c.name.trim());

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-6 py-12">
      <ProgressDots step={3} />

      <div className="w-full max-w-sm mt-8">
        <p className="text-xs font-semibold tracking-[0.25em] uppercase text-[#7a9e7e] mb-2 text-center">Step 3 of 4</p>
        <h2 className="text-3xl font-bold text-[#2d2926] mb-2 text-center" style={{ fontFamily: "Georgia, serif" }}>
          Add your children
        </h2>
        <p className="text-sm text-[#7a6f65] mb-7 text-center leading-relaxed">
          Add each child you&apos;re homeschooling. You can always edit these in Settings.
        </p>

        <div className="space-y-3 mb-4">
          {children.map((child) => (
            <ChildCard
              key={child.uid}
              child={child}
              userId={userId}
              onChange={(patch) => onChange(child.uid, patch)}
              onRemove={() => onRemove(child.uid)}
              showRemove={children.length > 1}
            />
          ))}
        </div>

        {children.length < 6 && (
          <button
            type="button"
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[#c8ddb8] bg-[#f0f7f0] hover:bg-[#e4f0e4] text-sm font-medium text-[#5c7f63] transition-colors mb-6"
          >
            <Plus size={15} /> Add another child
          </button>
        )}

        <button
          onClick={onNext}
          disabled={!hasValid}
          className="w-full py-3.5 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white font-semibold text-base transition-colors mb-3"
        >
          Continue →
        </button>
        <button onClick={onSkip} className="w-full text-center text-sm text-[#b5aca4] hover:text-[#7a6f65] transition-colors py-1">
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ─── Step 4 — Celebration ─────────────────────────────────────────────────────

function StepCelebration({
  familyName, saving, onComplete,
}: {
  familyName: string;
  saving: boolean;
  onComplete: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-6 relative overflow-hidden">
      <Confetti />

      <div className="relative z-10 flex flex-col items-center text-center max-w-sm">
        {/* Animated tree */}
        <div
          className="text-6xl mb-6"
          style={{ animation: "treeGrow 0.8s ease-out forwards", transformOrigin: "bottom center" }}
        >
          🌳
        </div>
        <style>{`
          @keyframes treeGrow {
            from { transform: scale(0.3); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
        `}</style>

        <p className="text-xs font-semibold tracking-[0.25em] uppercase text-[#7a9e7e] mb-3">
          You&apos;re all set!
        </p>
        <h2 className="text-3xl font-bold text-[#2d2926] mb-3 leading-tight" style={{ fontFamily: "Georgia, serif" }}>
          {familyName
            ? `Your Rooted home is ready, ${familyName}!`
            : "Your Rooted home is ready!"}
        </h2>
        <p className="text-sm text-[#7a6f65] mb-7 leading-relaxed">
          Here&apos;s what you can do from your dashboard:
        </p>

        {/* Checklist */}
        <ul className="w-full text-left space-y-2.5 mb-9">
          {CHECKLIST.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-[#e8f0e9] flex items-center justify-center shrink-0 mt-0.5">
                <Check size={11} className="text-[#5c7f63]" strokeWidth={3} />
              </div>
              <span className="text-sm text-[#2d2926]">{item}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={onComplete}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-semibold text-base transition-all hover:scale-105 active:scale-100 shadow-lg"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Setting up your space…
            </>
          ) : (
            <>Start My Journey <ArrowRight size={17} /></>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Progress dots ────────────────────────────────────────────────────────────

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      {[1,2,3,4].map((s) => (
        <div
          key={s}
          className="rounded-full transition-all"
          style={{
            width: s === step ? 20 : 6,
            height: 6,
            backgroundColor: s <= step ? "#5c7f63" : "#e8e2d9",
          }}
        />
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [ready,      setReady]      = useState(false);
  const [step,       setStep]       = useState(1);
  const [familyName, setFamilyName] = useState("");
  const [userId,     setUserId]     = useState("");
  const [saving,     setSaving]     = useState(false);

  // Step 2 — family photo
  const [familyPhotoFile,    setFamilyPhotoFile]    = useState<File | null>(null);
  const [familyPhotoPreview, setFamilyPhotoPreview] = useState<string | null>(null);

  // Step 3 — children
  const [children, setChildren] = useState<ChildDraft[]>([newChild()]);

  // ── Auth check ────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, onboarded")
        .eq("id", user.id)
        .maybeSingle();

      // Treat null as already onboarded (existing user before this feature)
      if (profile?.onboarded !== false) {
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

    let familyPhotoUrl: string | null = null;

    if (familyPhotoFile) {
      const ext  = familyPhotoFile.name.split(".").pop() ?? "jpg";
      const path = `${userId}/family.${ext}`;
      await supabase.storage
        .from("family-photos")
        .upload(path, familyPhotoFile, { contentType: familyPhotoFile.type, upsert: true });
      const { data: urlData } = supabase.storage.from("family-photos").getPublicUrl(path);
      familyPhotoUrl = urlData.publicUrl;
    }

    const childrenPayload = await Promise.all(
      children
        .filter((c) => c.name.trim())
        .map(async (child, i) => {
          let avatar_url: string | undefined;
          if (child.photoFile) {
            const ext  = child.photoFile.name.split(".").pop() ?? "jpg";
            const path = `${userId}/child-${Date.now()}-${i}.${ext}`;
            await supabase.storage
              .from("memories")
              .upload(path, child.photoFile, { contentType: child.photoFile.type, upsert: true });
            const { data: urlData } = supabase.storage.from("memories").getPublicUrl(path);
            avatar_url = urlData.publicUrl;
          }
          return { name: child.name.trim(), color: child.color, avatar_url };
        })
    );

    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/onboarding/complete", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ familyPhotoUrl, children: childrenPayload }),
    });

    router.push("/dashboard");
  }, [familyPhotoFile, userId, children, router]);

  // ─────────────────────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center">
        <span className="text-3xl animate-pulse">🌱</span>
      </div>
    );
  }

  if (step === 1) {
    return <StepWelcome familyName={familyName} onNext={() => setStep(2)} />;
  }

  if (step === 2) {
    return (
      <StepPhoto
        preview={familyPhotoPreview}
        onFile={(f) => {
          setFamilyPhotoFile(f);
          setFamilyPhotoPreview(URL.createObjectURL(f));
        }}
        onNext={() => setStep(3)}
        onSkip={() => setStep(3)}
      />
    );
  }

  if (step === 3) {
    return (
      <StepChildren
        children={children}
        userId={userId}
        onChange={updateChild}
        onAdd={() => setChildren((prev) => [...prev, newChild()])}
        onRemove={removeChild}
        onNext={() => setStep(4)}
        onSkip={() => setStep(4)}
      />
    );
  }

  return (
    <StepCelebration
      familyName={familyName}
      saving={saving}
      onComplete={complete}
    />
  );
}
