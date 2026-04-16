"use client";

import { useState, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const PHRASES = [
  "Way to go! \u{1F389}",
  "Crushed it! \u{1F4AA}",
  "One less thing! \u{2728}",
  "Look at you go! \u{1F31F}",
  "Nailed it! \u{1F64C}",
  "That's how it's done! \u{1F525}",
];

// ─── CSS (injected once via <style>) ─────────────────────────────────────────

const CELEBRATION_CSS = `
@keyframes cb-bounce {
  0%   { transform: scale(0); }
  60%  { transform: scale(1.25); }
  80%  { transform: scale(0.95); }
  100% { transform: scale(1); }
}
@keyframes cb-particle {
  0%   { opacity: 1; transform: translate(0, 0) scale(1); }
  100% { opacity: 0; transform: translate(var(--px), var(--py)) scale(0.4); }
}
@keyframes cb-toast-in  { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: translateY(0); } }
@keyframes cb-toast-out { 0% { opacity: 1; } 100% { opacity: 0; } }
.cb-bounce { animation: cb-bounce 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
.cb-particle { animation: cb-particle 0.4s ease-out forwards; }
.cb-toast-in  { animation: cb-toast-in 0.2s ease-out forwards; }
.cb-toast-out { animation: cb-toast-out 0.3s ease-in forwards; }
`;

let cssInjected = false;
function ensureCSS() {
  if (cssInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = CELEBRATION_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

// ─── Sparkle particles component ─────────────────────────────────────────────

function Sparkles({ active }: { active: boolean }) {
  if (!active) return null;
  const particles = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * 60 + Math.random() * 30 - 15) * (Math.PI / 180);
    const dist = 18 + Math.random() * 10;
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, delay: Math.random() * 0.05 };
  });
  return (
    <>
      {particles.map((p, i) => (
        <span
          key={i}
          className="cb-particle absolute w-1.5 h-1.5 rounded-full"
          style={{
            "--px": `${p.x}px`,
            "--py": `${p.y}px`,
            animationDelay: `${p.delay}s`,
            background: ["#22c55e", "#facc15", "#7C3AED", "#f97316", "#3b82f6", "#ec4899"][i % 6],
            top: "50%",
            left: "50%",
            marginTop: -3,
            marginLeft: -3,
          } as React.CSSProperties}
        />
      ))}
    </>
  );
}

// ─── Hook: useCelebration ────────────────────────────────────────────────────

type CelebrationState = {
  /** ID of the item currently celebrating */
  activeId: string | null;
  /** toast message to show */
  toast: string | null;
  /** whether toast is fading out */
  toastOut: boolean;
};

export function useCelebration() {
  const [state, setState] = useState<CelebrationState>({ activeId: null, toast: null, toastOut: false });

  const celebrate = useCallback((id: string) => {
    ensureCSS();
    const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    setState({ activeId: id, toast: phrase, toastOut: false });
    // Start fade-out after 1.5s
    setTimeout(() => setState((s) => (s.activeId === id ? { ...s, toastOut: true } : s)), 1500);
    // Clear after fade-out
    setTimeout(() => setState((s) => (s.activeId === id ? { activeId: null, toast: null, toastOut: false } : s)), 1800);
  }, []);

  return { ...state, celebrate };
}

// ─── Checkbox component with celebration ─────────────────────────────────────

export function CelebrationCheckbox({
  checked,
  onToggle,
  itemId,
  accentColor,
  celebrating,
}: {
  checked: boolean;
  onToggle: () => void;
  itemId: string;
  accentColor: string;
  celebrating: boolean;
}) {
  const isBouncing = celebrating;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all relative ${isBouncing ? "cb-bounce" : ""}`}
      style={{
        borderColor: checked ? accentColor : "#d4d0ca",
        backgroundColor: checked ? accentColor : "transparent",
      }}
    >
      {checked && (
        <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-none">
          <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <Sparkles active={isBouncing} />
    </button>
  );
}

// ─── Toast component ─────────────────────────────────────────────────────────

export function CelebrationToast({ toast, toastOut }: { toast: string | null; toastOut: boolean }) {
  if (!toast) return null;
  return (
    <span
      className={`absolute -top-8 left-0 right-0 flex justify-center pointer-events-none z-10 ${toastOut ? "cb-toast-out" : "cb-toast-in"}`}
    >
      <span className="text-[11px] font-medium text-white bg-[#2d2926] rounded-full px-3 py-1 shadow-lg whitespace-nowrap">
        {toast}
      </span>
    </span>
  );
}
