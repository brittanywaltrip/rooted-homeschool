/**
 * Progress Report download helper — shared between PlanV2 and the legacy
 * plan page's downloadReport() path. The PDF itself is drawn by
 * generateProgressReport() in lib/pdf.ts; this module owns the data prep
 * (queries + aggregation + scoping) so both surfaces call the exact same
 * formatter and the output stays byte-equivalent.
 *
 * This is a read-only operation — no audit event. The caller is expected
 * to handle loading UI state and surface any errors.
 */

import { supabase } from "@/lib/supabase";
import { generateProgressReport, fmtMins, type ReportData } from "@/lib/pdf";
import { buildRemovalContext, lessonDailyLogRow, subjectTableTotals } from "@/lib/progress-report-rows";
import { selectAllRowsResult } from "@/lib/supabase-all-rows";
import { lessonMinutes as sharedLessonMinutes } from "@/lib/lesson-minutes";
import { augustYearOf, getCurrentSchoolYear, schoolYearQuarters, todayLocalYmd, type SchoolYearWindow } from "@/app/lib/school-year";

export type ReportRangePreset = "q1" | "q2" | "q3" | "q4" | "custom" | "full";

export interface DownloadProgressReportOpts {
  userId: string;
  familyName: string;
  children: { id: string; name: string; color: string | null }[];
  /** A specific child id or null to scope to "all children". */
  childId: string | null;
  range: ReportRangePreset;
  /** Required when range === "custom". Local "YYYY-MM-DD". */
  customStart?: string;
  customEnd?: string;
  /** Include activity_logs in the report. Defaults to true to match
   *  legacy's default. */
  includeActivities?: boolean;
}

type LessonRow = {
  child_id: string;
  title: string;
  completed: boolean;
  minutes_spent: number | null;
  hours?: number | null;
  scheduled_date: string | null;
  date: string | null;
  curriculum_goal_id: string | null;
  subjects: { name: string } | null;
  // The subject of a curriculum lesson lives HERE, not on subjects: curriculum
  // lessons carry subject_id NULL. See lessonReportSubject.
  curriculum_goals: { subject_label: string | null; curriculum_name: string | null } | null;
  is_backfill?: boolean;
};
type MemoryRow = {
  child_id: string | null;
  type: string;
  title: string | null;
  date: string;
  duration_minutes: number | null;
};
type GoalRow = { id: string; curriculum_name?: string | null };
type ActivityLogRow = {
  activity_id: string;
  date: string;
  minutes_spent: number | null;
  completed: boolean;
  is_backfill?: boolean;
};
type ActivityRow = {
  id: string;
  name: string;
  emoji: string;
  child_ids: string[] | null;
};

function computeRange(opts: DownloadProgressReportOpts, schoolYear: SchoolYearWindow): {
  start: string;
  end: string;
  label: string;
} {
  // The quarters are four equal slices of the family's own school year, the
  // same window Full year uses (schoolYearQuarters in app/lib/school-year.ts).
  // They were fixed Sep-Nov, Dec-Feb, Mar-May, Jun-Aug of an August-to-July
  // year, and Q2 stopped on Feb 28, so a leap day was in no quarter.
  const { range, customStart, customEnd } = opts;
  const quarterIndex = range === "q1" ? 0 : range === "q2" ? 1 : range === "q3" ? 2 : range === "q4" ? 3 : -1;
  if (quarterIndex >= 0) {
    const q = schoolYearQuarters(schoolYear)[quarterIndex];
    if (q) {
      const long = (d: string) =>
        new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return { start: q.start, end: q.end, label: `Q${quarterIndex + 1} Report: ${long(q.start)} to ${long(q.end)}` };
    }
  }
  if (range === "custom" && customStart && customEnd) {
    const fmt = (d: string) =>
      new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return { start: customStart, end: customEnd, label: `${fmt(customStart)} – ${fmt(customEnd)}` };
  }
  // Full year: the family's current school year (app/lib/school-year.ts),
  // labelled with the name they gave it.
  return {
    start: schoolYear.start,
    end: schoolYear.end,
    label: schoolYear.name,
  };
}

