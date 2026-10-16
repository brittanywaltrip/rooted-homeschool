// Tests for lib/yearbook-settings-save.ts: one setting saves without
// overwriting the others, including when two tabs save at once.

import { test } from "node:test";
import assert from "node:assert/strict";

import { saveSettingKey, sameSettings, SettingsConflictError, type SettingsDb, type SettingsRecord } from "./yearbook-settings-save.ts";

/**
 * A stored settings object with compare-and-swap, and hooks to interfere.
 * It also offers an unconditional `write`, which saveSettingKey must never
 * call: the old fallback did, and the regression test below shows what that
 * cost.
 */
function fakeDb(initial: SettingsRecord | null) {
  let stored: SettingsRecord | null = initial ? { ...initial } : null;
  const log: string[] = [];
  let beforeSwap: (() => void) | null = null;
  let afterRead: ((n: number) => void) | null = null;
  let reads = 0;
  let swapMisses = 0;
  let swapNeverMatches = false;
  const db: SettingsDb & { write(next: SettingsRecord): Promise<SettingsRecord> } = {
    async read() {
      log.push("read");
      reads++;
      const out = stored ? { ...stored } : null;
      afterRead?.(reads);
      return out;
    },
    async swap(expected, next) {
      log.push("swap");
      if (beforeSwap) { const f = beforeSwap; beforeSwap = null; f(); }
      if (swapMisses > 0) { swapMisses--; return null; }
      if (swapNeverMatches || !sameSettings(stored, expected)) return null;
      stored = { ...next };
      return { ...stored };
    },
    async write(next) { log.push("write"); stored = { ...next }; return { ...stored }; },
  };
  return {
    db,
    log,
    get stored() { return stored; },
    set stored(v: SettingsRecord | null) { stored = v; },
    interfereOnce(f: () => void) { beforeSwap = f; },
    /** Runs right after the n-th read returns its snapshot. */
    onRead(f: (n: number) => void) { afterRead = f; },
    /** The next `n` swaps match nothing although nothing changed. */
    missSwaps(n: number) { swapMisses = n; },
    breakSwapFilter() { swapNeverMatches = true; },
  };
}

test("one key changes and every other stored key is kept", async () => {
  const f = fakeDb({ theme: "garden", show_letter: false, show_books_section: true });
  const out = await saveSettingKey(f.db, "theme", "heirloom");
  assert.deepEqual(f.stored, { theme: "heirloom", show_letter: false, show_books_section: true });
  assert.deepEqual(out, f.stored);
});

test("a family with no stored settings gets just the one key", async () => {
  const f = fakeDb(null);
  await saveSettingKey(f.db, "show_letter", false);
  assert.deepEqual(f.stored, { show_letter: false });
});

test("another tab saving in between is kept, not overwritten with a stale copy", async () => {
  // This tab read {theme: garden, show_letter: true}; before its write lands,
  // the other tab turns the letter off.
  const f = fakeDb({ theme: "garden", show_letter: true });
  f.interfereOnce(() => { f.stored = { theme: "garden", show_letter: false }; });
  await saveSettingKey(f.db, "theme", "gallery");
  assert.deepEqual(f.stored, { theme: "gallery", show_letter: false });
  assert.deepEqual(f.log, ["read", "swap", "read", "swap"]);
});

test("the value already stored is confirmed without a write", async () => {
  const f = fakeDb({ theme: "heirloom" });
  const out = await saveSettingKey(f.db, "theme", "heirloom");
  assert.deepEqual(out, { theme: "heirloom" });
  assert.deepEqual(f.log, ["read"]);
});

// Regression, review of #151: after a guarded write matched nothing, the old
// code re-read, saw the stored object unchanged, and wrote unconditionally.
// Another tab saving between that re-read and the plain write was erased.
test("another tab saving after the re-read is kept: no unconditional write ever happens", async () => {
  const f = fakeDb({ theme: "garden", show_letter: true, show_books_section: true });
  // The first guarded write misses although nothing changed (the case the old
  // fallback was for). Right after the re-read that follows it, the other tab
  // turns the books section off.
  f.missSwaps(1);
  f.onRead((n) => {
    if (n === 2) f.stored = { ...(f.stored ?? {}), show_books_section: false };
  });

  await saveSettingKey(f.db, "theme", "gallery");

  assert.deepEqual(f.stored, { theme: "gallery", show_letter: true, show_books_section: false },
    "the other tab's choice survives");
  assert.equal(f.log.includes("write"), false, "never an unconditional write");
  assert.deepEqual(f.log, ["read", "swap", "read", "swap", "read", "swap"]);
});

test("a guard that never confirms ends in a retryable conflict and changes nothing", async () => {
  const f = fakeDb({ theme: "garden", show_letter: false });
  f.breakSwapFilter();
  await assert.rejects(saveSettingKey(f.db, "theme", "gallery"), SettingsConflictError);
  assert.deepEqual(f.stored, { theme: "garden", show_letter: false });
  assert.equal(f.log.includes("write"), false);
  assert.equal(f.log.filter((l) => l === "swap").length, 4, "bounded: four guarded attempts");
});

test("settings that keep changing elsewhere end in a conflict error, not a stale overwrite", async () => {
  const f = fakeDb({ theme: "garden", n: 0 });
  const db: SettingsDb = {
    ...f.db,
    async swap(expected, next) {
      // Every attempt loses to another save.
      f.stored = { ...(f.stored ?? {}), n: Number((f.stored ?? {}).n) + 1 };
      return f.db.swap(expected, next);
    },
  };
  await assert.rejects(saveSettingKey(db, "theme", "gallery", 3), SettingsConflictError);
  assert.equal(f.stored?.theme, "garden");
});

test("a failed read or write rejects, so the caller never shows Saved", async () => {
  const f = fakeDb({ theme: "garden" });
  const readFails: SettingsDb = { ...f.db, async read() { throw new Error("offline"); } };
  await assert.rejects(saveSettingKey(readFails, "theme", "gallery"), /offline/);
  const swapFails: SettingsDb = { ...f.db, async swap() { throw new Error("42501 permission denied"); } };
  await assert.rejects(saveSettingKey(swapFails, "theme", "gallery"), /42501/);
  assert.deepEqual(f.stored, { theme: "garden" });
});

test("sameSettings ignores key order and tells null from empty", () => {
  assert.equal(sameSettings({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assert.equal(sameSettings({ a: 1 }, { a: 2 }), false);
  assert.equal(sameSettings(null, {}), false);
  assert.equal(sameSettings(null, null), true);
});
