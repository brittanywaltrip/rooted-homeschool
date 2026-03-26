import { supabase } from "@/lib/supabase";

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

export type BadgeDef = {
  id: string;
  emoji: string;
  label: string;
  message: string;
};

export const ACTIVITY_BADGES: BadgeDef[] = [
  { id: "story_begun",       emoji: "📖", label: "Story Begun",       message: "You saved your first memory. This is where your story starts." },
  { id: "first_win",         emoji: "🏆", label: "First Win",         message: "Your first win is captured. Celebrate the small stuff." },
  { id: "bookworm_begins",   emoji: "📚", label: "Bookworm Begins",   message: "The first book is logged. A reader is growing." },
  { id: "shutter",           emoji: "📷", label: "Shutter",           message: "First photo saved. These moments matter." },
  { id: "showing_up",        emoji: "🔥", label: "Showing Up",        message: "5 active days this month. Consistency is everything." },
];

/**
 * Check and award activity-based badges for a user.
 * Returns the first newly-earned badge (if any) for notification purposes.
 */
export async function checkAndAwardBadges(userId: string): Promise<BadgeDef | null> {
  // Fetch existing badges for this user
  const { data: existing } = await supabase
    .from("user_badges")
    .select("badge_id")
    .eq("user_id", userId);

  const earned = new Set((existing ?? []).map((b: { badge_id: string }) => b.badge_id));

  // Fetch counts needed for badge checks
  const [{ count: memoryCount }, { count: photoCount }, { count: bookCount }, { count: winCount }] = await Promise.all([
    supabase.from("app_events").select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("type", ["memory_photo", "memory_project", "memory_book", "memory_field_trip", "memory_activity"]),
    supabase.from("app_events").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("type", "memory_photo"),
    supabase.from("app_events").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("type", "memory_book"),
    supabase.from("app_events").select("id", { count: "exact", head: true })
      .eq("user_id", userId).in("type", ["memory_activity", "memory_project"]),
  ]);

  // Check "showing_up" — 5+ distinct active days this month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { data: monthEvents } = await supabase
    .from("app_events")
    .select("created_at")
    .eq("user_id", userId)
    .gte("created_at", monthStart.toISOString());

  const activeDays = new Set(
    (monthEvents ?? []).map((e: { created_at: string }) => e.created_at.slice(0, 10))
  );

  // Also count lesson completions this month
  const { data: monthLessons } = await supabase
    .from("lessons")
    .select("date, scheduled_date")
    .eq("user_id", userId)
    .eq("completed", true)
    .gte("scheduled_date", monthStart.toISOString().slice(0, 10));

  (monthLessons ?? []).forEach((l: { date: string | null; scheduled_date: string | null }) => {
    const d = l.date ?? l.scheduled_date;
    if (d) activeDays.add(d.slice(0, 10));
  });

  const checks: { id: string; met: boolean }[] = [
    { id: "story_begun",     met: (memoryCount ?? 0) >= 1 },
    { id: "first_win",       met: (winCount ?? 0) >= 1 },
    { id: "bookworm_begins", met: (bookCount ?? 0) >= 1 },
    { id: "shutter",         met: (photoCount ?? 0) >= 1 },
    { id: "showing_up",      met: activeDays.size >= 5 },
  ];

  let firstNew: BadgeDef | null = null;

  for (const { id, met } of checks) {
    if (met && !earned.has(id)) {
      // Award the badge — use upsert to handle race conditions
      await supabase.from("user_badges").upsert(
        { user_id: userId, badge_id: id },
        { onConflict: "user_id,badge_id" }
      );
      if (!firstNew) {
        firstNew = ACTIVITY_BADGES.find((b) => b.id === id) ?? null;
      }
    }
  }

  return firstNew;
}
