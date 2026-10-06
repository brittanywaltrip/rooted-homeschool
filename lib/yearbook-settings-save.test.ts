// Tests for lib/yearbook-settings-save.ts: one setting saves without
// overwriting the others, including when two tabs save at once.

import { test } from "node:test";
import assert from "node:assert/strict";

import { saveSettingKey, sameSettings, SettingsConflictError, type SettingsDb, type SettingsRecord } from "./yearbook-settings-save.ts";

/** A stored settings object with compare-and-swap, and hooks to interfere. */
function fakeDb(initial: SettingsRecord | null) {
  let stored: SettingsRecord | null = initial ? { ...initial } : null;
  const log: string[] = [];
  let beforeSwap: (() => void) | null = null;
  let swapNeverMatches = false;
  const db: SettingsDb = {
    async read() { log.push("read"); return stored ? { ...stored } : null; },
    async swap(expected, next) {
      log.push("swap");
      if (beforeSwap) { const f = beforeSwap; beforeSwap = null; f(); }
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
  assert.deepEqual(f.log, ["read", "swap", "read", "read", "swap"]);
});

test("the value already stored is confirmed without a write", async () => {
  const f = fakeDb({ theme: "heirloom" });
  const out = await saveSettingKey(f.db, "theme", "heirloom");
  assert.deepEqual(out, { theme: "heirloom" });
  assert.deepEqual(f.log, ["read"]);
});

test("a filter that never matches still saves when a re-read proves nothing changed", async () => {
  const f = fakeDb({ theme: "garden", show_letter: false });
  f.breakSwapFilter();
  await saveSettingKey(f.db, "theme", "gallery");
  assert.deepEqual(f.stored, { theme: "gallery", show_letter: false });
  assert.deepEqual(f.log, ["read", "swap", "read", "write"]);
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
