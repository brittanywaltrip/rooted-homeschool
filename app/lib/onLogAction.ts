import { updateStreak } from "./streaks";
import { checkAndAwardCreativeBadges } from "./badge-checker";
import type { BadgeCategory, BadgeTierDef } from "./badges-tiered";

export type NewBadge = {
  badgeKey: string;
  category: BadgeCategory;
  tierDef: BadgeTierDef;
};

/**
 * Unified post-action handler. Call after ANY successful logging event
 * (lesson, memory, book, activity, drawing, field trip, project, win).
 *
 * Handles:
 * 1. Streak update (per-user, not per-child)
 * 2. Creative badge check + award
 *
 * Safe to call fire-and-forget — errors are caught and logged,
 * never block the primary action.
 */
export async function onLogAction({
  userId,
  childId,
  actionType,
}: {
  userId: string;
  childId?: string;
  actionType: "lesson" | "memory" | "book" | "activity" | "drawing" | "field_trip" | "project" | "win" | "quote";
}): Promise<{ newBadges: NewBadge[] }> {
  const newBadges: NewBadge[] = [];

  try {
    // 1. Update streak (fire-and-forget safe)
    await updateStreak(userId);
  } catch (err) {
    console.error("[onLogAction] streak update failed:", err);
  }

  try {
    // 2. Check creative badges
    const badges = await checkAndAwardCreativeBadges(userId, childId);
    newBadges.push(...badges);
  } catch (err) {
    console.error("[onLogAction] badge check failed:", err);
  }

  if (newBadges.length > 0) {
    console.log(`[onLogAction] ${actionType}: ${newBadges.length} new badge(s) earned`);
    // Dispatch browser event so any listening component can show celebration
    if (typeof window !== "undefined") {
      for (const badge of newBadges) {
        window.dispatchEvent(
          new CustomEvent("creative-badge-earned", { detail: badge })
        );
      }
    }
  }

  return { newBadges };
}
