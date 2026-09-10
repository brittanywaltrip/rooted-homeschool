// Unit tests for the orphan-photo rules. Run with:
//   node --test lib/orphan-photos.test.ts
//
// What these guard: the reference set is built from database columns that
// hold a mix of public URLs, signed URLs and bare paths for the same file, so
// the normalizer must fold all three onto one key or a referenced photo gets
// called an orphan. And the orphan rule must never fire on a referenced file,
// a fresh upload, or an app asset at a bucket root.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeStorageRef,
  refKey,
  ownerOf,
  classifyObject,
  summarizeOrphans,
  orphansToCsv,
  csvRowCount,
  MIN_ORPHAN_AGE_MS,
  EMPTY_FOLDER_PLACEHOLDER,
  type ObjectRecord,
} from "./orphan-photos.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const GONE_USER = "22222222-2222-4222-8222-222222222222";
const PATH = `${USER}/1789006392831-cc-test-photo.jpg`;

const PUBLIC_URL = `https://auth.rootedhomeschoolapp.com/storage/v1/object/public/memory-photos/${PATH}`;
const SIGNED_URL = `https://auth.rootedhomeschoolapp.com/storage/v1/object/sign/memory-photos/${PATH}?token=eyJhbGciOiJIUzI1NiJ9.abc.def`;
const LEGACY_URL = `https://gvkbegvvmhcrmxdorctk.supabase.co/storage/v1/object/memory-photos/${PATH}`;

// ── normalizer ──────────────────────────────────────────────────────────────

test("public URL, signed URL and bare path normalize to the same bucket/path", () => {
  const fromPublic = normalizeStorageRef(PUBLIC_URL);
  const fromSigned = normalizeStorageRef(SIGNED_URL);
  const fromBare = normalizeStorageRef(PATH, { bareBucket: "memory-photos" });
  const fromLegacy = normalizeStorageRef(LEGACY_URL);

  const want = { bucket: "memory-photos", path: PATH };
  assert.deepEqual(fromPublic, want);
  assert.deepEqual(fromSigned, want, "the ?token= must be dropped");
  assert.deepEqual(fromBare, want);
  assert.deepEqual(fromLegacy, want, "the older unprefixed /object/<bucket>/ shape");

  const keys = new Set(
    [fromPublic, fromSigned, fromBare, fromLegacy].map((r) => refKey(r!.bucket, r!.path)),
  );
  assert.equal(keys.size, 1, "all four shapes must fold onto one key");
});

test("normalizer reads the bucket out of the URL, whichever bucket it is", () => {
  assert.deepEqual(
    normalizeStorageRef(`https://x.supabase.co/storage/v1/object/sign/family-photos/${USER}/family.jpg?token=t`),
    { bucket: "family-photos", path: `${USER}/family.jpg` },
  );
  assert.deepEqual(
    normalizeStorageRef(`https://x.supabase.co/storage/v1/object/public/yearbook-covers/${USER}/cover.jpg`),
    { bucket: "yearbook-covers", path: `${USER}/cover.jpg` },
  );
  // Child avatars live in the old `memories` bucket; still a reference.
  assert.deepEqual(
    normalizeStorageRef(`https://x.supabase.co/storage/v1/object/public/memories/${USER}/avatar.png`),
    { bucket: "memories", path: `${USER}/avatar.png` },
  );
});

test("normalizer: external URLs and empty values are not references", () => {
  assert.equal(normalizeStorageRef("https://covers.openlibrary.org/b/id/10084379-M.jpg"), null);
  assert.equal(normalizeStorageRef("https://lh3.googleusercontent.com/a/ACg8ocI=s96-c"), null);
  assert.equal(normalizeStorageRef(null), null);
  assert.equal(normalizeStorageRef(""), null);
  assert.equal(normalizeStorageRef("   "), null);
  // A bare path with no bucket to put it in is not a reference either.
  assert.equal(normalizeStorageRef(PATH), null);
});

test("normalizer decodes percent-encoding so it matches the raw object name", () => {
  const encoded = `https://x.supabase.co/storage/v1/object/sign/memory-photos/${USER}/my%20photo.jpg?token=t`;
  assert.deepEqual(normalizeStorageRef(encoded), {
    bucket: "memory-photos",
    path: `${USER}/my photo.jpg`,
  });
});

test("ownerOf is the first folder, and null at a bucket root", () => {
  assert.equal(ownerOf(PATH), USER);
  assert.equal(ownerOf("hero.mp4"), null);
  assert.equal(ownerOf("/leading-slash"), null);
});

// ── orphan rule ─────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-09-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

function obj(overrides: Partial<ObjectRecord> = {}): ObjectRecord {
  return {
    bucket: "memory-photos",
    path: PATH,
    size: 1211,
    createdAt: hoursAgo(72),
    ...overrides,
  };
}

