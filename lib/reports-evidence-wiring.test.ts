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
