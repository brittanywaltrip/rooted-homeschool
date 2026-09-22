import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityLog, selectReportAppointments, type ActivityLogAppointment } from "./report-activity-log.ts";
import { selectActivitySessions, summarizeActivitySessions, type ActivityDefinition, type ActivityLogRow } from "./activity-sessions.ts";

// Synthetic family: two children, one whole-family activity, one per-child
// activity, one retired activity, and appointments of every attribution.
const defs: ActivityDefinition[] = [
  { id: "piano", name: "Piano", emoji: null, child_ids: ["ada"], is_active: true },
  { id: "nature", name: "Nature walk", emoji: null, child_ids: [], is_active: true },
  { id: "chess", name: "Chess", emoji: null, child_ids: ["ben"], is_active: false },
];
const logs: ActivityLogRow[] = [
  { id: "l1", activity_id: "piano", date: "2026-08-31", minutes_spent: 30, completed: true },  // before range
  { id: "l2", activity_id: "piano", date: "2026-09-01", minutes_spent: 30, completed: true },  // first day
  { id: "l3", activity_id: "nature", date: "2026-09-10", minutes_spent: 45, completed: true },
  { id: "l4", activity_id: "chess", date: "2026-09-15", minutes_spent: 60, completed: true },  // retired
  { id: "l5", activity_id: "piano", date: "2026-09-20", minutes_spent: 30, completed: null },  // unknown, never counts
  { id: "l6", activity_id: "gone", date: "2026-09-25", minutes_spent: 20, completed: true },   // definition deleted
  { id: "l7", activity_id: "nature", date: "2026-09-30", minutes_spent: 50, completed: true }, // last day
  { id: "l8", activity_id: "nature", date: "2026-10-01", minutes_spent: 50, completed: true }, // after range
];
const appts: ActivityLogAppointment[] = [
  { id: "coop", title: "Co-op", emoji: "", date: "2026-09-03", duration_minutes: 120, child_ids: [] },
  { id: "coop", title: "Co-op", emoji: "", date: "2026-09-03", duration_minutes: 120, child_ids: [] }, // same occurrence twice
  { id: "coop", title: "Co-op", emoji: "", date: "2026-09-10", duration_minutes: 120, child_ids: [] },
  { id: "dentist", title: "Swim lesson", emoji: "", date: "2026-09-12", duration_minutes: 40, child_ids: ["ben"] },
  { id: "museum", title: "Museum", emoji: "", date: "2026-09-30", duration_minutes: null, child_ids: ["ada"] },
  { id: "early", title: "Early", emoji: "", date: "2026-08-31", duration_minutes: 60, child_ids: [] },
  { id: "late", title: "Late", emoji: "", date: "2026-10-01", duration_minutes: 60, child_ids: [] },
];
const FROM = "2026-09-01", TO = "2026-09-30";

function logFor(childId: string | null) {
  const sessions = selectActivitySessions(logs, defs, { childId, dateFrom: FROM, dateTo: TO });
  const appointments = selectReportAppointments(appts, childId, FROM, TO);
  return { sessions, appointments, log: buildActivityLog(sessions, appointments) };
}

test("all children: every in-range record is listed exactly once, boundaries inclusive", () => {
  const { log } = logFor(null);
  assert.deepEqual(log.rows.map((r) => r.key), [
    "session:l2", "appointment:coop:2026-09-03", "appointment:coop:2026-09-10", "session:l3",
    "appointment:dentist:2026-09-12", "session:l4", "session:l6", "appointment:museum:2026-09-30", "session:l7",
  ]);
  assert.equal(new Set(log.rows.map((r) => r.key)).size, log.rows.length);
  assert.equal(log.sessions, 5);
  assert.equal(log.appointments, 4);
});

test("Hours Logged is unchanged: counted minutes equal the old Activities total exactly", () => {
  for (const child of [null, "ada", "ben"]) {
    const { sessions, log } = logFor(child);
    assert.equal(log.countedMinutes, summarizeActivitySessions(sessions).minutes, `child ${child}`);
  }
  assert.equal(logFor(null).log.countedMinutes, 30 + 45 + 60 + 20 + 50);
  assert.equal(logFor(null).log.appointmentMinutes, 120 + 120 + 40);
});

test("a child's list keeps shared records and drops a sibling's", () => {
  assert.deepEqual(logFor("ada").log.rows.map((r) => r.key), [
    "session:l2", "appointment:coop:2026-09-03", "appointment:coop:2026-09-10", "session:l3",
    "appointment:museum:2026-09-30", "session:l7",
  ]);
  assert.deepEqual(logFor("ben").log.rows.map((r) => r.key), [
    "appointment:coop:2026-09-03", "appointment:coop:2026-09-10", "session:l3",
    "appointment:dentist:2026-09-12", "session:l4", "session:l7",
  ]);
});

test("merging never drops or duplicates: row count is sessions plus distinct appointments", () => {
  const { sessions, appointments, log } = logFor(null);
  const distinct = new Set(appointments.map((a) => `${a.id}:${a.date}`)).size;
  assert.equal(log.rows.length, sessions.length + distinct);
});
