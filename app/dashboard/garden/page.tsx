"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGES = [
  { name: "Seed",     emoji: "🌰", min: 0,   desc: "Just beginning",      bg: "#f5ede0", text: "#8b6f47" },
  { name: "Sprout",   emoji: "🌱", min: 5,   desc: "Taking root",         bg: "#e8f0e9", text: "#5c7f63" },
  { name: "Sapling",  emoji: "🌿", min: 15,  desc: "Growing strong",      bg: "#ddeedd", text: "#3d5c42" },
  { name: "Growing",  emoji: "🌳", min: 30,  desc: "Reaching upward",     bg: "#d4ecd4", text: "#2d5c38" },
  { name: "Thriving", emoji: "🌲", min: 50,  desc: "Fully flourishing",   bg: "#c8e6c8", text: "#1e4828" },
];

function getStageIndex(leaves: number) {
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (leaves >= STAGES[i].min) idx = i;
  }
  return idx;
}

// ─── Badge definitions ────────────────────────────────────────────────────────

const BADGES = [
  { id: "first_leaf",    emoji: "⭐", label: "First Leaf",      check: (l: number) => l >= 1         },
  { id: "sprout",        emoji: "🌱", label: "Sprouting!",      check: (l: number) => l >= 5          },
  { id: "ten_leaves",    emoji: "🍃", label: "10 Leaves",       check: (l: number) => l >= 10         },
  { id: "sapling",       emoji: "🌿", label: "Sapling",         check: (l: number) => l >= 15         },
  { id: "twenty_five",   emoji: "🏅", label: "25 Leaves",       check: (l: number) => l >= 25         },
  { id: "growing",       emoji: "🌳", label: "Growing!",        check: (l: number) => l >= 30         },
  { id: "fifty",         emoji: "🏆", label: "50 Leaves",       check: (l: number) => l >= 50         },
  { id: "thriving",      emoji: "🌲", label: "Thriving!",       check: (l: number) => l >= 50         },
  { id: "century",       emoji: "💯", label: "100 Leaves",      check: (l: number) => l >= 100        },
];

// ─── Tree SVG ─────────────────────────────────────────────────────────────────

function GardenTree({ stageIndex }: { stageIndex: number }) {
  const stage = stageIndex + 1;
  return (
    <svg viewBox="0 0 100 120" className="w-full h-full overflow-visible" aria-hidden>
      {/* Ground shadow */}
      <ellipse cx="50" cy="112" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />

      {/* Stage 1 – Seed */}
      {stage === 1 && (
        <g>
          <path d="M44 96 Q50 84 56 96 Q50 108 44 96" fill="#8b6f47" className="leaf-shimmer" />
          <path d="M50 85 Q53 76 50 68" stroke="#7a9e7e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <ellipse cx="50" cy="65" rx="4" ry="3" fill="#7a9e7e" opacity="0.7" />
        </g>
      )}

      {/* Stage 2+ – trunk base */}
      {stage >= 2 && (
        <rect x="47" y="72" width="6" height="40" rx="3" fill="#8b6f47" />
      )}

      {/* Stage 2 – Sprout */}
      {stage === 2 && (
        <g className="leaf-shimmer">
          <path d="M50 82 Q33 70 38 54 Q50 64 50 82" fill="#7a9e7e" />
          <path d="M50 82 Q67 70 62 54 Q50 64 50 82" fill="#5c7f63" />
        </g>
      )}

      {/* Stage 3 – Sapling */}
      {stage === 3 && (
        <g>
          <rect x="47" y="58" width="6" height="16" rx="3" fill="#8b6f47" />
          <path d="M50 74 Q28 60 35 40 Q48 54 50 74" fill="#5c7f63" className="leaf-shimmer" />
          <path d="M50 74 Q72 60 65 40 Q52 54 50 74" fill="#7a9e7e" className="leaf-shimmer" />
          <circle cx="50" cy="36" r="17" fill="#5c7f63" opacity="0.9" />
          <circle cx="50" cy="24" r="13" fill="#3d5c42" />
        </g>
      )}

      {/* Stage 4 – Growing */}
      {stage === 4 && (
        <g>
          <rect x="46" y="56" width="8" height="18" rx="4" fill="#8b6f47" />
          <path d="M50 70 Q22 54 30 30 Q46 46 50 70" fill="#5c7f63" className="leaf-shimmer" />
          <path d="M50 70 Q78 54 70 30 Q54 46 50 70" fill="#7a9e7e" className="leaf-shimmer" />
          <circle cx="32" cy="44" r="17" fill="#7a9e7e" />
          <circle cx="68" cy="44" r="17" fill="#7a9e7e" />
          <circle cx="50" cy="32" r="20" fill="#5c7f63" />
          <circle cx="50" cy="18" r="14" fill="#3d5c42" />
        </g>
      )}

      {/* Stage 5 – Thriving */}
      {stage >= 5 && (
        <g>
          <rect x="45" y="56" width="10" height="18" rx="5" fill="#8b6f47" />
          <path d="M50 72 Q14 54 24 22 Q44 42 50 72" fill="#5c7f63" className="leaf-shimmer" />
          <path d="M50 72 Q86 54 76 22 Q56 42 50 72" fill="#7a9e7e" className="leaf-shimmer" />
          <circle cx="26" cy="50" r="19" fill="#7a9e7e" />
          <circle cx="74" cy="50" r="19" fill="#7a9e7e" />
          <circle cx="38" cy="62" r="14" fill="#5c7f63" opacity="0.9" />
          <circle cx="62" cy="62" r="14" fill="#5c7f63" opacity="0.9" />
          <circle cx="50" cy="34" r="23" fill="#5c7f63" />
          <circle cx="50" cy="16" r="16" fill="#3d5c42" />
          <circle cx="34" cy="26" r="11" fill="#3d5c42" opacity="0.85" />
          <circle cx="66" cy="26" r="11" fill="#3d5c42" opacity="0.85" />
          {/* Sparkle dots */}
          <circle cx="20" cy="36" r="2" fill="#a8d8a8" className="sparkle" style={{ animationDelay: "0.3s" }} />
          <circle cx="80" cy="30" r="2" fill="#a8d8a8" className="sparkle" style={{ animationDelay: "0.9s" }} />
          <circle cx="50" cy="8"  r="1.5" fill="#c8f0c8" className="sparkle" style={{ animationDelay: "1.5s" }} />
        </g>
      )}
    </svg>
  );
}

