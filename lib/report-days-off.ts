// "Days Off" for the Hours & Attendance report.
//
// Two kinds of record land here, and they differ in who they belong to:
//
// - A BREAK from Plan (vacation_blocks). It has no child and pauses the whole
//   family's lessons, so it prints on every report, labelled "Whole family".
// - A CHILD'S DAY OFF (child_absences), such as one child's sick day, added
//   from the report itself. It belongs to one child: it prints on that child's
//   report and on the family report with the child's name, and never on a
//   sibling's report. Nothing that schedules lessons reads it.
//
// Neither kind changes Days Present, which stays the days with completed
// lessons or completed school appointments (lib/progress-report-rows.ts,
// attendancePresentDates). Both are clipped to the report's date range.
//
// No "@/" import and no side effects: node --test strips types, it does not
// resolve path aliases.

export interface ReportBreak {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface ReportAbsence {
  id: string;
  child_id: string;
  reason: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface ReportDayOff {
  id: string;
  kind: "break" | "absence";
  name: string;
  /** The absent child, or null for a whole-family break. */
  childId: string | null;
  /** Clipped to the report range. YYYY-MM-DD. */
  start: string;
  end: string;
}

export interface DaysOffInput {
  breaks: ReportBreak[];
  absences: ReportAbsence[];
  /** The child whose report this is, or null for the family report. */
  childId: string | null;
  from: string;
  to: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymd(value: string | null | undefined): string | null {
  const v = (value ?? "").slice(0, 10);
  return YMD.test(v) ? v : null;
}

/**
 * Days off that overlap [from, to], clipped to it, oldest first. An empty
 * `from` or `to` leaves that side open. Rows with a missing or reversed range
 * are dropped rather than guessed at. A child's day off appears only on that
 * child's report and the family report.
 */
export function selectReportDaysOff({ breaks, absences, childId, from, to }: DaysOffInput): ReportDayOff[] {
  const lo = ymd(from);
  const hi = ymd(to);
  const out: ReportDayOff[] = [];
  const seen = new Set<string>();

  const add = (id: string, kind: ReportDayOff["kind"], name: string, owner: string | null, rawStart: string | null, rawEnd: string | null) => {
    const start = ymd(rawStart);
    const end = ymd(rawEnd);
    if (!start || !end || start > end) return;
    if (lo && end < lo) return;
    if (hi && start > hi) return;
    const key = kind + ":" + id;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id, kind, name, childId: owner,
      start: lo && start < lo ? lo : start,
      end: hi && end > hi ? hi : end,
    });
  };

  for (const b of breaks) add(b.id, "break", b.name?.trim() || "Break", null, b.start_date, b.end_date);
  for (const a of absences) {
    if (childId !== null && a.child_id !== childId) continue;
    add(a.id, "absence", a.reason?.trim() || "Day off", a.child_id, a.start_date, a.end_date);
  }

  return out.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.name.localeCompare(b.name));
}

/** Calendar days in an inclusive YYYY-MM-DD range. */
export function dayOffLength(d: ReportDayOff): number {
  const ms = Date.parse(d.end + "T12:00:00Z") - Date.parse(d.start + "T12:00:00Z");
  return Math.round(ms / 86_400_000) + 1;
}

/** Why a new day off cannot be saved, or null when it can. */
export function dayOffInputError(childId: string, start: string, end: string, reason: string): string | null {
  if (!childId) return "Choose which child was out.";
  if (!ymd(start) || !ymd(end)) return "Choose the first and last day.";
  if (start > end) return "The last day can't be before the first day.";
  const r = reason.trim();
  if (!r) return "Add a reason, such as Sick day.";
  if (r.length > 80) return "Keep the reason under 80 characters.";
  return null;
}
