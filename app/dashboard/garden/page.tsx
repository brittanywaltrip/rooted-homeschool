"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { STAGE_INFO, LEAF_THRESHOLDS, getStageFromLeaves } from "@/components/GardenScene";
import PageHero from "@/app/components/PageHero";
import { checkAndAwardBadges, checkFoundingBadge, ACTIVITY_BADGES } from "@/lib/badges";
import { posthog } from "@/lib/posthog";

function treeEmoji(leaves: number): string {
  const s = getStageFromLeaves(leaves);
  const map: Record<number, string> = { 1:"🟤", 2:"🌱", 3:"🌿", 4:"🪴", 5:"🌳", 6:"🌲", 7:"🌳", 8:"🌸", 9:"🌳", 10:"🌳" };
  return map[s] ?? "🌱";
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null; birthday?: string | null };

type LessonRow = {
  child_id: string;
  date: string | null;
  scheduled_date: string | null;
  hours: number | null;
};

// ─── Tree sizes per stage ────────────────────────────────────────────────────

const TREE_SIZE: Record<number, number> = {
  1: 40, 2: 50, 3: 60, 4: 70, 5: 80,
  6: 90, 7: 100, 8: 110, 9: 116, 10: 124,
};

type VacationBlock = { start_date: string; end_date: string; name: string };

// ─── Stats helpers ────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  { id: "first_leaf",    emoji: "⭐", label: "First Leaf",      check: (l: number) => l >= 1,   tooltip: "Complete your first lesson"       },
  { id: "sprout",        emoji: "🌱", label: "Sprouting!",      check: (l: number) => l >= 5,   tooltip: "Earn 5 leaves"                    },
  { id: "ten_leaves",    emoji: "🍃", label: "10 Leaves",       check: (l: number) => l >= 10,  tooltip: "Complete 10 lessons"              },
  { id: "sapling",       emoji: "🌿", label: "Sapling",         check: (l: number) => l >= 15,  tooltip: "Reach the Sapling garden stage"   },
  { id: "twenty_five",   emoji: "🏅", label: "25 Leaves",       check: (l: number) => l >= 25,  tooltip: "Complete 25 lessons"              },
  { id: "growing",       emoji: "🌳", label: "Growing!",        check: (l: number) => l >= 30,  tooltip: "Earn 25 leaves"                   },
  { id: "fifty",         emoji: "🏆", label: "50 Leaves",       check: (l: number) => l >= 50,  tooltip: "Complete 50 lessons"              },
  { id: "thriving",      emoji: "🌲", label: "Thriving!",       check: (l: number) => l >= 50,  tooltip: "Reach the Thriving garden stage"  },
  { id: "century",       emoji: "💯", label: "100 Leaves",      check: (l: number) => l >= 100, tooltip: "Complete 100 lessons"             },
];

// ─── Garden scene decorations ─────────────────────────────────────────────────

