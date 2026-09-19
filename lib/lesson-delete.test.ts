import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deleteLessonById, deleteLessonsByIds, deleteYearLessons, restoreRemovedRow,
  LessonDeleteError, messageFor,
} from "./lesson-delete.ts";

const ok = { rpc: async () => ({ error: null }) };
const denied = {
  rpc: async () => ({ error: { message: "permission denied for table lessons", code: "42501" } }),
};

test("a successful delete resolves", async () => {
  await deleteLessonById(ok, "abc");
});

test("an error is THROWN, not returned — the whole point", async () => {
  await assert.rejects(() => deleteLessonById(denied, "abc"), LessonDeleteError);
});

test("a refusal after the grant is removed is flagged as a stale client", async () => {
  await deleteLessonById(denied, "abc").catch((e: LessonDeleteError) => {
    assert.equal(e.staleClient, true);
    assert.match(e.message, /reload/i);
  });
});

test("other failures are not blamed on the page being out of date", () => {
  const m = messageFor({ message: "deadlock detected", code: "40P01" });
  assert.doesNotMatch(m, /out of date/i);
});

test("the rpc is called with the server's parameter name", async () => {
  let seen: unknown = null;
  await deleteLessonById(
    { rpc: async (_fn, args) => { seen = args; return { error: null }; } },
    "lesson-1",
  );
  assert.deepEqual(seen, { p_lesson_id: "lesson-1" });
});

test("an empty id never reaches the network", async () => {
  let called = false;
  await assert.rejects(() =>
    deleteLessonById({ rpc: async () => { called = true; return { error: null }; } }, ""));
  assert.equal(called, false);
});

test("bulk delete returns the count the DATABASE reported, not the count asked for", async () => {
  const n = await deleteLessonsByIds(
    { rpc: async () => ({ error: null, data: 2 }) },
    ["a", "b", "c"],
  );
  assert.equal(n, 2);
});

test("bulk delete with nothing to do never calls the server", async () => {
  let called = false;
  const n = await deleteLessonsByIds(
    { rpc: async () => { called = true; return { error: null, data: 0 }; } }, [],
  );
  assert.equal(n, 0);
  assert.equal(called, false);
});

test("a refused bulk delete throws rather than reporting a silent zero", async () => {
  await assert.rejects(
    () => deleteLessonsByIds(
      { rpc: async () => ({ error: { message: "denied", code: "42501" } }) }, ["a"]),
    LessonDeleteError);
});

test("year delete passes the server's parameter name", async () => {
  let seen: unknown = null;
  await deleteYearLessons(
    { rpc: async (_f, a) => { seen = a; return { error: null, data: 7 }; } }, "year-1");
  assert.deepEqual(seen, { p_school_year_id: "year-1" });
});

test("restoring a removed row puts it back", () => {
  const prev = [{ id: "a" }, { id: "c" }];
  assert.deepEqual(restoreRemovedRow(prev, { id: "b" }), [{ id: "a" }, { id: "c" }, { id: "b" }]);
});

test("restoring is idempotent: a row a reload already re-added is not duplicated", () => {
  const prev = [{ id: "a" }, { id: "b" }];
  assert.equal(restoreRemovedRow(prev, { id: "b" }), prev, "the same array is returned, so React sees no change");
});

test("restoring does not mutate the previous list", () => {
  const prev = [{ id: "a" }];
  const next = restoreRemovedRow(prev, { id: "b" });
  assert.equal(prev.length, 1);
  assert.equal(next.length, 2);
});
