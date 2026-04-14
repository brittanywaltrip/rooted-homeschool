import { supabase } from "@/lib/supabase";
import { checkCreativeBadges, type BadgeCheckData, type BadgeCategory, type BadgeTierDef } from "./badges-tiered";

// ─── Helpers ────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function countWeekdaysInMonth(year: number, month: number): number {
  let count = 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// ─── Data Gathering ─────────────────────────────────────────────────────────

async function gatherBadgeData(
  userId: string,
  childId: string | undefined,
): Promise<BadgeCheckData> {
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const startOfWeek = toDateStr(getMonday(now));

  // Run all queries in parallel
  const [
    { data: completedLessons },
    { data: memories },
    { data: activityLogs },
    { data: activityDefs },
    { data: profile },
    { count: totalMemories },
    { count: totalBooks },
    { data: weekLessons },
    { data: monthLessons },
    { data: monthMemories },
    { data: monthActivityLogs },
    { data: curricula },
  ] = await Promise.all([
    // Total leaves: completed lessons for this child
    childId
      ? supabase.from("lessons").select("id").eq("user_id", userId).eq("child_id", childId).eq("completed", true)
      : supabase.from("lessons").select("id").eq("user_id", userId).eq("completed", true),
    // Total leaves: memories for this child
    childId
      ? supabase.from("memories").select("id").eq("user_id", userId).eq("child_id", childId)
      : supabase.from("memories").select("id").eq("user_id", userId),
    // Total leaves: activity logs (completed)
    supabase.from("activity_logs").select("activity_id").eq("user_id", userId).eq("completed", true),
    // Activity definitions (to map child_ids)
    supabase.from("activities").select("id, child_ids").eq("user_id", userId),
    // Profile streak data
    supabase.from("profiles").select("current_streak_days, longest_streak_days").eq("id", userId).single(),
    // Total memories count (all children)
    supabase.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId),
    // Total books count
    supabase.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "book"),
    // Subjects this week: lessons with distinct subjects
    childId
      ? supabase.from("lessons").select("subject_id").eq("user_id", userId).eq("child_id", childId).eq("completed", true).gte("date", startOfWeek).not("subject_id", "is", null)
      : supabase.from("lessons").select("subject_id").eq("user_id", userId).eq("completed", true).gte("date", startOfWeek).not("subject_id", "is", null),
    // Days logged this month: lessons
    supabase.from("lessons").select("date").eq("user_id", userId).eq("completed", true).gte("date", startOfMonth),
    // Days logged this month: memories
    supabase.from("memories").select("date").eq("user_id", userId).gte("date", startOfMonth),
    // Days logged this month: activity logs
    supabase.from("activity_logs").select("date").eq("user_id", userId).eq("completed", true).gte("date", startOfMonth),
    // Curriculum goals for completion %
    childId
      ? supabase.from("curriculum_goals").select("id, total_lessons, current_lesson").eq("user_id", userId).eq("child_id", childId)
      : supabase.from("curriculum_goals").select("id, total_lessons, current_lesson").eq("user_id", userId),
  ]);

  // Calculate total leaves for child
  let leafCount = (completedLessons?.length ?? 0) + (memories?.length ?? 0);
  if (childId && activityLogs && activityDefs) {
    const actMap = new Map<string, string[]>();
    for (const a of activityDefs as { id: string; child_ids: string[] }[]) {
      actMap.set(a.id, a.child_ids ?? []);
    }
    for (const log of activityLogs as { activity_id: string }[]) {
      const childIds = actMap.get(log.activity_id) ?? [];
      if (childIds.includes(childId)) leafCount++;
    }
  } else if (!childId) {
    leafCount += activityLogs?.length ?? 0;
  }

  // Unique subjects this week
  const subjectSet = new Set<string>();
  for (const l of (weekLessons ?? []) as { subject_id: string }[]) {
    if (l.subject_id) subjectSet.add(l.subject_id);
  }

  // Days logged this month (unique dates across lessons + memories + activities)
  const daySet = new Set<string>();
  for (const l of (monthLessons ?? []) as { date: string }[]) {
    if (l.date) daySet.add(l.date.slice(0, 10));
  }
  for (const m of (monthMemories ?? []) as { date: string }[]) {
    if (m.date) daySet.add(m.date.slice(0, 10));
  }
  for (const a of (monthActivityLogs ?? []) as { date: string }[]) {
    if (a.date) daySet.add(a.date.slice(0, 10));
  }

  // Curriculum completion percentages
  const curriculaData = ((curricula ?? []) as { id: string; total_lessons: number | null; current_lesson: number | null }[])
    .filter(c => c.total_lessons && c.total_lessons > 0)
    .map(c => ({
      goalId: c.id,
      completionPct: Math.round(((c.current_lesson ?? 0) / c.total_lessons!) * 100),
    }));

  return {
    totalLeaves: leafCount,
    currentStreak: (profile as { current_streak_days?: number } | null)?.current_streak_days ?? 0,
    longestStreak: (profile as { longest_streak_days?: number } | null)?.longest_streak_days ?? 0,
    daysLoggedThisMonth: daySet.size,
    schoolDaysThisMonth: countWeekdaysInMonth(now.getFullYear(), now.getMonth()),
    totalMemories: totalMemories ?? 0,
    totalBooks: totalBooks ?? 0,
    subjectsThisWeek: subjectSet.size,
    curricula: curriculaData,
  };
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Gather badge data and check for newly earned creative badges.
 * Returns array of newly earned badges (empty if none).
 */
export async function checkAndAwardCreativeBadges(
  userId: string,
  childId?: string,
): Promise<{ badgeKey: string; category: BadgeCategory; tierDef: BadgeTierDef }[]> {
  const data = await gatherBadgeData(userId, childId);
  return checkCreativeBadges(userId, childId ?? "", data);
}
