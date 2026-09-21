import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve(import.meta.dirname, "..", "supabase", "migrations", "20260921120000_report_record_management.sql"),
  "utf8",
);
const lockdown = readFileSync(
  resolve(import.meta.dirname, "..", "supabase", "migrations", "20260921121000_report_record_management_lockdown.sql"),
  "utf8",
);

test("record correction RPCs require the authenticated owner", () => {
  assert.match(migration, /v_user uuid := auth\.uid\(\)/);
  assert.match(migration, /user_id = v_user/g);
  assert.match(migration, /revoke all on function public\.delete_report_lesson_record/);
  assert.match(migration, /grant execute on function public\.delete_report_lesson_record\(uuid\) to authenticated/);
  assert.match(lockdown, /delete_report_lesson_record\(uuid\) from anon/);
  assert.match(lockdown, /delete_report_activity_record\(uuid\) from anon/);
});

test("deleting a curriculum record closes both sequence gaps", () => {
  assert.match(migration, /lesson_number > v_lesson_number/);
  assert.match(migration, /lesson_number = r\.lesson_number - 1/);
  assert.match(migration, /queue_position > v_queue_position/);
  assert.match(migration, /queue_position = r\.queue_position - 1/);
  assert.match(migration, /recompute_curriculum_current_lesson\(v_goal\)/);
});

test("record edits keep placement and completion dates aligned", () => {
  assert.match(migration, /date = p_date,\s*scheduled_date = p_date/);
  assert.match(migration, /completed_at = case when completed/);
  assert.match(migration, /minutes_spent = p_minutes_spent/);
});