function ctx(overrides: Partial<Parameters<typeof classifyObject>[1]> = {}) {
  return {
    referenced: new Set<string>(),
    liveUsers: new Set([USER]),
    now: NOW,
    ...overrides,
  };
}

test("a referenced file is never an orphan, however old", () => {
  const referenced = new Set([refKey("memory-photos", PATH)]);
  const c = classifyObject(obj({ createdAt: hoursAgo(24 * 400) }), ctx({ referenced }));
  assert.equal(c.verdict, "referenced");
  assert.equal(c.orphan, false);
});

test("an unreferenced file created 2 hours ago is not an orphan", () => {
  const c = classifyObject(obj({ createdAt: hoursAgo(2) }), ctx());
  assert.equal(c.verdict, "recent");
  assert.equal(c.orphan, false);
});

test("an unreferenced file created 3 days ago is an orphan", () => {
  const c = classifyObject(obj({ createdAt: hoursAgo(72) }), ctx());
  assert.equal(c.verdict, "unreferenced");
  assert.equal(c.orphan, true);
  assert.equal(c.ownerId, USER);
  assert.equal(c.ownerExists, true);
});

test("the age boundary is exactly MIN_ORPHAN_AGE_MS", () => {
  const justUnder = new Date(NOW - MIN_ORPHAN_AGE_MS + 1).toISOString();
  const exactly = new Date(NOW - MIN_ORPHAN_AGE_MS).toISOString();
  assert.equal(classifyObject(obj({ createdAt: justUnder }), ctx()).orphan, false);
  assert.equal(classifyObject(obj({ createdAt: exactly }), ctx()).orphan, true);
});

test("owner_missing when the folder is not a live auth.users id", () => {
  const c = classifyObject(
    obj({ path: `${GONE_USER}/1789006392831-old.jpg` }),
    ctx(),
  );
  assert.equal(c.verdict, "owner_missing");
  assert.equal(c.orphan, true);
  assert.equal(c.ownerExists, false);
});

test("a bucket-root file is an app asset, never an orphan", () => {
  const c = classifyObject(
    obj({ bucket: "media", path: "hero.mp4", size: 45993564, createdAt: hoursAgo(24 * 150) }),
    ctx(),
  );
  assert.equal(c.verdict, "root_asset");
  assert.equal(c.orphan, false);
  assert.equal(c.ownerId, null);
});

test("the empty-folder placeholder is never an orphan", () => {
  const c = classifyObject(obj({ path: `${USER}/${EMPTY_FOLDER_PLACEHOLDER}`, size: 0 }), ctx());
  assert.equal(c.verdict, "placeholder");
  assert.equal(c.orphan, false);
});

test("an unparseable created_at is treated as recent, not as old", () => {
  assert.equal(classifyObject(obj({ createdAt: null }), ctx()).orphan, false);
  assert.equal(classifyObject(obj({ createdAt: "not a date" }), ctx()).orphan, false);
});

// ── summary + CSV ───────────────────────────────────────────────────────────

test("summarizeOrphans counts files, bytes and distinct families per bucket", () => {
  const rows = [
    classifyObject(obj({ path: `${USER}/a.jpg`, size: 100 }), ctx()),
    classifyObject(obj({ path: `${USER}/b.jpg`, size: 200 }), ctx()),
    classifyObject(obj({ path: `${GONE_USER}/c.jpg`, size: 300 }), ctx()),
    classifyObject(obj({ path: `${USER}/fresh.jpg`, size: 999, createdAt: hoursAgo(1) }), ctx()),
    classifyObject(obj({ bucket: "media", path: "hero.mp4", size: 5 }), ctx()),
  ];
  const summary = summarizeOrphans(rows, ["memory-photos", "media"]);
  assert.deepEqual(summary, [
    { bucket: "memory-photos", count: 3, bytes: 600, families: 2 },
    { bucket: "media", count: 0, bytes: 0, families: 0 },
  ]);
});

test("CSV holds the orphans only and csvRowCount reads it back", () => {
  const rows = [
    classifyObject(obj({ path: `${USER}/a.jpg` }), ctx()),
    classifyObject(obj({ path: `${USER}/fresh.jpg`, createdAt: hoursAgo(1) }), ctx()),
    classifyObject(obj({ path: `${GONE_USER}/c.jpg` }), ctx()),
  ];
  const csv = orphansToCsv(rows);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "bucket,path,size,created_at,owner_id,owner_exists,reason");
  assert.equal(lines.length, 3, "header plus the two orphans");
  assert.match(lines[1], new RegExp(`^memory-photos,${USER}/a.jpg,1211,.*,${USER},true,unreferenced$`));
  assert.match(lines[2], new RegExp(`,${GONE_USER},false,owner_missing$`));
  assert.equal(csvRowCount(csv), 2);
  assert.equal(csvRowCount("bucket,path\n"), 0);
  assert.equal(csvRowCount(""), 0);
});
