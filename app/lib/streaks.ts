import type { SupabaseClient } from "@supabase/supabase-js";

// The default browser client chains through @/ path aliases that node --test
// can't resolve, so load it lazily. Tests always pass opts.supabase and
// never take this branch.
async function getDefaultSupabase(): Promise<SupabaseClient> {
  const mod = await import("../../lib/supabase.ts");
  return mod.supabase as SupabaseClient;
}

/**
 * Check if a given date falls on a school day.
 * schoolDays: array of day names like ["Mon", "Tue", "Wed", "Thu", "Fri"]
 */
export function isSchoolDay(date: Date, schoolDays: string[]): boolean {
  const dayMap: Record<number, string> = {
    0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
  };
  return schoolDays.includes(dayMap[date.getDay()]);
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Find the previous school day before the given date.
 */
export function previousSchoolDay(date: Date, schoolDays: string[]): Date {
  const d = new Date(date);
  for (let i = 0; i < 14; i++) {
    d.setDate(d.getDate() - 1);
    if (isSchoolDay(d, schoolDays)) return d;
  }
  // Fallback: just go back 1 day
  const fallback = new Date(date);
  fallback.setDate(fallback.getDate() - 1);
  return fallback;
}

/**
 * Update streak tracking after a lesson is logged.
 *
 * Logic:
 * - If last_logged_date = today → no change
 * - If last_logged_date = previous school day → increment streak
 * - If last_logged_date < previous school day → reset to 1
 * - Update longest_streak_days if current > longest
 * - Update last_logged_date to today
 */
export async function updateStreak(
  userId: string,
  opts: { supabase?: SupabaseClient; now?: Date } = {},
): Promise<{ currentStreak: number; longestStreak: number }> {
  const supabase = opts.supabase ?? (await getDefaultSupabase());
  // Fetch profile streak data and school days
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_streak_days, longest_streak_days, last_logged_date, school_days")
    .eq("id", userId)
    .single();

  if (!profile) return { currentStreak: 0, longestStreak: 0 };

  const schoolDays: string[] = profile.school_days ?? ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const today = new Date(opts.now ?? Date.now());
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);

  const currentStreak = profile.current_streak_days ?? 0;
  const longestStreak = profile.longest_streak_days ?? 0;
  const lastLogged = profile.last_logged_date;

  // Already logged today — no change
  if (lastLogged === todayStr) {
    return { currentStreak, longestStreak };
  }

  let newStreak: number;

  if (!lastLogged) {
    // First ever log
    newStreak = 1;
  } else {
    const prevSchoolDay = previousSchoolDay(today, schoolDays);
    const prevSchoolDayStr = toDateStr(prevSchoolDay);

    if (lastLogged === prevSchoolDayStr) {
      // Consecutive school day — increment
      newStreak = currentStreak + 1;
    } else if (lastLogged > prevSchoolDayStr) {
      // Logged on a non-school day between then and now — keep streak
      newStreak = currentStreak + 1;
    } else {
      // Missed a school day — reset
      newStreak = 1;
    }
  }

  const newLongest = Math.max(longestStreak, newStreak);

  await supabase
    .from("profiles")
    .update({
      current_streak_days: newStreak,
      longest_streak_days: newLongest,
      last_logged_date: todayStr,
    })
    .eq("id", userId);

  return { currentStreak: newStreak, longestStreak: newLongest };
}

/**
 * Belt-and-suspenders recompute for the Today page. Writes
 * `current_streak_days = 0` to the DB when the user's stored streak has
 * gone stale (last_logged_date is older than the previous school day),
 * so the Garden page and badge checker see the corrected value even
 * though the Today page computes its own live streak from lesson rows.
 *
 * `longest_streak_days` is never touched — that's the user's record.
 * Safe to call fire-and-forget; errors are swallowed.
 */
export async function recomputeStaleStreak(
  userId: string,
  opts: { supabase?: SupabaseClient; now?: Date } = {},
): Promise<"reset" | "kept" | "skipped"> {
  const supabase = opts.supabase ?? (await getDefaultSupabase());
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_streak_days, last_logged_date, school_days")
      .eq("id", userId)
      .single();
    if (!profile) return "skipped";

    const stored = profile.current_streak_days ?? 0;
    if (stored === 0) return "kept";
    const lastLogged = profile.last_logged_date;
    if (!lastLogged) return "kept";

    const schoolDays: string[] = profile.school_days?.length
      ? profile.school_days
      : ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const anchor = new Date(opts.now ?? Date.now());
    anchor.setHours(0, 0, 0, 0);
    const todayStr = toDateStr(anchor);
    if (lastLogged === todayStr) return "kept";
    const prevSchoolDayStr = toDateStr(previousSchoolDay(anchor, schoolDays));
    if (lastLogged >= prevSchoolDayStr) return "kept";

    await supabase
      .from("profiles")
      .update({ current_streak_days: 0 })
      .eq("id", userId);
    return "reset";
  } catch (err) {
    console.error("[recomputeStaleStreak] failed:", err);
    return "skipped";
  }
}
