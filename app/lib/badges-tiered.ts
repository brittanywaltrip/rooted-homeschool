import { supabase } from "@/lib/supabase";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BadgeTier = "bronze" | "silver" | "gold";

export type BadgeTierDef = {
  tier: BadgeTier;
  emoji: string;
  name: string;
  threshold: number;
  unit: string;
  description: string;
};

export type BadgeCategory = {
  id: string;
  name: string;
  icon: string;
  tiers: BadgeTierDef[];
  perCurriculum?: boolean;
  conditional?: boolean;
};

// ─── 7 Badge Categories ──────────────────────────────────────────────────────

export const BADGE_CATEGORIES: BadgeCategory[] = [
  {
    id: "growth",
    name: "Growth",
    icon: "🌱",
    tiers: [
      { tier: "bronze", emoji: "🌱", name: "Sprout",       threshold: 25,  unit: "leaves",     description: "Your garden is growing!" },
      { tier: "silver", emoji: "🌿", name: "Flourishing",  threshold: 100, unit: "leaves",     description: "Look how far you've come!" },
      { tier: "gold",   emoji: "🌳", name: "Mighty Oak",   threshold: 500, unit: "leaves",     description: "A forest of learning!" },
    ],
  },
  {
    id: "flame",
    name: "Flame",
    icon: "🕯️",
    tiers: [
      { tier: "bronze", emoji: "🕯️", name: "Spark",     threshold: 3,  unit: "day streak",  description: "A flame is lit!" },
      { tier: "silver", emoji: "🔥",  name: "Bonfire",   threshold: 7,  unit: "day streak",  description: "Nothing can stop you!" },
      { tier: "gold",   emoji: "☀️",  name: "Supernova", threshold: 30, unit: "day streak",  description: "You ARE the light!" },
    ],
  },
  {
    id: "rhythm",
    name: "Rhythm",
    icon: "🐛",
    tiers: [
      { tier: "bronze", emoji: "🐛", name: "Caterpillar", threshold: 5,  unit: "days this month", description: "Building your rhythm!" },
      { tier: "silver", emoji: "🦋", name: "Butterfly",   threshold: 15, unit: "days this month", description: "Beautiful consistency!" },
      { tier: "gold",   emoji: "🦅", name: "Eagle",       threshold: -1, unit: "every school day", description: "Soaring above it all!" },
    ],
  },
  {
    id: "deep-roots",
    name: "Deep Roots",
    icon: "🪨",
    tiers: [
      { tier: "bronze", emoji: "🪨", name: "Rough Stone", threshold: 25,  unit: "% complete", description: "Digging deep!" },
      { tier: "silver", emoji: "💎", name: "Diamond",     threshold: 50,  unit: "% complete", description: "Polished and brilliant!" },
      { tier: "gold",   emoji: "👑", name: "Crown",       threshold: 100, unit: "% complete", description: "Mastery achieved!" },
    ],
    perCurriculum: true,
  },
  {
    id: "explorer",
    name: "Explorer",
    icon: "🐾",
    tiers: [
      { tier: "bronze", emoji: "🐾", name: "Footprints",   threshold: 3, unit: "subjects", description: "Following the trail!" },
      { tier: "silver", emoji: "🧭", name: "Navigator",    threshold: 5, unit: "subjects", description: "Charting new territory!" },
      { tier: "gold",   emoji: "🗺️", name: "Cartographer", threshold: 7, unit: "subjects", description: "You've mapped the world!" },
    ],
  },
  {
    id: "memory-keeper",
    name: "Memory Keeper",
    icon: "📸",
    tiers: [
      { tier: "bronze", emoji: "📸", name: "Snapshot",  threshold: 5,   unit: "memories", description: "Capturing the moments!" },
      { tier: "silver", emoji: "📚", name: "Scrapbook", threshold: 25,  unit: "memories", description: "A story taking shape!" },
      { tier: "gold",   emoji: "🏛️", name: "Museum",   threshold: 100, unit: "memories", description: "A gallery of memories!" },
    ],
  },
  {
    id: "bookworm",
    name: "Bookworm",
    icon: "🔖",
    tiers: [
      { tier: "bronze", emoji: "🔖", name: "Bookmark",          threshold: 5,  unit: "books", description: "A reader is born!" },
      { tier: "silver", emoji: "📖", name: "Storyteller",       threshold: 15, unit: "books", description: "Lost in the pages!" },
      { tier: "gold",   emoji: "🏰", name: "Castle of Stories", threshold: 50, unit: "books", description: "A kingdom of imagination!" },
    ],
    conditional: true,
  },
];

// ─── Data shape for badge checking ───────────────────────────────────────────

export type BadgeCheckData = {
  totalLeaves: number;
  currentStreak: number;
  longestStreak: number;
  daysLoggedThisMonth: number;
  schoolDaysThisMonth: number;
  totalMemories: number;
  totalBooks: number;
  subjectsThisWeek: number;
  curricula: { goalId: string; completionPct: number }[];
};

// ─── Badge checking logic ────────────────────────────────────────────────────

