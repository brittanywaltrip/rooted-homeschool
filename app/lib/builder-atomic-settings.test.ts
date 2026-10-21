import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterOrphanCleanup, changedSettings, pointerFor } from "./builder-settings-restore.ts";
import { applyPhase2Commit, type Phase2CommitPlan } from "./phase2-commit.ts";

const before = { total_lessons: 34, lessons_per_day: 1, lessons_per_day_overrides: null, school_days: ["Mon"], start_date: "2026-08-10", start_at_lesson: 3 };

test("only changed scheduling columns travel with the lessons", () => {
  assert.deepEqual(changedSettings(before, { ...before, lessons_per_day: 2, school_days: ["Mon", "Wed"] }), { lessons_per_day: 2, school_days: ["Mon", "Wed"] });
  assert.deepEqual(changedSettings(before, { ...before }), {});
  const withoutStart: Record<string, unknown> = { ...before, total_lessons: 40 };
  delete withoutStart.start_at_lesson;
  assert.deepEqual(changedSettings(before, withoutStart), { total_lessons: 40 });
});

test("the pointer follows the database rule", () => {
  assert.equal(pointerFor({ startAtLesson: 3, totalLessons: 34, maxCompletedSlot: 5 }), 5);
  assert.equal(pointerFor({ startAtLesson: 9, totalLessons: 34, maxCompletedSlot: 5 }), 8);
  assert.equal(pointerFor({ startAtLesson: 40, totalLessons: 34, maxCompletedSlot: 5 }), 34);
  assert.equal(pointerFor({ startAtLesson: null, totalLessons: null, maxCompletedSlot: 0 }), 0);
});

test("the orphan cleanup prediction mirrors the trigger", () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({ id: `r${n}`, lesson_number: n, completed: false, scheduled_date: "2026-10-05", queue_pinned: false, notes: null, ...extra });
  const rows = [row(3), row(4, { queue_pinned: true }), row(5, { notes: "parent" }), row(6, { completed: true }), row(7, { scheduled_date: null }), row(8), row(9)];
  const after = afterOrphanCleanup(rows, 5, 8);
  assert.deepEqual(after.map((r) => r.scheduled_date), [null, "2026-10-05", "2026-10-05", "2026-10-05", null, null, "2026-10-05"]);
  assert.deepEqual(afterOrphanCleanup(rows, 8, 8), rows, "a pointer that does not rise runs no cleanup");
  assert.equal(rows[0].scheduled_date, "2026-10-05", "the input rows are not mutated");
});

const plan: Phase2CommitPlan = { unpin_ids: [], makeup_ids: [], delete_ids: [], inserts: [], redates: [], retire_above: null, retire_keep_ids: [] };
const expected = { goal: {}, rows: [], day_start: "x", day_end: "y" } as unknown as Parameters<typeof applyPhase2Commit>[1]["expected"];
function fakeClient(responses: Array<{ data?: unknown; error?: unknown }>) {
  const calls: Array<Record<string, unknown>> = [];
  return { calls, client: { rpc: async (_name: string, args: Record<string, unknown>) => { calls.push(args); return responses.shift() ?? { data: null, error: { message: "exhausted" } }; } } };
}

test("a lost response is re-sent once, identically, and a replay is reported", async () => {
  const f = fakeClient([{ error: { message: "fetch failed" } }, { data: { status: "applied", inserted: 2, redated: 1, replayed: true } }]);
  const r = await applyPhase2Commit(f.client as never, { goalId: "g", localDay: "2026-10-01", expected, plan: { ...plan, request_id: "11111111-1111-4111-8111-111111111111" }, settings: { lessons_per_day: 2 } });
  assert.deepEqual(r, { status: "applied", inserted: 2, redated: 1, replayed: true });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], f.calls[1], "the retry is the identical call");
  assert.deepEqual(f.calls[0].p_settings, { lessons_per_day: 2 }, "settings use the five-argument form");
});

test("without a request id, or when the function is missing, nothing is re-sent", async () => {
  let f = fakeClient([{ error: { message: "fetch failed" } }]);
  let r = await applyPhase2Commit(f.client as never, { goalId: "g", localDay: "d", expected, plan });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(r, { status: "failed", reason: "fetch failed", transport: true });
  f = fakeClient([{ error: { code: "PGRST202", message: "not found" } }]);
  r = await applyPhase2Commit(f.client as never, { goalId: "g", localDay: "d", expected, plan: { ...plan, request_id: "11111111-1111-4111-8111-111111111111" }, settings: { total_lessons: 9 } });
  assert.equal(f.calls.length, 1);
  assert.equal(r.status, "unavailable", "an older database writes nothing rather than ignoring the settings");
  f = fakeClient([{ data: { status: "applied", inserted: 0, redated: 0 } }]);
  await applyPhase2Commit(f.client as never, { goalId: "g", localDay: "d", expected, plan });
  assert.ok(!("p_settings" in f.calls[0]), "a save with no settings change uses the four-argument form");
});

test("the Schedule Builder commits an existing curriculum's settings with its lessons", () => {
  const src = readFileSync(new URL("../dashboard/plan/schedule/page.tsx", import.meta.url), "utf8");
  // Phase 1 strips the scheduling columns from an existing curriculum's update.
  assert.match(src, /for \(const f of SCHEDULE_FIELDS\) delete \(updatePayload as Record<string, unknown>\)\[f\];/);
  assert.match(src, /pendingSettings\.set\(row\.dbId, \{ settings: changed, before \}\)/);
  // Phase 2 does not write the pointer for them; it computes it.
  assert.match(src, /if \(pending\) \{[\s\S]{0,900}?\} else \{\n\s+newCurrent = await recomputeCurrentLesson\(supabase, goalId\);/);
  assert.match(src, /afterOrphanCleanup\(actualBeforeRows, storedPointer, currentLesson\)/);
  // The settings and the pre-save goal go to the database together.
  assert.match(src, /snapshot = \{ \.\.\.\(pending\.before as unknown as Phase2GoalSnapshot\), current_lesson: storedPointer as number \}/);
  assert.match(src, /\.\.\.\(pending \? \{ settings: pending\.settings as Record<string, unknown> \} : \{\}\)/);
  assert.match(src, /plan: \{ \.\.\.plan, request_id: requestIdFor\(goalId\) \}/);
  // Every early exit that writes no lessons still commits the settings.
  assert.match(src, /if \(upcoming\.length === 0\) \{ await commitSettingsOnly\(\); return; \}/);
  assert.equal((src.match(/await commitSettingsOnly\(\);\n\s+return;/g) ?? []).length, 2);
});
