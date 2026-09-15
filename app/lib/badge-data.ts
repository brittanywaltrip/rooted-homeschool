// The numbers the tiered badges are judged on, for one child or the family.
//
// The client is a parameter (no "@/" imports) so node --test can run this over
// in-memory rows, the way lib/badge-checks.ts is tested.
//
// A year filed through Add a past year earns no badges. Every lesson count
// here excludes rows tagged scheduled_source = 'past_year', and Deep Roots only
// looks at curricula still in use (archived = false): a filed year's curricula
// are put away the moment they are written, and a closed year's were judged
// while they were live. Families reported filing a year auto-completing a run
// of badges on 2026-09-14. Nothing already earned is touched; badges rows are
// unique per child and key, so an award is for life either way.

import type { BadgeCheckData } from "./badge-tiers.ts";
import { NOT_FILED_PAST_YEAR } from "./past-year-dates.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BadgeDataClient = { from(table: string): any };

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

export async function gatherBadgeData(
  client: BadgeDataClient,
  userId: string,
  childId: string | undefined,
  now: Date = new Date(),
): Promise<BadgeCheckData> {
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const startOfWeek = toDateStr(getMonday(now));

  // Run all queries in parallel
  const [
    { count: completedLessonCount },
    { count: memoryCount },
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
    // Total leaves: completed lessons for this child. A count, not the rows:
    // this runs after every completion tap on Plan and Today, and it used to
    // pull every completed lesson id for the child (thousands, for the
    // families this matters to) to take .length of the array.
    childId
      ? client.from("lessons").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("child_id", childId).eq("completed", true).or(NOT_FILED_PAST_YEAR)
      : client.from("lessons").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("completed", true).or(NOT_FILED_PAST_YEAR),
    // Total leaves: memories for this child. Same: a count.
    childId
      ? client.from("memories").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("child_id", childId)
      : client.from("memories").select("*", { count: "exact", head: true }).eq("user_id", userId),
    // Total leaves: activity logs (completed)
    client.from("activity_logs").select("activity_id").eq("user_id", userId).eq("completed", true),
    // Activity definitions (to map child_ids)
    client.from("activities").select("id, child_ids").eq("user_id", userId),
    // Profile streak data
    client.from("profiles").select("current_streak_days, longest_streak_days").eq("id", userId).single(),
    // Total memories count (all children)
    client.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId),
    // Total books count
    client.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "book"),
    // Subjects this week: lessons with distinct subjects
    childId
      ? client.from("lessons").select("subject_id").eq("user_id", userId).eq("child_id", childId).eq("completed", true).gte("date", startOfWeek).not("subject_id", "is", null).or(NOT_FILED_PAST_YEAR)
      : client.from("lessons").select("subject_id").eq("user_id", userId).eq("completed", true).gte("date", startOfWeek).not("subject_id", "is", null).or(NOT_FILED_PAST_YEAR),
    // Days logged this month: lessons
    client.from("lessons").select("date").eq("user_id", userId).eq("completed", true).gte("date", startOfMonth).or(NOT_FILED_PAST_YEAR),
    // Days logged this month: memories
    client.from("memories").select("date").eq("user_id", userId).gte("date", startOfMonth),
    // Days logged this month: activity logs
    client.from("activity_logs").select("date").eq("user_id", userId).eq("completed", true).gte("date", startOfMonth),
    // Curriculum goals for completion %
    childId
      ? client.from("curriculum_goals").select("id, total_lessons, current_lesson").eq("user_id", userId).eq("child_id", childId).eq("archived", false)
      : client.from("curriculum_goals").select("id, total_lessons, current_lesson").eq("user_id", userId).eq("archived", false),
  ]);

  // Calculate total leaves for child
  let leafCount = (completedLessonCount ?? 0) + (memoryCount ?? 0);
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

