// Tests for lib/yearbook-drafts.ts, the device copy of typed yearbook text
// that survives Back, reload and a failed navigation.

import { test } from "node:test";
import assert from "node:assert/strict";

import { openDraftStore, triageDrafts, draftScopePrefix, type DraftStorage, type DraftScope } from "./yearbook-drafts.ts";

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const SCOPE: DraftScope = { authUserId: "auth-1", familyUserId: "fam-1", yearbookKey: "2026-27" };

test("a draft is kept per field and listed back", () => {
  const s = memoryStorage();
  const store = openDraftStore(() => s, SCOPE);
  assert.equal(store.available, true);
  assert.equal(store.write("letter_from_home:null:null", "Dear future us"), true);
  assert.equal(store.write("month:2026-09", "Apples"), true);
  const listed = store.list();
  assert.deepEqual(listed.map((d) => [d.field, d.value]), [
    ["letter_from_home:null:null", "Dear future us"],
    ["month:2026-09", "Apples"],
  ]);
  assert.ok(listed.every((d) => d.savedAt.length > 0));
});

test("drafts are scoped by signed-in user, family and yearbook", () => {
  const s = memoryStorage();
  openDraftStore(() => s, SCOPE).write("letter_from_home:null:null", "mine");
  assert.equal(openDraftStore(() => s, { ...SCOPE, authUserId: "auth-2" }).list().length, 0, "another sign-in");
  assert.equal(openDraftStore(() => s, { ...SCOPE, familyUserId: "fam-2" }).list().length, 0, "another family");
  assert.equal(openDraftStore(() => s, { ...SCOPE, yearbookKey: "2025-26" }).list().length, 0, "another year");
  assert.equal(openDraftStore(() => s, SCOPE).list().length, 1);
  assert.ok([...s.map.keys()].some((k) => k.startsWith(draftScopePrefix(SCOPE))));
});

test("a confirmed write clears the draft only when the draft holds that text", () => {
  const s = memoryStorage();
  const store = openDraftStore(() => s, SCOPE);
  store.write("letter_from_home:null:null", "Dear");
  // She typed more while "Dear" was saving.
  store.write("letter_from_home:null:null", "Dear future us");
  store.clearIfConfirmed("letter_from_home:null:null", "Dear");
  assert.deepEqual(store.list().map((d) => d.value), ["Dear future us"], "the newer edit survives the older confirmation");

  store.clearIfConfirmed("letter_from_home:null:null", "Dear future us");
  assert.deepEqual(store.list(), []);
});

test("triage offers drafts that differ from the server and drops ones already saved", () => {
  const server: Record<string, string> = {
    "letter_from_home:null:null": "Dear future us",
    "tiny_moments:null:null": "Lost a tooth",
  };
  const { offer, alreadySaved } = triageDrafts(
    [
      { field: "letter_from_home:null:null", value: "Dear future us", savedAt: "" },
      { field: "tiny_moments:null:null", value: "Lost a tooth\nBuilt a fort", savedAt: "" },
      { field: "month:2026-09", value: "Apples", savedAt: "" },
      { field: "family_name:null:null", value: "", savedAt: "" },
    ],
    (f) => server[f],
  );
  assert.deepEqual(offer.map((d) => d.field), ["tiny_moments:null:null", "month:2026-09"]);
  assert.deepEqual(alreadySaved.map((d) => d.field), ["letter_from_home:null:null", "family_name:null:null"]);
});

test("missing storage is reported as unavailable, and nothing throws", () => {
  const store = openDraftStore(() => null, SCOPE);
  assert.equal(store.available, false);
  assert.equal(store.write("x", "y"), false);
  assert.deepEqual(store.list(), []);
  store.clearIfConfirmed("x", "y");
  store.discard("x");
});

test("storage that throws on access (blocked by the browser) is unavailable", () => {
  const store = openDraftStore(() => { throw new Error("SecurityError"); }, SCOPE);
  assert.equal(store.available, false);
  assert.equal(store.write("x", "y"), false);
});

test("a write refused later (quota) flips available to false instead of claiming a copy", () => {
  const s = memoryStorage();
  const store = openDraftStore(() => s, SCOPE);
  assert.equal(store.available, true);
  s.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(store.write("letter_from_home:null:null", "Dear"), false);
  assert.equal(store.available, false);
});

test("a corrupt stored entry is ignored, not offered", () => {
  const s = memoryStorage();
  const store = openDraftStore(() => s, SCOPE);
  s.setItem(draftScopePrefix(SCOPE) + "letter_from_home:null:null", "{not json");
  s.setItem(draftScopePrefix(SCOPE) + "tiny_moments:null:null", JSON.stringify({ value: 42 }));
  assert.deepEqual(store.list(), []);
});

test("discard removes one field's draft", () => {
  const s = memoryStorage();
  const store = openDraftStore(() => s, SCOPE);
  store.write("a", "1");
  store.write("b", "2");
  store.discard("a");
  assert.deepEqual(store.list().map((d) => d.field), ["b"]);
});
