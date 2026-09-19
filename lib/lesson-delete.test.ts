import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deleteLessonById, deleteLessonsByIds, deleteYearLessons, restoreRemovedRow,
  LessonDeleteError, messageFor, type LessonDeleteClient,
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

// ── Deferred / timer-driven deletes ────────────────────────────────────────
// Today removes the lesson, then deletes it 5s later from a setTimeout. The
// old shape was `setTimeout(async () => { await deleteLessonById(...) })`:
// setTimeout DISCARDS the promise an async callback returns, so a rejection
// was unhandled, the row stayed in the database, and the screen showed it gone
// until the next load. These pin the replacement's behaviour.

function deferred<T extends { id: string }>(
  client: LessonDeleteClient,
  row: T,
  state: { list: T[]; message: string | null },
): Promise<void> {
  // The exact shape used in app/dashboard/page.tsx: a chain with its own
  // catch, started with `void`, never an async callback.
  return deleteLessonById(client, row.id)
    .catch((err: unknown) => {
      state.list = restoreRemovedRow(state.list, row);
      state.message = err instanceof LessonDeleteError ? err.message : "fallback";
    });
}

test("a deferred delete that fails restores the row and sets a message", async () => {
  const row = { id: "x" };
  const state = { list: [] as { id: string }[], message: null as string | null };
  await deferred(denied, row, state);
  assert.deepEqual(state.list, [row], "the row the screen removed is put back");
  assert.match(String(state.message), /reload/i, "and the parent is told why");
});

test("a deferred delete that succeeds leaves the row removed and says nothing", async () => {
  const state = { list: [] as { id: string }[], message: null as string | null };
  await deferred(ok, { id: "x" }, state);
  assert.deepEqual(state.list, []);
  assert.equal(state.message, null);
});

test("a failing deferred delete produces NO unhandled rejection", async () => {
  const seen: unknown[] = [];
  const onUnhandled = (e: unknown) => seen.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const state = { list: [] as { id: string }[], message: null as string | null };
    void deferred(denied, { id: "x" }, state);
    // Let the microtask queue drain, then a macrotask, which is when an
    // unhandled rejection would be reported.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(seen.length, 0, "the chain must carry its own catch");
    assert.equal(state.list.length, 1, "and still restore the row");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a deferred BULK delete restores every row it removed", async () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  let list: { id: string }[] = [];
  let msg: string | null = null;
  await deleteLessonsByIds(denied, rows.map((r) => r.id)).catch((err: unknown) => {
    list = rows.reduce((acc, r) => restoreRemovedRow(acc, r), list);
    msg = err instanceof LessonDeleteError ? err.message : "fallback";
  });
  assert.deepEqual(list.map((r) => r.id).sort(), ["a", "b", "c"],
    "a partial restore would leave the parent short without saying so");
  assert.notEqual(msg, null);
});
