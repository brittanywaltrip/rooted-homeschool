import { supabase } from "@/lib/supabase";
import { previousSchoolDay, toDateStr } from "./streaks";

const DEFAULT_SCHOOL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * Live count of photo memories for a user across both storage paths:
 * - `memories.photo_url` (camera FAB, book/drawing inserts)
 * - `app_events.payload->>'photo_url'` (LogTodayModal uploads)
 *
 * Returns 0 on failure — callers should treat this as a soft check.
 */
export async function getPhotoCount(userId: string): Promise<number> {
  const [{ count: memCount }, { count: evtCount }] = await Promise.all([
    supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("photo_url", "is", null)
      .neq("photo_url", ""),
    supabase
      .from("app_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("payload->>photo_url", "is", null)
      .neq("payload->>photo_url", ""),
  ]);
  return (memCount ?? 0) + (evtCount ?? 0);
}

type StreakProfile = {
  current_streak_days?: number | null;
  last_logged_date?: string | null;
  school_days?: string[] | null;
};

/**
 * Display-side validator for `current_streak_days`.
 *
 * The stored value only changes when the user logs something. If they stop
 * logging, it drifts. This returns 0 when the last log is older than the
 * previous school day — weekend-safe (Mon–Fri users aren't zeroed over
 * weekends because previousSchoolDay skips non-school days).
 *
 * Storage is still the source of truth at WRITE time; this is READ-only.
 */
export function validateStreak(
  profile: StreakProfile | null | undefined,
  today: Date = new Date(),
): number {
  if (!profile) return 0;
  const stored = profile.current_streak_days ?? 0;
  if (stored === 0) return 0;
  const lastLogged = profile.last_logged_date;
  if (!lastLogged) return 0;

  const schoolDays = profile.school_days?.length ? profile.school_days : DEFAULT_SCHOOL_DAYS;
  const anchor = new Date(today);
  anchor.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(anchor);
  if (lastLogged === todayStr) return stored;

  const prevSchoolDayStr = toDateStr(previousSchoolDay(anchor, schoolDays));
  return lastLogged >= prevSchoolDayStr ? stored : 0;
}
