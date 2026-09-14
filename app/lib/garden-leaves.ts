import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countByChild,
  mergeMemoryRecords,
  LEGACY_MEMORY_EVENT_TYPES,
  type LegacyMemoryEvent,
  type MemoryTableRow,
} from "../../lib/memory-leaves.ts";
import { selectAllRowsResult } from "../../lib/supabase-all-rows.ts";
import type { SchoolYearWindow } from "./school-year.ts";

/**
 * A leaf, counted once, for one school year.
 *
 * A child's tree starts over each school year (decided Sept 11 2026). Before
 * this, three surfaces counted leaves three ways: the Garden counted lessons,
 * memories and activity logs for the life of the account; Today's "tree grew a
 * leaf" toast and the kids' view counted lessons and memories (with the legacy
 * app_events merge) but no activities. A toast could promise 128 leaves above
 * a tree that had 3. Every surface now reads this.
 *
 * A leaf is: a completed lesson, a captured memory (memories table first, the
 * pre-March-2026 app_events merged in behind it, see lib/memory-leaves.ts), or
 * a completed activity, credited to every child on the activity. Each is
 * counted when its date falls inside the school year's window.
 *
 * lessons.date, memories.date and activity_logs.date are all NOT NULL, so the
 * date filter goes in the query and is exact. That keeps the read small and
 * keeps a big family's all-time history away from PostgREST's 1,000-row cap.
 */

export type LeafLessonRow = { child_id: string | null; date: string | null; scheduled_date: string | null };

export type LeafSources = {
  lessons: LeafLessonRow[];
  memories: MemoryTableRow[];
  legacyEvents: LegacyMemoryEvent[];
  activityLogs: { activity_id: string }[];
  activities: { id: string; child_ids: string[] | null }[];
};

/** Leaves per child id. Pure, so the rule is testable without a database. */
export function countLeaves(src: LeafSources): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (cid: string | null | undefined, n = 1) => {
    if (cid) counts[cid] = (counts[cid] ?? 0) + n;
  };
  for (const l of src.lessons) add(l.child_id);
  for (const [cid, n] of Object.entries(countByChild(mergeMemoryRecords(src.memories, src.legacyEvents)))) add(cid, n);
  const childIdsByActivity: Record<string, string[]> = {};
  for (const a of src.activities) childIdsByActivity[a.id] = a.child_ids ?? [];
  for (const log of src.activityLogs) {
    for (const cid of childIdsByActivity[log.activity_id] ?? []) add(cid);
  }
  return counts;
}

/**
 * Every leaf source inside the window. A failed read degrades to an empty list
 * (the tree shows fewer leaves) rather than throwing the page away.
 */
export async function loadLeafSources(
  supabase: SupabaseClient,
  userId: string,
  y: Pick<SchoolYearWindow, "start" | "end">,
): Promise<LeafSources> {
  const [lessons, memories, legacy, logs, activities] = await Promise.all([
    selectAllRowsResult<LeafLessonRow>((from, to) =>
      supabase.from("lessons").select("child_id, date, scheduled_date")
        .eq("user_id", userId).eq("completed", true)
        .gte("date", y.start).lte("date", y.end)
        .order("id").range(from, to)),
    selectAllRowsResult<MemoryTableRow>((from, to) =>
      supabase.from("memories").select("child_id, type, title, date, book_child_ids")
        .eq("user_id", userId)
        .gte("date", y.start).lte("date", y.end)
        .order("id").range(from, to)),
    supabase.from("app_events").select("type, payload")
      .eq("user_id", userId).in("type", [...LEGACY_MEMORY_EVENT_TYPES])
      .gte("payload->>date", y.start).lte("payload->>date", y.end),
    selectAllRowsResult<{ activity_id: string }>((from, to) =>
      supabase.from("activity_logs").select("activity_id")
        .eq("user_id", userId).eq("completed", true)
        .gte("date", y.start).lte("date", y.end)
        .order("id").range(from, to)),
    // All of them, archived included: closing a year deactivates activities,
    // and last year's logs still need to know whose they were.
    supabase.from("activities").select("id, child_ids").eq("user_id", userId),
  ]);
  return {
    lessons: lessons.data ?? [],
    memories: memories.data ?? [],
    legacyEvents: ((legacy.data ?? []) as unknown as LegacyMemoryEvent[]),
    activityLogs: logs.data ?? [],
    activities: ((activities.data ?? []) as { id: string; child_ids: string[] | null }[]),
  };
}

export async function loadLeafCounts(
  supabase: SupabaseClient,
  userId: string,
  y: Pick<SchoolYearWindow, "start" | "end">,
): Promise<Record<string, number>> {
  return countLeaves(await loadLeafSources(supabase, userId, y));
}

/**
 * The user_badges.badge_id that records "this child's stage celebration has
 * been seen, this school year". Keyed by the year so a new year celebrates
 * again, and stored server-side so a second device does not celebrate twice.
 * A family with no school_years row is keyed by its August 1 window.
 */
export function gardenStageSeenPrefix(y: Pick<SchoolYearWindow, "id" | "start">): string {
  return `garden_stage:${y.id ?? `aug-${y.start}`}:`;
}

export function gardenStageSeenId(
  y: Pick<SchoolYearWindow, "id" | "start">,
  childId: string,
  stageMin: number,
): string {
  return `${gardenStageSeenPrefix(y)}${childId}:${stageMin}`;
}