export async function checkCreativeBadges(
  userId: string,
  childId: string,
  data: BadgeCheckData,
): Promise<{ badgeKey: string; category: BadgeCategory; tierDef: BadgeTierDef }[]> {
  const { data: existingRows } = await supabase
    .from("badges")
    .select("badge_key")
    .eq("user_id", userId)
    .eq("child_id", childId);

  const earned = new Set((existingRows ?? []).map((b: { badge_key: string }) => b.badge_key));
  const newBadges: { badgeKey: string; category: BadgeCategory; tierDef: BadgeTierDef }[] = [];

  function getValue(cat: BadgeCategory): number {
    switch (cat.id) {
      case "growth": return data.totalLeaves;
      case "flame": return Math.max(data.currentStreak, data.longestStreak);
      case "rhythm": return data.daysLoggedThisMonth;
      case "explorer": return data.subjectsThisWeek;
      case "memory-keeper": return data.totalMemories;
      case "bookworm": return data.totalBooks;
      default: return 0;
    }
  }

  for (const cat of BADGE_CATEGORIES) {
    if (cat.perCurriculum) {
      // Deep Roots — check per curriculum
      for (const curr of data.curricula) {
        for (const t of cat.tiers) {
          const key = `${cat.id}_${t.tier}_${curr.goalId}`;
          if (!earned.has(key) && curr.completionPct >= t.threshold) {
            await awardBadge(userId, childId, cat.id, key, t.tier);
            newBadges.push({ badgeKey: key, category: cat, tierDef: t });
          }
        }
      }
      continue;
    }

    const value = getValue(cat);
    for (const t of cat.tiers) {
      const key = `${cat.id}_${t.tier}`;
      // Special case: rhythm gold uses dynamic threshold
      const threshold = cat.id === "rhythm" && t.tier === "gold"
        ? data.schoolDaysThisMonth
        : t.threshold;
      if (threshold <= 0) continue;
      if (!earned.has(key) && value >= threshold) {
        await awardBadge(userId, childId, cat.id, key, t.tier);
        newBadges.push({ badgeKey: key, category: cat, tierDef: t });
      }
    }
  }

  return newBadges;
}

async function awardBadge(userId: string, childId: string, badgeType: string, badgeKey: string, tier: string) {
  const { error } = await supabase.from("badges").insert({
    user_id: userId,
    child_id: childId,
    badge_type: badgeType,
    badge_key: badgeKey,
    tier,
  });
  if (error && !error.message.includes("duplicate") && !error.code?.includes("23505")) {
    console.error("[badges-tiered] award failed:", error);
  }
}

export async function getEarnedBadgeKeys(userId: string, childId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("badges")
    .select("badge_key")
    .eq("user_id", userId)
    .eq("child_id", childId);
  return new Set((data ?? []).map((b: { badge_key: string }) => b.badge_key));
}

export async function getEarnedBadgesWithDates(userId: string, childId: string): Promise<{ badge_key: string; badge_type: string; tier: string; earned_at: string }[]> {
  const { data } = await supabase
    .from("badges")
    .select("badge_key, badge_type, tier, earned_at")
    .eq("user_id", userId)
    .eq("child_id", childId)
    .order("earned_at", { ascending: false });
  return (data ?? []) as { badge_key: string; badge_type: string; tier: string; earned_at: string }[];
}

// Legacy exports for backward compatibility
export type TieredBadgeDef = BadgeTierDef & { badgeType: string; badgeKey: string; icon: string; label: string };
export const LESSON_BADGES: TieredBadgeDef[] = BADGE_CATEGORIES[0].tiers.map(t => ({ badgeType: "growth", badgeKey: `growth_${t.tier}`, tier: t.tier, icon: t.emoji, label: t.name, description: t.description, threshold: t.threshold, emoji: t.emoji, name: t.name, unit: t.unit }));
export const STREAK_BADGES: TieredBadgeDef[] = BADGE_CATEGORIES[1].tiers.map(t => ({ badgeType: "flame", badgeKey: `flame_${t.tier}`, tier: t.tier, icon: t.emoji, label: t.name, description: t.description, threshold: t.threshold, emoji: t.emoji, name: t.name, unit: t.unit }));
export const CONSISTENCY_BADGES: TieredBadgeDef[] = BADGE_CATEGORIES[2].tiers.map(t => ({ badgeType: "rhythm", badgeKey: `rhythm_${t.tier}`, tier: t.tier, icon: t.emoji, label: t.name, description: t.description, threshold: t.threshold, emoji: t.emoji, name: t.name, unit: t.unit }));
export const SUBJECT_BADGES: TieredBadgeDef[] = BADGE_CATEGORIES[3].tiers.map(t => ({ badgeType: "deep-roots", badgeKey: `deep-roots_${t.tier}`, tier: t.tier, icon: t.emoji, label: t.name, description: t.description, threshold: t.threshold, emoji: t.emoji, name: t.name, unit: t.unit }));
export const ALL_BADGE_CATEGORIES = BADGE_CATEGORIES.map(c => ({ name: c.name, badges: c.tiers.map(t => ({ badgeType: c.id, badgeKey: `${c.id}_${t.tier}`, tier: t.tier, icon: t.emoji, label: t.name, description: t.description, threshold: t.threshold })) }));
export const checkTieredBadges = async (userId: string, childId: string) => {
  // Legacy wrapper — returns badge keys only
  const result = await checkCreativeBadges(userId, childId, { totalLeaves: 0, currentStreak: 0, longestStreak: 0, daysLoggedThisMonth: 0, schoolDaysThisMonth: 0, totalMemories: 0, totalBooks: 0, subjectsThisWeek: 0, curricula: [] });
  return result.map(r => r.badgeKey);
};
