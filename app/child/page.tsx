"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null; birthday?: string | null };

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGES = [
  { name: "Tiny Seed",      emoji: "🌰", min: 0,  color: "#c4956a", bg: "#f5ede0", msg: "You're just getting started — and that's amazing!" },
  { name: "Sprouting!",     emoji: "🌱", min: 5,  color: "#5c7f63", bg: "#e8f5ea", msg: "Look at you go! You're growing fast!" },
  { name: "Sapling",        emoji: "🌿", min: 15, color: "#3d5c42", bg: "#d4ead4", msg: "Growing stronger every single day!" },
  { name: "Growing Tall",   emoji: "🌳", min: 30, color: "#2d5c38", bg: "#c8e6c8", msg: "Wow, you're reaching for the sky!" },
  { name: "THRIVING! ✨",   emoji: "🌲", min: 50, color: "#1e4828", bg: "#b8ddb8", msg: "You are AMAZING! Look how far you've come!" },
];

function getStageIndex(leaves: number) {
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (leaves >= STAGES[i].min) idx = i;
  }
  return idx;
}

const BADGES = [
  { id: "first_leaf",  emoji: "⭐", label: "First Leaf",  check: (l: number) => l >= 1  },
  { id: "sprout",      emoji: "🌱", label: "Sprouting!",  check: (l: number) => l >= 5  },
  { id: "ten",         emoji: "🍃", label: "10 Leaves",   check: (l: number) => l >= 10 },
  { id: "sapling",     emoji: "🌿", label: "Sapling",     check: (l: number) => l >= 15 },
  { id: "twenty_five", emoji: "🏅", label: "25 Leaves",   check: (l: number) => l >= 25 },
  { id: "growing",     emoji: "🌳", label: "Growing!",    check: (l: number) => l >= 30 },
  { id: "fifty",       emoji: "🏆", label: "50 Leaves",   check: (l: number) => l >= 50 },
  { id: "century",     emoji: "💯", label: "100 Leaves",  check: (l: number) => l >= 100 },
];

const CHEERS = [
  "You're growing SO fast! 🌟",
  "Every lesson is a new leaf! 🍃",
  "You're an amazing learner! ✨",
  "Keep going — you're doing great! 💪",
  "Look how tall your tree is! 🌳",
  "You're a superstar! ⭐",
  "Learning is your superpower! ⚡",
  "Your tree is so proud of you! 🌿",
];

// ─── Tree SVG ──────────────────────────────────────────────────────────────────

