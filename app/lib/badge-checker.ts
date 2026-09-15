import { supabase } from "@/lib/supabase";
import { checkCreativeBadges, type BadgeCategory, type BadgeTierDef } from "./badges-tiered";
import { gatherBadgeData } from "./badge-data";

// The data the tiered badges read is gathered in badge-data.ts (pure of the
// app's client, so it is tested); this binds it to the browser client.

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Gather badge data and check for newly earned creative badges.
 * Returns array of newly earned badges (empty if none).
 */
export async function checkAndAwardCreativeBadges(
  userId: string,
  childId?: string,
): Promise<{ badgeKey: string; category: BadgeCategory; tierDef: BadgeTierDef }[]> {
  const data = await gatherBadgeData(supabase, userId, childId);
  return checkCreativeBadges(userId, childId ?? "", data);
}
