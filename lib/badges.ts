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
  { id: "shutter",           emoji: "📷", label: "Shutter",           message: "First photo or drawing saved. These moments matter." },
  { id: "showing_up",        emoji: "🔥", label: "Showing Up",        message: "5 active days this month. Consistency is everything." },
  { id: "gallery_wall",      emoji: "🖼️", label: "Gallery Wall",      message: "3 drawings saved. You're building a gallery." },
  { id: "author",            emoji: "✍️", label: "Author",            message: "10 memories in the yearbook. You're writing a real book." },
  { id: "full_circle",       emoji: "🔄", label: "Full Circle",       message: "A memory from one year ago. Look how far you've come." },
  { id: "founding_family",   emoji: "⭐", label: "Founding Family",   message: "You believed in Rooted from the start. Thank you." },
];

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
  // Fetch existing badges for this user
  const { data: existing } = await supabase
    .from("user_badges")
    .select("badge_id")
    .eq("user_id", userId);

  const earned = new Set((existing ?? []).map((b: { badge_id: string }) => b.badge_id));

  // Fetch counts from both memories table and app_events (legacy)
  const [
    { count: memCount },
    { count: memPhotoCount },
    { count: memDrawingCount },
    { count: memBookCount },
    { count: memWinCount },
    { count: legacyCount },
    { count: legacyPhotoCount },
    { count: legacyBookCount },
    { count: legacyWinCount },
    { count: inBookCount },
  ] = await Promise.all([
    // memories table counts
    supabase.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "photo"),
    supabase.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "drawing"),
    supabase.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "book"),
    supabase.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).in("type", ["win", "moment"]),
    // app_events legacy counts
    supabase.from("app_events").select("id", { count: "exact", head: true }).eq("user_id", userId)
      .in("type", ["memory_photo", "memory_project", "memory_book", "memory_field_trip", "memory_activity"]),
    supabase.from("app_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "memory_photo"),
    supabase.from("app_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "memory_book"),
    supabase.from("app_events").select("id", { count: "exact", head: true }).eq("user_id", userId)
      .in("type", ["memory_activity", "memory_project"]),
    // yearbook curator count
    supabase.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("include_in_book", true),
  ]);

  const totalMemories = (memCount ?? 0) + (legacyCount ?? 0);
  const totalPhotosAndDrawings = (memPhotoCount ?? 0) + (memDrawingCount ?? 0) + (legacyPhotoCount ?? 0);
  const totalDrawings = memDrawingCount ?? 0;
  const totalBooks = (memBookCount ?? 0) + (legacyBookCount ?? 0);
  const totalWins = (memWinCount ?? 0) + (legacyWinCount ?? 0);
  const totalInBook = inBookCount ?? 0;

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

  const { data: monthMemories } = await supabase
    .from("memories")
    .select("created_at")
    .eq("user_id", userId)
    .gte("created_at", monthStart.toISOString());

  (monthMemories ?? []).forEach((m: { created_at: string }) => {
    activeDays.add(m.created_at.slice(0, 10));
  });

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

  // Check "full_circle" — memory from ~1 year ago
  const now = new Date();
  const yearAgoStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() - 3);
  const yearAgoEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 3);
  const yStart = yearAgoStart.toISOString().slice(0, 10);
  const yEnd = yearAgoEnd.toISOString().slice(0, 10);
  const { count: onThisDayCount } = await supabase
    .from("memories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("date", yStart)
    .lte("date", yEnd);

  const checks: { id: string; met: boolean }[] = [
    { id: "story_begun",     met: totalMemories >= 1 },
    { id: "first_win",       met: totalWins >= 1 },
    { id: "bookworm_begins", met: totalBooks >= 1 },
    { id: "shutter",         met: totalPhotosAndDrawings >= 1 },
    { id: "showing_up",      met: activeDays.size >= 5 },
    { id: "gallery_wall",    met: totalDrawings >= 3 },
    { id: "author",          met: totalInBook >= 10 },
    { id: "full_circle",     met: (onThisDayCount ?? 0) >= 1 },
  ];

  let firstNew: BadgeDef | null = null;

  for (const { id, met } of checks) {
    if (met && !earned.has(id)) {
      await supabase.from("user_badges").upsert(
        { user_id: userId, badge_id: id },
        { onConflict: "user_id,badge_id" }
      );
      if (!firstNew) {
        firstNew = ACTIVITY_BADGES.find((b) => b.id === id) ?? null;
      }
    }
  }

  if (firstNew) {
    emitBadgeEarned(firstNew);
  }

  return firstNew;
}

/**
 * Award the founding_family badge if the user has that plan type.
 */
export async function checkFoundingBadge(userId: string): Promise<BadgeDef | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan_type")
    .eq("id", userId)
    .single();

  if ((profile as { plan_type?: string } | null)?.plan_type !== "founding_family") return null;

  const { data: existing } = await supabase
    .from("user_badges")
    .select("badge_id")
    .eq("user_id", userId)
    .eq("badge_id", "founding_family");

  if (existing && existing.length > 0) return null;

  await supabase.from("user_badges").upsert(
    { user_id: userId, badge_id: "founding_family" },
    { onConflict: "user_id,badge_id" }
  );

  const badge = ACTIVITY_BADGES.find((b) => b.id === "founding_family")!;
  emitBadgeEarned(badge);
  return badge;
}
