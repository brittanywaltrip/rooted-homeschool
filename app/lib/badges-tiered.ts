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
import { checkCreativeBadgesWith, type BadgeWriteClient } from "./badge-award";

// The definitions and the "which badges are met" rule live in badge-tiers.ts,
// pure so they can be tested; this file writes the awards.
export { BADGE_CATEGORIES, metTieredBadges };
export type { BadgeWriteClient };
export type { BadgeCategory, BadgeCheckData, BadgeTier, BadgeTierDef, MetTieredBadge };

// ─── Badge checking logic ────────────────────────────────────────────────────

/** Binds the singleton client to the award logic in badge-award.ts. */
export async function checkCreativeBadges(
  userId: string,
  childId: string | undefined | null,
  data: BadgeCheckData,
  client: BadgeWriteClient = supabase as unknown as BadgeWriteClient,
): Promise<MetTieredBadge[]> {
  return checkCreativeBadgesWith(client, userId, childId, data);
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
