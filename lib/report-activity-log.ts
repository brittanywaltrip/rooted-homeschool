// One "Activities" list for the Hours & Attendance report.
//
// The report used to print two sections for out-of-curriculum time:
// "Activities and Appointments" (completed school appointments) and
// "Activities" (completed recurring-activity sessions). They come from
// different tables and nothing writes one when the other is created, so a
// merged list is a plain union: every record appears exactly once, and no
// record is dropped.
//
// Minutes keep the rule the report already had. Session minutes count toward
// Hours Logged. Appointment minutes are shown on their row but have never been
// part of Hours Logged (appointments feed Days Present only), so merging the
// lists must not quietly change that total. `countedMinutes` is the number
// that belongs in Hours Logged; `appointmentMinutes` is reported separately.
//
// No "@/" import and no side effects: node --test strips types, it does not
// resolve path aliases.

import type { ActivitySession } from "./activity-sessions.ts";

export interface ActivityLogAppointment {
  id: string;
  title: string;
  emoji: string;
  date: string;
  duration_minutes: number | null;
  child_ids: string[];
}

export type ActivityLogRow =
  | { kind: "session"; key: string; date: string; name: string; minutes: number; session: ActivitySession }
  | { kind: "appointment"; key: string; date: string; name: string; minutes: number; appointment: ActivityLogAppointment };

export interface ActivityLog {
  rows: ActivityLogRow[];
  sessions: number;
  appointments: number;
  /** Minutes that count toward Hours Logged: completed sessions only. */
  countedMinutes: number;
  /** Minutes on appointment rows. Listed, not part of Hours Logged. */
  appointmentMinutes: number;
}

/**
 * Merge already-filtered sessions and appointments into one dated list.
 *
 * Both inputs must already be scoped to the child and date range; this adds no
 * filtering of its own, so the list cannot disagree with the totals elsewhere
 * on the report. An appointment is keyed by (id, date): a recurring series
 * completes one row per occurrence, and the same occurrence reaching the page
 * twice is listed once.
 */
export function buildActivityLog(
  sessions: ReadonlyArray<ActivitySession>,
  appointments: ReadonlyArray<ActivityLogAppointment>,
): ActivityLog {
  const rows: ActivityLogRow[] = [];
  let countedMinutes = 0;
  let appointmentMinutes = 0;

  sessions.forEach((s, i) => {
    rows.push({
      kind: "session",
      key: `session:${s.logId ?? `${s.activityId}:${s.date}:${i}`}`,
      date: s.date, name: s.name, minutes: s.minutes, session: s,
    });
    countedMinutes += s.minutes;
  });

  const seen = new Set<string>();
  let appointmentCount = 0;
  for (const a of appointments) {
    const key = `appointment:${a.id}:${a.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const minutes = a.duration_minutes && a.duration_minutes > 0 ? a.duration_minutes : 0;
    rows.push({ kind: "appointment", key, date: a.date, name: a.title, minutes, appointment: a });
    appointmentMinutes += minutes;
    appointmentCount += 1;
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  return { rows, sessions: sessions.length, appointments: appointmentCount, countedMinutes, appointmentMinutes };
}

/**
 * Completed school appointments for one child and date range. The rule the
 * report has always used: an appointment with no children named is
 * whole-family and counts for whichever child is selected; one that names
 * children counts only for them. Inclusive on both ends.
 */
export function selectReportAppointments<T extends ActivityLogAppointment>(
  appointments: ReadonlyArray<T>,
  childId: string | null,
  dateFrom: string,
  dateTo: string,
): T[] {
  return appointments.filter((a) => {
    if (childId && a.child_ids.length > 0 && !a.child_ids.includes(childId)) return false;
    return a.date >= dateFrom && a.date <= dateTo;
  });
}
