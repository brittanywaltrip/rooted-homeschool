"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { STAGE_INFO, LEAF_THRESHOLDS, getStageFromLeaves } from "@/components/GardenScene";

function treeEmoji(leaves: number): string {
  const s = getStageFromLeaves(leaves);
  const map: Record<number, string> = { 1:"🌱", 2:"🌿", 3:"🪴", 4:"🌳", 5:"🌲", 6:"🌸", 7:"🍃", 8:"🌳", 9:"🍂", 10:"🌳" };
  return map[s] ?? "🌱";
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

type LessonRow = {
  child_id: string;
  date: string | null;
  scheduled_date: string | null;
  hours: number | null;
};

// ─── Stats helpers ────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getStreak(activeDates: Set<string>): { current: number; best: number } {
  let current = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const temp = new Date(cursor);
  while (activeDates.has(toDateStr(temp))) {
    current++;
    temp.setDate(temp.getDate() - 1);
  }
  if (current === 0) {
    cursor.setDate(cursor.getDate() - 1);
    while (activeDates.has(toDateStr(cursor))) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }
  const sorted = [...activeDates].sort();
  let best = 0, running = 0;
  let prev: Date | null = null;
  for (const ds of sorted) {
    const d = new Date(ds + "T12:00:00");
    if (prev) {
      const diff = Math.round((d.getTime() - prev.getTime()) / 86400000);
      running = diff === 1 ? running + 1 : 1;
    } else {
      running = 1;
    }
    best = Math.max(best, running);
    prev = d;
  }
  return { current, best };
}

// ─── Stage helpers (delegate to GardenScene) ──────────────────────────────────

const STAGES = STAGE_INFO.map((s, i) => ({
  name: s.name,
  desc: s.desc,
  min:  LEAF_THRESHOLDS[i],
  bg:   "#e8f0e9",
  text: s.color,
}));