// ─── Garden scene decorations ─────────────────────────────────────────────────

function Sun() {
  return (
    <div className="absolute top-4 right-5 sun-glow" style={{ width: 56, height: 56 }}>
      <svg viewBox="0 0 56 56" className="w-full h-full" overflow="visible">
        {/* Very large soft painterly glow */}
        <circle cx="28" cy="28" r="48" fill="#fef3c7" opacity="0.5" />
        <circle cx="28" cy="28" r="36" fill="#fef3c7" opacity="0.3" />
        {/* Short soft dashes like a child's drawing — no spinning */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <line key={a} x1="28" y1="11" x2="28" y2="7"
            stroke="#f6c243" strokeWidth="2" strokeLinecap="round"
            opacity="0.4" transform={`rotate(${a} 28 28)`} />
        ))}
        {/* Sun disc — warm golden yellow */}
        <circle cx="28" cy="28" r="14" fill="#f9d77e" />
        <circle cx="28" cy="28" r="10" fill="#fce49c" opacity="0.6" />
        <circle cx="24" cy="24" r="2.5" fill="#fff8d6" opacity="0.5" />
      </svg>
    </div>
  );
}

function Cloud({ x, y, scale = 1, delay = 0, alt = false }: {
  x: number; y: number; scale?: number; delay?: number; alt?: boolean;
}) {
  return (
    <div
      className={alt ? "cloud-drift-slow" : "cloud-drift"}
      style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: `scale(${scale})`,
        transformOrigin: "left center", animationDelay: `${delay}s` }}
    >
      <svg viewBox="0 0 90 42" width="90" height="42">
        {/* Warm shadow underneath — hand-painted feel */}
        <ellipse cx="45" cy="37" rx="38" ry="5" fill="#e8d8c0" opacity="0.2" />
        {/* Overlapping circles for organic cloud shape */}
        <circle cx="18" cy="30" r="12" fill="#fefcf8" opacity="0.92" />
        <circle cx="32" cy="24" r="16" fill="#fefcf8" opacity="0.92" />
        <circle cx="52" cy="22" r="15" fill="#fefcf8" opacity="0.92" />
        <circle cx="68" cy="27" r="12" fill="#fefcf8" opacity="0.92" />
        <circle cx="42" cy="29" r="13" fill="#fefcf8" opacity="0.88" />
        <circle cx="24" cy="32" r="10" fill="#fefcf8" opacity="0.85" />
        <circle cx="60" cy="31" r="10" fill="#fefcf8" opacity="0.85" />
      </svg>
    </div>
  );
}

