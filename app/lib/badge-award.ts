// Awarding a creative badge: the writes, pure of the app's Supabase client.
//
// Split out for the same reason badge-data.ts is: node --test strips types but
// does not resolve the "@/" alias, so a module that imports the client at
// module scope cannot be unit tested. badges-tiered.ts binds the singleton;
// everything here takes its client as an argument.
//
// WHAT WENT WRONG (2026-09-20). checkAndAwardCreativeBadges passed
// `childId ?? ""` into badges.child_id, a uuid column. Confirmed against
// staging by issuing exactly what the client issues:
//
//   SELECT .eq(child_id, '') -> 22P02: invalid input syntax for type uuid: ""
//   INSERT child_id: ''      -> 22P02: invalid input syntax for type uuid: ""
//
// So every creative-badge check from a flow with no child produced two failing
// /rest/v1/badges requests. Worse, awardBadge's guard matched neither
// "duplicate" nor 23505, so it logged the failure and the caller returned the
// badge anyway: the family was congratulated for a row that did not exist, and
// congratulated again next time because nothing had been persisted to stop it.

import { metTieredBadges, type BadgeCheckData, type MetTieredBadge } from "./badge-tiers.ts";

/** The slice of the Supabase client these writes use. */
export interface BadgeWriteClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => PromiseLike<{
          data: { badge_key: string }[] | null;
          error: { code?: string; message: string } | null;
        }>;
      };
    };
    insert: (row: Record<string, unknown>) => PromiseLike<{
      error: { code?: string; message: string } | null;
    }>;
  };
}

/**
 * "inserted" -- the row is new, celebrate it.
 * "already"  -- another writer got there first. Idempotent: not an error, and
 *               NOT a second celebration.
 * "failed"   -- nothing was written, so nothing is celebrated.
 */
export type AwardResult = "inserted" | "already" | "failed";

export async function awardBadge(
  client: BadgeWriteClient,
  userId: string,
  childId: string,
  badgeType: string,
  badgeKey: string,
  tier: string,
): Promise<AwardResult> {
  const { error } = await client.from("badges").insert({
    user_id: userId,
    child_id: childId,
    badge_type: badgeType,
    badge_key: badgeKey,
    tier,
  });
  if (!error) return "inserted";
  // 23505 is the unique violation a concurrent check produces. The row exists,
  // which is the outcome we wanted; it is simply not ours to celebrate.
  if (error.code === "23505" || error.message.includes("duplicate")) return "already";
  console.error("[badge-award] award failed:", error.code, error.message);
  return "failed";
}

export async function checkCreativeBadgesWith(
  client: BadgeWriteClient,
  userId: string,
  childId: string | undefined | null,
  data: BadgeCheckData,
): Promise<MetTieredBadge[]> {
  // A badge belongs to a child. Without one there is nothing to look up and
  // nothing to award, and child_id rejects "" with 22P02. Return before any
  // request: no query, no insert, empty result.
  if (!childId) return [];

  const { data: existingRows, error: lookupError } = await client
    .from("badges")
    .select("badge_key")
    .eq("user_id", userId)
    .eq("child_id", childId);

  // If we cannot read what is already earned we cannot tell new from old, and
  // celebrating on a guess is how a family gets the same badge twice.
  if (lookupError) {
    console.error("[badge-award] lookup failed:", lookupError.code, lookupError.message);
    return [];
  }

  const earned = new Set((existingRows ?? []).map((b) => b.badge_key));
  const candidates = metTieredBadges(data, earned);

  // ONLY BADGES THAT ACTUALLY LANDED ARE RETURNED. The caller dispatches a
  // celebration for everything it gets back.
  const awarded: MetTieredBadge[] = [];
  for (const b of candidates) {
    const result = await awardBadge(client, userId, childId, b.category.id, b.badgeKey, b.tierDef.tier);
    if (result === "inserted") awarded.push(b);
  }
  return awarded;
}
