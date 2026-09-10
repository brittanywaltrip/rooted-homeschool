// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { batches, LESSON_INSERT_BATCH } from "./batches.ts";

test("1,201 rows split into 500, 500 and 201, in the original order", () => {
  const rows = Array.from({ length: 1201 }, (_, i) => i);
  const b = batches(rows);
  assert.equal(LESSON_INSERT_BATCH, 500);
  assert.deepEqual(b.map((x) => x.length), [500, 500, 201]);
  assert.deepEqual(b.flat(), rows, "concatenating the batches gives the rows back in order");
  assert.equal(b[1][0], 500);
  assert.equal(b[2][200], 1200);
});

test("edge cases: empty, exactly one batch, a custom size, a bad size", () => {
  assert.deepEqual(batches([]), []);
  assert.deepEqual(batches([1, 2, 3], 3), [[1, 2, 3]]);
  assert.deepEqual(batches([1, 2, 3], 2), [[1, 2], [3]]);
  assert.throws(() => batches([1], 0), /positive integer/);
});
