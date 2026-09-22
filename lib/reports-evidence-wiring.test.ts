import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const page = readFileSync(resolve(import.meta.dirname, "..", "app", "dashboard", "reports", "page.tsx"), "utf8");

test("the report reads, prints, and manages parent-owned lesson and activity records", () => {
  assert.match(page, /completed, minutes_spent, notes/);
  assert.match(page, /id, activity_id, date, minutes_spent, completed, notes/);
  assert.match(page, /lesson\.notes/);
  assert.match(page, /s\.notes/);
  for (const rpc of [
    "update_report_lesson_record",
    "delete_report_lesson_record",
    "update_report_activity_record",
    "delete_report_activity_record",
  ]) assert.ok(page.includes(rpc), `${rpc} must be wired into the report`);
  assert.match(page, />\s*Edit record/);
  assert.match(page, />\s*Delete record/);
  assert.match(page, /type="date"/);
  assert.match(page, /type="number"/);
});

test("photo evidence is fetched without book covers and rendered with captions", () => {
  assert.match(page, /not\("photo_url", "is", null\)\.neq\("type", "book"\)/);
  assert.match(page, /Photo Documentation/);
  assert.match(page, /data-report-photo/);
  assert.match(page, /photo\.caption\?\.trim\(\) \|\| photo\.title\?\.trim\(\) \|\| null/);
  assert.doesNotMatch(page, /Learning moment/);
});

test("Hours printing owns a scoped visible sheet and clears competing print modes", () => {
  assert.match(page, /body\.classList\.add\("print-mode-hours-report"\)/);
  assert.match(page, /body\.print-mode-hours-report \.hours-report-print-sheet,/);
  assert.match(page, /body\.print-mode-hours-report \.hours-report-print-sheet \* \{ visibility: visible !important; \}/);
  for (const mode of ["print-mode-yearbook", "print-mode-reading-log", "print-mode-daily", "print-mode-weekly", "print-mode-monthly"]) {
    assert.ok(page.includes(`"${mode}"`), `${mode} must be cleared before Hours printing`);
  }
  assert.match(page, /document\.fonts\?\.ready/);
  assert.match(page, /image\.complete/);
  assert.match(page, /onClick=\{printHoursReport\}/);
});

test("Include photos is a report-only choice: default on, wired to the selection, no delete path", () => {
  assert.match(page, /const \[includePhotos, setIncludePhotos\] = useState\(true\)/);
  assert.match(page, /selectReportPhotos\(photos, child\?\.id \?\? null, dateFrom, dateTo, includePhotos\)/);
  assert.match(page, /includePhotos=\{includePhotos\}/);
  assert.match(page, />\s*Include photos\s*</);
  // The toggle's handler only flips state; it must never reach storage or a row.
  const handler = page.match(/onChange=\{\(e\) => setIncludePhotos\(e\.target\.checked\)\}/);
  assert.ok(handler, "the checkbox only sets includePhotos");
});

test("sessions and appointments print as one Activities section and Hours Logged is unchanged", () => {
  assert.doesNotMatch(page, /Activities and Appointments/);
  assert.match(page, /buildActivityLog\(activitySessions, filteredAppointments\)/);
  assert.match(page, /const totalHours = lessonHours \+ memoryHours \+ activitySummary\.hours;/);
  assert.match(page, /attendancePresentDates\(completedLessons, filteredAppointments\.map\(\(a\) => a\.date\)\)/);
});

test("breaks print as Days Off and never feed Days Present", () => {
  assert.match(page, /from\("vacation_blocks"\)\.select\("id, name, start_date, end_date"\)\.eq\("user_id", effectiveUserId\)/);
  assert.match(page, /const daysOff = selectReportDaysOff\(breaks, dateFrom, dateTo\);/);
  assert.match(page, /data-report-days-off/);
  assert.match(page, /Days Off \(\{daysOff\.length\}\)/);
  assert.match(page, /breaks=\{breaks\}/);
  // Breaks are family-wide (vacation_blocks has no child), so each entry says so.
  assert.match(page, /\{" · Whole family"\}/);
  // Days Present stays lessons plus completed school appointments only.
  assert.match(page, /const presentDates = attendancePresentDates\(completedLessons, filteredAppointments\.map\(\(a\) => a\.date\)\);/);
  const presentLine = page.split("\n").find((l) => l.includes("attendancePresentDates(completedLessons")) ?? "";
  assert.doesNotMatch(presentLine, /daysOff|breaks/);
});
