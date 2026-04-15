"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { checkAndAwardBadges, checkFoundingBadge, ACTIVITY_BADGES } from "@/lib/badges";
import {
  BADGE_CATEGORIES,
  checkCreativeBadges,
  getEarnedBadgeKeys,
  type BadgeTierDef,
  type BadgeCategory,
} from "@/app/lib/badges-tiered";
import PageHero from "@/app/components/PageHero";
import { posthog } from "@/lib/posthog";
import { capitalizeChildNames } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null; birthday?: string | null };

type LessonRow = {
  child_id: string;
  date: string | null;
  scheduled_date: string | null;
  hours: number | null;
};

type VacationBlock = { start_date: string; end_date: string; name: string };

// ─── Growth stages (8-stage leaf system) ────────────────────────────────────────

const GROWTH_STAGES = [
  { name: "Seed",          emoji: "🫘", label: "Just getting started",       min: 0,   scale: 1.0 },
  { name: "Sprouting",     emoji: "🌱", label: "A tiny shoot appears",       min: 1,   scale: 1.0 },
  { name: "Seedling",      emoji: "🪴", label: "Putting down roots",         min: 10,  scale: 1.0 },
  { name: "Growing",       emoji: "🌿", label: "Putting down roots",         min: 25,  scale: 0.8 },
  { name: "Young Tree",    emoji: "🌳", label: "Standing tall",              min: 50,  scale: 1.0 },
  { name: "Flourishing",   emoji: "🌲", label: "Strong and steady",          min: 100, scale: 1.1 },
  { name: "Blossoming",    emoji: "🌸", label: "In full bloom",              min: 200, scale: 1.2 },
  { name: "Bearing Fruit", emoji: "🍎", label: "The harvest of your work",   min: 500, scale: 1.4 },
];

function getGrowthStage(lessons: number) {
  let stage = GROWTH_STAGES[0];
  for (const s of GROWTH_STAGES) {
    if (lessons >= s.min) stage = s;
  }
  return stage;
}