function Sun() {
  return (
    <div className="absolute top-4 right-5 sun-glow" style={{ width: 44, height: 44 }}>
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
      <svg viewBox="0 0 30 22" width="24" height="17">
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
  const [children, setChildren]         = useState<Child[]>([]);
  const [leafCounts, setLeafCounts]     = useState<Record<string, number>>({});
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [allLessons, setAllLessons]     = useState<LessonRow[]>([]);
  const [vacationBlocks, setVacationBlocks] = useState<VacationBlock[]>([]);
  const [familyName, setFamilyName]     = useState("");
  const [profile, setProfile]           = useState<{ plan_type?: string; subscription_status?: string } | null>(null);
  const [isAffiliate, setIsAffiliate]   = useState(false);
  const [badgeCelebration, setBadgeCelebration] = useState<string | null>(null);
  const [earnedActivityBadgeIds, setEarnedActivityBadgeIds] = useState<Set<string>>(new Set());
  const [memoriesCount, setMemoriesCount] = useState(0);
  const [booksCount, setBooksCount] = useState(0);

  const todayStr = toDateStr(new Date());
  const activeVacation = vacationBlocks.find((b) => todayStr >= b.start_date && todayStr <= b.end_date) ?? null;

  useEffect(() => { document.title = "Garden \u00b7 Rooted"; localStorage.setItem("rooted_visited_garden", "1"); posthog.capture('page_viewed', { page: 'garden' }); }, []);

  useEffect(() => {
    if (!effectiveUserId) return;
    async function load() {
      const { data: kids } = await supabase
        .from("children")
        .select("id, name, color, birthday")
        .eq("user_id", effectiveUserId)
        .eq("archived", false)
        .order("sort_order");

      const kids_ = kids ?? [];
      setChildren(kids_);
      if (kids_.length > 0) setSelectedId(kids_[0].id);

      const [{ data: completed }, { data: activityEvents }, { data: memoryRows }, { data: vacBlocks }, { data: profile }] = await Promise.all([
        supabase.from("lessons").select("child_id, date, scheduled_date, hours").eq("user_id", effectiveUserId).eq("completed", true),
        supabase.from("app_events").select("type, payload").eq("user_id", effectiveUserId).in("type", ["book_read", "memory_photo", "memory_project", "memory_book", "memory_field_trip", "memory_activity"]),
        supabase.from("memories").select("child_id, type").eq("user_id", effectiveUserId),
        supabase.from("vacation_blocks").select("start_date, end_date, name").eq("user_id", effectiveUserId),
        supabase.from("profiles").select("display_name, plan_type, subscription_status").eq("id", effectiveUserId).maybeSingle(),
      ]);

      setAllLessons((completed as LessonRow[]) ?? []);
      setVacationBlocks((vacBlocks as VacationBlock[]) ?? []);
      const profileData = profile as { display_name?: string; plan_type?: string; subscription_status?: string } | null;
      setFamilyName(profileData?.display_name ?? "");
      setProfile(profileData);

      const { data: affiliateData } = await supabase
        .from("affiliates")
        .select("code, is_active")
        .eq("user_id", effectiveUserId)
        .maybeSingle();
      setIsAffiliate(!!affiliateData?.is_active);

      const counts: Record<string, number> = {};
      completed?.forEach((l) => {
        counts[l.child_id] = (counts[l.child_id] ?? 0) + 1;
      });
      activityEvents?.forEach((e) => {
        const cid = e.payload?.child_id;
        if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
      });
      const memRows = (memoryRows ?? []) as { child_id: string | null; type?: string }[];
      memRows.forEach((m) => {
        if (m.child_id) counts[m.child_id] = (counts[m.child_id] ?? 0) + 1;
      });
      setMemoriesCount(memRows.length);
      setBooksCount(memRows.filter((m) => m.type === "book").length);

      setLeafCounts(counts);

      // Check for new badge celebrations
      const totalLeaves = Object.values(counts).reduce((s, n) => s + n, 0);
      const seenBadgesKey = `garden_badges_seen_${effectiveUserId}`;
      const seenBadges = new Set(JSON.parse(localStorage.getItem(seenBadgesKey) ?? "[]") as string[]);
      const newBadge = BADGES.find(b => b.check(totalLeaves) && !seenBadges.has(b.id));
      if (newBadge) {
        const allEarned = BADGES.filter(b => b.check(totalLeaves)).map(b => b.id);
        localStorage.setItem(seenBadgesKey, JSON.stringify(allEarned));
        setBadgeCelebration(newBadge.label);
        setTimeout(() => setBadgeCelebration(null), 3000);
      } else if (seenBadges.size === 0 && totalLeaves > 0) {
        const allEarned = BADGES.filter(b => b.check(totalLeaves)).map(b => b.id);
        localStorage.setItem(seenBadgesKey, JSON.stringify(allEarned));
      }

      // Check activity-based badges + founding family badge, then fetch earned set
      await Promise.all([
        checkAndAwardBadges(effectiveUserId),
        checkFoundingBadge(effectiveUserId),
      ]);
      const { data: badgeRows } = await supabase
        .from("user_badges")
        .select("badge_id")
        .eq("user_id", effectiveUserId);
      setEarnedActivityBadgeIds(new Set((badgeRows ?? []).map((b: { badge_id: string }) => b.badge_id)));

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

  // Keep leaf-count badge lists for the celebration overlay
  const earnedBadges = BADGES.filter((b) => b.check(selectedLeaves));
  const lockedBadges = BADGES.filter((b) => !b.check(selectedLeaves));
  // Suppress unused lint — these are used in the JSX badges section
  void lockedBadges;

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
    <>
      <PageHero
        overline="Your Family's"
        title="Garden 🌿"
        subtitle="Every lesson and memory grows a leaf."
      />
      <div className="max-w-3xl px-4 pt-5 pb-7 space-y-6">

      {/* ── First-visit tip banner ───────────────────────── */}
      {!tipDismissed && totalLeaves === 0 && (
        <div className="flex items-start gap-3 rounded-xl border-l-4 border-[#7ab87a] bg-[#f4faf4] px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--g-deep)] mb-0.5">🌿 Your garden grows with every lesson</p>
            <p className="text-xs text-[#5c7f63] leading-relaxed">
              Log a lesson on Today to earn a leaf and watch your family&apos;s garden come to life.
            </p>
            <Link
              href="/dashboard"
              className="inline-block mt-1.5 text-xs font-semibold text-[var(--g-deep)] hover:underline"
            >
              Go to Today →
            </Link>
          </div>
          <button
            type="button"
            onClick={dismissTip}
            aria-label="Dismiss tip"
            className="shrink-0 text-[#7ab87a] hover:text-[var(--g-deep)] text-lg leading-none mt-0.5 transition-colors"
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
          minHeight: 340,
        }}
      >
        {/* Sun */}
        <Sun />

        {/* Clouds */}
        <Cloud x={8}  y={8}  scale={1.1} delay={0} />
        <Cloud x={28} y={14} scale={0.7} delay={-5} alt />
        <Cloud x={55} y={6}  scale={0.85} delay={-2} />

        {/* Butterflies — hover near ground level, above hills/plants */}
        <Butterfly x={12} y={58} delay={0}   color="#f9a8d4" />
        <Butterfly x={72} y={62} delay={1.8} color="#fbbf24" />
        <Butterfly x={45} y={55} delay={3.2} color="#86efac" />

        {/* Vacation palm trees — flanking left and right */}
        {activeVacation && (
          <>
            <div
              className="absolute garden-sway"
              style={{ bottom: "27%", left: "12%", transformOrigin: "center bottom", fontSize: "clamp(30px, 6vw, 48px)", lineHeight: 1, userSelect: "none", zIndex: 5 }}
              aria-hidden
            >
              🌴
            </div>
            <div
              className="absolute garden-sway-alt"
              style={{ bottom: "27%", right: "12%", transformOrigin: "center bottom", fontSize: "clamp(30px, 6vw, 48px)", lineHeight: 1, userSelect: "none", zIndex: 5 }}
              aria-hidden
            >
              🌴
            </div>
            <div
              className="absolute bottom-[52%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-2xl px-3 py-1.5 text-center shadow-md z-10"
              style={{ background: "#fef3dc", border: "1.5px solid #f0dda8" }}
            >
              <p className="text-xs font-semibold text-[#7a4a1a] leading-snug">
                {familyName ? `${familyName.replace(/^The\s+/i, "").trim() || familyName}` : "Family"} is away 🌴
              </p>
            </div>
          </>
        )}

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
                className="absolute cursor-pointer flex flex-col items-center"
                style={{ bottom: "28%", left: `${x}%`, transform: "translateX(-50%)", alignItems: "flex-end" }}
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
                      fontSize: TREE_SIZE[getStageFromLeaves(leaves)] ?? 40,
                      lineHeight: 1,
                      display: "block",
                      filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.2))",
                      userSelect: "none",
                    }}
                    aria-hidden
                  >
                    {treeEmoji(leaves)}
                  </span>

                </div>

                {/* Leaf count pill */}
                <div className="mt-1 flex items-center gap-0.5 shadow-sm" style={{ background: "#ffffff", borderRadius: 12, padding: "3px 8px" }}>
                  <span style={{ fontSize: 11 }}>🍃</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--g-brand)" }}>{leaves}</span>
                </div>

                {/* Name tag */}
                <div className="mt-1 text-center">
                  <span className="font-semibold shadow-sm whitespace-nowrap" style={{ fontSize: 12, background: "rgba(0,0,0,0.3)", color: "#ffffff", borderRadius: 10, padding: "3px 10px" }}>
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
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5 flex items-center gap-1"
                style={{ color: selectedStage.text }}>
                {selectedChild.name}
                {selectedChild.birthday && (() => {
                  const bd = new Date(selectedChild.birthday + "T12:00:00");
                  const now = new Date();
                  return bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate() ? " 🎂" : "";
                })()}
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
            <div style={{ width: 56, height: 56, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span
                style={{ fontSize: 44, lineHeight: 1, filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.2))", userSelect: "none" }}
                aria-hidden
              >
                {treeEmoji(selectedLeaves)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Badges ────────────────────────────────────────── */}
      {(() => {
        // Merge leaf-count badges + activity badges into one unified display
        const allBadges: { id: string; emoji: string; label: string; earned: boolean; message?: string }[] = [];

        // Activity badges from user_badges table
        for (const ab of ACTIVITY_BADGES) {
          allBadges.push({ id: ab.id, emoji: ab.emoji, label: ab.label, earned: earnedActivityBadgeIds.has(ab.id), message: ab.message });
        }

        // Leaf-count badges (only if not already covered by activity badge id)
        const activityIds = new Set(ACTIVITY_BADGES.map((b) => b.id));
        for (const lb of BADGES) {
          if (!activityIds.has(lb.id)) {
            allBadges.push({ id: lb.id, emoji: lb.emoji, label: lb.label, earned: lb.check(selectedLeaves) });
          }
        }

        // Rooted Partner (special)
        if (isAffiliate) {
          allBadges.push({ id: "rooted_partner", emoji: "🤝", label: "Rooted Partner", earned: true, message: "A true partner in the Rooted community." });
        }

        const earned = allBadges.filter((b) => b.earned);
        const locked = allBadges.filter((b) => !b.earned);
        const totalEarned = earned.length;

        // Badge SVG illustrations
        const BADGE_SVG: Record<string, React.ReactNode> = {
          story_begun: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="sb-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#e8f5e9"/><stop offset="100%" stopColor="#a5d6a7"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#sb-bg)"/><path d="M32 48 C32 48 32 28 32 24 C32 18 28 14 28 14" stroke="#5c7f63" strokeWidth="2.5" fill="none" strokeLinecap="round"/><ellipse cx="28" cy="14" rx="6" ry="9" fill="#66bb6a" opacity="0.85" transform="rotate(-15 28 14)"/><ellipse cx="36" cy="18" rx="5" ry="8" fill="#81c784" opacity="0.8" transform="rotate(20 36 18)"/><circle cx="32" cy="48" r="3" fill="#8d6e63" opacity="0.6"/></svg>
          ),
          first_leaf: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="fl-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#f1f8e9"/><stop offset="100%" stopColor="#c5e1a5"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#fl-bg)"/><path d="M32 50 Q32 35 24 22 Q30 20 32 12 Q34 20 40 22 Q32 35 32 50Z" fill="#66bb6a" stroke="#43a047" strokeWidth="1"/><path d="M32 48 L32 18" stroke="#43a047" strokeWidth="1.5" fill="none" strokeLinecap="round"/><path d="M32 30 Q27 26 24 22" stroke="#43a047" strokeWidth="1" fill="none" opacity="0.6"/><path d="M32 30 Q37 26 40 22" stroke="#43a047" strokeWidth="1" fill="none" opacity="0.6"/></svg>
          ),
          first_win: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="fw-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#fff8e1"/><stop offset="100%" stopColor="#ffe082"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#fw-bg)"/><path d="M22 18h20l-3 16h-14z" fill="#ffd54f" stroke="#f9a825" strokeWidth="1.5"/><rect x="28" y="34" width="8" height="6" rx="1" fill="#f9a825"/><rect x="24" y="40" width="16" height="3" rx="1.5" fill="#f9a825"/><path d="M18 18l-2 10 6-4z" fill="#ffb300" opacity="0.7"/><path d="M46 18l2 10-6-4z" fill="#ffb300" opacity="0.7"/></svg>
          ),
          bookworm_begins: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="bb-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#e8f5e9"/><stop offset="100%" stopColor="#a5d6a7"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#bb-bg)"/><rect x="18" y="20" width="28" height="24" rx="2" fill="#8d6e63" opacity="0.2"/><path d="M32 18v28" stroke="#5c7f63" strokeWidth="1.5"/><path d="M20 20 Q26 24 32 20" fill="#81c784" stroke="#66bb6a" strokeWidth="1"/><path d="M32 20 Q38 24 44 20" fill="#a5d6a7" stroke="#81c784" strokeWidth="1"/><path d="M20 28 Q26 32 32 28" fill="#81c784" stroke="#66bb6a" strokeWidth="0.8" opacity="0.6"/><path d="M32 28 Q38 32 44 28" fill="#a5d6a7" stroke="#81c784" strokeWidth="0.8" opacity="0.6"/></svg>
          ),
          shutter: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="sh-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#e3f2fd"/><stop offset="100%" stopColor="#90caf9"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#sh-bg)"/><rect x="16" y="22" width="32" height="22" rx="4" fill="#42a5f5" opacity="0.8"/><circle cx="32" cy="33" r="8" fill="#e3f2fd" stroke="#1e88e5" strokeWidth="1.5"/><circle cx="32" cy="33" r="5" fill="#bbdefb"/><circle cx="30" cy="31" r="1.5" fill="white" opacity="0.8"/><rect x="26" y="20" width="12" height="4" rx="2" fill="#1e88e5" opacity="0.6"/></svg>
          ),
          showing_up: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="su-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#fff3e0"/><stop offset="100%" stopColor="#ffcc80"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#su-bg)"/><path d="M32 46 Q28 34 22 28 Q28 30 32 16 Q36 30 42 28 Q36 34 32 46Z" fill="#ff7043" opacity="0.85"/><path d="M32 46 Q30 38 26 34 Q30 36 32 24 Q34 36 38 34 Q34 38 32 46Z" fill="#ffab40" opacity="0.9"/><path d="M32 46 Q31 40 29 38 Q31 39 32 32 Q33 39 35 38 Q33 40 32 46Z" fill="#ffe082"/></svg>
          ),
          gallery_wall: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="gw-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#f3e5f5"/><stop offset="100%" stopColor="#ce93d8"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#gw-bg)"/><rect x="12" y="18" width="16" height="12" rx="2" fill="#ab47bc" opacity="0.3" stroke="#ab47bc" strokeWidth="1"/><rect x="36" y="18" width="16" height="12" rx="2" fill="#ab47bc" opacity="0.3" stroke="#ab47bc" strokeWidth="1"/><rect x="20" y="34" width="24" height="14" rx="2" fill="#ab47bc" opacity="0.3" stroke="#ab47bc" strokeWidth="1"/><circle cx="20" cy="24" r="3" fill="#e1bee7"/><path d="M14 28l4-4 4 3 3-2 3 3" stroke="#ce93d8" strokeWidth="1" fill="none"/></svg>
          ),
          author: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="au-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#e8f5e9"/><stop offset="100%" stopColor="#a5d6a7"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#au-bg)"/><path d="M24 16l-4 32h24l-4-32z" fill="#8d6e63" opacity="0.15" stroke="#5d4037" strokeWidth="1"/><path d="M26 16v32" stroke="#5d4037" strokeWidth="0.8" opacity="0.4"/><path d="M28 22h10M28 26h10M28 30h8M28 34h10M28 38h6" stroke="#5c7f63" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/><path d="M38 14l2 8-6-2z" fill="#66bb6a" opacity="0.7"/></svg>
          ),
          full_circle: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="fc-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#e0f2f1"/><stop offset="100%" stopColor="#80cbc4"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#fc-bg)"/><circle cx="32" cy="32" r="16" fill="none" stroke="#26a69a" strokeWidth="2.5" strokeDasharray="4 3"/><path d="M40 24l2-4M42 20l-1 2" stroke="#26a69a" strokeWidth="2" strokeLinecap="round"/><circle cx="32" cy="32" r="4" fill="#26a69a" opacity="0.3"/><path d="M28 28l4 4 4-4" stroke="#26a69a" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.6"/></svg>
          ),
          founding_family: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="ff-bg" cx="50%" cy="35%" r="55%"><stop offset="0%" stopColor="#fff8e1"/><stop offset="100%" stopColor="#ffe082"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#ff-bg)"/><path d="M32 12l4 10h10l-8 6 3 10-9-7-9 7 3-10-8-6h10z" fill="#f9a825" stroke="#f57f17" strokeWidth="1" strokeLinejoin="round"/><circle cx="32" cy="28" r="3" fill="#fff8e1" opacity="0.6"/></svg>
          ),
          rooted: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="rt-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#e8f5e9"/><stop offset="100%" stopColor="#81c784"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#rt-bg)"/><path d="M32 44v-20" stroke="#5d4037" strokeWidth="3" strokeLinecap="round"/><circle cx="32" cy="18" r="12" fill="#43a047" opacity="0.8"/><circle cx="26" cy="16" r="7" fill="#66bb6a" opacity="0.7"/><circle cx="38" cy="16" r="7" fill="#66bb6a" opacity="0.7"/><circle cx="32" cy="12" r="6" fill="#81c784" opacity="0.8"/><path d="M32 44 Q28 50 22 52" stroke="#8d6e63" strokeWidth="1.5" fill="none" opacity="0.5"/><path d="M32 44 Q36 50 42 52" stroke="#8d6e63" strokeWidth="1.5" fill="none" opacity="0.5"/><path d="M32 44 Q32 50 32 54" stroke="#8d6e63" strokeWidth="1.5" fill="none" opacity="0.5"/></svg>
          ),
          rooted_partner: (
            <svg viewBox="0 0 64 64" className="w-full h-full"><defs><radialGradient id="rp-bg" cx="50%" cy="40%" r="55%"><stop offset="0%" stopColor="#e8eaf6"/><stop offset="100%" stopColor="#9fa8da"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#rp-bg)"/><path d="M22 32 Q22 24 28 24 L28 28 Q24 28 24 32 Q24 36 28 36 L36 36 Q40 36 40 32 Q40 28 36 28 L36 24 Q42 24 42 32 Q42 40 36 40 L28 40 Q22 40 22 32Z" fill="#5c6bc0" opacity="0.7"/></svg>
          ),
        };

        return (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
              Badges {totalEarned > 0 && `\u00b7 ${totalEarned} earned`}
            </h2>

            {earned.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-[#5c7f63] font-medium mb-2">Earned</p>
                <div className="flex flex-wrap gap-3">
                  {earned.map((badge) => (
                    <div key={badge.id} className="badge-float flex flex-col items-center w-[76px]">
                      <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-sm border border-[#b8d9bc] bg-gradient-to-b from-[#e8f0e9] to-[#d4ead4] p-1">
                        {BADGE_SVG[badge.id] ?? (
                          <div className="w-full h-full rounded-xl bg-gradient-to-b from-[#e8f0e9] to-[#d4ead4] flex items-center justify-center text-2xl">{badge.emoji}</div>
                        )}
                      </div>
                      <span className="text-[10px] font-semibold text-[var(--g-deep)] text-center leading-tight mt-1.5">
                        {badge.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {locked.length > 0 && (
              <div>
                <p className="text-xs text-[#b5aca4] font-medium mb-2">Undiscovered</p>
                <div className="flex flex-wrap gap-3">
                  {locked.map((badge) => (
                    <div key={badge.id} className="flex flex-col items-center w-[76px]">
                      <div className="relative w-16 h-16 rounded-2xl overflow-hidden p-1">
                        <svg viewBox="0 0 64 64" className="w-full h-full">
                          <circle cx="32" cy="32" r="29" fill="none" stroke="#e8e2d9" strokeWidth="2" strokeDasharray="4 4" />
                          <circle cx="32" cy="32" r="24" fill="#faf8f4" />
                        </svg>
                        <span style={{
                          position: "absolute", top: "50%", left: "50%",
                          transform: "translate(-50%, -50%)", fontSize: 22,
                          opacity: 0.15, filter: "grayscale(1)", userSelect: "none",
                        }}>
                          {badge.emoji}
                        </span>
                        <span style={{
                          position: "absolute", bottom: 4, right: 4, fontSize: 10, lineHeight: 1,
                        }}>
                          🔒
                        </span>
                      </div>
                      <span className="text-[10px] font-medium text-[#c8bfb5] text-center leading-tight mt-1.5">
                        ???
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {earned.length === 0 && locked.length === 0 && (
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 text-center">
                <p className="text-sm text-[#7a6f65]">Start logging lessons and memories to earn badges! 🌟</p>
              </div>
            )}
          </div>
        );
      })()}

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
              Your Journey
            </h2>
            {!hasSomeData ? (
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 text-center">
                <p className="text-sm text-[#7a6f65]">Complete lessons to see your stats here 📊</p>
              </div>
            ) : (
              <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gradient-to-br from-[#fff8ed] to-[#fef3dc] border border-[#f5c97a]/40 rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">🔥</div>
                  <p className="text-2xl font-bold text-[#c4956a]">{currentStreak}</p>
                  <p className="text-xs font-medium text-[#8b6f47] mt-0.5">Current streak</p>
                  <p className="text-[10px] text-[#b5aca4] mt-0.5">
                    {currentStreak === 0 ? "Start today!" : `${currentStreak} day${currentStreak !== 1 ? "s" : ""}`}
                  </p>
                </div>
                <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">📚</div>
                  <p className="text-2xl font-bold text-[#2d2926]">{allLessons.length}</p>
                  <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Lessons logged</p>
                  <p className="text-[10px] text-[#b5aca4] mt-0.5">All time</p>
                </div>
                {totalHours > 0 ? (
                  <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
                    <div className="text-2xl mb-1">⏱️</div>
                    <p className="text-2xl font-bold text-[#2d2926]">
                      {totalHours % 1 === 0 ? `${totalHours}h` : `${totalHours.toFixed(1)}h`}
                    </p>
                    <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Total hours</p>
                    <p className="text-[10px] text-[#b5aca4] mt-0.5">This year</p>
                  </div>
                ) : (
                  <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
                    <div className="text-2xl mb-1">📸</div>
                    <p className="text-2xl font-bold text-[#2d2926]">{memoriesCount}</p>
                    <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Memories captured</p>
                    <p className="text-[10px] text-[#b5aca4] mt-0.5">This year</p>
                  </div>
                )}
                <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">📖</div>
                  <p className="text-2xl font-bold text-[#2d2926]">{booksCount}</p>
                  <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Books read</p>
                  <p className="text-[10px] text-[#b5aca4] mt-0.5">This year</p>
                </div>
              </div>

              {/* Export progress PDF — inline below stats */}
              <Link
                href="/dashboard/reports"
                className="flex items-center justify-between bg-white border border-[#e8e2d9] rounded-xl px-4 py-3 hover:bg-[#f8f7f4] transition-colors mt-3"
              >
                <div>
                  <p className="text-sm font-semibold text-[#2d2926]">Export progress PDF</p>
                  <p className="text-xs text-[#7a6f65] mt-0.5">Lessons, books, and hours by subject</p>
                </div>
                <span className="text-[#5c7f63] text-lg">↗</span>
              </Link>
              </>
            )}
          </div>
        );
      })()}

      <div className="h-4" />
      </div>

      {/* Leaf badge celebration overlay */}
      {badgeCelebration && (
        <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className="absolute text-xl"
              style={{
                left: `${30 + Math.random() * 40}%`,
                top: `${30 + Math.random() * 30}%`,
                animation: `badge-burst 1.5s ease-out forwards`,
                animationDelay: `${i * 0.08}s`,
                opacity: 0,
              }}
            >
              {["⭐", "🌟", "✨", "🎉", "🏅"][i % 5]}
            </span>
          ))}
          <div
            className="bg-white/95 border border-[#e8e2d9] rounded-2xl px-6 py-4 text-center shadow-xl"
            style={{ animation: "badge-pop 2s ease-out forwards" }}
          >
            <p className="text-2xl mb-1">🏅</p>
            <p className="text-sm font-bold text-[#2d2926]">New badge earned!</p>
            <p className="text-xs text-[#5c7f63] mt-0.5">{badgeCelebration}</p>
          </div>
        </div>
      )}

    </>
  );
}
