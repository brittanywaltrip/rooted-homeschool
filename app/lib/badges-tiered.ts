import { supabase } from "@/lib/supabase";

// ─── Badge definitions ─────────────────────────────────────────────────────────

export type BadgeTier = "bronze" | "silver" | "gold";

export type TieredBadgeDef = {
  badgeType: string;
  badgeKey: string;
  tier: BadgeTier;
  icon: string;
  label: string;
  description: string;
  threshold: number;
};

// Category 1: Lesson Milestones
export const LESSON_BADGES: TieredBadgeDef[] = [
  { badgeType: "lessons", badgeKey: "lessons_10",  tier: "bronze", icon: "📖", label: "10 Lessons",  description: "Complete 10 lessons",  threshold: 10 },
  { badgeType: "lessons", badgeKey: "lessons_50",  tier: "silver", icon: "📖", label: "50 Lessons",  description: "Complete 50 lessons",  threshold: 50 },
  { badgeType: "lessons", badgeKey: "lessons_100", tier: "gold",   icon: "📖", label: "100 Lessons", description: "Complete 100 lessons", threshold: 100 },
];

// Category 2: Streak Champion
export const STREAK_BADGES: TieredBadgeDef[] = [
  { badgeType: "streak", badgeKey: "streak_3",  tier: "bronze", icon: "🔥", label: "3-Day Streak",  description: "Log 3 days in a row",  threshold: 3 },
  { badgeType: "streak", badgeKey: "streak_7",  tier: "silver", icon: "🔥", label: "7-Day Streak",  description: "Log 7 days in a row",  threshold: 7 },
  { badgeType: "streak", badgeKey: "streak_30", tier: "gold",   icon: "🔥", label: "30-Day Streak", description: "Log 30 days in a row", threshold: 30 },
];

// Category 3: Consistency
export const CONSISTENCY_BADGES: TieredBadgeDef[] = [
  { badgeType: "consistency", badgeKey: "month_5",    tier: "bronze", icon: "📅", label: "5 Days",        description: "Log 5 days in a month",        threshold: 5 },
  { badgeType: "consistency", badgeKey: "month_15",   tier: "silver", icon: "📅", label: "15 Days",       description: "Log 15 days in a month",       threshold: 15 },
  { badgeType: "consistency", badgeKey: "month_full", tier: "gold",   icon: "📅", label: "Full Month",    description: "Log every school day in a month", threshold: 0 },
];

// Category 4: Subject Star (per curriculum)
export const SUBJECT_BADGES: TieredBadgeDef[] = [
  { badgeType: "subject", badgeKey: "subject_25",  tier: "bronze", icon: "⭐", label: "25% Done",   description: "Complete 25% of a curriculum",  threshold: 0.25 },
  { badgeType: "subject", badgeKey: "subject_50",  tier: "silver", icon: "⭐", label: "50% Done",   description: "Complete 50% of a curriculum",  threshold: 0.50 },
  { badgeType: "subject", badgeKey: "subject_100", tier: "gold",   icon: "⭐", label: "100% Done",  description: "Complete an entire curriculum", threshold: 1.0 },
];

export const ALL_BADGE_CATEGORIES = [
  { name: "Lesson Milestones", badges: LESSON_BADGES },
  { name: "Streak Champion", badges: STREAK_BADGES },
  { name: "Consistency", badges: CONSISTENCY_BADGES },
  { name: "Subject Star", badges: SUBJECT_BADGES },
];

// ─── Badge checking logic ─────────────────────────────────────────────────────

/**
 * Check and award tiered badges for a specific child.
 * Returns newly awarded badge keys.
 */