function getGrowthStageIndex(lessons: number): number {
  let idx = 0;
  for (let i = 0; i < GROWTH_STAGES.length; i++) {
    if (lessons >= GROWTH_STAGES[i].min) idx = i;
  }
  return idx;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getTreeX(index: number, total: number): number {
  if (total === 1) return 50;
  const margin = 16;
  const spread = 100 - 2 * margin;
  return margin + (spread / (total - 1)) * index;
}

// ─── Seasonal garden decorations ────────────────────────────────────────────────

type GardenTheme = {
  name: string;
  groundEmojis: string[];
  skyEmojis: string[];
  treeEffect: string;
  skyGradient: string;
};

function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getMothersDay(year: number): Date {
  const may1 = new Date(year, 4, 1);
  const firstSunday = (7 - may1.getDay()) % 7;
  return new Date(year, 4, 1 + firstSunday + 7);
}

function getThanksgiving(year: number): Date {
  const nov1 = new Date(year, 10, 1);
  const firstThurs = (4 - nov1.getDay() + 7) % 7;
  return new Date(year, 10, 1 + firstThurs + 21);
}

function getGardenTheme(date: Date): GardenTheme {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();

  // Holiday windows (check first, override seasonal defaults)

  // New Year's (Jan 1–2)
  if (m === 1 && d <= 2) return {
    name: "New Year's",
    groundEmojis: ["🎉", "🥳", "🎊", "🎉", "🥳", "🎊"],
    skyEmojis: ["🎆", "🎆"],
    treeEffect: "party",
    skyGradient: "linear-gradient(180deg, #1a1a4e 0%, #3d3d8e 30%, #87CEEB 70%, #7ab87a 100%)",
  };

  // Valentine's (Feb 10–15)
  if (m === 2 && d >= 10 && d <= 15) return {
    name: "Valentine's Day",
    groundEmojis: ["🌹", "💕", "❤️", "🩷", "🌹", "💕"],
    skyEmojis: ["💝", "💝", "💕"],
    treeEffect: "pink-glow",
    skyGradient: "linear-gradient(180deg, #f8c8d4 0%, #f0d0d8 30%, #e8e0e8 60%, #e8f4e8 80%, #7ab87a 100%)",
  };

  // St. Patrick's (Mar 14–18)
  if (m === 3 && d >= 14 && d <= 18) return {
    name: "St. Patrick's Day",
    groundEmojis: ["☘️", "🍀", "☘️", "🍀", "🌈", "☘️"],
    skyEmojis: ["🌈", "🌈"],
    treeEffect: "green-sparkle",
    skyGradient: "linear-gradient(180deg, #87CEEB 0%, #c8e8c8 40%, #a8d8a8 70%, #5ab85a 100%)",
  };

  // Easter (dynamic — 2026: April 5)
  const easter = getEasterDate(y);
  const easterStart = new Date(easter); easterStart.setDate(easter.getDate() - 3);
  const easterEnd = new Date(easter); easterEnd.setDate(easter.getDate() + 3);
  if (date >= easterStart && date <= easterEnd) return {
    name: "Easter",
    groundEmojis: ["🥚", "🐣", "🥕", "🌷", "🐰", "🥚"],
    skyEmojis: ["☀️", "☀️"],
    treeEffect: "blossoms",
    skyGradient: "linear-gradient(180deg, #87CEEB 0%, #c4dff0 30%, #f0e8f0 60%, #e8f4e8 80%, #7ab87a 100%)",
  };

  // Earth Day (Apr 22)
  if (m === 4 && d === 22) return {
    name: "Earth Day",
    groundEmojis: ["🌍", "♻️", "🌻", "🌱", "🌍", "🌻"],
    skyEmojis: ["☁️", "☁️"],
    treeEffect: "green-glow",
    skyGradient: "linear-gradient(180deg, #87CEEB 0%, #c4dff0 30%, #deeef8 60%, #d0f0d0 80%, #5ab85a 100%)",
  };

  // Mother's Day (2nd Sunday of May ± 2 days)
  const mothersDay = getMothersDay(y);
  const mdStart = new Date(mothersDay); mdStart.setDate(mothersDay.getDate() - 2);
  const mdEnd = new Date(mothersDay); mdEnd.setDate(mothersDay.getDate() + 2);
  if (date >= mdStart && date <= mdEnd) return {
    name: "Mother's Day",
    groundEmojis: ["💐", "🌸", "🌺", "💐", "🌸", "🌺"],
    skyEmojis: ["🦋", "🦋"],
    treeEffect: "blooms",
    skyGradient: "linear-gradient(180deg, #f8c8e0 0%, #f0d8e8 30%, #e8e8f0 60%, #e8f4e8 80%, #7ab87a 100%)",
  };

  // 4th of July (Jul 1–5)
  if (m === 7 && d >= 1 && d <= 5) return {
    name: "4th of July",
    groundEmojis: ["🇺🇸", "🎆", "🎇", "🇺🇸", "🎆", "🎇"],
    skyEmojis: ["🎆", "🎇", "🎆"],
    treeEffect: "flags",
    skyGradient: "linear-gradient(180deg, #1a3a6a 0%, #4a6a9a 30%, #87CEEB 60%, #e8f4e8 80%, #7ab87a 100%)",
  };

  // Halloween (Oct 25–31)
  if (m === 10 && d >= 25 && d <= 31) return {
    name: "Halloween",
    groundEmojis: ["🎃", "👻", "🕷️", "🕸️", "🦇", "🎃"],
    skyEmojis: ["🦇", "🦇", "🌙"],
    treeEffect: "cobwebs",
    skyGradient: "linear-gradient(180deg, #2a1a3a 0%, #4a2a5a 30%, #8a6a9a 60%, #c0a080 80%, #5a7a3a 100%)",
  };

  // Thanksgiving (week of)
  const thanksgiving = getThanksgiving(y);
  const tgStart = new Date(thanksgiving); tgStart.setDate(thanksgiving.getDate() - 3);
  const tgEnd = new Date(thanksgiving); tgEnd.setDate(thanksgiving.getDate() + 1);
  if (date >= tgStart && date <= tgEnd) return {
    name: "Thanksgiving",
    groundEmojis: ["🦃", "🌽", "🥧", "🍂", "🦃", "🌽"],
    skyEmojis: ["🍁", "🍁", "🍂"],
    treeEffect: "golden-glow",
    skyGradient: "linear-gradient(180deg, #c0a060 0%, #d0b870 30%, #e0d0a0 60%, #d0c080 80%, #8a9a5a 100%)",
  };

  // Christmas (Dec 1–31)
  if (m === 12) return {
    name: "Christmas",
    groundEmojis: ["🎄", "🎅", "🍬", "🎁", "🎄", "⛄"],
    skyEmojis: ["❄️", "⭐", "❄️"],
    treeEffect: "lights",
    skyGradient: "linear-gradient(180deg, #2a3a5a 0%, #5a7a9a 30%, #a0c0d8 60%, #d8e8f0 80%, #6a9a8a 100%)",
  };

  // New Year's Eve (Dec 31)
  if (m === 12 && d === 31) return {
    name: "New Year's Eve",
    groundEmojis: ["🎉", "🥂", "🎊", "🎉", "🥂", "🎊"],
    skyEmojis: ["🎆", "🎆", "🎆"],
    treeEffect: "sparkle",
    skyGradient: "linear-gradient(180deg, #1a1a4e 0%, #3d3d8e 30%, #87CEEB 70%, #7ab87a 100%)",
  };

  // Default seasonal themes
  // Winter (Dec–Feb)
  if (m <= 2 || m === 12) return {
    name: "Winter",
    groundEmojis: ["❄️", "⛄", "❄️", "🌲", "❄️"],
    skyEmojis: ["❄️", "❄️"],
    treeEffect: "",
    skyGradient: "linear-gradient(180deg, #4A6FA5 0%, #B8D0E8 60%, #d8e8f4 82%, #6a9a8a 100%)",
  };

  // Spring (Mar–May)
  if (m >= 3 && m <= 5) return {
    name: "Spring",
    groundEmojis: ["🌸", "🌷", "🌱", "🌼", "🌸", "🌷"],
    skyEmojis: ["🦋", "🦋"],
    treeEffect: "",
    skyGradient: "linear-gradient(180deg, #87CEEB 0%, #C8E8F8 60%, #dff0e8 82%, #7ab87a 100%)",
  };

  // Summer (Jun–Aug)
  if (m >= 6 && m <= 8) return {
    name: "Summer",
    groundEmojis: ["🌻", "🌼", "🐝", "🌻", "🐝"],
    skyEmojis: ["☀️", "☀️"],
    treeEffect: "",
    skyGradient: "linear-gradient(180deg, #1E90FF 0%, #87CEEB 60%, #d4ecea 82%, #6aaa5a 100%)",
  };

  // Fall (Sep–Nov)
  return {
    name: "Fall",
    groundEmojis: ["🍂", "🍁", "🍄", "🍂", "🍁"],
    skyEmojis: ["🍁", "🍂"],
    treeEffect: "",
    skyGradient: "linear-gradient(180deg, #C0A060 0%, #E8A040 55%, #f0d090 78%, #8aaa5a 100%)",
  };
}

// Stable random positions from seed
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

// ─── Garden scene SVG components ────────────────────────────────────────────────

function Sun() {
  return (
    <div className="absolute top-4 right-5 sun-glow" style={{ width: 44, height: 44 }}>
      <svg viewBox="0 0 56 56" className="w-full h-full" overflow="visible">
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
        <path d="M15 11 Q8 3 3 5 Q0 9 3 13 Q7 16 12 13 Q14 12 15 11" fill={color} opacity="0.92" />
        <path d="M15 11 Q22 3 27 5 Q30 9 27 13 Q23 16 18 13 Q16 12 15 11" fill={color} opacity="0.92" />
        <path d="M15 12 Q10 15 8 18 Q11 21 14 18 Q15 16 15 12" fill={color} opacity="0.78" />
        <path d="M15 12 Q20 15 22 18 Q19 21 16 18 Q15 16 15 12" fill={color} opacity="0.78" />
        <ellipse cx="15" cy="12" rx="1.1" ry="4.5" fill="#5a4a3a" />
        <path d="M14.2 8 Q12 4 10 2" stroke="#5a4a3a" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <path d="M15.8 8 Q18 4 20 2" stroke="#5a4a3a" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <circle cx="10" cy="1.8" r="1" fill="#5a4a3a" />
        <circle cx="20" cy="1.8" r="1" fill="#5a4a3a" />
      </svg>
    </div>
  );
}

// ─── Badge tier styles ──────────────────────────────────────────────────────────

const TIER_STYLES = {
  bronze: {
    bg: "linear-gradient(135deg, #f5e6d3, #d4a574)",
    border: "#c4944a",
    shadow: "0 2px 8px rgba(196, 148, 74, 0.3)",
  },
  silver: {
    bg: "linear-gradient(135deg, #f0f0f0, #c8c8c8)",
    border: "#b0b0b0",
    shadow: "0 2px 8px rgba(176, 176, 176, 0.3)",
  },
  gold: {
    bg: "linear-gradient(135deg, #fff8e1, #ffd54f)",
    border: "#C4962A",
    shadow: "0 2px 10px rgba(196, 150, 42, 0.4)",
  },
};

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function GardenPage() {
  const router = useRouter();
  const { effectiveUserId } = usePartner();
  const [children, setChildren]         = useState<Child[]>([]);
  const [leafCounts, setLeafCounts]     = useState<Record<string, number>>({});
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [allLessons, setAllLessons]     = useState<LessonRow[]>([]);
  const [vacationBlocks, setVacationBlocks] = useState<VacationBlock[]>([]);
  const [familyName, setFamilyName]     = useState("");
  const [profile, setProfile]           = useState<{
    plan_type?: string;
    subscription_status?: string;
    current_streak_days?: number;
    longest_streak_days?: number;
  } | null>(null);
  const [isAffiliate, setIsAffiliate]   = useState(false);
  const [celebrationData, setCelebrationData] = useState<{
    childName: string;
    stage: typeof GROWTH_STAGES[number];
    prevStage: typeof GROWTH_STAGES[number] | null;
    leafCount: number;
  } | null>(null);
  const [earnedActivityBadgeIds, setEarnedActivityBadgeIds] = useState<Set<string>>(new Set());
  const [earnedTieredBadgeKeys, setEarnedTieredBadgeKeys] = useState<Set<string>>(new Set());
  const [memoriesCount, setMemoriesCount] = useState(0);
  const [booksCount, setBooksCount] = useState(0);

  const todayStr = toDateStr(new Date());
  const activeVacation = vacationBlocks.find((b) => todayStr >= b.start_date && todayStr <= b.end_date) ?? null;
  const theme = getGardenTheme(new Date());

  useEffect(() => { document.title = "Garden \u00b7 Rooted"; localStorage.setItem("rooted_visited_garden", "1"); posthog.capture('page_viewed', { page: 'garden' }); }, []);

  const loadBadges = useCallback(async (userId: string, childId: string) => {
    // Activity badges (legacy)
    await Promise.all([
      checkAndAwardBadges(userId),
      checkFoundingBadge(userId),
    ]);
    const { data: actBadgeRows } = await supabase
      .from("user_badges")
      .select("badge_id")
      .eq("user_id", userId);
    setEarnedActivityBadgeIds(new Set((actBadgeRows ?? []).map((b: { badge_id: string }) => b.badge_id)));

    // Creative tiered badges
    const keys = await getEarnedBadgeKeys(userId, childId);
    setEarnedTieredBadgeKeys(keys);
  }, []);

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
      setChildren(capitalizeChildNames(kids_));
      const firstChildId = kids_.length > 0 ? kids_[0].id : null;
      if (firstChildId) setSelectedId(firstChildId);

      const [{ data: completed }, { data: memoryRows }, { data: vacBlocks }, { data: profileRow }, { data: actLogs }, { data: actDefs }] = await Promise.all([
        supabase.from("lessons").select("child_id, date, scheduled_date, hours").eq("user_id", effectiveUserId).eq("completed", true),
        supabase.from("memories").select("child_id, type").eq("user_id", effectiveUserId),
        supabase.from("vacation_blocks").select("start_date, end_date, name").eq("user_id", effectiveUserId),
        supabase.from("profiles").select("display_name, plan_type, subscription_status, current_streak_days, longest_streak_days").eq("id", effectiveUserId).maybeSingle(),
        supabase.from("activity_logs").select("activity_id, completed").eq("user_id", effectiveUserId).eq("completed", true),
        supabase.from("activities").select("id, child_ids").eq("user_id", effectiveUserId),
      ]);

      setAllLessons((completed as LessonRow[]) ?? []);
      setVacationBlocks((vacBlocks as VacationBlock[]) ?? []);
      const pd = profileRow as typeof profile & { display_name?: string } | null;
      setFamilyName(pd?.display_name ?? "");
      setProfile(pd);

      const { data: affiliateData } = await supabase
        .from("affiliates")
        .select("code, is_active")
        .eq("user_id", effectiveUserId)
        .maybeSingle();
      setIsAffiliate(!!affiliateData?.is_active);

      // Count leaves per child (lessons + memories + activities)
      const counts: Record<string, number> = {};
      completed?.forEach((l) => {
        counts[l.child_id] = (counts[l.child_id] ?? 0) + 1;
      });
      const memRows = (memoryRows ?? []) as { child_id: string | null; type?: string }[];
      memRows.forEach((m) => {
        if (m.child_id) counts[m.child_id] = (counts[m.child_id] ?? 0) + 1;
      });
      // Activity logs: map activity_id → child_ids, credit each child
      const actMap: Record<string, string[]> = {};
      for (const a of ((actDefs ?? []) as { id: string; child_ids: string[] | null }[])) {
        actMap[a.id] = a.child_ids ?? [];
      }
      for (const log of ((actLogs ?? []) as { activity_id: string; completed: boolean }[])) {
        const childIds = actMap[log.activity_id] ?? [];
        for (const cid of childIds) {
          counts[cid] = (counts[cid] ?? 0) + 1;
        }
      }
      setMemoriesCount(memRows.length);
      setBooksCount(memRows.filter((m) => m.type === "book").length);
      setLeafCounts(counts);

      // Growth stage celebration check — per child
      const seenBadgesKey = `garden_badges_seen_${effectiveUserId}`;
      const seenBadges = new Set(JSON.parse(localStorage.getItem(seenBadgesKey) ?? "[]") as string[]);
      const badgeThresholds = GROWTH_STAGES.filter(s => s.min > 0).map(s => s.min);

      let celebrationChild: { name: string; leafCount: number; threshold: number } | null = null;
      for (const kid of kids_) {
        const kidLeaves = counts[kid.id] ?? 0;
        const newThreshold = badgeThresholds.find(
          t => kidLeaves >= t && !seenBadges.has(`leaves_${kid.id}_${t}`)
        );
        if (newThreshold) {
          celebrationChild = { name: kid.name, leafCount: kidLeaves, threshold: newThreshold };
          const allEarned = badgeThresholds
            .filter(t => kidLeaves >= t)
            .map(t => `leaves_${kid.id}_${t}`);
          const updatedSeen = new Set([...seenBadges, ...allEarned]);
          localStorage.setItem(seenBadgesKey, JSON.stringify([...updatedSeen]));
          break;
        }
      }

      if (celebrationChild) {
        const stage = getGrowthStage(celebrationChild.leafCount);
        const prevStageIdx = getGrowthStageIndex(celebrationChild.leafCount) - 1;
        const prevStage = prevStageIdx >= 0 ? GROWTH_STAGES[prevStageIdx] : null;
        setCelebrationData({
          childName: celebrationChild.name,
          stage,
          prevStage,
          leafCount: celebrationChild.leafCount,
        });
      }

      // Load badges
      if (firstChildId) {
        await loadBadges(effectiveUserId, firstChildId);
      }

      setLoading(false);
    }
    load();
  }, [effectiveUserId, loadBadges]);

  // Reload tiered badges when selected child changes
  useEffect(() => {
    if (!effectiveUserId || !selectedId) return;
    loadBadges(effectiveUserId, selectedId);
  }, [selectedId, effectiveUserId, loadBadges]);

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
  const selectedStageIdx = getGrowthStageIndex(selectedLeaves);
  const selectedStage = GROWTH_STAGES[selectedStageIdx];
  const nextStage = GROWTH_STAGES[selectedStageIdx + 1] ?? null;
  const progress = nextStage
    ? ((selectedLeaves - selectedStage.min) / (nextStage.min - selectedStage.min)) * 100
    : 100;

  const currentStreak = profile?.current_streak_days ?? 0;

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
        overline="Your"
        title="Garden"
        subtitle="Watch your family grow"
      />
      <div className="max-w-3xl px-4 pt-5 pb-7 space-y-6">

      {/* ── First-visit tip ───────────────────────────────── */}
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
          <button type="button" onClick={dismissTip} aria-label="Dismiss tip"
            className="shrink-0 text-[#7ab87a] hover:text-[var(--g-deep)] text-lg leading-none mt-0.5 transition-colors">
            ×
          </button>
        </div>
      )}

      {/* ── Garden Scene ─────────────────────────────────── */}
      <div
        className="relative w-full overflow-hidden rounded-3xl shadow-md"
        style={{
          background: theme.skyGradient,
          aspectRatio: "16/9",
          minHeight: 280,
        }}
      >
        {/* Sun */}
        <Sun />

        {/* Clouds */}
        <Cloud x={8}  y={8}  scale={1.1} delay={0} />
        <Cloud x={28} y={14} scale={0.7} delay={-5} alt />
        <Cloud x={55} y={6}  scale={0.85} delay={-2} />

        {/* Sky decorations (seasonal) */}
        {theme.skyEmojis.slice(0, 3).map((emoji, i) => (
          <div
            key={`sky-${i}`}
            className="absolute"
            style={{
              left: `${15 + i * 30 + seededRandom(i * 7) * 10}%`,
              top: `${8 + seededRandom(i * 13) * 18}%`,
              fontSize: 20,
              opacity: 0.7,
              userSelect: "none",
              animation: `float-gentle ${3 + i}s ease-in-out infinite`,
              animationDelay: `${i * 0.5}s`,
            }}
          >
            {emoji}
          </div>
        ))}

        {/* Butterflies */}
        <Butterfly x={12} y={58} delay={0}   color="#f9a8d4" />
        <Butterfly x={72} y={62} delay={1.8} color="#fbbf24" />
        <Butterfly x={45} y={55} delay={3.2} color="#86efac" />

        {/* Vacation banner */}
        {activeVacation && (
          <div className="absolute bottom-[50%] left-1/2 -translate-x-1/2 rounded-2xl px-5 py-3 text-center shadow-lg z-10"
            style={{ background: "#fef3dc", border: "2px solid #f0dda8" }}>
            <p className="text-2xl mb-1" aria-hidden>🌴</p>
            <p className="text-sm font-bold text-[#7a4a1a] leading-snug">
              {familyName ? `${familyName.replace(/^The\s+/i, "").trim() || familyName}` : "Family"} is on a break!
            </p>
            {activeVacation.name && (
              <p className="text-xs text-[#a06b2d] mt-0.5">{activeVacation.name}</p>
            )}
          </div>
        )}

        {/* Ground layers */}
        <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: "32%" }}>
          <svg viewBox="0 0 400 100" preserveAspectRatio="xMidYMax slice" className="w-full h-full">
            <path d="M0 55 Q80 32 160 50 Q240 68 320 44 Q380 28 400 48 L400 100 L0 100 Z"
              fill="#8aba6a" opacity="0.6" />
            <path d="M0 65 Q100 48 200 62 Q300 76 400 58 L400 100 L0 100 Z"
              fill="#5c8a47" />
            <path d="M0 65 Q100 48 200 62 Q300 76 400 58" fill="none"
              stroke="#6aa050" strokeWidth="1.5" opacity="0.8" />
            <path d="M0 75 Q100 68 200 73 Q300 78 400 70 L400 100 L0 100 Z"
              fill="#3d6030" />
          </svg>
        </div>

        {/* Ground decorations (seasonal) */}
        {theme.groundEmojis.slice(0, 6).map((emoji, i) => (
          <div
            key={`ground-${i}`}
            className="absolute"
            style={{
              bottom: `${4 + seededRandom(i * 3 + 1) * 12}%`,
              left: `${5 + i * 15 + seededRandom(i * 5 + 2) * 8}%`,
              fontSize: 16,
              opacity: 0.6,
              userSelect: "none",
              zIndex: 2,
            }}
          >
            {emoji}
          </div>
        ))}

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
            const leaves = leafCounts[child.id] ?? 0;
            const x = getTreeX(i, children.length);
            const stage = getGrowthStage(leaves);
            const swayClass = i % 2 === 0 ? "garden-sway" : "garden-sway-alt";
            const baseSize = 64;
            const size = Math.round(baseSize * stage.scale);

            return (
              <div
                key={child.id}
                className="absolute cursor-pointer flex flex-col items-center"
                style={{ bottom: "28%", left: `${x}%`, transform: "translateX(-50%)" }}
                onClick={() => setSelectedId(child.id)}
              >
                <div
                  className={`${swayClass} relative flex items-end justify-center`}
                  style={{ transformOrigin: "center bottom", animationDelay: `${i * 0.7}s` }}
                >
                  <span
                    style={{
                      fontSize: size,
                      lineHeight: 1,
                      display: "block",
                      filter: stage.min >= 200
                        ? "drop-shadow(0 0 12px rgba(92, 127, 99, 0.5)) drop-shadow(0 6px 14px rgba(0,0,0,0.2))"
                        : "drop-shadow(0 6px 14px rgba(0,0,0,0.2))",
                      userSelect: "none",
                    }}
                    aria-hidden
                  >
                    {stage.emoji}
                  </span>
                </div>

                {/* Leaf count pill */}
                <div className="mt-1 flex items-center gap-0.5 shadow-sm" style={{ background: "#ffffff", borderRadius: 12, padding: "3px 8px" }}>
                  <span style={{ fontSize: 11 }}>🌿</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--g-brand)" }}>{leaves}</span>
                </div>

                {/* Name tag */}
                <div className="mt-1 text-center">
                  <span className="font-semibold shadow-sm whitespace-nowrap" style={{
                    fontSize: 12, background: "rgba(0,0,0,0.3)", color: "#ffffff",
                    borderRadius: 10, padding: "3px 10px",
                  }}>
                    {child.name}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Per-kid Growth Cards (stacked) ──────────────────── */}
      {children.map((child) => {
        const childLeaves = leafCounts[child.id] ?? 0;
        const childStage = GROWTH_STAGES[getGrowthStageIndex(childLeaves)];
        const childNextStage = GROWTH_STAGES[getGrowthStageIndex(childLeaves) + 1] ?? null;
        const isSelected = child.id === selectedId;

        return (
          <div
            key={child.id}
            className={`bg-white border rounded-2xl p-[18px] transition-colors cursor-pointer ${
              isSelected ? "border-[#2D5A3D] shadow-sm" : "border-[#e8e5e0]"
            }`}
            onClick={() => setSelectedId(child.id)}
          >
            {/* Top row: accent strip + info + tree emoji */}
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-stretch">
                <div
                  className="w-1 rounded-full mr-3 self-stretch"
                  style={{ background: child.color || "#8B7E74" }}
                />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74]">
                    {child.name}
                  </p>
                  <p className="text-xl font-bold text-[#2d2926] flex items-center gap-1.5 mt-0.5">
                    {childStage.emoji} {childStage.name}
                  </p>
                  <p className="text-[13px] text-[#8B7E74] mt-0.5">
                    {childStage.label}
                  </p>
                </div>
              </div>
              <div className="w-[52px] h-[52px] flex items-center justify-center text-[38px]">
                {getGrowthStage(childLeaves).emoji}
              </div>
            </div>

            {/* Leaf count + next stage */}
            <div className="flex items-center gap-1.5 pt-3 border-t border-[#f0ede8] text-[13px]">
              <span>🌿</span>
              <span className="font-semibold text-[#2D5A3D]">
                {childLeaves} {childLeaves === 1 ? "leaf" : "leaves"}
              </span>
              {childNextStage && (
                <span className="text-[#8B7E74]">
                  · {childNextStage.min - childLeaves} to {childNextStage.name}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* ── Kid View Buttons ──────────────────────────────── */}
      {children.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {children.map((child) => (
            <button
              key={child.id}
              onClick={() => router.push(`/child?child=${child.id}`)}
              className="w-full flex items-center justify-between bg-white border border-[#e8e5e0] rounded-2xl px-5 py-4 hover:border-[#2D5A3D] hover:shadow-sm transition-all group"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                  style={{ background: `${child.color || '#8B7E74'}22` }}
                >
                  {getGrowthStage(leafCounts[child.id] ?? 0).emoji}
                </div>
                <div className="text-left">
                  <p className="text-[15px] font-bold text-[#2D2A26]">
                    Show {child.name} Their Garden
                  </p>
                  <p className="text-[12px] text-[#8B7E74]">
                    Open {child.name}&apos;s kid-friendly view
                  </p>
                </div>
              </div>
              <span className="text-[#8B7E74] group-hover:text-[#2D5A3D] text-lg transition-colors">&rarr;</span>
            </button>
          ))}
        </div>
      )}

      {/* ── How leaves are earned ─────────────────────────── */}
      <div className="text-center">
        <p className="text-[12px] font-medium text-[#5C5346] mb-1">How leaves are earned:</p>
        <p className="text-[11px] text-[#8B7E74]">
          Complete a lesson = 1 leaf · Log a book = 1 leaf · Capture a memory = 1 leaf · Complete an activity = 1 leaf
        </p>
      </div>

      {/* ── Child Toggle Pills ────────────────────────────── */}
      {children.length > 1 && (
        <div className="flex justify-center">
          <div className="inline-flex bg-white border border-[#e8e5e0] rounded-full p-1 gap-1">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => setSelectedId(child.id)}
                className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all ${
                  selectedId === child.id
                    ? "bg-[#2D5A3D] text-white shadow-sm"
                    : "text-[#8B7E74] hover:text-[#5C5346]"
                }`}
              >
                {child.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Tree Growth Stages ───────────────────────────── */}
      {selectedChild && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2 pl-1">
            Tree Growth Stages
          </p>
          <div className="bg-white border border-[#e8e5e0] rounded-2xl p-5">
            <p className="text-[13px] text-[#5C5346] mb-4 leading-relaxed">
              Each kid&apos;s tree grows as they earn leaves from lessons, books, and memories.
            </p>
            <div className="space-y-0">
              {GROWTH_STAGES.map((stage, i) => {
                const isEarned = selectedLeaves >= stage.min;
                const isNext = i === selectedStageIdx + 1;
                const leavesToGo = stage.min - selectedLeaves;
                return (
                  <div key={stage.name} className="flex items-start gap-3 relative">
                    {i < GROWTH_STAGES.length - 1 && (
                      <div className="absolute left-[9px] top-[22px] w-[2px] h-[calc(100%-4px)]"
                        style={{ backgroundColor: isEarned ? "#2D5A3D" : "#e8e5e0" }} />
                    )}
                    <div className="shrink-0 mt-[6px] z-10"
                      style={{
                        width: 20, height: 20, borderRadius: "50%",
                        border: isEarned ? "none" : isNext ? "2px solid #2D5A3D" : "2px dashed #d5d0ca",
                        backgroundColor: isEarned ? "#2D5A3D" : isNext ? "#e8f0e9" : "transparent",
                      }}
                    />
                    <div className="pb-4" style={{ opacity: isEarned || isNext ? 1 : 0.4 }}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{stage.emoji}</span>
                        <span className={`text-[13px] ${isEarned ? "font-bold text-[#2D2A26]" : "font-medium text-[#5C5346]"}`}>
                          {stage.name}
                        </span>
                        <span className="text-[11px] text-[#8B7E74]">
                          — {stage.min === 0 ? "0 leaves" : stage.min === 1 ? "1 leaf" : `${stage.min} leaves`}
                        </span>
                        {isNext && <span className="text-[10px] font-semibold text-[#2D5A3D] bg-[#e8f0e9] px-1.5 py-0.5 rounded">NEXT</span>}
                      </div>
                      <p className="text-[11px] text-[#8B7E74] mt-0.5 pl-7">
                        {isEarned ? "\u2713 Reached" : isNext ? `${leavesToGo} more leaf${leavesToGo !== 1 ? "s" : ""} to go` : stage.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Creative Badge Collection ──────────────────────── */}
      {selectedChild && (
      <div>
        <p className="text-[13px] font-bold uppercase tracking-wide text-[#5C5346] mb-3 pl-1">
          {selectedChild ? `${selectedChild.name}'s Badges` : "Badges"}
        </p>
        <div className="bg-white border border-[#e8e5e0] rounded-2xl p-4">
          {BADGE_CATEGORIES.filter(cat => !cat.conditional || booksCount > 0).map((cat, catIdx, filteredCats) => {
            return (
              <div key={cat.id} className={catIdx < filteredCats.length - 1 ? "border-b border-[#f2f0ec] pb-3 mb-3" : ""}>
                <p className="text-[13px] font-semibold text-[#2D2A26] mb-2">{cat.icon} {cat.name}</p>
                <div className="flex gap-4">
                  {cat.tiers.map((t, tIdx) => {
                    const key = cat.perCurriculum
                      ? `${cat.id}_${t.tier}`
                      : `${cat.id}_${t.tier}`;
                    const isEarned = cat.perCurriculum
                      ? [...earnedTieredBadgeKeys].some(k => k.startsWith(`${cat.id}_${t.tier}_`))
                      : earnedTieredBadgeKeys.has(key);
                    const prevEarned = tIdx === 0
                      ? true
                      : cat.perCurriculum
                        ? [...earnedTieredBadgeKeys].some(k => k.startsWith(`${cat.id}_${cat.tiers[tIdx - 1].tier}_`))
                        : earnedTieredBadgeKeys.has(`${cat.id}_${cat.tiers[tIdx - 1].tier}`);
                    const isNext = !isEarned && prevEarned;

                    // ── Duolingo-style visual states ──
                    const tierBg = isEarned
                      ? t.tier === "gold" ? "radial-gradient(circle, #fff8e1 0%, #ffe082 50%, #ffd54f 100%)"
                        : t.tier === "silver" ? "radial-gradient(circle, #fafafa 0%, #e8e8e8 50%, #d0d0d0 100%)"
                        : "radial-gradient(circle, #fdf0e0 0%, #f0d8b8 50%, #e8c8a0 100%)"
                      : isNext ? "#f0ede8" : "#f5f3f0";
                    const tierBorder = isEarned
                      ? t.tier === "gold" ? "2.5px solid #C4962A"
                        : t.tier === "silver" ? "2.5px solid #a0a0a0"
                        : "2.5px solid #c4944a"
                      : isNext ? "2.5px solid #2D5A3D" : "2px solid #e8e5e0";
                    const tierShadow = isEarned
                      ? t.tier === "gold" ? "0 4px 16px rgba(196,150,42,0.4), inset 0 1px 2px rgba(255,255,255,0.5)"
                        : t.tier === "silver" ? "0 3px 12px rgba(160,160,160,0.3), inset 0 1px 2px rgba(255,255,255,0.4)"
                        : "0 3px 12px rgba(196,148,74,0.3), inset 0 1px 2px rgba(255,255,255,0.4)"
                      : isNext ? "0 2px 8px rgba(45,90,61,0.15)" : "none";

                    return (
                      <div key={t.tier} className="flex flex-col items-center" style={{ width: 76 }}>
                        <div
                          className="relative flex items-center justify-center rounded-2xl"
                          style={{
                            width: 64, height: 64, background: tierBg,
                            border: tierBorder, boxShadow: tierShadow,
                            transform: isEarned ? "scale(1)" : "scale(0.95)",
                            transition: "transform 0.2s, box-shadow 0.2s",
                          }}
                        >
                          <span style={{
                            fontSize: 30,
                            opacity: isEarned ? 1 : isNext ? 0.5 : 0.2,
                            userSelect: "none",
                            filter: !isEarned && !isNext ? "grayscale(100%)" : "none",
                          }}>
                            {t.emoji}
                          </span>
                          {isEarned && (
                            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#2D5A3D] rounded-full flex items-center justify-center shadow-sm">
                              <span className="text-white text-[10px] font-bold">{"\u2713"}</span>
                            </span>
                          )}
                          {isNext && (
                            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-[#2D5A3D] text-white text-[8px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shadow-sm">
                              NEXT
                            </span>
                          )}
                          {!isEarned && !isNext && (
                            <span className="absolute bottom-1 right-1 text-[10px] opacity-40">🔒</span>
                          )}
                        </div>
                        <span className={`text-[11px] font-semibold text-center leading-tight mt-2 ${
                          isEarned ? "text-[#2D2A26]" : isNext ? "text-[#2D5A3D]" : "text-[#c0b8b0]"
                        }`}>
                          {t.name}
                        </span>
                        <span className={`text-[10px] text-center ${isEarned ? "text-[#8B7E74]" : "text-[#d0c8c0]"}`}>
                          {t.threshold === -1 ? t.unit : `${t.threshold} ${t.unit}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      <div className="h-4" />
      </div>

      {/* Growth stage celebration modal (persists until dismissed) */}
      {celebrationData && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[60]" />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
            <div className="bg-white rounded-3xl shadow-2xl p-8 text-center max-w-xs w-full">
              {/* Stage transition */}
              <div className="text-4xl mb-4 flex items-center justify-center gap-2">
                {celebrationData.prevStage && (
                  <>
                    <span className="opacity-40">{celebrationData.prevStage.emoji}</span>
                    <span className="text-[#8B7E74] text-lg">→</span>
                  </>
                )}
                <span>{celebrationData.stage.emoji}</span>
              </div>
              <h2 className="text-xl font-bold text-[#2D2A26] mb-2" style={{ fontFamily: "var(--font-display)" }}>
                {celebrationData.childName} reached {celebrationData.stage.name}!
              </h2>
              <p className="text-sm text-[#8B7E74] mb-6">
                {celebrationData.leafCount} {celebrationData.leafCount === 1 ? "leaf" : "leaves"} earned by {celebrationData.childName}
              </p>
              <button
                type="button"
                onClick={() => setCelebrationData(null)}
                className="w-full py-3.5 rounded-xl bg-[#2D5A3D] text-white font-semibold text-sm hover:opacity-90 transition-colors"
              >
                Keep Growing!
              </button>
            </div>
          </div>
        </>
      )}

      {/* Float animation for seasonal items */}
      <style jsx>{`
        @keyframes float-gentle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </>
  );
}
