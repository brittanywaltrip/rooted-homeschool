import { supabase } from "@/lib/supabase";
import { awardActivityBadges, awardFoundingBadge, ACTIVITY_BADGES, type BadgeDef } from "@/lib/badge-checks";

// ─── SQL to create table (run in Supabase SQL editor) ────────────────────────
//
// CREATE TABLE IF NOT EXISTS user_badges (
//   id uuid DEFAULT gen_random_uuid(),
//   user_id uuid REFERENCES profiles(id),
//   badge_id text NOT NULL,
//   earned_at timestamptz DEFAULT now(),
//   PRIMARY KEY (id),
//   UNIQUE (user_id, badge_id)
// );
//
// ─────────────────────────────────────────────────────────────────────────────
//
// The checks themselves live in lib/badge-checks.ts, which takes the client
// as a parameter so the badge set is tested against in-memory rows. This file
// binds them to the app's browser client and fires the notification event.

export { ACTIVITY_BADGES };
export type { BadgeDef };

/**
 * Dispatch a badge-earned event so the global listener can show the notification.
 */
export function emitBadgeEarned(badge: BadgeDef) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("badge-earned", { detail: badge }));
  }
}

/**
 * Check and award activity-based badges for a user.
 * Returns the first newly-earned badge (if any) for notification purposes.
 */
export async function checkAndAwardBadges(userId: string): Promise<BadgeDef | null> {
  const firstNew = await awardActivityBadges(supabase, userId);
  if (firstNew) emitBadgeEarned(firstNew);
  return firstNew;
}

/**
 * Award the founding_family badge if the user has that plan type.
 */
export async function checkFoundingBadge(userId: string): Promise<BadgeDef | null> {
  const badge = await awardFoundingBadge(supabase, userId);
  if (badge) emitBadgeEarned(badge);
  return badge;
}