export async function checkTieredBadges(
  userId: string,
  childId: string,
): Promise<string[]> {
  // Fetch existing earned badges for this child
  const { data: existingRows } = await supabase
    .from("badges")
    .select("badge_key")
    .eq("user_id", userId)
    .eq("child_id", childId);

  const earned = new Set((existingRows ?? []).map((b: { badge_key: string }) => b.badge_key));
  const newBadges: string[] = [];

  // 1. Lesson milestones: count completed lessons for this child
  const { count: lessonCount } = await supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("child_id", childId)
    .eq("completed", true);

  const totalLessons = lessonCount ?? 0;

  for (const badge of LESSON_BADGES) {
    if (!earned.has(badge.badgeKey) && totalLessons >= badge.threshold) {
      await awardBadge(userId, childId, badge);
      newBadges.push(badge.badgeKey);
    }
  }

  // 2. Streak champion: use profile streak data
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_streak_days, longest_streak_days")
    .eq("id", userId)
    .single();

  const longestStreak = Math.max(
    profile?.current_streak_days ?? 0,
    profile?.longest_streak_days ?? 0,
  );

  for (const badge of STREAK_BADGES) {
    if (!earned.has(badge.badgeKey) && longestStreak >= badge.threshold) {
      await awardBadge(userId, childId, badge);
      newBadges.push(badge.badgeKey);
    }
  }

  // 3. Consistency: count distinct active days this month for this child
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

  const { data: monthLessons } = await supabase
    .from("lessons")
    .select("date")
    .eq("user_id", userId)
    .eq("child_id", childId)
    .eq("completed", true)
    .gte("date", monthStart)
    .lt("date", monthEnd);

  const uniqueDays = new Set((monthLessons ?? []).map((l: { date: string }) => l.date));
  const daysThisMonth = uniqueDays.size;

  // Bronze: 5 days
  if (!earned.has("month_5") && daysThisMonth >= 5) {
    await awardBadge(userId, childId, CONSISTENCY_BADGES[0]);
    newBadges.push("month_5");
  }
  // Silver: 15 days
  if (!earned.has("month_15") && daysThisMonth >= 15) {
    await awardBadge(userId, childId, CONSISTENCY_BADGES[1]);
    newBadges.push("month_15");
  }
  // Gold: every school day (approx 20-22)
  const { data: profileDays } = await supabase
    .from("profiles")
    .select("school_days")
    .eq("id", userId)
    .single();
  const schoolDays: string[] = profileDays?.school_days ?? ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const dayMap: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
  let schoolDaysInMonth = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor.getMonth() === now.getMonth() && cursor <= now) {
    if (schoolDays.includes(dayMap[cursor.getDay()])) schoolDaysInMonth++;
    cursor.setDate(cursor.getDate() + 1);
  }
  if (!earned.has("month_full") && schoolDaysInMonth > 0 && daysThisMonth >= schoolDaysInMonth) {
    await awardBadge(userId, childId, CONSISTENCY_BADGES[2]);
    newBadges.push("month_full");
  }

  // 4. Subject star: check curriculum completion percentages
  const { data: goals } = await supabase
    .from("curriculum_goals")
    .select("id, total_lessons, current_lesson")
    .eq("user_id", userId)
    .eq("child_id", childId);

  for (const goal of goals ?? []) {
    const total = goal.total_lessons ?? 0;
    const current = goal.current_lesson ?? 0;
    if (total <= 0) continue;
    const pct = current / total;

    for (const badge of SUBJECT_BADGES) {
      const key = `${badge.badgeKey}_${goal.id}`;
      if (!earned.has(key) && pct >= badge.threshold) {
        await supabase.from("badges").insert({
          user_id: userId,
          child_id: childId,
          badge_type: badge.badgeType,
          badge_key: key,
          tier: badge.tier,
        });
        newBadges.push(key);
      }
    }
  }

  return newBadges;
}

async function awardBadge(userId: string, childId: string, badge: TieredBadgeDef) {
  // The unique index on badges table prevents duplicates — ignore constraint errors
  const { error } = await supabase.from("badges").insert({
    user_id: userId,
    child_id: childId,
    badge_type: badge.badgeType,
    badge_key: badge.badgeKey,
    tier: badge.tier,
  });
  if (error && !error.message.includes("duplicate") && !error.code?.includes("23505")) {
    console.error("[badges-tiered] award failed:", error);
  }
}

/**
 * Fetch all earned tiered badges for a child.
 */
export async function getEarnedBadges(
  userId: string,
  childId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("badges")
    .select("badge_key")
    .eq("user_id", userId)
    .eq("child_id", childId);

  return new Set((data ?? []).map((b: { badge_key: string }) => b.badge_key));
}
