// The tiered badge definitions and the rule for which ones a child's numbers
// satisfy. Pure, with no imports, so node --test can run it: badges-tiered.ts
// (which writes awards through the app's Supabase client) re-exports all of it.

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

// ─── Which badges the numbers satisfy ────────────────────────────────────────

export type MetTieredBadge = { badgeKey: string; category: BadgeCategory; tierDef: BadgeTierDef };

/**
 * Every tiered badge `data` satisfies that `earned` does not already hold, in
 * BADGE_CATEGORIES order. checkCreativeBadges awards exactly these.
 */
export function metTieredBadges(data: BadgeCheckData, earned: ReadonlySet<string>): MetTieredBadge[] {
  const out: MetTieredBadge[] = [];

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
            out.push({ badgeKey: key, category: cat, tierDef: t });
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
        out.push({ badgeKey: key, category: cat, tierDef: t });
      }
    }
  }

  return out;
}