function Flower({ x, color = "#e8a0a0" }: { x: number; color?: string }) {
  return (
    <div className="absolute" style={{ bottom: "27%", left: `${x}%` }}>
      <svg viewBox="0 0 20 26" width="13" height="17">
        {/* Thin painterly stem */}
        <line x1="10" y1="26" x2="10" y2="14" stroke="#8aaa78" strokeWidth="1" strokeLinecap="round" />
        {/* Cluster of soft overlapping circles */}
        <circle cx="7"  cy="12" r="4"   fill={color} opacity="0.72" />
        <circle cx="13" cy="11" r="3.5" fill={color} opacity="0.68" />
        <circle cx="10" cy="9"  r="4.5" fill={color} opacity="0.75" />
        <circle cx="6"  cy="8"  r="3"   fill={color} opacity="0.60" />
        <circle cx="14" cy="8"  r="3"   fill={color} opacity="0.60" />
      </svg>
    </div>
  );
}

function Butterfly({ x, y, delay = 0, color = "#f9a8d4" }: { x: number; y: number; delay?: number; color?: string }) {
  return (
    <div className="absolute butterfly" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}>
      <svg viewBox="0 0 30 22" width="26" height="19">
        {/* Upper wings */}
        <path d="M15 11 Q8 3 3 5 Q0 9 3 13 Q7 16 12 13 Q14 12 15 11" fill={color} opacity="0.92" />
        <path d="M15 11 Q22 3 27 5 Q30 9 27 13 Q23 16 18 13 Q16 12 15 11" fill={color} opacity="0.92" />
        {/* Lower wings (smaller, rounder) */}
        <path d="M15 12 Q10 15 8 18 Q11 21 14 18 Q15 16 15 12" fill={color} opacity="0.78" />
        <path d="M15 12 Q20 15 22 18 Q19 21 16 18 Q15 16 15 12" fill={color} opacity="0.78" />
        {/* Wing vein detail */}
        <path d="M15 11 Q10 8 5 9" stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" fill="none" />
        <path d="M15 11 Q20 8 25 9" stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" fill="none" />
        {/* Spot markings */}
        <circle cx="7"  cy="10" r="1.8" fill="rgba(255,255,255,0.45)" />
        <circle cx="23" cy="10" r="1.8" fill="rgba(255,255,255,0.45)" />
        <circle cx="9"  cy="17" r="1.2" fill="rgba(255,255,255,0.35)" />
        <circle cx="21" cy="17" r="1.2" fill="rgba(255,255,255,0.35)" />
        {/* Body */}
        <ellipse cx="15" cy="12" rx="1.1" ry="4.5" fill="#5a4a3a" />
        {/* Antennae */}
        <path d="M14.2 8 Q12 4 10 2" stroke="#5a4a3a" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <path d="M15.8 8 Q18 4 20 2" stroke="#5a4a3a" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <circle cx="10" cy="1.8" r="1"   fill="#5a4a3a" />
        <circle cx="20" cy="1.8" r="1"   fill="#5a4a3a" />
      </svg>
    </div>
  );
}

// ─── Tree positions ───────────────────────────────────────────────────────────

