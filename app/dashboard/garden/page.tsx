"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { STAGE_INFO, LEAF_THRESHOLDS, getStageFromLeaves, getNextThreshold } from "@/components/GardenScene";
import PageHero from "@/app/components/PageHero";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null; birthday?: string | null };
type LessonRow = { child_id: string; date: string | null; scheduled_date: string | null; hours: number | null };
type VacationBlock = { start_date: string; end_date: string; name: string };

// ─── Emoji tree by stage ──────────────────────────────────────────────────────

const TREE_EMOJI: Record<number, { emoji: string; size: number }> = {
  1:  { emoji: "\uD83C\uDF31", size: 14 },  // 🌱
  2:  { emoji: "\uD83C\uDF31", size: 20 },
  3:  { emoji: "\uD83C\uDF3F", size: 26 },  // 🌿
  4:  { emoji: "\uD83E\uDEB4", size: 32 },  // 🪴
  5:  { emoji: "\uD83E\uDEB4", size: 38 },
  6:  { emoji: "\uD83C\uDF32", size: 44 },  // 🌲
  7:  { emoji: "\uD83C\uDF32", size: 52 },
  8:  { emoji: "\uD83C\uDF38", size: 58 },  // 🌸
  9:  { emoji: "\uD83C\uDF33", size: 64 },  // 🌳
  10: { emoji: "\uD83C\uDF33", size: 72 },
};

// ─── Stage journey chips ──────────────────────────────────────────────────────

const STAGE_CHIPS = [
  { emoji: "\uD83C\uDF31", label: "Seed",    min: 0 },
  { emoji: "\uD83C\uDF3F", label: "Sprout",  min: 3 },
  { emoji: "\uD83E\uDEB4", label: "Sapling", min: 11 },
  { emoji: "\uD83C\uDF32", label: "Tree",    min: 41 },
  { emoji: "\uD83C\uDF38", label: "Bloom",   min: 70 },
  { emoji: "\uD83C\uDF33", label: "Majestic",min: 135 },
];

// ─── Badges ───────────────────────────────────────────────────────────────────

const BADGES = [
  { id: "first",         emoji: "\uD83C\uDF31", label: "First Leaf",        check: (l: number) => l >= 1,   tooltip: "Complete your first lesson" },
  { id: "budding",       emoji: "\uD83C\uDF3F", label: "Budding Learner",   check: (l: number) => l >= 5,   tooltip: "Complete 5 lessons" },
  { id: "sprout",        emoji: "\uD83C\uDF3F", label: "Growing Sprout",    check: (l: number) => l >= 10,  tooltip: "Complete 10 lessons" },
  { id: "bookworm",      emoji: "\uD83D\uDCDA", label: "Bookworm",          check: (l: number) => l >= 20,  tooltip: "Complete 20 lessons" },
  { id: "sapling",       emoji: "\uD83C\uDF32", label: "Sapling",           check: (l: number) => l >= 30,  tooltip: "Complete 30 lessons" },
  { id: "gardener",      emoji: "\uD83C\uDF3B", label: "Master Gardener",   check: (l: number) => l >= 50,  tooltip: "Complete 50 lessons" },
  { id: "century",       emoji: "\uD83D\uDCAF", label: "100 Leaves",        check: (l: number) => l >= 100, tooltip: "Complete 100 lessons" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getStreak(activeDates: Set<string>): { current: number; best: number } {
  let current = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const temp = new Date(cursor);
  while (activeDates.has(toDateStr(temp))) { current++; temp.setDate(temp.getDate() - 1); }
  if (current === 0) { cursor.setDate(cursor.getDate() - 1); while (activeDates.has(toDateStr(cursor))) { current++; cursor.setDate(cursor.getDate() - 1); } }
  let best = 0, run = 0;
  const sorted = [...activeDates].sort();
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) { run = 1; } else {
      const prev = new Date(sorted[i - 1] + "T12:00:00");
      const curr = new Date(sorted[i] + "T12:00:00");
      run = (curr.getTime() - prev.getTime()) / 86400000 <= 1 ? run + 1 : 1;
    }
    best = Math.max(best, run);
  }
  return { current, best };
}

