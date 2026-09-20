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
  // NO CHILD, NO BADGE WORK AT ALL.
  //
  // This used to pass `childId ?? ""` into badges.child_id, which is a uuid
  // column. PostgREST answered both the lookup and the insert with
  //
  //   22P02: invalid input syntax for type uuid: ""
  //
  // Every creative-badge check from a flow with no child selected produced two
  // failing /rest/v1/badges requests, and because the caller swallowed the
  // error and returned the badge anyway, the family was congratulated for a
  // badge that had not been saved -- then congratulated again on the next
  // action, because nothing had been persisted to stop it.
  //
  // A badge belongs to a child. With no child there is nothing to award, so
  // this returns before touching the network. Production holds 1,816 badges
  // and none with a null child_id; that stays true.
  if (!childId) return [];

  const data = await gatherBadgeData(supabase, userId, childId);
  return checkCreativeBadges(userId, childId, data);
}
