// Tests for lib/save-queue.ts, the rule the yearbook editor uses to decide
// when a mother's typed answer has really been saved.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSaveQueue, type SaveQueueOptions } from "./save-queue.ts";

/** Timers the test fires by hand, so debounce windows are explicit. */
function fakeTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const opts: SaveQueueOptions = {
    setTimer: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t) => { pending.delete(t as unknown as number); },
  };
  /** Fire every timer of the given length (the debounce, or the "saved" fade). */
  function fire(ms: number) {
    for (const [id, t] of [...pending]) {
      if (t.ms === ms) { pending.delete(id); t.fn(); }
    }
  }
  return { opts, fire, pending };
}

/** A writer whose calls the test resolves or rejects one at a time. */
function controlledWriter() {
  const calls: { value: string; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const write = (value: string) =>
    new Promise<void>((resolve, reject) => { calls.push({ value, resolve, reject }); });
  return { calls, write };
}

/** Let awaited promise chains run. */
const tick = () => new Promise((r) => setImmediate(r));

const DEBOUNCE = 800;
const FADE = 3000;

test("a debounced edit is not written, and not called saved, before the window closes", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts, savedResetMs: FADE });
  const w = controlledWriter();

  q.schedule("letter", "Dear future us", w.write, DEBOUNCE);
  assert.equal(q.status("letter"), "pending");
  assert.equal(w.calls.length, 0);
  assert.equal(q.hasUnsaved(), true);
});

test("saved is shown only after the write is confirmed", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts, savedResetMs: FADE });
  const w = controlledWriter();

  q.schedule("letter", "Dear future us", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  assert.equal(w.calls.length, 1);
  assert.equal(q.status("letter"), "saving");

  w.calls[0].resolve();
  await tick();
  assert.equal(q.status("letter"), "saved");
  assert.equal(q.hasUnsaved(), false);

  t.fire(FADE);
  assert.equal(q.status("letter"), "idle");
});

test("a rejected write is an error, never saved, and the value is kept for retry", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts, savedResetMs: FADE });
  const w = controlledWriter();

  q.schedule("letter", "Dear future us", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  w.calls[0].reject(new Error("new row violates row-level security policy"));
  await tick();

  assert.equal(q.status("letter"), "error");
  assert.deepEqual(q.failedKeys(), ["letter"]);
  assert.equal(q.hasUnsaved(), true, "a failed field still counts as unsaved for navigation");
  assert.match(String(q.error("letter")), /row-level security/);

  // No silent retry loop.
  await tick();
  assert.equal(w.calls.length, 1);

  // Retry writes the same text again.
  const retried = q.retry("letter");
  await tick();
  assert.equal(w.calls.length, 2);
  assert.equal(w.calls[1].value, "Dear future us");
  w.calls[1].resolve();
  assert.equal(await retried, true);
  assert.equal(q.status("letter"), "saved");
  assert.deepEqual(q.failedKeys(), []);
});

test("a retry that fails again stays an error and reports false", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  const first = q.saveNow("family_name", "The Garcias", w.write);
  await tick();
  w.calls[0].reject(new Error("offline"));
  assert.equal(await first, false);

  const again = q.retry("family_name");
  await tick();
  w.calls[1].reject(new Error("still offline"));
  assert.equal(await again, false);
  assert.equal(q.status("family_name"), "error");
});

test("editing a failed field writes the new text, and success clears the error", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  q.schedule("letter", "Dear", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  w.calls[0].reject(new Error("offline"));
  await tick();
  assert.equal(q.status("letter"), "error");

  q.schedule("letter", "Dear future us", w.write, DEBOUNCE);
  assert.equal(q.status("letter"), "pending");
  t.fire(DEBOUNCE);
  assert.equal(w.calls[1].value, "Dear future us");
  w.calls[1].resolve();
  await tick();
  assert.equal(q.status("letter"), "saved");
});

test("rapid edits inside the window coalesce into one write of the newest text", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  for (const v of ["D", "De", "Dea", "Dear"]) q.schedule("letter", v, w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].value, "Dear");
});

