// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { countLeaves, gardenStageSeenId, gardenStageSeenPrefix, type LeafSources } from "./garden-leaves.ts";

const ZOE = "zoe";
const EMMA = "emma";

function sources(over: Partial<LeafSources> = {}): LeafSources {
  return { lessons: [], memories: [], legacyEvents: [], activityLogs: [], activities: [], ...over };
}

test("a leaf is a lesson, a memory or an activity, credited to the right child", () => {
  const counts = countLeaves(sources({
    lessons: [
      { child_id: ZOE, date: "2026-09-12", scheduled_date: null },
      { child_id: ZOE, date: "2026-09-13", scheduled_date: null },
      { child_id: null, date: "2026-09-13", scheduled_date: null },
    ],
    memories: [
      { child_id: EMMA, type: "photo", title: "Pond", date: "2026-09-12" },
      { child_id: null, type: "photo", title: "Family", date: "2026-09-12" },
    ],
    activityLogs: [{ activity_id: "piano" }, { activity_id: "gone" }],
    activities: [{ id: "piano", child_ids: [ZOE, EMMA] }],
  }));
  assert.deepEqual(counts, { [ZOE]: 3, [EMMA]: 2 });
});

test("a book logged to both tables during the March 2026 cutover grows one leaf", () => {
  const counts = countLeaves(sources({
    memories: [{ child_id: ZOE, type: "book", title: "Charlotte's Web", date: "2026-09-12" }],
    legacyEvents: [{ type: "book_read", payload: { title: "Charlotte's Web", child_id: ZOE, date: "2026-09-12" } }],
  }));
  assert.equal(counts[ZOE], 1);
});

test("an empty year is a seed, not an error", () => {
  assert.deepEqual(countLeaves(sources()), {});
});

test("stage-seen markers are per school year, so a new year celebrates again", () => {
  const lastYear = { id: "sy-2025", start: "2025-08-15" };
  const thisYear = { id: "sy-2026", start: "2026-09-11" };
  assert.equal(gardenStageSeenId(lastYear, ZOE, 10), "garden_stage:sy-2025:zoe:10");
  assert.notEqual(gardenStageSeenId(lastYear, ZOE, 10), gardenStageSeenId(thisYear, ZOE, 10));
  assert.ok(gardenStageSeenId(thisYear, ZOE, 10).startsWith(gardenStageSeenPrefix(thisYear)));
  // A family with no school_years row is keyed by its August 1 window.
  assert.equal(gardenStageSeenPrefix({ id: null, start: "2026-08-01" }), "garden_stage:aug-2026-08-01:");
});
