// "Days Off" for the Hours & Attendance report.
//
// A family records a sick day, a holiday or a vacation as a break in Plan
// (vacation_blocks). The report never showed them, so a parent who wanted a
// sick day on the record had nowhere to put it. This lists the breaks that
// overlap the report's date range, clipped to that range.
//
// It is a record of days off only. It does not change Days Present, which
// stays the days with completed lessons or completed school appointments
// (lib/progress-report-rows.ts, attendancePresentDates). A break has no child,
// so it prints on every child's report as well as the family report.
//
// No "@/" import and no side effects: node --test strips types, it does not
// resolve path aliases.

export interface ReportBreak {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface ReportDayOff {
  id: string;
  name: string;
  /** Clipped to the report range. YYYY-MM-DD. */
  start: string;
  end: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymd(value: string | null | undefined): string | null {
  const v = (value ?? "").slice(0, 10);
  return YMD.test(v) ? v : null;
}

/**
 * Breaks that overlap [from, to], clipped to it, oldest first. An empty
 * `from` or `to` leaves that side open. Rows with a missing or reversed range
 * are dropped rather than guessed at.
 */
export function selectReportDaysOff(blocks: ReportBreak[], from: string, to: string): ReportDayOff[] {
  const lo = ymd(from);
  const hi = ymd(to);
  const out: ReportDayOff[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const start = ymd(b.start_date);
    const end = ymd(b.end_date);
    if (!start || !end || start > end) continue;
    if (lo && end < lo) continue;
    if (hi && start > hi) continue;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push({
      id: b.id,
      name: b.name?.trim() || "Break",
      start: lo && start < lo ? lo : start,
      end: hi && end > hi ? hi : end,
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.name.localeCompare(b.name));
}

/** Calendar days in an inclusive YYYY-MM-DD range. */
export function dayOffLength(d: ReportDayOff): number {
  const ms = Date.parse(d.end + "T12:00:00Z") - Date.parse(d.start + "T12:00:00Z");
  return Math.round(ms / 86_400_000) + 1;
}
