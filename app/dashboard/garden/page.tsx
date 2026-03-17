"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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
      <svg viewBox="0 0 56 56" className="w-full h-full">
        <g className="sun-rays-spin" style={{ transformOrigin: "28px 28px" }}>
          {[0, 45, 90, 135].map((a) => (
            <line key={a} x1="28" y1="6" x2="28" y2="1" stroke="#ffc93d" strokeWidth="2.5"
              strokeLinecap="round" transform={`rotate(${a} 28 28)`} />
          ))}
          {[22.5, 67.5, 112.5, 157.5].map((a) => (
            <line key={a} x1="28" y1="7.5" x2="28" y2="3" stroke="#ffd86b" strokeWidth="1.5"
              strokeLinecap="round" transform={`rotate(${a} 28 28)`} />
          ))}
        </g>
        <circle cx="28" cy="28" r="14" fill="#ffd854" />
        <circle cx="28" cy="28" r="10" fill="#ffec8a" />
        <circle cx="24" cy="24" r="2.5" fill="#fff5a0" opacity="0.6" />
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
        <ellipse cx="45" cy="30" rx="43" ry="13" fill="white" opacity="0.88" />
        <ellipse cx="26" cy="26" rx="20" ry="17" fill="white" opacity="0.88" />
        <ellipse cx="60" cy="24" rx="18" ry="18" fill="white" opacity="0.88" />
        <ellipse cx="45" cy="20" rx="28" ry="18" fill="white" opacity="0.9" />
        <ellipse cx="45" cy="30" rx="43" ry="13" fill="rgba(200,230,255,0.2)" />
      </svg>
    </div>
  );
}

function Flower({ x, color = "#ff9ec4" }: { x: number; color?: string }) {
  return (
    <div className="absolute" style={{ bottom: "27%", left: `${x}%` }}>
      <svg viewBox="0 0 18 24" width="12" height="16">
        <line x1="9" y1="24" x2="9" y2="12" stroke="#5c7f63" strokeWidth="1.5" />
        <circle cx="9" cy="9" r="3" fill={color} opacity="0.9" />
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="9" cy="9" rx="2" ry="4" fill={color} opacity="0.7"
            transform={`rotate(${a} 9 9)`} />
        ))}
        <circle cx="9" cy="9" r="2" fill="#ffd854" />
      </svg>
    </div>
  );
}

function Butterfly({ x, y, delay = 0 }: { x: number; y: number; delay?: number }) {
  return (
    <div className="absolute butterfly" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}>
      <svg viewBox="0 0 20 14" width="16" height="11">
        <path d="M10 7 Q4 2 2 5 Q1 9 6 9 Q9 9 10 7" fill="#f9a8d4" opacity="0.85" />
        <path d="M10 7 Q16 2 18 5 Q19 9 14 9 Q11 9 10 7" fill="#f9a8d4" opacity="0.85" />
        <line x1="10" y1="4" x2="10" y2="10" stroke="#78716c" strokeWidth="0.8" />
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
  const [children, setChildren]   = useState<Child[]>([]);
  const [leafCounts, setLeafCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: kids } = await supabase
        .from("children")
        .select("id, name, color")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("sort_order");

      const kids_ = kids ?? [];
      setChildren(kids_);
      if (kids_.length > 0) setSelectedId(kids_[0].id);

      const { data: completed } = await supabase
        .from("lessons")
        .select("child_id")
        .eq("user_id", user.id)
        .eq("completed", true);

      // Also count book_read events as +1 leaf each
      const { data: bookEvents } = await supabase
        .from("app_events")
        .select("payload")
        .eq("user_id", user.id)
        .eq("type", "book_read");

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
  }, []);

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
          background: "linear-gradient(180deg, #5bafd4 0%, #82cde8 25%, #b2e4f0 50%, #c8ecb8 72%, #7ec46a 100%)",
          aspectRatio: "16/9",
          minHeight: 200,
        }}
      >
        {/* Sun */}
        <Sun />

        {/* Clouds */}
        <Cloud x={8}  y={8}  scale={1.1} delay={0} />
        <Cloud x={28} y={14} scale={0.7} delay={-5} alt />
        <Cloud x={55} y={6}  scale={0.85} delay={-2} />

        {/* Butterflies */}
        <Butterfly x={12} y={30} delay={0} />
        <Butterfly x={72} y={24} delay={1.8} />

        {/* Ground layers */}
        <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: "32%" }}>
          <svg viewBox="0 0 400 100" preserveAspectRatio="xMidYMax slice" className="w-full h-full">
            {/* Back hill */}
            <path d="M0 55 Q80 32 160 50 Q240 68 320 44 Q380 28 400 48 L400 100 L0 100 Z"
              fill="#7bc469" opacity="0.55" />
            {/* Mid ground */}
            <path d="M0 65 Q100 48 200 62 Q300 76 400 58 L400 100 L0 100 Z"
              fill="#5c8a57" />
            {/* Soil edge */}
            <path d="M0 65 Q100 48 200 62 Q300 76 400 58" fill="none"
              stroke="#7fc469" strokeWidth="1.5" opacity="0.8" />
            {/* Soil */}
            <path d="M0 75 Q100 68 200 73 Q300 78 400 70 L400 100 L0 100 Z"
              fill="#4a7040" />
          </svg>
        </div>

        {/* Decorative flowers */}
        <Flower x={3}  color="#ff9ec4" />
        <Flower x={6}  color="#ffd166" />
        <Flower x={88} color="#a8d8ea" />
        <Flower x={92} color="#ff9ec4" />
        <Flower x={95} color="#ffd166" />

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