function getTreeX(index: number, total: number): number {
  if (total === 1) return 50;
  const margin = 14;
  const spread = 100 - 2 * margin;
  return margin + (spread / (total - 1)) * index;
}

function getStageIndex(leaves: number) {
  return getStageFromLeaves(leaves) - 1;
}

const STAGES = STAGE_INFO.map((s, i) => ({
  ...s,
  min: LEAF_THRESHOLDS[i],
  bg: ["#fef5e4","#e8f5ea","#e8f5ea","#e8f5ea","#e8f5ea","#e4f2fb","#e4f2fb","#fce8f4","#fef5e4","#e8f0e9"][i],
  text: ["#8b6f47","#5c7f63","#5c7f63","#5c7f63","#5c7f63","#1a5c80","#1a5c80","#7a2a5a","#8b6f47","#2d5c38"][i],
}));

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

  const todayStr = toDateStr(new Date());
  const activeVacation = vacationBlocks.find((b) => todayStr >= b.start_date && todayStr <= b.end_date) ?? null;

  useEffect(() => {
    if (!effectiveUserId) return;
    async function load() {
      const { data: kids } = await supabase
        .from("children").select("id, name, color, birthday")
        .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order");
      const kids_ = kids ?? [];
      setChildren(kids_);
      if (kids_.length > 0) setSelectedId(kids_[0].id);

      const [{ data: completed }, { data: bookEvents }, { data: vacBlocks }, { data: prof }] = await Promise.all([
        supabase.from("lessons").select("child_id, date, scheduled_date, hours").eq("user_id", effectiveUserId).eq("completed", true),
        supabase.from("app_events").select("payload").eq("user_id", effectiveUserId).eq("type", "book_read"),
        supabase.from("vacation_blocks").select("start_date, end_date, name").eq("user_id", effectiveUserId),
        supabase.from("profiles").select("display_name, plan_type, subscription_status").eq("id", effectiveUserId).maybeSingle(),
      ]);
      setAllLessons((completed as LessonRow[]) ?? []);
      setVacationBlocks((vacBlocks as VacationBlock[]) ?? []);
      const profileData = prof as { display_name?: string; plan_type?: string; subscription_status?: string } | null;
      setFamilyName(profileData?.display_name ?? "");
      setProfile(profileData);

      const { data: affiliateData } = await supabase.from("affiliates").select("code, is_active").eq("user_id", effectiveUserId).maybeSingle();
      setIsAffiliate(!!affiliateData?.is_active);

      const counts: Record<string, number> = {};
      completed?.forEach((l) => { counts[l.child_id] = (counts[l.child_id] ?? 0) + 1; });
      bookEvents?.forEach((e) => { const cid = e.payload?.child_id; if (cid) counts[cid] = (counts[cid] ?? 0) + 1; });
      setLeafCounts(counts);

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
      setLoading(false);
    }
    load();
  }, [effectiveUserId]);

  const totalLeaves = Object.values(leafCounts).reduce((s, n) => s + n, 0);
  const selectedChild = children.find((c) => c.id === selectedId);
  const selectedLeaves = selectedId ? (leafCounts[selectedId] ?? 0) : 0;
  const selectedStageIdx = getStageIndex(selectedLeaves);
  const selectedStage = STAGES[selectedStageIdx];
  const nextStage = STAGES[selectedStageIdx + 1];
  const progress = nextStage ? ((selectedLeaves - selectedStage.min) / (nextStage.min - selectedStage.min)) * 100 : 100;
  const earnedBadges = BADGES.filter((b) => b.check(selectedLeaves));
  const lockedBadges = BADGES.filter((b) => !b.check(selectedLeaves));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl animate-pulse">{"\uD83C\uDF3F"}</span>
          <p className="text-sm text-[#7a6f65]">Growing your garden...</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <PageHero overline="Your Family" title="Garden" />
    <div className="px-4 pb-8 space-y-5 max-w-3xl">

      {/* ── Garden Scene ─────────────────────────────────── */}
      <div
        className="relative w-full overflow-hidden rounded-3xl shadow-md"
        style={{
          background: "linear-gradient(180deg, #87ceeb 0%, #b8dff0 40%, #d4eef4 65%, #c4e8c0 85%, #7ab87a 100%)",
          aspectRatio: "4/3",
          minHeight: 240,
        }}
      >
        {/* Animated sun */}
        <div className="absolute top-4 right-6 garden-sun" style={{ fontSize: 36, lineHeight: 1 }} aria-hidden>{"\u2600\uFE0F"}</div>

        {/* Drifting clouds */}
        <div className="absolute cloud-drift" style={{ top: "12%", left: "-10%", fontSize: 28, lineHeight: 1 }} aria-hidden>{"\u2601\uFE0F"}</div>
        <div className="absolute cloud-drift-slow" style={{ top: "22%", left: "-15%", fontSize: 22, lineHeight: 1, animationDelay: "-8s" }} aria-hidden>{"\u2601\uFE0F"}</div>

        {/* Butterflies */}
        <div className="absolute butterfly" style={{ top: "30%", left: "15%", fontSize: 16 }} aria-hidden>{"\uD83E\uDD8B"}</div>
        <div className="absolute butterfly" style={{ top: "25%", left: "70%", fontSize: 14, animationDelay: "1.5s" }} aria-hidden>{"\uD83E\uDD8B"}</div>

        {/* Vacation overlay */}
        {activeVacation && (
          <div className="absolute bottom-[52%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-2xl px-3 py-1.5 text-center shadow-md z-10"
            style={{ background: "#fef3dc", border: "1.5px solid #f0dda8" }}>
            <p className="text-xs font-semibold text-[#7a4a1a] leading-snug">
              {familyName
                ? `${familyName.replace(/^The\s+/i, "").replace(/\s+family$/i, "").trim()} Family is on ${activeVacation.name} \uD83C\uDF34`
                : `Enjoying ${activeVacation.name} \uD83C\uDF34`}
            </p>
          </div>
        )}

        {/* Green ground */}
        <div className="absolute bottom-0 left-0 right-0" style={{ height: "28%", background: "linear-gradient(180deg, #7ab87a 0%, #5c9a50 100%)", borderRadius: "50% 50% 0 0 / 20% 20% 0 0" }} />

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
            const leaves = leafCounts[child.id] ?? 0;
            const stage = getStageFromLeaves(leaves);
            const tree = TREE_EMOJI[stage] ?? TREE_EMOJI[1];
            const x = getTreeX(i, children.length);
            const isActive = child.id === selectedId;

            return (
              <div
                key={child.id}
                className="absolute cursor-pointer flex flex-col items-center garden-tree-bounce"
                style={{ bottom: "22%", left: `${x}%`, transform: "translateX(-50%)", animationDelay: `${i * 0.5}s` }}
                onClick={() => setSelectedId(child.id)}
              >
                {/* Emoji tree */}
                <span style={{ fontSize: tree.size, lineHeight: 1, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.15))", userSelect: "none" }} aria-hidden>
                  {tree.emoji}
                </span>

                {/* Leaf count pill */}
                <div className="mt-1 bg-white/90 rounded-full px-1.5 py-0.5 flex items-center gap-0.5 shadow-sm">
                  <span className="text-[9px]">{"\uD83C\uDF43"}</span>
                  <span className="text-[9px] font-bold text-[#3d5c42]">{leaves}</span>
                </div>

                {/* Name tag */}
                <div className="mt-1 text-center">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap ${
                    isActive ? "bg-white text-[#2d2926]" : "bg-white/70 text-[#2d2926]/80"
                  }`}>
                    {child.name}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Child Cards ──────────────────────────────────── */}
      {children.map((child, cardIdx) => {
        const leaves = leafCounts[child.id] ?? 0;
        const stage = getStageFromLeaves(leaves);
        const stageInfo = STAGES[stage - 1];
        const nextThreshold = getNextThreshold(leaves);
        const nextStageName = STAGES[stage]?.name;
        const stageProgress = nextThreshold
          ? ((leaves - LEAF_THRESHOLDS[stage - 1]) / (nextThreshold - LEAF_THRESHOLDS[stage - 1])) * 100
          : 100;
        const tree = TREE_EMOJI[stage] ?? TREE_EMOJI[1];

        return (
          <div
            key={child.id}
            className="bg-white border border-[#e8e2d9] rounded-2xl p-4 space-y-3 card-fade-up"
            style={{ animationDelay: `${cardIdx * 0.1}s` }}
            onClick={() => setSelectedId(child.id)}
          >
            {/* Header */}
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 28 }}>{tree.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#2d2926]">{child.name}</p>
                <p className="text-xs text-[#7a6f65]">{stageInfo.name} · {leaves} {leaves === 1 ? "leaf" : "leaves"}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="h-2 bg-[#f0ede8] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(stageProgress, 100)}%`, backgroundColor: stageInfo.color }} />
              </div>
              {nextThreshold && nextStageName && (
                <p className="text-[10px] text-[#b5aca4] mt-1">{nextThreshold - leaves} more leaves to {nextStageName}</p>
              )}
            </div>

            {/* Stage journey chips */}
            <div className="flex gap-1.5 flex-wrap">
              {STAGE_CHIPS.map((chip) => {
                const isCompleted = leaves >= chip.min && chip.min < (STAGE_CHIPS[STAGE_CHIPS.indexOf(chip) + 1]?.min ?? Infinity);
                const isPast = leaves >= (STAGE_CHIPS[STAGE_CHIPS.indexOf(chip) + 1]?.min ?? Infinity);
                const isCurrent = isCompleted && !isPast;
                return (
                  <span
                    key={chip.label}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      isCurrent
                        ? "bg-[#3d5c42] text-white"
                        : isPast
                        ? "bg-[#e8f0e9] text-[#5c7f63]"
                        : "bg-[#f0ede8] text-[#b5aca4]"
                    }`}
                  >
                    {chip.emoji} {chip.label}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ── Badges ────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
          Badges {earnedBadges.length > 0 && `\u00B7 ${earnedBadges.length} earned`}
        </h2>

        {(profile?.plan_type === 'founding_family' || profile?.subscription_status === 'founding') && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl shadow-sm"
                  style={{ background: 'linear-gradient(135deg, #b8823a 0%, #e8b87a 50%, #b8823a 100%)' }}>
                  {"\u2B50"}
                </div>
                <span className="text-[10px] font-semibold text-[#b8823a] text-center leading-tight">Founding<br />Member</span>
              </div>
            </div>
          </div>
        )}

        {isAffiliate && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl shadow-sm"
                  style={{ background: 'linear-gradient(135deg, #4338ca 0%, #818cf8 50%, #4338ca 100%)' }}>
                  {"\uD83E\uDD1D"}
                </div>
                <span className="text-[10px] font-semibold text-[#4338ca] text-center leading-tight">Rooted<br />Partner</span>
              </div>
            </div>
          </div>
        )}

        {earnedBadges.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {earnedBadges.map((badge) => (
              <div key={badge.id} className="flex flex-col items-center bg-gradient-to-b from-[#e8f0e9] to-[#d4ead4] border border-[#b8d9bc] rounded-2xl px-4 py-3 min-w-[72px]">
                <span className="text-2xl mb-1">{badge.emoji}</span>
                <span className="text-[10px] font-semibold text-[#3d5c42] text-center leading-tight">{badge.label}</span>
              </div>
            ))}
          </div>
        )}

        {lockedBadges.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {lockedBadges.map((badge) => (
              <div key={badge.id} className="relative group">
                <div className="flex flex-col items-center bg-[#f0ede8] border border-[#e8e2d9] rounded-2xl px-4 py-3 min-w-[72px] opacity-50">
                  <span className="text-2xl mb-1 grayscale">{badge.emoji}</span>
                  <span className="text-[10px] font-medium text-[#7a6f65] text-center leading-tight">{badge.label}</span>
                </div>
                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[160px] rounded-lg bg-[#2d2926] px-2.5 py-1.5 text-center text-[11px] text-white leading-snug opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  {badge.tooltip}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Stats ─────────────────────────────────────────── */}
      {(() => {
        const activeDates = new Set(allLessons.map((l) => l.date ?? l.scheduled_date).filter(Boolean) as string[]);
        const { current: currentStreak, best: bestStreak } = getStreak(activeDates);
        const totalHours = allLessons.reduce((s, l) => s + (l.hours ?? 0), 0);
        return allLessons.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">Your Stats</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gradient-to-br from-[#fff8ed] to-[#fef3dc] border border-[#f5c97a]/40 rounded-2xl p-4 text-center">
                <div className="text-2xl mb-1">{"\uD83D\uDD25"}</div>
                <p className="text-2xl font-bold text-[#c4956a]">{currentStreak}</p>
                <p className="text-xs font-medium text-[#8b6f47] mt-0.5">Current streak</p>
              </div>
              <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-4 text-center">
                <div className="text-2xl mb-1">{"\uD83C\uDFC6"}</div>
                <p className="text-2xl font-bold text-[#3d5c42]">{bestStreak}</p>
                <p className="text-xs font-medium text-[#5c7f63] mt-0.5">Best streak</p>
              </div>
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
                <div className="text-2xl mb-1">{"\uD83D\uDCDA"}</div>
                <p className="text-2xl font-bold text-[#2d2926]">{allLessons.length}</p>
                <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Lessons logged</p>
              </div>
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
                <div className="text-2xl mb-1">{"\u23F1\uFE0F"}</div>
                <p className="text-2xl font-bold text-[#2d2926]">{totalHours % 1 === 0 ? `${totalHours}h` : `${totalHours.toFixed(1)}h`}</p>
                <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Total hours</p>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      {/* ── Keep & Share ──────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-[#7a6f65] uppercase tracking-widest mb-1">Keep & Share</p>
        <Link href="/dashboard/reports" className="flex items-center justify-between bg-white border border-[#e8e2d9] rounded-xl px-4 py-3 hover:bg-[#f8f7f4] transition-colors">
          <div>
            <p className="text-sm font-semibold text-[#2d2926]">Export progress PDF</p>
            <p className="text-xs text-[#7a6f65] mt-0.5">Lessons, books, and hours by subject</p>
          </div>
          <span className="text-[#5c7f63] text-lg">{"\u2197"}</span>
        </Link>
        <Link href="/dashboard/year-in-review" className="flex items-center justify-between bg-white border border-[#e8e2d9] rounded-xl px-4 py-3 hover:bg-[#f8f7f4] transition-colors">
          <div>
            <p className="text-sm font-semibold text-[#2d2926]">Year in Review</p>
            <p className="text-xs text-[#7a6f65] mt-0.5">AI-generated annual keepsake {"\u2728"}</p>
          </div>
          <span className="text-[#5c7f63] text-lg">{"\u2197"}</span>
        </Link>
      </div>
    </div>

    {/* Badge celebration */}
    {badgeCelebration && (
      <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center">
        <div className="bg-white/95 border border-[#e8e2d9] rounded-2xl px-6 py-4 text-center shadow-xl" style={{ animation: "badge-pop 2s ease-out forwards" }}>
          <p className="text-2xl mb-1">{"\uD83C\uDFC5"}</p>
          <p className="text-sm font-bold text-[#2d2926]">New badge earned!</p>
          <p className="text-xs text-[#5c7f63] mt-0.5">{badgeCelebration}</p>
        </div>
      </div>
    )}

    {/* CSS Animations */}
    <style>{`
      @keyframes cloud-drift { from { transform: translateX(0); } to { transform: translateX(calc(100vw + 60px)); } }
      @keyframes butterfly-flutter { 0%, 100% { transform: translateY(0) rotate(-5deg); } 50% { transform: translateY(-12px) rotate(5deg); } }
      @keyframes sun-sway { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(8deg); } }
      @keyframes tree-bounce { 0%, 100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(-3px); } }
      @keyframes leaf-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
      @keyframes card-fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes badge-pop { 0% { opacity:0; transform:scale(0.5); } 20% { opacity:1; transform:scale(1.1); } 40% { transform:scale(1); } 80% { opacity:1; } 100% { opacity:0; transform:scale(0.8); } }
      .cloud-drift { animation: cloud-drift 30s linear infinite; }
      .cloud-drift-slow { animation: cloud-drift 45s linear infinite; }
      .butterfly { animation: butterfly-flutter 3s ease-in-out infinite; }
      .garden-sun { animation: sun-sway 6s ease-in-out infinite; }
      .garden-tree-bounce { animation: tree-bounce 4s ease-in-out infinite; }
      .leaf-pulse { animation: leaf-pulse 3s ease-in-out infinite; }
      .card-fade-up { animation: card-fade-up 0.4s ease-out both; }
    `}</style>
    </>
  );
}
