// Tests for lib/yearbook-photo-saves.ts: photo reorder decisions and the
// confirmed page_order write.

import { test } from "node:test";
import assert from "node:assert/strict";

import { reorderWithinGroup, writePageOrders, PageOrderSaveError } from "./yearbook-photo-saves.ts";

const ORDER = { kidA: ["a1", "a2", "a3"], family: ["f1", "f2"] };

test("a drop moves the photo to the target's place within its chapter", () => {
  assert.deepEqual(reorderWithinGroup(ORDER, "a1", "a3"), { group: "kidA", ids: ["a2", "a3", "a1"] });
  assert.deepEqual(reorderWithinGroup(ORDER, "a3", "a1"), { group: "kidA", ids: ["a3", "a1", "a2"] });
  assert.deepEqual(ORDER.kidA, ["a1", "a2", "a3"], "the input is not mutated");
});

test("a drop onto itself, onto another chapter, or of an unknown photo does nothing", () => {
  assert.equal(reorderWithinGroup(ORDER, "a1", "a1"), null);
  assert.equal(reorderWithinGroup(ORDER, "a1", "f1"), null);
  assert.equal(reorderWithinGroup(ORDER, "zz", "a1"), null);
});

test("every photo is written as page_order 0..n-1 and success needs all of them", async () => {
  const writes: [string, number][] = [];
  await writePageOrders(["a2", "a3", "a1"], async (id, n) => { writes.push([id, n]); });
  assert.deepEqual(writes, [["a2", 0], ["a3", 1], ["a1", 2]]);
});

test("one failed row fails the save, names it, and the others are still attempted", async () => {
  const attempted: string[] = [];
  await assert.rejects(
    writePageOrders(["a2", "a3", "a1"], async (id) => {
      attempted.push(id);
      if (id === "a3") throw new Error("offline");
    }),
    (e: unknown) => e instanceof PageOrderSaveError && e.failed.length === 1 && e.failed[0] === "a3",
  );
  assert.deepEqual(attempted, ["a2", "a3", "a1"]);
});
