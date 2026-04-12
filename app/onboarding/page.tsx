"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/compress-image";

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

// ─── Shared UI ────────────────────────────────────────────────────────────────

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2.5 mb-10">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
            i < current ? "bg-white" : i === current ? "bg-white animate-pulse" : "bg-white/30"
          }`}
        />
      ))}
    </div>
  );
}

function StepShell({
  children,
  green = true,
}: {
  children: React.ReactNode;
  green?: boolean;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12 transition-colors duration-500"
      style={{ background: green ? "var(--g-brand)" : "#FEFCF9" }}
    >
      {green && (
        <img
          src="/rooted-logo-white.png"
          alt="Rooted"
          className="h-12 w-auto mb-10 opacity-90"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/rooted-logo-nav.png";
            (e.target as HTMLImageElement).className = "h-12 w-auto mb-10 opacity-90 brightness-0 invert";
          }}
        />
      )}
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState("");
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [animate, setAnimate] = useState(true);

  // Profile data
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [childRows, setChildRows] = useState([{ name: "", color: CHILD_COLORS[0] }]);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  // Skip tracking
  const [skipStep1, setSkipStep1] = useState(false);
  const [skipStep2, setSkipStep2] = useState(false);
  const [bothSkipped, setBothSkipped] = useState(false);
  const [celebrationReady, setCelebrationReady] = useState(false);
  const celebrationReadyRef = useRef(false);

  // ── Auth + profile check ────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, first_name, last_name, onboarded, state")
        .eq("id", user.id)
        .maybeSingle();

      if ((profile as { onboarded?: boolean | null } | null)?.onboarded === true && !celebrationReadyRef.current) {
        router.replace("/dashboard");
        return;
      }

      setUserId(user.id);

      const fn = profile?.first_name || user.user_metadata?.first_name || "";
      const ln = profile?.last_name || user.user_metadata?.last_name || "";
      const dn = profile?.display_name || "";

      setFirstName(fn);
      setLastName(ln);
      setDisplayName(dn);
      if (profile?.state) setSelectedState(profile.state);

      const skip1 = !!fn;
      const skip2 = !!dn;
      setSkipStep1(skip1);
      setSkipStep2(skip2);
      setBothSkipped(skip1 && skip2);

      let startStep = 0;
      if (skip1) startStep = 1;
      if (skip1 && skip2) startStep = 2;
      setStep(startStep);

      setReady(true);
    });
  }, [router]);

  // ── Step transition ────────────────────────────────────────────────────

  function goTo(next: number) {
    setAnimate(false);
    setError("");
    setTimeout(() => { setStep(next); setAnimate(true); }, 150);
  }

  // ── Visible steps (exclude skipped) ────────────────────────────────────

  const visibleSteps = [
    ...(!skipStep1 ? [0] : []),
    ...(!skipStep2 ? [1] : []),
    2, 3, 4, 5,
  ];
  const totalDots = visibleSteps.length;
  const currentDot = visibleSteps.indexOf(step);

  // ── Step handlers ──────────────────────────────────────────────────────

  async function saveStep1() {
    if (!firstName.trim()) { setError("Please enter your first name to continue"); return; }
    setSaving(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ first_name: firstName.trim(), ...(lastName.trim() ? { last_name: lastName.trim() } : {}) }),
    });
    if (!displayName && lastName.trim()) {
      setDisplayName(`The ${lastName.trim().charAt(0).toUpperCase() + lastName.trim().slice(1)} Family`);
    }
    setSaving(false);
    goTo(1);
  }

  async function saveStep2() {
    if (!displayName.trim()) { setError("Please enter your family name to continue"); return; }
    setSaving(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ display_name: displayName.trim() }),
    });
    setSaving(false);
    goTo(2);
  }

  async function saveStep3() {
    if (selectedState) {
      setSaving(true);
      const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
      await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ state: selectedState }),
      });
      setSaving(false);
    }
    goTo(3);
  }

  async function saveStep4() {
    const filled = childRows.filter(r => r.name.trim());
    if (filled.length === 0) { setError("Please add your child's name to continue"); return; }
    setSaving(true);
    for (let i = 0; i < filled.length; i++) {
      const { error: childErr } = await supabase
        .from("children")
        .insert({
          user_id: userId,
          name: filled[i].name.trim(),
          color: filled[i].color,
          sort_order: i + 1,
          archived: false,
          name_key: filled[i].name.trim().toLowerCase().replace(/\s+/g, "_"),
        });
      if (childErr) {
        setError("Something went wrong. Please try again.");
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    goTo(4);
  }

  const completeCalled = useRef(false);
  const completeOnboarding = useCallback(async () => {
    if (completeCalled.current) return;
    completeCalled.current = true;
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";

    let referredBy: string | undefined;
    try { const ref = localStorage.getItem("rooted_ref"); if (ref) referredBy = ref.toUpperCase(); } catch {}

    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        onboarded: true,
        onboarded_at: new Date().toISOString(),
        ...(referredBy ? { referred_by: referredBy } : {}),
      }),
    });
  }, []);

  // ── Complete onboarding when celebration step renders ────────────────

  useEffect(() => {
    if (step === 4 && !celebrationReady) {
      celebrationReadyRef.current = true;
      setCelebrationReady(true);
      completeOnboarding();
    }
  }, [step, celebrationReady, completeOnboarding]);

  // ── Render ──────────────────────���─────────────────────────────────────���

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--g-brand)" }}>
        <span className="text-4xl animate-pulse">🌱</span>
      </div>
    );
  }

  const fadeClass = `transition-opacity duration-300 ${animate ? "opacity-100" : "opacity-0"}`;

  // ─── STEP 1 — Name ────────────────────────────────────────────────────

  if (step === 0 && !skipStep1) {
    return (
      <StepShell>
        <div className={fadeClass}>
          <ProgressDots current={currentDot} total={totalDots} />
          <h1
            className="text-3xl font-bold text-white text-center mb-3 leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            First, what&apos;s your name?
          </h1>
          <p className="text-white/60 text-center text-sm mb-10">
            We&apos;ll use this to personalize your experience.
          </p>

          <input
            type="text"
            value={firstName}
            onChange={(e) => { setFirstName(e.target.value); setError(""); }}
            placeholder="First name"
            autoFocus
            className="w-full px-5 py-4 rounded-2xl bg-white/15 border border-white/20 text-white text-lg placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/20 transition mb-3"
          />
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name (optional)"
            className="w-full px-5 py-3.5 rounded-2xl bg-white/10 border border-white/15 text-white text-base placeholder-white/30 focus:outline-none focus:border-white/40 focus:bg-white/15 transition mb-6"
          />

          {error && <p className="text-sm text-red-300 text-center mb-4">{error}</p>}

          <button
            onClick={saveStep1}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Continue →"}
          </button>
        </div>
      </StepShell>
    );
  }

  // ─── STEP 2 — Family Name ─────────────────────────────────────────────

  if (step === 1 && !skipStep2) {
    return (
      <StepShell>
        <div className={fadeClass}>
          <ProgressDots current={currentDot} total={totalDots} />
          <h1
            className="text-3xl font-bold text-white text-center mb-3 leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            What do you call your family?
          </h1>
          <p className="text-white/60 text-center text-sm mb-10">
            This shows up in your app greeting and yearbook.
          </p>

          <input
            type="text"
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); setError(""); }}
            placeholder="e.g. The Johnson Family"
            autoFocus
            className="w-full px-5 py-4 rounded-2xl bg-white/15 border border-white/20 text-white text-lg placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/20 transition mb-2"
          />
          <p className="text-white/40 text-xs mb-6 px-1">
            We&apos;ll pre-fill this for you — just edit if needed
          </p>

          {error && <p className="text-sm text-red-300 text-center mb-4">{error}</p>}

          <button
            onClick={saveStep2}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 mb-4"
          >
            {saving ? "Saving..." : "Continue →"}
          </button>

          {!skipStep1 && (
            <button onClick={() => goTo(0)} className="w-full text-center text-sm text-white/40 hover:text-white/60 transition-colors">
              ← Back
            </button>
          )}
        </div>
      </StepShell>
    );
  }

  // ─── STEP 3 — State ───────────────────────────────────────────────────

  if (step === 2) {
    return (
      <StepShell>
        <div className={fadeClass}>
          <ProgressDots current={currentDot} total={totalDots} />

          {bothSkipped && (
            <p className="text-white/70 text-sm text-center mb-6">
              Welcome, {firstName}! Let&apos;s finish setting up your space. 🌿
            </p>
          )}

          <h1
            className="text-3xl font-bold text-white text-center mb-3 leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Where are you homeschooling?
          </h1>
          <p className="text-white/60 text-center text-sm mb-10">
            We use this to show local resources and field trips near you.
          </p>

          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl bg-white/15 border border-white/20 text-white text-base focus:outline-none focus:border-white/50 focus:bg-white/20 transition mb-6 appearance-none"
            style={{
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 16px center",
            }}
          >
            <option value="" className="text-[#2d2926]">Select your state</option>
            {US_STATES.map((s) => (
              <option key={s} value={s} className="text-[#2d2926]">{s}</option>
            ))}
          </select>

          <button
            onClick={saveStep3}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 mb-3"
          >
            {saving ? "Saving..." : "Continue →"}
          </button>

          <button onClick={() => goTo(3)} className="w-full text-center text-sm text-white/40 hover:text-white/60 transition-colors">
            Skip for now →
          </button>

          {(!skipStep1 || !skipStep2) && (
            <button onClick={() => goTo(skipStep1 ? 1 : 0)} className="w-full text-center text-sm text-white/40 hover:text-white/60 transition-colors mt-2">
              ← Back
            </button>
          )}
        </div>
      </StepShell>
    );
  }

  // ─── STEP 4 — Children ─────────────────────────────────────────────────

  if (step === 3) {
    const filled = childRows.filter(r => r.name.trim());
    const filledCount = filled.length;
    const ctaLabel = filledCount === 0
      ? "Add your children to my garden →"
      : filledCount === 1
        ? `Add ${filled[0].name.trim()} to my garden →`
        : `Add ${filledCount} children to my garden →`;

    function updateRow(idx: number, patch: Partial<{ name: string; color: string }>) {
      setChildRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
      setError("");
    }

    function addRow() {
      const usedColors = childRows.map(r => r.color);
      const nextColor = CHILD_COLORS.find(c => !usedColors.includes(c)) ?? CHILD_COLORS[childRows.length % CHILD_COLORS.length];
      setChildRows(prev => [...prev, { name: "", color: nextColor }]);
    }

    function removeRow(idx: number) {
      setChildRows(prev => prev.filter((_, i) => i !== idx));
    }

    return (
      <StepShell>
        <div className={fadeClass}>
          <ProgressDots current={currentDot} total={totalDots} />
          <h1
            className="text-3xl font-bold text-white text-center mb-3 leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Add your children 🌱
          </h1>
          <p className="text-white/60 text-center text-sm mb-8">
            Every child gets their own growing tree in your garden.
          </p>

          <div className="space-y-4 mb-4">
            {childRows.map((row, idx) => (
              <div key={idx} className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(idx, { name: e.target.value })}
                    placeholder={idx === 0 ? "Child's name" : "Another child's name"}
                    autoFocus={idx === 0}
                    className="flex-1 px-5 py-4 rounded-2xl bg-white/15 border border-white/20 text-white text-lg placeholder-white/40 focus:outline-none focus:border-white/50 focus:bg-white/20 transition"
                  />
                  {childRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/50 hover:text-white transition-colors shrink-0"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-center gap-2.5">
                  {CHILD_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => updateRow(idx, { color: c })}
                      className="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 focus:outline-none"
                      style={{
                        backgroundColor: c,
                        borderColor: row.color === c ? "white" : "transparent",
                      }}
                    >
                      {row.color === c && <Check size={12} className="text-white" strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {childRows.length < 8 && (
            <button
              type="button"
              onClick={addRow}
              className="w-full text-center text-sm font-medium mb-6 py-2 transition-colors"
              style={{ color: "rgba(255,255,255,0.5)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
            >
              + Add another child
            </button>
          )}

          {error && <p className="text-sm text-red-300 text-center mb-4">{error}</p>}

          <button
            onClick={saveStep4}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-white text-[var(--g-brand)] font-semibold text-base transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 mb-4"
          >
            {saving ? "Adding..." : ctaLabel}
          </button>

          <button onClick={() => goTo(2)} className="w-full text-center text-sm text-white/40 hover:text-white/60 transition-colors">
            ← Back
          </button>
        </div>
      </StepShell>
    );
  }

  // ─── STEP 5 — Celebration ─────────────────────────────────────────────

  if (step === 4) {
    return (
      <StepShell green={false}>
        <div className={`${fadeClass} flex flex-col items-center text-center`}>
          <div className="text-7xl mb-6 animate-bounce" style={{ animationDuration: "2s" }}>🌿</div>
          <h1
            className="text-3xl font-bold text-[#2d2926] mb-4 leading-snug"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Your garden is ready{firstName ? `, ${firstName}` : ""}!
          </h1>
          <p className="text-[#7a6f65] text-base leading-relaxed mb-10 max-w-xs">
            Every lesson, every memory, every milestone — Rooted holds onto it all.
          </p>

          <button
            onClick={() => router.push("/dashboard/memories?new=true")}
            className="w-full py-4 rounded-2xl font-semibold text-base text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "var(--g-brand)" }}
          >
            Capture your first memory →
          </button>
        </div>
      </StepShell>
    );
  }

  return null;
}
