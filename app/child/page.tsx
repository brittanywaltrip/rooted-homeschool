"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  BADGE_CATEGORIES,
  getEarnedBadgeKeys,
} from "@/app/lib/badges-tiered";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null; birthday?: string | null };

// ─── 8-stage system (synced with garden page) ─────────────────────────────────

const GROWTH_STAGES = [
  { name: "Seed",          emoji: "🫘", min: 0,   color: "#c4956a", msg: "You're just getting started — and that's amazing!" },
  { name: "Sprouting",     emoji: "🌱", min: 1,   color: "#5c7f63", msg: "A tiny shoot appears!" },
  { name: "Seedling",      emoji: "🪴", min: 10,  color: "#e8927c", msg: "Look at you grow!" },
  { name: "Growing",       emoji: "🌿", min: 25,  color: "#5c7f63", msg: "Growing stronger every single day!" },
  { name: "Young Tree",    emoji: "🌳", min: 50,  color: "#2d5c38", msg: "Standing tall!" },
  { name: "Flourishing",   emoji: "🌲", min: 100, color: "#1e4828", msg: "Strong and steady!" },
  { name: "Blossoming",    emoji: "🌸", min: 200, color: "#d4789c", msg: "In full bloom — so beautiful!" },
  { name: "Bearing Fruit", emoji: "🍎", min: 500, color: "#c0392b", msg: "The harvest of all your hard work!" },
];

function getStageIndex(leaves: number) {
  let idx = 0;
  for (let i = 0; i < GROWTH_STAGES.length; i++) {
    if (leaves >= GROWTH_STAGES[i].min) idx = i;
  }
  return idx;
}

// ─── Inner page (needs Suspense for useSearchParams) ──────────────────────────

function ChildPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const childParam = searchParams.get("child");
  const confettiRef = useRef<HTMLCanvasElement>(null);

  const [children, setChildren] = useState<Child[]>([]);
  const [leafCounts, setLeafCounts] = useState<Record<string, number>>({});
  const [childIdx, setChildIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cheerIdx, setCheerIdx] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [earnedBadgeKeys, setEarnedBadgeKeys] = useState<Set<string>>(new Set());
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationData, setCelebrationData] = useState({ emoji: "", title: "", sub: "" });
  const [treeShaking, setTreeShaking] = useState(false);

  // Personalized cheers
  const child = children[childIdx];
  const childName = child?.name ?? "Friend";
  const cheers = [
    `${childName}, you're growing SO fast! 🌟`,
    `Every lesson is a new leaf, ${childName}! 🍃`,
    `${childName}, you're an amazing learner! ✨`,
    `Keep going, ${childName} — you're doing great! 💪`,
    `Look how tall your tree is, ${childName}! 🌳`,
    `${childName}, you're a superstar! ⭐`,
    `Learning is YOUR superpower, ${childName}! ⚡`,
    `Your tree is so proud of you, ${childName}! 🌿`,
  ];

  // Rotate cheer messages
  useEffect(() => {
    const t = setInterval(() => setCheerIdx((i) => (i + 1) % 8), 3500);
    return () => clearInterval(t);
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }

    const uid = session.user.id;
    setUserId(uid);

    const [{ data: kids }, { data: completed }, { data: activityEvents }, { data: memoryRows }] = await Promise.all([
      supabase.from("children").select("id, name, color, birthday")
        .eq("user_id", uid).eq("archived", false).order("sort_order"),
      supabase.from("lessons").select("child_id")
        .eq("user_id", uid).eq("completed", true),
      supabase.from("app_events").select("type, payload")
        .eq("user_id", uid).in("type", ["book_read", "memory_photo", "memory_project", "memory_book", "memory_field_trip", "memory_activity"]),
      supabase.from("memories").select("child_id, type")
        .eq("user_id", uid),
    ]);

    const counts: Record<string, number> = {};
    completed?.forEach((l) => { counts[l.child_id] = (counts[l.child_id] ?? 0) + 1; });
    activityEvents?.forEach((e) => {
      const cid = e.payload?.child_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    });
    (memoryRows ?? []).forEach((m: { child_id: string | null }) => {
      if (m.child_id) counts[m.child_id] = (counts[m.child_id] ?? 0) + 1;
    });

    setChildren(kids ?? []);
    setLeafCounts(counts);
    setLoading(false);

    // If URL has ?child=ID, select that child
    if (childParam && kids) {
      const idx = kids.findIndex((k: Child) => k.id === childParam);
      if (idx >= 0) setChildIdx(idx);
    }
  }, [router, childParam]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load tiered badges for selected child
  useEffect(() => {
    if (!userId || !child) return;
    getEarnedBadgeKeys(userId, child.id).then(setEarnedBadgeKeys);
  }, [userId, child]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived state
  const leaves = child ? (leafCounts[child.id] ?? 0) : 0;
  const stageIdx = getStageIndex(leaves);
  const stage = GROWTH_STAGES[stageIdx];
  const nextStage = GROWTH_STAGES[stageIdx + 1];
  const progress = nextStage
    ? ((leaves - stage.min) / (nextStage.min - stage.min)) * 100
    : 100;
  const childColor = child?.color ?? stage.color;

  // ─── Confetti ───────────────────────────────────────────────────────────────
  function fireConfetti() {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff8feb", "#a855f7", "#fb923c"];
    const particles: { x: number; y: number; vx: number; vy: number; color: string; size: number; rotation: number; rotSpeed: number; gravity: number; opacity: number; shape: string }[] = [];

    for (let i = 0; i < 120; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.4,
        vx: (Math.random() - 0.5) * 16,
        vy: -(8 + Math.random() * 12),
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 6,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        gravity: 0.2 + Math.random() * 0.1,
        opacity: 1,
        shape: Math.random() > 0.5 ? "rect" : "circle",
      });
    }

    let frame = 0;
    function animate() {
      frame++;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rotation += p.rotSpeed;
        if (frame > 50) p.opacity -= 0.015;
        if (p.opacity <= 0) continue;
        alive = true;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate((p.rotation * Math.PI) / 180);
        ctx!.globalAlpha = Math.max(0, p.opacity);
        ctx!.fillStyle = p.color;
        if (p.shape === "rect") {
          ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx!.beginPath();
          ctx!.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.restore();
      }
      if (alive && frame < 200) requestAnimationFrame(animate);
      else ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
    }
    animate();
  }

  function triggerCelebration(emoji: string, title: string, sub: string) {
    setCelebrationData({ emoji, title, sub });
    setShowCelebration(true);
    fireConfetti();
  }

  function handleTreeTap() {
    setTreeShaking(true);
    setTimeout(() => setTreeShaking(false), 700);
  }

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
            className="bg-white text-[#1a2c22] font-bold px-6 py-3 rounded-2xl shadow-lg">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen overflow-x-hidden relative flex flex-col"
      style={{
        background: "linear-gradient(180deg, #5bafd4 0%, #87ceeb 30%, #b2e4f0 58%, #7EC46A 78%, #4CAF50 100%)",
      }}
    >
      {/* Confetti canvas */}
      <canvas ref={confettiRef} className="fixed inset-0 pointer-events-none z-50" />

      {/* Butterfly */}
      <div className="fixed z-20 pointer-events-none text-2xl"
        style={{
          animation: "kidview-butterfly 18s cubic-bezier(0.4,0,0.6,1) infinite",
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))",
        }}>
        <span style={{ display: "inline-block", animation: "kidview-wingflap 0.6s ease-in-out infinite alternate" }}>🦋</span>
      </div>

      {/* Bee */}
      <div className="fixed z-20 pointer-events-none text-xl"
        style={{
          animation: "kidview-bee 14s cubic-bezier(0.4,0,0.6,1) infinite",
          animationDelay: "-4s",
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))",
        }}>
        <span style={{ display: "inline-block", animation: "kidview-beebob 0.8s ease-in-out infinite alternate" }}>🐝</span>
      </div>

      {/* Top bar */}
      <div className="flex items-center px-4 pt-4 pb-2 relative z-10">
        <button
          onClick={() => router.push("/dashboard/garden")}
          className="flex items-center gap-1 bg-white/25 hover:bg-white/40 backdrop-blur-sm text-white font-semibold text-sm px-3 py-2 rounded-full transition-colors"
        >
          &larr; Parent View
        </button>
      </div>

      {/* Sun */}
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

      {/* Clouds */}
      <div className="cloud-drift absolute top-12 left-4 opacity-80">
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

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center px-6 pb-32 relative z-10">

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
                      top: "-5%",
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
                Today is YOUR day, {childName}! Let&apos;s celebrate by learning something amazing 🌱
              </p>
            </div>
          );
        })()}

        {/* Child name */}
        <div
          className="text-5xl font-black text-white drop-shadow-lg mb-1 text-center tracking-tight cursor-pointer select-none active:scale-110 transition-transform"
          style={{ textShadow: "0 4px 16px rgba(0,0,0,0.2)" }}
        >
          {childName}
          {child?.birthday && (() => {
            const bd = new Date(child.birthday + "T12:00:00");
            const now = new Date();
            return bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate() ? " 🎂" : "";
          })()}
        </div>

        {/* Stage pill */}
        <div
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full font-black text-xl shadow-lg mb-2 cursor-pointer select-none active:scale-105 transition-transform"
          style={{ backgroundColor: childColor, color: "white" }}
        >
          <span>{stage.emoji}</span>
          <span>{stage.name}</span>
        </div>

        {/* Tree — big emoji, tappable */}
        <div
          className="cursor-pointer select-none mt-2"
          onClick={handleTreeTap}
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          <div
            className={`${treeShaking ? "animate-[kidview-shake_0.6s_ease-in-out]" : ""}`}
            style={{
              fontSize: "clamp(100px, 28vw, 140px)",
              lineHeight: 1,
              filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.2))",
              transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            {stage.emoji}
          </div>
        </div>

        {/* Leaf count */}
        <div
          className="flex items-center gap-2 px-5 py-2.5 rounded-full shadow-xl font-black text-white text-xl mt-2 cursor-pointer select-none active:scale-105 transition-transform"
          style={{ backgroundColor: childColor }}
        >
          🍃 {leaves} {leaves === 1 ? "leaf" : "leaves"}
        </div>

        {/* Progress to next stage */}
        {nextStage && (
          <div className="mt-5 w-full max-w-xs cursor-pointer select-none">
            <div className="flex justify-between text-xs font-bold text-white/85 mb-1.5 px-1">
              <span>{stage.emoji} {stage.name}</span>
              <span>{nextStage.min - leaves} more to {nextStage.name}</span>
            </div>
            <div className="w-full h-3.5 bg-white/25 rounded-full overflow-hidden shadow-inner relative">
              <div
                className="h-full rounded-full transition-all duration-1000 relative overflow-hidden"
                style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: "white" }}
              >
                <div className="absolute inset-0" style={{
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                  animation: "kidview-shimmer 2s infinite",
                }} />
              </div>
            </div>
          </div>
        )}

        {/* Streak */}
        <div className="mt-5 flex items-center gap-3 bg-white/20 backdrop-blur-sm px-5 py-3 rounded-2xl cursor-pointer select-none active:scale-105 transition-transform">
          <span className="text-3xl" style={{ animation: "kidview-fire 0.5s ease-in-out infinite alternate" }}>🔥</span>
          <div>
            <div className="text-white font-extrabold text-base" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>
              {leaves > 0 ? `${Math.min(leaves, 30)} day streak!` : "Start your streak!"}
            </div>
            <div className="text-white/80 text-xs font-semibold">Keep it going tomorrow! 💪</div>
          </div>
        </div>

        {/* Tiered Badges */}
        <div className="w-full max-w-sm mt-6">
          <p className="text-white font-extrabold text-sm text-center uppercase tracking-wide mb-3"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>
            🏆 {childName}&apos;s Badges
          </p>
          <div className="flex flex-wrap gap-2.5 justify-center">
            {BADGE_CATEGORIES.map((cat) =>
              cat.tiers.map((t, tIdx) => {
                const key = cat.perCurriculum
                  ? `${cat.id}_${t.tier}`
                  : `${cat.id}_${t.tier}`;
                const isEarned = cat.perCurriculum
                  ? [...earnedBadgeKeys].some(k => k.startsWith(`${cat.id}_${t.tier}_`))
                  : earnedBadgeKeys.has(key);
                const prevEarned = tIdx === 0
                  ? true
                  : cat.perCurriculum
                    ? [...earnedBadgeKeys].some(k => k.startsWith(`${cat.id}_${cat.tiers[tIdx - 1].tier}_`))
                    : earnedBadgeKeys.has(`${cat.id}_${cat.tiers[tIdx - 1].tier}`);
                const isNext = !isEarned && prevEarned;

                return (
                  <div
                    key={`${cat.id}_${t.tier}`}
                    className={`relative flex flex-col items-center rounded-2xl px-3 py-3 min-w-[72px] max-w-[80px] cursor-pointer select-none active:scale-95 transition-transform ${
                      isEarned
                        ? "bg-white/95 backdrop-blur-md shadow-xl ring-2 ring-white/30"
                        : isNext
                        ? "bg-white/40 backdrop-blur-md border-2 border-white/90 shadow-md"
                        : "bg-white/15 backdrop-blur-sm"
                    }`}
                    onClick={() => {
                      if (isEarned) {
                        triggerCelebration(
                          t.emoji,
                          `${childName}, you did it!`,
                          `You earned the <strong>${t.name}</strong> badge! ${t.description}`
                        );
                      }
                    }}
                  >
                    {isEarned && (
                      <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#2D5A3D] rounded-full flex items-center justify-center shadow-sm border-2 border-white">
                        <span className="text-white text-[10px] font-bold">{"\u2713"}</span>
                      </span>
                    )}
                    {isNext && (
                      <div className="bg-white text-[#2D5A3D] text-[7px] font-extrabold px-2 py-0.5 rounded-full mb-1 shadow-sm">
                        NEXT
                      </div>
                    )}
                    <span className={`text-3xl mb-1 ${!isEarned && !isNext ? "opacity-20 grayscale" : isNext ? "opacity-50" : ""}`}>
                      {t.emoji}
                    </span>
                    <span className={`text-[9px] font-bold text-center leading-tight ${
                      isEarned ? "text-[#2D2A26]" : isNext ? "text-white/90" : "text-white/30"
                    }`}>
                      {t.name}
                    </span>
                    {!isEarned && !isNext && (
                      <span className="text-[8px] opacity-30 mt-0.5">🔒</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Cheer message */}
        <div
          className="mt-8 text-center text-xl font-extrabold text-white drop-shadow-lg max-w-sm cursor-pointer select-none active:scale-105 transition-transform"
          style={{ textShadow: "0 3px 10px rgba(0,0,0,0.2)" }}
          onClick={() => setCheerIdx((i) => (i + 1) % cheers.length)}
        >
          {cheers[cheerIdx]}
        </div>
      </div>

      {/* Ground */}
      <div className="fixed bottom-0 left-0 right-0 pointer-events-none z-[1]" style={{ height: "18vh" }}>
        <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMax slice" className="w-full h-full">
          <path d="M0 50 Q80 32 160 46 Q240 62 320 40 Q380 24 400 44 L400 90 L0 90 Z"
            fill="#4CAF50" opacity="0.5" />
          <path d="M0 58 Q100 44 200 56 Q300 70 400 52 L400 90 L0 90 Z" fill="#388E3C" />
          {[8, 15, 85, 92].map((x) => (
            <g key={x} transform={`translate(${x * 4}, 52)`}>
              <line x1="0" y1="0" x2="0" y2="-14" stroke="#2E7D32" strokeWidth="1.5" />
              <circle cx="0" cy="-17" r="4" fill={["#ff9ec4", "#ffd166", "#a8d8ea", "#ff9ec4"][Math.floor(x / 10) % 4]} />
            </g>
          ))}
        </svg>
      </div>

      {/* Celebration overlay */}
      {showCelebration && (
        <div
          className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowCelebration(false)}
        >
          <div
            className="bg-white rounded-3xl p-8 text-center max-w-[300px] w-[90%] shadow-2xl animate-[kidview-cardpop_0.5s_cubic-bezier(0.34,1.56,0.64,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-6xl mb-2 animate-bounce">{celebrationData.emoji}</div>
            <div className="text-2xl font-black text-[#2D2A26] mb-1">{celebrationData.title}</div>
            <div className="text-sm text-[#8B7E74] mb-5 leading-relaxed" dangerouslySetInnerHTML={{ __html: celebrationData.sub }} />
            <button
              onClick={() => setShowCelebration(false)}
              className="bg-gradient-to-br from-[#2D5A3D] to-[#3d7a52] text-white font-extrabold px-8 py-3 rounded-2xl shadow-lg text-base active:scale-95 transition-transform"
            >
              AWESOME! 🎉
            </button>
          </div>
        </div>
      )}

      {/* Inline keyframe styles */}
      <style jsx>{`
        @keyframes kidview-butterfly {
          0%   { top: 28%; left: -5%; transform: rotate(3deg) scaleX(1); }
          8%   { top: 25%; left: 8%; transform: rotate(-2deg) scaleX(1); }
          16%  { top: 22%; left: 18%; transform: rotate(2deg) scaleX(1); }
          24%  { top: 26%; left: 28%; transform: rotate(-1deg) scaleX(1); }
          32%  { top: 20%; left: 38%; transform: rotate(3deg) scaleX(1); }
          40%  { top: 24%; left: 48%; transform: rotate(0deg) scaleX(1); }
          48%  { top: 18%; left: 56%; transform: rotate(-2deg) scaleX(-1); }
          56%  { top: 22%; left: 64%; transform: rotate(1deg) scaleX(-1); }
          64%  { top: 26%; left: 72%; transform: rotate(-1deg) scaleX(-1); }
          72%  { top: 20%; left: 80%; transform: rotate(2deg) scaleX(-1); }
          80%  { top: 24%; left: 88%; transform: rotate(0deg) scaleX(-1); }
          88%  { top: 22%; left: 96%; transform: rotate(-2deg) scaleX(-1); }
          100% { top: 26%; left: 108%; transform: rotate(1deg) scaleX(-1); }
        }
        @keyframes kidview-wingflap {
          0% { transform: scaleX(1) rotate(0deg); }
          100% { transform: scaleX(0.7) rotate(2deg); }
        }
        @keyframes kidview-bee {
          0%   { top: 38%; right: -5%; transform: scaleX(-1); }
          10%  { top: 36%; right: 8%; transform: scaleX(-1); }
          20%  { top: 33%; right: 18%; transform: scaleX(-1); }
          30%  { top: 36%; right: 28%; transform: scaleX(-1); }
          40%  { top: 32%; right: 40%; transform: scaleX(-1); }
          50%  { top: 35%; right: 52%; transform: scaleX(-1); }
          60%  { top: 31%; right: 62%; transform: scaleX(1); }
          70%  { top: 34%; right: 72%; transform: scaleX(1); }
          80%  { top: 30%; right: 82%; transform: scaleX(1); }
          90%  { top: 34%; right: 94%; transform: scaleX(1); }
          100% { top: 36%; right: 108%; transform: scaleX(1); }
        }
        @keyframes kidview-beebob {
          0% { transform: translateY(0) rotate(-1deg); }
          100% { transform: translateY(-2px) rotate(1deg); }
        }
        @keyframes kidview-fire {
          0% { transform: scale(1) rotate(-2deg); filter: brightness(1); }
          100% { transform: scale(1.08) rotate(2deg); filter: brightness(1.15); }
        }
        @keyframes kidview-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes kidview-shake {
          0%, 100% { transform: rotate(0deg); }
          15% { transform: rotate(-8deg); }
          30% { transform: rotate(6deg); }
          45% { transform: rotate(-5deg); }
          60% { transform: rotate(3deg); }
          75% { transform: rotate(-2deg); }
        }
        @keyframes kidview-cardpop {
          0% { transform: scale(0.7); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Exported page (Suspense boundary for useSearchParams) ────────────────────

export default function ChildPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(180deg, #87CEEB 0%, #5BAFD4 50%, #7EC46A 100%)" }}>
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🌿</div>
          <p className="text-white text-xl font-bold drop-shadow">Loading your garden…</p>
        </div>
      </div>
    }>
      <ChildPageInner />
    </Suspense>
  );
}
