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
  scheduled_date: string | null;
  date: string | null;
  curriculum_goal_id: string | null;
  subjects: { name: string } | null;
  is_backfill?: boolean;
};
type MemoryRow = {
  child_id: string | null;
  type: string;
  title: string | null;
  date: string;
  duration_minutes: number | null;
};
type GoalRow = { id: string; default_minutes: number };
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

function computeRange(opts: DownloadProgressReportOpts): {
  start: string;
  end: string;
  label: string;
} {
  const now = new Date();
  const yearStart = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const { range, customStart, customEnd } = opts;
  if (range === "q1") return { start: `${yearStart}-09-01`, end: `${yearStart}-11-30`, label: `Q1 Report: September – November ${yearStart}` };
  if (range === "q2") return { start: `${yearStart}-12-01`, end: `${yearStart + 1}-02-28`, label: `Q2 Report: December ${yearStart} – February ${yearStart + 1}` };
  if (range === "q3") return { start: `${yearStart + 1}-03-01`, end: `${yearStart + 1}-05-31`, label: `Q3 Report: March – May ${yearStart + 1}` };
  if (range === "q4") return { start: `${yearStart + 1}-06-01`, end: `${yearStart + 1}-08-31`, label: `Q4 Report: June – August ${yearStart + 1}` };
  if (range === "custom" && customStart && customEnd) {
    const fmt = (d: string) =>
      new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return { start: customStart, end: customEnd, label: `${fmt(customStart)} – ${fmt(customEnd)}` };
  }
  // Full year — use the entire school-year window as the label so the PDF
  // header reads cleanly.
  return {
    start: `${yearStart}-08-01`,
    end: `${yearStart + 1}-07-31`,
    label: `${yearStart}–${yearStart + 1}`,
  };
}

/** Minutes + "is this estimated from the goal's default?" flag. */
function lessonMinutes(l: LessonRow, goalDefaults: Record<string, number>): { m: number; e: boolean } {
  if (l.minutes_spent != null) return { m: l.minutes_spent, e: false };
  if (l.curriculum_goal_id && goalDefaults[l.curriculum_goal_id]) {
    return { m: goalDefaults[l.curriculum_goal_id], e: true };
  }
  return { m: 30, e: true };
}

function lessonDate(l: LessonRow): string {
  return l.scheduled_date || l.date || "";
}

export async function downloadProgressReport(opts: DownloadProgressReportOpts): Promise<void> {
  const { userId, familyName, children, childId, includeActivities = true } = opts;
  const { jsPDF } = await import("jspdf");

  const now = new Date();
  const fallbackYr = now.getMonth() >= 6
    ? `${now.getFullYear()}–${now.getFullYear() + 1}`
    : `${now.getFullYear() - 1}–${now.getFullYear()}`;
  const dateGenerated = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const [{ data: lr }, { data: mr }, { data: gr }, { data: al }, { data: acts }] = await Promise.all([
    supabase.from("lessons").select("child_id, title, completed, minutes_spent, scheduled_date, date, curriculum_goal_id, subjects(name), is_backfill").eq("user_id", userId),
    supabase.from("memories").select("child_id, type, title, date, duration_minutes").eq("user_id", userId),
    supabase.from("curriculum_goals").select("id, default_minutes").eq("user_id", userId),
    supabase.from("activity_logs").select("activity_id, date, minutes_spent, completed, is_backfill").eq("user_id", userId).eq("completed", true),
    supabase.from("activities").select("id, name, emoji, child_ids").eq("user_id", userId),
  ]);

  let allLessons = (lr ?? []) as unknown as LessonRow[];
  let allMemories = (mr ?? []) as unknown as MemoryRow[];
  let allActivityLogs = (al ?? []) as unknown as ActivityLogRow[];
  const activityMap: Record<string, ActivityRow> = {};
  for (const a of ((acts ?? []) as unknown as ActivityRow[])) activityMap[a.id] = a;
  const goalDefaults: Record<string, number> = {};
  for (const g of ((gr ?? []) as unknown as GoalRow[])) goalDefaults[g.id] = g.default_minutes ?? 30;

  const { start: rangeStart, end: rangeEnd, label: dateRangeLabel } = computeRange(opts);
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

  const scopedLessonMins = scopedDone.reduce((s, l) => s + lessonMinutes(l, goalDefaults).m, 0);
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
    done.filter((l) => l.is_backfill).reduce((s, l) => s + lessonMinutes(l, goalDefaults).m, 0) +
    activityLogs.filter((a) => a.is_backfill).reduce((s, a) => s + (a.minutes_spent || 0), 0);

  const childrenReport: ReportData["children"] = reportChildren.map((c) => {
    const childLessons = done.filter((l) => l.child_id === c.id);
    const childLessonMins = childLessons.reduce((s, l) => s + lessonMinutes(l, goalDefaults).m, 0);
    const childActs = activityLogs.filter((a) => activityMap[a.activity_id]?.child_ids?.includes(c.id));
    const childActMins = childActs.reduce((s, a) => s + (a.minutes_spent || 0), 0);
    const childLessonDays = new Set(childLessons.map(lessonDate).filter(Boolean));
    const childActDays = new Set(childActs.map((a) => a.date));
    const childSchoolDays = new Set([...childLessonDays, ...childActDays]).size;

    const subjectAgg: Record<string, { n: number; m: number; e: boolean }> = {};
    for (const l of childLessons) {
      const nm = l.subjects?.name || "General";
      if (!subjectAgg[nm]) subjectAgg[nm] = { n: 0, m: 0, e: false };
      subjectAgg[nm].n++;
      const r = lessonMinutes(l, goalDefaults);
      subjectAgg[nm].m += r.m;
      if (r.e) subjectAgg[nm].e = true;
    }
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
      subjects: Object.entries(subjectAgg)
        .map(([n, d]) => ({ name: n, count: d.n, hours: fmtMins(d.m), estimated: d.e }))
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
    const r = lessonMinutes(l, goalDefaults);
    dailyLogMap[d].push({
      childName: childNameMap[l.child_id] || "",
      subject: l.subjects?.name || "General",
      description: l.is_backfill ? `${l.title || "Lesson"} (imported)` : (l.title || "Lesson"),
      minutes: r.m,
      type: l.is_backfill ? "Imported" : "Lesson",
      estimated: r.e,
    });
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
  doc.save(`${fileSlug}-progress-report-${fallbackYr.replace(/[^\d]/g, "-")}.pdf`);
}
