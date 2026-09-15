import { supabase } from "@/lib/supabase";
import {
  BADGE_CATEGORIES,
  metTieredBadges,
  type BadgeCategory,
  type BadgeCheckData,
  type BadgeTier,
  type BadgeTierDef,
  type MetTieredBadge,
} from "./badge-tiers";

// The definitions and the "which badges are met" rule live in badge-tiers.ts,
// pure so they can be tested; this file writes the awards.
export { BADGE_CATEGORIES, metTieredBadges };
export type { BadgeCategory, BadgeCheckData, BadgeTier, BadgeTierDef, MetTieredBadge };

// ─── Badge checking logic ────────────────────────────────────────────────────

export async function checkCreativeBadges(
  userId: string,
  childId: string,
  data: BadgeCheckData,
): Promise<MetTieredBadge[]> {
  const { data: existingRows } = await supabase
    .from("badges")
    .select("badge_key")
    .eq("user_id", userId)
    .eq("child_id", childId);

  const earned = new Set((existingRows ?? []).map((b: { badge_key: string }) => b.badge_key));
  const newBadges = metTieredBadges(data, earned);
  for (const b of newBadges) {
    await awardBadge(userId, childId, b.category.id, b.badgeKey, b.tierDef.tier);
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