/** Minutes + "is this estimated from the goal's default?" flag. */
// The one rule every total uses (lib/lesson-minutes.ts). This report used to
// price a lesson with no minutes at its curriculum's default_minutes, where
// Reports priced it at 30, so the PDF and the page disagreed.
function lessonMinutes(l: LessonRow): { m: number; e: boolean } {
  const r = sharedLessonMinutes(l);
  return { m: r.minutes, e: r.estimated };
}

function lessonDate(l: LessonRow): string {
  return l.scheduled_date || l.date || "";
}

export async function downloadProgressReport(opts: DownloadProgressReportOpts): Promise<void> {
  const { userId, familyName, children, childId, includeActivities = true } = opts;
  const { jsPDF } = await import("jspdf");

  const now = new Date();
  const schoolYear = await getCurrentSchoolYear(supabase, userId);
  const fallbackYr = schoolYear.name;
  // The file name wants digits, and a family's year can be "Kindergarten Year".
  const fileYear = augustYearOf(todayLocalYmd());
  const dateGenerated = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const [{ data: lr }, { data: mr }, { data: gr }, { data: al }, { data: acts }, { data: delEvents }] = await Promise.all([
    // Paged. The report's own range filter runs below, in JS, so this read
    // has to bring back the family's whole history or the range can land
    // entirely past PostgREST's 1,000-row cap and print an empty report.
    // See lib/supabase-all-rows.ts.
    selectAllRowsResult<LessonRow>((from, to) =>
      supabase.from("lessons").select("child_id, title, completed, minutes_spent, hours, scheduled_date, date, curriculum_goal_id, subjects(name), curriculum_goals(subject_label, curriculum_name), is_backfill").eq("user_id", userId)
        .order("id").range(from, to)),
    supabase.from("memories").select("child_id, type, title, date, duration_minutes").eq("user_id", userId),
    supabase.from("curriculum_goals").select("id, curriculum_name").eq("user_id", userId),
    supabase.from("activity_logs").select("activity_id, date, minutes_spent, completed, is_backfill").eq("user_id", userId).eq("completed", true),
    supabase.from("activities").select("id, name, emoji, child_ids").eq("user_id", userId),
    // The family's own deletion records: with the curriculum names above
    // (archived included), what establishes a removed curriculum.
    supabase.from("app_events").select("payload").eq("user_id", userId).eq("type", "curriculum_goal.deleted"),
  ]);

  let allLessons = (lr ?? []) as unknown as LessonRow[];
  let allMemories = (mr ?? []) as unknown as MemoryRow[];
  let allActivityLogs = (al ?? []) as unknown as ActivityLogRow[];
  const activityMap: Record<string, ActivityRow> = {};
  for (const a of ((acts ?? []) as unknown as ActivityRow[])) activityMap[a.id] = a;
  const removal = buildRemovalContext(
    ((delEvents ?? []) as { payload: { curriculum_name?: string | null } | null }[]).map((e) => e.payload?.curriculum_name ?? null),
    ((gr ?? []) as unknown as GoalRow[]).map((g) => g.curriculum_name ?? null),
  );

  const { start: rangeStart, end: rangeEnd, label: dateRangeLabel } = computeRange(opts, schoolYear);
  if (rangeStart && rangeEnd) {
    allLessons = allLessons.filter((l) => {
      const d = lessonDate(l);
      return d >= rangeStart && d <= rangeEnd;
    });
    allMemories = allMemories.filter((m) => m.date >= rangeStart && m.date <= rangeEnd);
    allActivityLogs = allActivityLogs.filter((a) => a.date >= rangeStart && a.date <= rangeEnd);
  }

  const activityLogs = includeActivities ? allActivityLogs : [];
  const lessons = allLessons;
  const memories = allMemories;
  const done = lessons.filter((l) => l.completed);

  // Per-child subject + activity + memory aggregation. The legacy path
  // supports "all children" OR a single child; PlanV2 spec says the
  // dropdown offers both, so mirror that behavior here.
  const reportChildren = childId
    ? children.filter((c) => c.id === childId)
    : children;
  const isPerChild = reportChildren.length === 1;

  const scopedDone = isPerChild ? done.filter((l) => l.child_id === reportChildren[0].id) : done;
  const scopedMemories = isPerChild
    ? memories.filter((m) => m.child_id === reportChildren[0].id || m.child_id === null)
    : memories;
  const scopedActivityLogs = isPerChild
    ? activityLogs.filter((a) => {
        const act = activityMap[a.activity_id];
        return act?.child_ids?.includes(reportChildren[0].id);
      })
    : activityLogs;

  const scopedLessonMins = scopedDone.reduce((s, l) => s + lessonMinutes(l).m, 0);
  const scopedActivityMins = scopedActivityLogs.reduce((s, a) => s + (a.minutes_spent || 0), 0);
  const scopedMemoryMins = scopedMemories
    .filter((m) => m.duration_minutes)
    .reduce((s, m) => s + (m.duration_minutes || 0), 0);
  const scopedBooks = scopedMemories.filter((m) => m.type === "book");
  const scopedTrips = scopedMemories.filter((m) => ["field_trip", "project", "activity"].includes(m.type));
  const scopedLessonDays = new Set(scopedDone.map(lessonDate).filter(Boolean));
  const scopedActivityDays = new Set(scopedActivityLogs.map((a) => a.date));
  const scopedSchoolDays = new Set([...scopedLessonDays, ...scopedActivityDays]).size;

  // Backfill hours (for the "N hours imported" callout).
  const backfillMins =
    done.filter((l) => l.is_backfill).reduce((s, l) => s + lessonMinutes(l).m, 0) +
    activityLogs.filter((a) => a.is_backfill).reduce((s, a) => s + (a.minutes_spent || 0), 0);

  const childrenReport: ReportData["children"] = reportChildren.map((c) => {
    const childLessons = done.filter((l) => l.child_id === c.id);
    const childLessonMins = childLessons.reduce((s, l) => s + lessonMinutes(l).m, 0);
    const childActs = activityLogs.filter((a) => activityMap[a.activity_id]?.child_ids?.includes(c.id));
    const childActMins = childActs.reduce((s, a) => s + (a.minutes_spent || 0), 0);
    const childLessonDays = new Set(childLessons.map(lessonDate).filter(Boolean));
    const childActDays = new Set(childActs.map((a) => a.date));
    const childSchoolDays = new Set([...childLessonDays, ...childActDays]).size;

    // Same subject rule as the day-by-day log below (lessonReportSubject), so
    // a curriculum lesson prints under its subject in both, not "General".
    const subjectTotals = subjectTableTotals(childLessons, (l) => lessonMinutes(l), removal);
    const activityAgg: Record<string, { name: string; emoji: string; sessions: number; mins: number }> = {};
    for (const a of childActs) {
      const act = activityMap[a.activity_id];
      if (!act) continue;
      if (!activityAgg[a.activity_id]) {
        activityAgg[a.activity_id] = { name: act.name, emoji: act.emoji, sessions: 0, mins: 0 };
      }
      activityAgg[a.activity_id].sessions++;
      activityAgg[a.activity_id].mins += a.minutes_spent || 0;
    }

    return {
      name: c.name,
      totalHours: fmtMins(childLessonMins + childActMins),
      totalLessons: childLessons.length,
      schoolDays: childSchoolDays,
      subjects: subjectTotals
        .map((d) => ({ name: d.name, count: d.count, hours: fmtMins(d.minutes), estimated: d.estimated }))
        .sort((a, b) => b.count - a.count),
      activities: Object.values(activityAgg)
        .map((g) => ({ name: g.name, emoji: g.emoji, sessions: g.sessions, hours: fmtMins(g.mins) }))
        .sort((a, b) => b.sessions - a.sessions),
      books: memories
        .filter((m) => m.type === "book" && (m.child_id === c.id || m.child_id === null))
        .map((m) => m.title || "Untitled"),
      fieldTrips: memories
        .filter((m) => ["field_trip", "project", "activity"].includes(m.type) && (m.child_id === c.id || m.child_id === null))
        .map((m) => ({ title: m.title || "Untitled", duration: m.duration_minutes })),
      wins: memories
        .filter((m) => ["win", "quote"].includes(m.type) && (m.child_id === c.id || m.child_id === null))
        .map((m) => m.title || "Untitled"),
      badges: [],
    };
  });

  const childNameMap: Record<string, string> = {};
  for (const c of children) childNameMap[c.id] = c.name;

  const dailyLogMap: Record<string, { childName: string; subject: string; description: string; minutes: number; type: string; estimated: boolean }[]> = {};
  for (const l of scopedDone) {
    const d = lessonDate(l);
    if (!d) continue;
    if (!dailyLogMap[d]) dailyLogMap[d] = [];
    const r = lessonMinutes(l);
    dailyLogMap[d].push(
      lessonDailyLogRow({
        lesson: l,
        childName: childNameMap[l.child_id] || "",
        minutes: r.m,
        estimated: r.e,
        removal,
      }),
    );
  }
  for (const m of scopedMemories) {
    if (!m.duration_minutes || !["field_trip", "project", "activity", "win"].includes(m.type)) continue;
    if (!dailyLogMap[m.date]) dailyLogMap[m.date] = [];
    dailyLogMap[m.date].push({
      childName: m.child_id ? (childNameMap[m.child_id] || "") : "",
      subject: m.type === "win" ? "Win" : "Field Trip",
      description: m.title || "Activity",
      minutes: m.duration_minutes,
      type: "Activity",
      estimated: false,
    });
  }
  for (const a of scopedActivityLogs) {
    const act = activityMap[a.activity_id];
    if (!act || !a.minutes_spent) continue;
    if (!dailyLogMap[a.date]) dailyLogMap[a.date] = [];
    const childNames = (act.child_ids || []).map((id) => childNameMap[id] || "").filter(Boolean).join(", ");
    dailyLogMap[a.date].push({
      childName: childNames,
      subject: act.name,
      description: `${act.emoji} ${act.name}${a.is_backfill ? " (imported)" : ""}`,
      minutes: a.minutes_spent,
      type: "Activity",
      estimated: false,
    });
  }
  const dailyLog: ReportData["dailyLog"] = Object.entries(dailyLogMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({
      dateLabel: new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      entries,
    }));

  const selectedChild = isPerChild ? reportChildren[0] : null;
  const reportTitle = selectedChild ? `${selectedChild.name} - ${familyName}` : familyName;

  const doc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
  generateProgressReport(doc, {
    familyName: reportTitle,
    schoolYear: dateRangeLabel || fallbackYr,
    dateGenerated,
    showWatermark: true,
    summary: {
      totalHours: fmtMins(scopedLessonMins + scopedActivityMins + scopedMemoryMins),
      curriculumHours: fmtMins(scopedLessonMins),
      activityHours: scopedActivityMins > 0 ? fmtMins(scopedActivityMins) : undefined,
      schoolDays: scopedSchoolDays,
      lessons: scopedDone.length,
      books: scopedBooks.length,
      trips: scopedTrips.length,
      memories: scopedMemories.length,
    },
    children: childrenReport,
    dailyLog,
    showChildColumn: !isPerChild,
    backfillHours: backfillMins,
  });

  const slugify = (s: string) =>
    s.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const fileSlug = selectedChild
    ? `${slugify(selectedChild.name)}-${slugify(familyName)}`
    : slugify(familyName);
  doc.save(`${fileSlug}-progress-report-${fileYear}-${fileYear + 1}.pdf`);
}