test("a newer edit never races an older write: one in flight per field, newest written last", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  q.schedule("letter", "Dear", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  assert.equal(w.calls.length, 1);

  // She keeps typing while "Dear" is still on the wire.
  q.schedule("letter", "Dear future us", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  assert.equal(w.calls.length, 1, "the second write waits for the first");
  assert.equal(q.status("letter"), "saving");

  w.calls[0].resolve();
  await tick();
  assert.equal(w.calls.length, 2);
  assert.equal(w.calls[1].value, "Dear future us");
  assert.notEqual(q.status("letter"), "saved", "the older confirmation does not count for the newer text");

  w.calls[1].resolve();
  await tick();
  assert.equal(q.status("letter"), "saved");
});

test("an older write failing while a newer one is queued does not leave an error behind", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  q.schedule("letter", "Dear", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  q.schedule("letter", "Dear future us", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);

  w.calls[0].reject(new Error("timeout"));
  await tick();
  assert.equal(w.calls[1].value, "Dear future us");
  w.calls[1].resolve();
  await tick();
  assert.equal(q.status("letter"), "saved");
  assert.deepEqual(q.failedKeys(), []);
});

test("fields are independent: one field's failure does not block another", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  q.schedule("letter", "Dear", w.write, DEBOUNCE);
  q.schedule("tiny_moments", "Lost a tooth", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  assert.equal(w.calls.length, 2);
  w.calls[0].reject(new Error("offline"));
  w.calls[1].resolve();
  await tick();
  assert.equal(q.status("letter"), "error");
  assert.equal(q.status("tiny_moments"), "saved");
});

test("flush writes edits still waiting on their debounce, for navigation", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  q.schedule("letter", "Dear future us", w.write, DEBOUNCE);
  q.schedule("month:2026-09", "Apples", w.write, DEBOUNCE);
  const flushed = q.flush();
  await tick();
  assert.deepEqual(w.calls.map((c) => c.value).sort(), ["Apples", "Dear future us"]);
  assert.equal(t.pending.size, 0, "the debounce timers were consumed, not left to fire twice");

  w.calls.forEach((c) => c.resolve());
  assert.deepEqual(await flushed, { ok: true, failed: [] });
  assert.equal(q.hasUnsaved(), false);
});

test("flush waits for a write already in flight and then the newer one behind it", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  q.schedule("letter", "Dear", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  q.schedule("letter", "Dear future us", w.write, DEBOUNCE);

  let done = false;
  const flushed = q.flush().then((r) => { done = true; return r; });
  await tick();
  assert.equal(w.calls.length, 1);
  w.calls[0].resolve();
  await tick();
  assert.equal(done, false, "flush is not finished while the newest text is unwritten");
  assert.equal(w.calls[1].value, "Dear future us");
  w.calls[1].resolve();
  assert.deepEqual(await flushed, { ok: true, failed: [] });
});

test("flush reports exactly which fields failed, and retries ones that had failed before", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  const first = q.saveNow("family_name", "The Garcias", w.write);
  await tick();
  w.calls[0].reject(new Error("offline"));
  await first;

  q.schedule("letter", "Dear", w.write, DEBOUNCE);
  q.schedule("school_year", "2026-2027", w.write, DEBOUNCE);
  const flushed = q.flush();
  await tick();
  // family_name (retried), letter, school_year
  assert.equal(w.calls.length, 4);
  const byValue = new Map(w.calls.slice(1).map((c) => [c.value, c]));
  byValue.get("The Garcias")!.resolve();
  byValue.get("Dear")!.reject(new Error("offline"));
  byValue.get("2026-2027")!.resolve();

  const r = await flushed;
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, ["letter"]);
  assert.equal(q.status("family_name"), "saved");
});

test("saveNow cancels a waiting debounce for the same field and writes its own value", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();

  q.schedule("letter", "Dear", w.write, DEBOUNCE);
  const p = q.saveNow("letter", "Dear future us", w.write);
  await tick();
  assert.equal(t.pending.size, 0);
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].value, "Dear future us");
  w.calls[0].resolve();
  assert.equal(await p, true);
});

test("subscribers hear every status change", async () => {
  const t = fakeTimers();
  const q = createSaveQueue({ ...t.opts });
  const w = controlledWriter();
  const seen: string[] = [];
  const off = q.subscribe(() => seen.push(q.status("letter")));

  q.schedule("letter", "Dear", w.write, DEBOUNCE);
  t.fire(DEBOUNCE);
  w.calls[0].resolve();
  await tick();
  off();
  assert.ok(seen.includes("pending"));
  assert.ok(seen.includes("saving"));
  assert.equal(seen[seen.length - 1], "saved");
});

test("a key with no edits is idle and retrying it is a no-op", async () => {
  const q = createSaveQueue();
  assert.equal(q.status("nothing"), "idle");
  assert.equal(await q.retry("nothing"), true);
  assert.deepEqual(await q.flush(), { ok: true, failed: [] });
  q.dispose();
});