function BigTree({ stageIndex }: { stageIndex: number }) {
  const stage = stageIndex + 1;
  return (
    <svg viewBox="0 0 100 120" className="w-full h-full overflow-visible" aria-hidden>
      <ellipse cx="50" cy="113" rx="24" ry="5" fill="rgba(0,0,0,0.12)" />

      {stage === 1 && (
        <g>
          <path d="M44 96 Q50 84 56 96 Q50 108 44 96" fill="#8b6f47" className="leaf-shimmer" />
          <path d="M50 85 Q53 76 50 68" stroke="#7a9e7e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <ellipse cx="50" cy="65" rx="4" ry="3" fill="#7a9e7e" opacity="0.7" />
        </g>
      )}
      {stage >= 2 && <rect x="47" y="72" width="6" height="40" rx="3" fill="#8b6f47" />}
      {stage === 2 && (
        <g className="leaf-shimmer">
          <path d="M50 82 Q33 70 38 54 Q50 64 50 82" fill="#7a9e7e" />
          <path d="M50 82 Q67 70 62 54 Q50 64 50 82" fill="#5c7f63" />
        </g>
      )}
      {stage === 3 && (
        <g>
          <rect x="47" y="58" width="6" height="16" rx="3" fill="#8b6f47" />
          <path d="M50 74 Q28 60 35 40 Q48 54 50 74" fill="#5c7f63" className="leaf-shimmer" />
          <path d="M50 74 Q72 60 65 40 Q52 54 50 74" fill="#7a9e7e" className="leaf-shimmer" />
          <circle cx="50" cy="36" r="17" fill="#5c7f63" opacity="0.9" />
          <circle cx="50" cy="24" r="13" fill="#3d5c42" />
        </g>
      )}
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
          <circle cx="20" cy="36" r="2" fill="#a8d8a8" className="sparkle" style={{ animationDelay: "0.3s" }} />
          <circle cx="80" cy="30" r="2" fill="#a8d8a8" className="sparkle" style={{ animationDelay: "0.9s" }} />
          <circle cx="50" cy="8"  r="1.5" fill="#c8f0c8" className="sparkle" style={{ animationDelay: "1.5s" }} />
        </g>
      )}
    </svg>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ChildPage() {
  const router = useRouter();
  const [children,   setChildren]   = useState<Child[]>([]);
  const [leafCounts, setLeafCounts] = useState<Record<string, number>>({});
  const [childIdx,   setChildIdx]   = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [cheerIdx,   setCheerIdx]   = useState(0);

  // Rotate cheer messages
  useEffect(() => {
    const t = setInterval(() => {
      setCheerIdx((i) => (i + 1) % CHEERS.length);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }

    const uid = session.user.id;

    const [{ data: kids }, { data: completed }, { data: bookEvents }] = await Promise.all([
      supabase.from("children").select("id, name, color, birthday")
        .eq("user_id", uid).eq("archived", false).order("sort_order"),
      supabase.from("lessons").select("child_id")
        .eq("user_id", uid).eq("completed", true),
      supabase.from("app_events").select("payload")
        .eq("user_id", uid).eq("type", "book_read"),
    ]);

    const counts: Record<string, number> = {};
    completed?.forEach((l) => { counts[l.child_id] = (counts[l.child_id] ?? 0) + 1; });
    bookEvents?.forEach((e) => {
      const cid = e.payload?.child_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    });

    setChildren(kids ?? []);
    setLeafCounts(counts);
    setLoading(false);
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  const child   = children[childIdx];
  const leaves  = child ? (leafCounts[child.id] ?? 0) : 0;
  const stageIdx = getStageIndex(leaves);
  const stage    = STAGES[stageIdx];
  const nextStage = STAGES[stageIdx + 1];
  const progress  = nextStage
    ? ((leaves - stage.min) / (nextStage.min - stage.min)) * 100
    : 100;
  const earnedBadges = BADGES.filter((b) => b.check(leaves));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(180deg, #87CEEB 0%, #5BAFD4 50%, #7EC46A 100%)" }}>
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🌿</div>
          <p className="text-white text-xl font-bold drop-shadow">Loading your garden…</p>
        </div>
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(180deg, #87CEEB 0%, #5BAFD4 50%, #7EC46A 100%)" }}>
        <div className="text-center px-8">
          <div className="text-6xl mb-4">🌱</div>
          <p className="text-white text-2xl font-bold drop-shadow mb-2">No children set up yet!</p>
          <p className="text-white/80 mb-6">Ask a parent to add children in Settings.</p>
          <button onClick={() => router.push("/dashboard")}
            className="bg-white text-[#3d5c42] font-bold px-6 py-3 rounded-2xl shadow-lg">
            Go back
          </button>
        </div>
      </div>
    );
  }

  const childColor = child?.color ?? "#5c7f63";

  return (
    <div
      className="min-h-screen overflow-hidden relative flex flex-col"
      style={{
        background: "linear-gradient(180deg, #5bafd4 0%, #87ceeb 30%, #b2e4f0 58%, #7EC46A 78%, #4CAF50 100%)",
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 relative z-10">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-1.5 bg-white/25 hover:bg-white/40 backdrop-blur-sm text-white font-semibold text-sm px-3 py-2 rounded-full transition-colors"
        >
          <ChevronLeft size={16} />
          Parent View
        </button>

        {/* Child switcher */}
        {children.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChildIdx((i) => (i - 1 + children.length) % children.length)}
              className="w-8 h-8 bg-white/25 hover:bg-white/40 backdrop-blur-sm rounded-full flex items-center justify-center text-white transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex gap-1.5">
              {children.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => setChildIdx(i)}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    i === childIdx ? "scale-125 bg-white" : "bg-white/50"
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => setChildIdx((i) => (i + 1) % children.length)}
              className="w-8 h-8 bg-white/25 hover:bg-white/40 backdrop-blur-sm rounded-full flex items-center justify-center text-white transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* ── Sun ──────────────────────────────────────────────── */}
      <div className="absolute top-8 right-6 sun-glow z-10" style={{ width: 72, height: 72 }}>
        <svg viewBox="0 0 72 72" className="w-full h-full">
          <g className="sun-rays-spin" style={{ transformOrigin: "36px 36px" }}>
            {[0, 45, 90, 135].map((a) => (
              <line key={a} x1="36" y1="8" x2="36" y2="2" stroke="#ffc93d" strokeWidth="3"
                strokeLinecap="round" transform={`rotate(${a} 36 36)`} />
            ))}
            {[22.5, 67.5, 112.5, 157.5].map((a) => (
              <line key={a} x1="36" y1="10" x2="36" y2="4" stroke="#ffd86b" strokeWidth="2"
                strokeLinecap="round" transform={`rotate(${a} 36 36)`} />
            ))}
          </g>
          <circle cx="36" cy="36" r="18" fill="#ffd854" />
          <circle cx="36" cy="36" r="13" fill="#ffec8a" />
          <circle cx="31" cy="31" r="3" fill="#fff5a0" opacity="0.6" />
        </svg>
      </div>

      {/* ── Cloud decorations ─────────────────────────────────── */}
      <div className="cloud-drift absolute top-12 left-4 opacity-80" style={{ animationDelay: "0s" }}>
        <svg viewBox="0 0 100 48" width="100" height="48">
          <ellipse cx="50" cy="34" rx="48" ry="14" fill="white" opacity="0.9" />
          <ellipse cx="30" cy="28" rx="22" ry="20" fill="white" opacity="0.9" />
          <ellipse cx="66" cy="26" rx="20" ry="20" fill="white" opacity="0.9" />
          <ellipse cx="50" cy="22" rx="30" ry="20" fill="white" />
        </svg>
      </div>
      <div className="cloud-drift-slow absolute top-16 right-24 opacity-60" style={{ animationDelay: "-6s" }}>
        <svg viewBox="0 0 80 36" width="80" height="36">
          <ellipse cx="40" cy="26" rx="38" ry="11" fill="white" opacity="0.9" />
          <ellipse cx="24" cy="22" rx="18" ry="16" fill="white" opacity="0.9" />
          <ellipse cx="54" cy="20" rx="16" ry="15" fill="white" opacity="0.9" />
          <ellipse cx="40" cy="17" rx="24" ry="15" fill="white" />
        </svg>
      </div>

      {/* ── Main content area ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10">

        {/* Birthday celebration */}
        {child?.birthday && (() => {
          const bd = new Date(child.birthday + "T12:00:00");
          const now = new Date();
          const isBirthday = bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate();
          if (!isBirthday) return null;
          return (
            <div className="text-center mb-4">
              <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden>
                {Array.from({ length: 20 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute rounded-full"
                    style={{
                      left: `${5 + Math.random() * 90}%`,
                      top: `-5%`,
                      width: 6 + Math.random() * 4,
                      height: 6 + Math.random() * 4,
                      background: ["#f9a8d4", "#fbbf24", "#86efac", "#93c5fd", "#c4b5fd"][i % 5],
                      animation: `birthday-confetti ${3 + Math.random() * 2}s linear infinite`,
                      animationDelay: `${Math.random() * 3}s`,
                    }}
                  />
                ))}
              </div>
              <p className="text-sm text-white/80 font-medium">
                Today is YOUR day, {child.name}! Let&apos;s celebrate by learning something amazing 🌱
              </p>
            </div>
          );
        })()}

        {/* Child name */}
        <div
          className="text-4xl sm:text-5xl font-black text-white drop-shadow-lg mb-1 text-center tracking-tight"
          style={{ textShadow: "0 3px 12px rgba(0,0,0,0.25)" }}
        >
          {child?.name}
          {child?.birthday && (() => {
            const bd = new Date(child.birthday + "T12:00:00");
            const now = new Date();
            return bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate() ? " 🎂" : "";
          })()}
        </div>

        {/* Stage badge */}
        <div
          className="inline-flex items-center gap-2 px-5 py-2 rounded-full font-black text-lg sm:text-xl shadow-lg mb-6"
          style={{ backgroundColor: childColor, color: "white" }}
        >
          <span>{stage.emoji}</span>
          <span>{stage.name}</span>
        </div>

        {/* Tree */}
        <div className="relative">
          <div
            className="garden-sway"
            style={{
              width: "clamp(160px, 40vw, 240px)",
              height: "clamp(180px, 44vw, 270px)",
              transformOrigin: "center bottom",
            }}
          >
            <BigTree stageIndex={stageIdx} />
          </div>

          {/* Floating leaf count badge */}
          <div
            className="absolute -top-4 left-1/2 -translate-x-1/2 badge-float flex items-center gap-2 px-4 py-2 rounded-full shadow-xl font-black text-white text-xl sm:text-2xl whitespace-nowrap"
            style={{ backgroundColor: childColor }}
          >
            🍃 {leaves} {leaves === 1 ? "leaf" : "leaves"}
          </div>
        </div>

        {/* Progress to next stage */}
        {nextStage && (
          <div className="mt-5 w-full max-w-xs">
            <div className="flex justify-between text-xs font-semibold text-white/80 mb-1.5 px-1">
              <span>{stage.emoji} {stage.name}</span>
              <span>{nextStage.min - leaves} more to {nextStage.name} {nextStage.emoji}</span>
            </div>
            <div className="w-full h-3 bg-white/30 rounded-full overflow-hidden shadow-inner">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: "white" }}
              />
            </div>
          </div>
        )}

        {/* Earned badges */}
        {earnedBadges.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-3 justify-center">
            {earnedBadges.map((b) => (
              <div
                key={b.id}
                className="badge-float flex flex-col items-center bg-white/90 backdrop-blur-sm rounded-2xl px-3 py-2.5 shadow-lg min-w-[64px]"
              >
                <span className="text-2xl sm:text-3xl mb-1">{b.emoji}</span>
                <span className="text-[10px] font-bold text-[#2d2926] text-center leading-tight">{b.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Cheer message */}
        <div
          className="mt-8 text-center text-lg sm:text-xl font-bold text-white drop-shadow-lg max-w-sm"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
          key={cheerIdx}
        >
          {CHEERS[cheerIdx]}
        </div>
      </div>

      {/* ── Ground decorations ────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: "22%" }}>
        <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMax slice" className="w-full h-full">
          <path d="M0 50 Q80 32 160 46 Q240 62 320 40 Q380 24 400 44 L400 90 L0 90 Z"
            fill="#4CAF50" opacity="0.5" />
          <path d="M0 58 Q100 44 200 56 Q300 70 400 52 L400 90 L0 90 Z" fill="#388E3C" />
          {/* Flowers */}
          {[8, 15, 85, 92].map((x) => (
            <g key={x} transform={`translate(${x * 4}, 52)`}>
              <line x1="0" y1="0" x2="0" y2="-14" stroke="#2E7D32" strokeWidth="1.5" />
              <circle cx="0" cy="-17" r="4" fill={["#ff9ec4","#ffd166","#a8d8ea","#ff9ec4"][Math.floor(x/10)%4]} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