function getTreeX(index: number, total: number): number {
  if (total === 1) return 50;
  const margin = 16;
  const spread = 100 - 2 * margin;
  return margin + (spread / (total - 1)) * index;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GardenPage() {
  const { effectiveUserId } = usePartner();
  const [children, setChildren]   = useState<Child[]>([]);
  const [leafCounts, setLeafCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!effectiveUserId) return;
    async function load() {
      const { data: kids } = await supabase
        .from("children")
        .select("id, name, color")
        .eq("user_id", effectiveUserId)
        .eq("archived", false)
        .order("sort_order");

      const kids_ = kids ?? [];
      setChildren(kids_);
      if (kids_.length > 0) setSelectedId(kids_[0].id);

      const [{ data: completed }, { data: bookEvents }] = await Promise.all([
        supabase.from("lessons").select("child_id").eq("user_id", effectiveUserId).eq("completed", true),
        supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
      ]);

      const counts: Record<string, number> = {};
      completed?.forEach((l) => {
        counts[l.child_id] = (counts[l.child_id] ?? 0) + 1;
      });
      bookEvents?.forEach((e) => {
        const cid = e.payload?.child_id;
        if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
      });

      setLeafCounts(counts);
      setLoading(false);
    }
    load();
  }, [effectiveUserId]);

  const selectedChild = children.find((c) => c.id === selectedId);
  const selectedLeaves = selectedId ? (leafCounts[selectedId] ?? 0) : 0;
  const selectedStageIdx = getStageIndex(selectedLeaves);
  const selectedStage = STAGES[selectedStageIdx];
  const nextStage = STAGES[selectedStageIdx + 1];
  const progress = nextStage
    ? ((selectedLeaves - selectedStage.min) / (nextStage.min - selectedStage.min)) * 100
    : 100;

  const earnedBadges = BADGES.filter((b) => b.check(selectedLeaves));
  const lockedBadges = BADGES.filter((b) => !b.check(selectedLeaves));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl animate-pulse">🌿</span>
          <p className="text-sm text-[#7a6f65]">Growing your garden…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl px-4 py-7 space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Your Family&apos;s
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Garden 🌿</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Every lesson learned grows a leaf. Watch your family bloom.
        </p>
      </div>

      {/* ── Garden Scene ─────────────────────────────────── */}
      <div
        className="relative w-full overflow-hidden rounded-3xl shadow-md"
        style={{
          background: "#fef8f0",
          aspectRatio: "16/9",
          minHeight: 200,
        }}
      >
        {/* Full-scene SVG: watercolor defs + textured background wash */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 400 225"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#e8f4fc" />
              <stop offset="30%"  stopColor="#93c9e8" />
              <stop offset="65%"  stopColor="#72b8e0" />
              <stop offset="100%" stopColor="#c8e8d0" />
            </linearGradient>
            <filter id="watercolor" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" stitchTiles="stitch" result="noise"/>
              <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
              <feBlend in="SourceGraphic" in2="grayNoise" mode="screen" result="blend"/>
              <feComposite in="blend" in2="SourceGraphic" operator="in"/>
            </filter>
            <filter id="softBlur">
              <feGaussianBlur stdDeviation="0.8"/>
            </filter>
          </defs>
          {/* Watercolor-textured background */}
          <rect width="400" height="225" fill="url(#skyGrad)" />
        </svg>

        {/* Sun */}
        <Sun />

        {/* Clouds */}
        <Cloud x={8}  y={8}  scale={1.1} delay={0} />
        <Cloud x={28} y={14} scale={0.7} delay={-5} alt />
        <Cloud x={55} y={6}  scale={0.85} delay={-2} />

        {/* Butterflies */}
        <Butterfly x={12} y={30} delay={0}   color="#f9a8d4" />
        <Butterfly x={72} y={24} delay={1.8} color="#fbbf24" />
        <Butterfly x={45} y={38} delay={3.2} color="#86efac" />

        {/* Ground layers — watercolor rolling hills */}
        <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: "32%" }}>
          <svg viewBox="0 0 400 100" preserveAspectRatio="xMidYMax slice" className="w-full h-full">
            {/* Back hill — soft sage watercolor wash */}
            <path d="M0 56 Q60 28 130 48 Q205 68 280 42 Q350 22 400 44 L400 100 L0 100 Z"
              fill="#c8ddb8" opacity="0.85" filter="url(#softBlur)" />
            {/* Middle hill — medium sage, slightly richer */}
            <path d="M0 66 Q85 44 175 60 Q268 76 355 58 Q382 54 400 57 L400 100 L0 100 Z"
              fill="#a8c898" filter="url(#softBlur)" />
            {/* Soft hill edge */}
            <path d="M0 66 Q85 44 175 60 Q268 76 355 58 Q382 54 400 57" fill="none"
              stroke="#8aaa78" strokeWidth="1" opacity="0.4" />
            {/* Front hill — deepest sage, most saturated */}
            <path d="M0 77 Q88 67 182 74 Q278 81 372 70 Q390 68 400 70 L400 100 L0 100 Z"
              fill="#7aaa78" filter="url(#softBlur)" />
          </svg>
        </div>

        {/* Decorative flowers — soft painterly palette */}
        <Flower x={3}  color="#e8a0a0" />
        <Flower x={6}  color="#f5e6c8" />
        <Flower x={88} color="#c8b8d8" />
        <Flower x={92} color="#e8a0a0" />
        <Flower x={95} color="#f5e6c8" />

        {/* Trees */}
        {children.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center bg-white/40 backdrop-blur-sm rounded-2xl px-6 py-4">
              <p className="text-sm font-medium text-[#2d2926]">No children added yet</p>
              <p className="text-xs text-[#5c7f63]">Add children in Settings to grow your garden</p>
            </div>
          </div>
        ) : (
          children.map((child, i) => {
            const leaves   = leafCounts[child.id] ?? 0;
            const sIdx     = getStageIndex(leaves);
            const x        = getTreeX(i, children.length);
            const isActive = child.id === selectedId;
            const swayClass = i % 2 === 0 ? "garden-sway" : "garden-sway-alt";

            return (
              <div
                key={child.id}
                className="absolute cursor-pointer"
                style={{ bottom: "28%", left: `${x}%`, transform: "translateX(-50%)" }}
                onClick={() => setSelectedId(child.id)}
              >
                {/* Tree */}
                <div
                  className={`${swayClass} relative`}
                  style={{
                    width: "clamp(52px, 14vw, 90px)",
                    transformOrigin: "center bottom",
                    animationDelay: `${i * 0.7}s`,
                  }}
                >
                  <GardenTree stageIndex={sIdx} />

                  {/* Leaf count badge */}
                  <div
                    className="absolute -top-1 -right-2 w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shadow-sm"
                    style={{ backgroundColor: child.color ?? "#5c7f63" }}
                  >
                    {leaves > 99 ? "99+" : leaves}
                  </div>

                  {/* Active ring */}
                  {isActive && (
                    <div
                      className="absolute inset-0 rounded-full border-2 border-white/60 pointer-events-none"
                      style={{ margin: "-4px" }}
                    />
                  )}
                </div>

                {/* Child name */}
                <div className="mt-1 text-center">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm ${
                      isActive ? "bg-white text-[#2d2926]" : "bg-white/70 text-[#2d2926]/80"
                    }`}
                  >
                    {child.name}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Child tabs ─────────────────────────────────────── */}
      {children.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {children.map((child) => (
            <button
              key={child.id}
              onClick={() => setSelectedId(child.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedId === child.id
                  ? "text-white border-transparent shadow-sm"
                  : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"
              }`}
              style={selectedId === child.id ? { backgroundColor: child.color ?? "#5c7f63" } : {}}
            >
              {child.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Stage info card ────────────────────────────────── */}
      {selectedChild && (
        <div
          className="rounded-2xl p-5 border"
          style={{ backgroundColor: selectedStage.bg, borderColor: selectedStage.text + "30" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5"
                style={{ color: selectedStage.text }}>
                {selectedChild.name}
              </p>
              <h2 className="text-xl font-bold text-[#2d2926]">
                {selectedStage.emoji} {selectedStage.name}
              </h2>
              <p className="text-sm mt-0.5" style={{ color: selectedStage.text }}>
                {selectedStage.desc}
              </p>

              <div className="flex items-center gap-2 mt-3 mb-2">
                <span className="text-sm">🍃</span>
                <span className="text-sm font-semibold text-[#2d2926]">
                  {selectedLeaves} {selectedLeaves === 1 ? "leaf" : "leaves"} earned
                </span>
                {nextStage && (
                  <span className="text-xs text-[#7a6f65]">
                    · {nextStage.min - selectedLeaves} to {nextStage.name}
                  </span>
                )}
              </div>

              <div className="w-full h-2 bg-white/50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: selectedStage.text }}
                />
              </div>
            </div>

            {/* Big tree preview */}
            <div style={{ width: 80, height: 88, flexShrink: 0 }}>
              <GardenTree stageIndex={selectedStageIdx} />
            </div>
          </div>
        </div>
      )}

      {/* ── Badges ────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
          Badges {earnedBadges.length > 0 && `· ${earnedBadges.length} earned`}
        </h2>

        {earnedBadges.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-[#5c7f63] font-medium mb-2">✨ Earned</p>
            <div className="flex flex-wrap gap-2">
              {earnedBadges.map((badge) => (
                <div
                  key={badge.id}
                  className="badge-float flex flex-col items-center bg-gradient-to-b from-[#e8f0e9] to-[#d4ead4] border border-[#b8d9bc] rounded-2xl px-4 py-3 min-w-[72px]"
                >
                  <span className="text-2xl mb-1">{badge.emoji}</span>
                  <span className="text-[10px] font-semibold text-[#3d5c42] text-center leading-tight">
                    {badge.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {lockedBadges.length > 0 && (
          <div>
            <p className="text-xs text-[#b5aca4] font-medium mb-2">🔒 Locked</p>
            <div className="flex flex-wrap gap-2">
              {lockedBadges.map((badge) => (
                <div
                  key={badge.id}
                  className="flex flex-col items-center bg-[#f0ede8] border border-[#e8e2d9] rounded-2xl px-4 py-3 min-w-[72px] opacity-50"
                >
                  <span className="text-2xl mb-1 grayscale">{badge.emoji}</span>
                  <span className="text-[10px] font-medium text-[#7a6f65] text-center leading-tight">
                    {badge.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {earnedBadges.length === 0 && lockedBadges.length === 0 && (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 text-center">
            <p className="text-sm text-[#7a6f65]">Complete lessons to earn your first badge! 🌟</p>
          </div>
        )}
      </div>

      <div className="h-4" />
    </div>
  );
}