function getStageIndex(leaves: number) {
  return getStageFromLeaves(leaves) - 1; // 0-based
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

// ─── Garden scene decorations ─────────────────────────────────────────────────

function Sun() {
  return (
    <div className="absolute top-4 right-5 sun-glow" style={{ width: 56, height: 56 }}>
      <svg viewBox="0 0 56 56" className="w-full h-full" overflow="visible">
        {/* Soft radial glow behind sun */}
        <circle cx="28" cy="28" r="32" fill="#fff3a0" opacity="0.3" />
        <g className="sun-rays-spin" style={{ transformOrigin: "28px 28px" }}>
          {[0, 45, 90, 135].map((a) => (
            <line key={a} x1="28" y1="6" x2="28" y2="1" stroke="#ffc93d" strokeWidth="2.5"
              strokeLinecap="round" transform={`rotate(${a} 28 28)`} opacity="0.8" />
          ))}
          {[22.5, 67.5, 112.5, 157.5].map((a) => (
            <line key={a} x1="28" y1="7.5" x2="28" y2="3" stroke="#ffd86b" strokeWidth="1.5"
              strokeLinecap="round" transform={`rotate(${a} 28 28)`} opacity="0.8" />
          ))}
        </g>
        <circle cx="28" cy="28" r="14" fill="#ffd84d" opacity="1" />
        <circle cx="28" cy="28" r="10" fill="#ffe680" opacity="0.9" />
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
        <ellipse cx="45" cy="30" rx="43" ry="13" fill="#ffffff" opacity="0.9" />
        <ellipse cx="26" cy="26" rx="20" ry="17" fill="#ffffff" opacity="0.9" />
        <ellipse cx="60" cy="24" rx="18" ry="18" fill="#ffffff" opacity="0.9" />
        <ellipse cx="45" cy="20" rx="28" ry="18" fill="#ffffff" opacity="0.9" />
        <ellipse cx="45" cy="30" rx="43" ry="13" fill="rgba(200,230,255,0.15)" />
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
        <circle cx="9" cy="9" r="2" fill="#ffd84d" />
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
  const [children, setChildren]     = useState<Child[]>([]);
  const [leafCounts, setLeafCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [allLessons, setAllLessons] = useState<LessonRow[]>([]);

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
        supabase.from("lessons").select("child_id, date, scheduled_date, hours").eq("user_id", effectiveUserId).eq("completed", true),
        supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
      ]);

      setAllLessons((completed as LessonRow[]) ?? []);

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

  const [tipDismissed, setTipDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("garden-tip-dismissed") === "1";
  });

  function dismissTip() {
    localStorage.setItem("garden-tip-dismissed", "1");
    setTipDismissed(true);
  }

  const totalLeaves = Object.values(leafCounts).reduce((s, n) => s + n, 0);

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

      {/* ── First-visit tip banner ───────────────────────── */}
      {!tipDismissed && totalLeaves === 0 && (
        <div className="flex items-start gap-3 rounded-2xl border px-4 py-3" style={{ background: "#e8f0e9", borderColor: "#5c7f63" }}>
          <p className="flex-1 text-sm text-[#2d2926] leading-relaxed">
            🌱 Every lesson you log grows a leaf! Complete 5 lessons to reach Seedling stage.
          </p>
          <button
            type="button"
            onClick={dismissTip}
            aria-label="Dismiss tip"
            className="shrink-0 text-[#5c7f63] hover:text-[#2d5a3d] text-lg leading-none mt-0.5 transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Garden Scene ─────────────────────────────────── */}
      <div
        className="relative w-full overflow-hidden rounded-3xl shadow-md"
        style={{
          background: "linear-gradient(180deg, #a8c8e8 0%, #c4dff0 30%, #deeef8 60%, #e8f4e8 80%, #7ab87a 100%)",
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
        <Butterfly x={12} y={30} delay={0}   color="#f9a8d4" />
        <Butterfly x={72} y={24} delay={1.8} color="#fbbf24" />
        <Butterfly x={45} y={38} delay={3.2} color="#86efac" />

        {/* Ground layers */}
        <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: "32%" }}>
          <svg viewBox="0 0 400 100" preserveAspectRatio="xMidYMax slice" className="w-full h-full">
            {/* Back hill */}
            <path d="M0 55 Q80 32 160 50 Q240 68 320 44 Q380 28 400 48 L400 100 L0 100 Z"
              fill="#8aba6a" opacity="0.6" />
            {/* Mid ground */}
            <path d="M0 65 Q100 48 200 62 Q300 76 400 58 L400 100 L0 100 Z"
              fill="#5c8a47" />
            {/* Soil edge */}
            <path d="M0 65 Q100 48 200 62 Q300 76 400 58" fill="none"
              stroke="#6aa050" strokeWidth="1.5" opacity="0.8" />
            {/* Soil */}
            <path d="M0 75 Q100 68 200 73 Q300 78 400 70 L400 100 L0 100 Z"
              fill="#3d6030" />
          </svg>
        </div>

        {/* Decorative flowers */}
        <Flower x={3}  color="#e8758a" />
        <Flower x={6}  color="#f5e070" />
        <Flower x={88} color="#e8758a" />
        <Flower x={92} color="#f5e070" />
        <Flower x={95} color="#e8758a" />

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
                  className={`${swayClass} relative flex items-end justify-center`}
                  style={{
                    transformOrigin: "center bottom",
                    animationDelay: `${i * 0.7}s`,
                  }}
                >
                  <span
                    style={{
                      fontSize: "clamp(44px, 11vw, 72px)",
                      lineHeight: 1,
                      display: "block",
                      filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.2))",
                      userSelect: "none",
                    }}
                    aria-hidden
                  >
                    {treeEmoji(leaves)}
                  </span>

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
                {selectedStage.name}
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
            <div style={{ width: 80, height: 88, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span
                style={{ fontSize: 64, lineHeight: 1, filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.2))", userSelect: "none" }}
                aria-hidden
              >
                {treeEmoji(selectedLeaves)}
              </span>
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

      {/* ── Your Stats ─────────────────────────────── */}
      {(() => {
        const activeDates = new Set(
          allLessons.map((l) => l.date ?? l.scheduled_date).filter(Boolean) as string[]
        );
        const { current: currentStreak, best: bestStreak } = getStreak(activeDates);
        const totalHours = allLessons.reduce((s, l) => s + (l.hours ?? 0), 0);
        const dayTotals = [0, 0, 0, 0, 0, 0, 0];
        allLessons.forEach((l) => {
          const d = l.date ?? l.scheduled_date;
          if (d) dayTotals[new Date(d + "T12:00:00").getDay()]++;
        });
        const mostActiveDay = dayTotals.reduce((best, v, i) => (v > dayTotals[best] ? i : best), 0);
        const hasSomeData = allLessons.length > 0;
        return (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
              Your Stats
            </h2>
            {!hasSomeData ? (
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 text-center">
                <p className="text-sm text-[#7a6f65]">Complete lessons to see your stats here 📊</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gradient-to-br from-[#fff8ed] to-[#fef3dc] border border-[#f5c97a]/40 rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">🔥</div>
                  <p className="text-2xl font-bold text-[#c4956a]">{currentStreak}</p>
                  <p className="text-xs font-medium text-[#8b6f47] mt-0.5">Current streak</p>
                  <p className="text-[10px] text-[#b5aca4] mt-0.5">
                    {currentStreak === 0 ? "Start today!" : `${currentStreak} day${currentStreak !== 1 ? "s" : ""}`}
                  </p>
                </div>
                <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">🏆</div>
                  <p className="text-2xl font-bold text-[#3d5c42]">{bestStreak}</p>
                  <p className="text-xs font-medium text-[#5c7f63] mt-0.5">Best streak</p>
                  <p className="text-[10px] text-[#b5aca4] mt-0.5">Personal record</p>
                </div>
                <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">📚</div>
                  <p className="text-2xl font-bold text-[#2d2926]">{allLessons.length}</p>
                  <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Lessons logged</p>
                  <p className="text-[10px] text-[#b5aca4] mt-0.5">All time</p>
                </div>
                <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">⏱️</div>
                  <p className="text-2xl font-bold text-[#2d2926]">
                    {totalHours % 1 === 0 ? `${totalHours}h` : `${totalHours.toFixed(1)}h`}
                  </p>
                  <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Total hours</p>
                  {dayTotals[mostActiveDay] > 0 && (
                    <p className="text-[10px] text-[#5c7f63] mt-0.5 font-medium">
                      Most active: {DAY_NAMES[mostActiveDay]}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="h-4" />
    </div>
  );
}
