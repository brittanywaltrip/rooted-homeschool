// Completed recurring-activity sessions, for the reports.
//
// WHY THIS FILE EXISTS
// Rooted records time in four DIFFERENT places, and the two report documents
// disagreed about which of them count:
//
//   1. completed lessons          -- lessons.completed, minutes_spent
//   2. completed activity sessions-- activity_logs.completed, one row per time
//                                    a recurring activity actually happened
//   3. timed memories             -- memories.duration_minutes on a field trip,
//                                    project, activity or win
//   4. appointments               -- a scheduled commitment, with exceptions
//
// The Progress Report (lib/progress-report.ts) reads (1), (2) and (3).
// The Hours & Attendance report read (1), (3) and (4) but NOT (2), so a family
// whose out-of-curriculum time is recorded as recurring activities saw it in
// one document and not the other. Reported 2026-09-20 by a family with 20
// completed activity sessions and ZERO timed memories: her Hours & Attendance
// log showed none of that time at all.
//
// An "activity type" is a DEFINITION (activities). A "session" is one completed
// occurrence of it (activity_logs). Counting definitions as sessions, or the
// reverse, is the mistake this module exists to make impossible: they are
// different numbers and both belong on the report.
//
// No "@/" import and no side effects: node --test strips types, it does not
// resolve path aliases.

/** A recurring activity DEFINITION. `is_active` false means retired, not deleted. */
export interface ActivityDefinition {
  id: string;
  name: string;
  emoji: string | null;
  child_ids: string[] | null;
  is_active?: boolean | null;
}

/** One completed occurrence of an activity. */
export interface ActivityLogRow {
  activity_id: string;
  date: string;
  minutes_spent: number | null;
  completed?: boolean | null;
}

/** A session resolved against its definition, ready to render. */
export interface ActivitySession {
  activityId: string;
  name: string;
  emoji: string | null;
  date: string;
  minutes: number;
  /** False when the definition has been retired. The session still counts. */
  definitionIsActive: boolean;
  /** True when no definition row exists at all. The session still counts. */
  definitionMissing: boolean;
}

export interface ActivitySessionFilter {
  childId?: string | null;
  dateFrom: string;
  dateTo: string;
}

/** The label a session gets when its definition row has gone entirely. */
export const RETIRED_ACTIVITY_LABEL = "Past activity";

/**
 * Does this activity belong to the child being reported on?
 *
 * Same rule the appointments section uses: a definition with no children named
 * is a whole-family activity and counts toward whichever child is selected; one
 * that names children counts only for those. "All children" (null) takes
 * everything. Scoping is by the DEFINITION's child_ids, because an activity_log
 * row carries no child of its own.
 */
export function activityBelongsToChild(
  def: ActivityDefinition | undefined,
  childId: string | null | undefined,
): boolean {
  if (!childId) return true;
  if (!def) return true; // a session whose definition is gone is not hidden
  const ids = def.child_ids ?? [];
  if (ids.length === 0) return true;
  return ids.includes(childId);
}

/**
 * Completed sessions for one child and date range, resolved against their
 * definitions.
 *
 * A retired definition (is_active false) and a missing definition BOTH still
 * produce a session: the hours were really spent, and a report that drops them
 * when a family tidies up its activity list is wrong in the direction that
 * matters. The definition is looked up by id with no is_active filter.
 */
export function selectActivitySessions(
  logs: ReadonlyArray<ActivityLogRow>,
  definitions: ReadonlyArray<ActivityDefinition>,
  filter: ActivitySessionFilter,
): ActivitySession[] {
  const byId = new Map<string, ActivityDefinition>();
  for (const d of definitions) byId.set(d.id, d);

  const out: ActivitySession[] = [];
  for (const log of logs) {
    if (log.completed === false) continue;
    if (!log.date) continue;
    if (log.date < filter.dateFrom || log.date > filter.dateTo) continue;
    const def = byId.get(log.activity_id);
    if (!activityBelongsToChild(def, filter.childId)) continue;
    out.push({
      activityId: log.activity_id,
      name: def?.name ?? RETIRED_ACTIVITY_LABEL,
      emoji: def?.emoji ?? null,
      date: log.date,
      minutes: log.minutes_spent ?? 0,
      definitionIsActive: def ? def.is_active !== false : false,
      definitionMissing: !def,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  return out;
}

export interface ActivitySessionSummary {
  /** DISTINCT activities that produced a session here. Not the session count. */
  activityTypes: number;
  /** Completed occurrences. */
  sessions: number;
  minutes: number;
  hours: number;
  /** Dates on which at least one session happened. For the attendance question. */
  dates: Set<string>;
}

export function summarizeActivitySessions(
  sessions: ReadonlyArray<ActivitySession>,
): ActivitySessionSummary {
  const types = new Set<string>();
  const dates = new Set<string>();
  let minutes = 0;
  for (const s of sessions) {
    types.add(s.activityId);
    dates.add(s.date);
    minutes += s.minutes;
  }
  return { activityTypes: types.size, sessions: sessions.length, minutes, hours: minutes / 60, dates };
}

/** Per-activity rollup for the detail table, newest activity name first. */
export function groupActivitySessions(
  sessions: ReadonlyArray<ActivitySession>,
): Array<{ activityId: string; name: string; emoji: string | null; sessions: number; minutes: number; retired: boolean }> {
  const agg = new Map<string, { activityId: string; name: string; emoji: string | null; sessions: number; minutes: number; retired: boolean }>();
  for (const s of sessions) {
    const cur = agg.get(s.activityId);
    if (cur) {
      cur.sessions += 1;
      cur.minutes += s.minutes;
    } else {
      agg.set(s.activityId, {
        activityId: s.activityId, name: s.name, emoji: s.emoji,
        sessions: 1, minutes: s.minutes,
        retired: !s.definitionIsActive || s.definitionMissing,
      });
    }
  }
  return [...agg.values()].sort((a, b) => a.name.localeCompare(b.name));
}
