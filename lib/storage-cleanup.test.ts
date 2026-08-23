// Unit tests for the account-deletion storage sweep. Run with:
//   node --test lib/storage-cleanup.test.ts
//
// The bug these guard: account deletion used to find a family's photo files
// by string-matching memories.photo_url against "/object/public/
// memory-photos/". Storage went private in April 2026, so most rows hold
// signed urls (/object/sign/...?token=...) that marker never matches. 647 of
// 1025 production photo_url values were signed-style, so roughly two thirds
// of a deleting family's files stayed in the bucket. The fix stops parsing
// urls entirely and lists the user's folder instead, so no test here builds
// a path out of a url.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  USER_SCOPED_BUCKETS,
  listUserFiles,
  sweepBucket,
  deleteAllUserStorage,
  unremovedCount,
  summarize,
  type StorageCapableClient,
} from "./storage-cleanup.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

type FakeOpts = {
  /** Buckets whose list() returns an error. */
  listErrors?: Record<string, string>;
  /** Buckets whose remove() returns an error. */
  removeErrors?: Record<string, string>;
};

/**
 * Minimal in-memory stand-in for Supabase storage. Files are held as full
 * paths ("<userId>/<filename>"), which is how production stores them: every
 * user-uploaded object is exactly one level deep.
 */
function makeStorage(
  initial: Record<string, string[]> = {},
  opts: FakeOpts = {},
) {
  const buckets = new Map<string, Set<string>>();
  for (const [bucket, paths] of Object.entries(initial)) {
    buckets.set(bucket, new Set(paths));
  }
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  const listCalls: { bucket: string; prefix: string; offset: number; limit: number }[] = [];

  const client: StorageCapableClient = {
    storage: {
      from(bucket: string) {
        return {
          async list(prefix: string, options: { limit: number; offset: number }) {
            listCalls.push({ bucket, prefix, offset: options.offset, limit: options.limit });
            const listErr = opts.listErrors?.[bucket];
            if (listErr) return { data: null, error: { message: listErr } };
            const all = [...(buckets.get(bucket) ?? [])]
              .filter((p) => p.startsWith(`${prefix}/`))
              // Only one level deep, matching the real layout.
              .filter((p) => !p.slice(prefix.length + 1).includes("/"))
              .sort();
            const page = all
              .slice(options.offset, options.offset + options.limit)
              .map((p) => ({ name: p.slice(prefix.length + 1), id: "file-id" }));
            return { data: page, error: null };
          },
          async remove(paths: string[]) {
            removeCalls.push({ bucket, paths: [...paths] });
            const removeErr = opts.removeErrors?.[bucket];
            if (removeErr) return { data: null, error: { message: removeErr } };
            const set = buckets.get(bucket);
            if (set) for (const p of paths) set.delete(p);
            return { data: paths.map((p) => ({ name: p })), error: null };
          },
        };
      },
    },
  };

  const remaining = (bucket: string) => [...(buckets.get(bucket) ?? [])].sort();

  return { client, removeCalls, listCalls, remaining };
}

/** n files in one user's folder, named predictably. */
function folder(userId: string, n: number, prefix = "photo") {
  return Array.from({ length: n }, (_, i) => `${userId}/${prefix}-${i}.jpg`);
}

// ── listUserFiles ────────────────────────────────────────────────────────────

test("listUserFiles lists every file in the user's folder and never another user's", async () => {
  const { client } = makeStorage({
    "memory-photos": [
      ...folder(USER, 3),
      ...folder(OTHER_USER, 4, "theirs"),
    ],
  });

  const { paths, errors } = await listUserFiles(client, "memory-photos", USER);

  assert.deepEqual(errors, []);
  assert.equal(paths.length, 3);
  assert.deepEqual(paths.sort(), folder(USER, 3).sort());
  assert.ok(
    paths.every((p) => p.startsWith(`${USER}/`)),
    "never reaches into another family's folder",
  );
});

test("listUserFiles pages past the 100-file list limit", async () => {
  // 237 files: 100 + 100 + 37, so the third page is the short one that ends
  // the loop. A single un-paged list() would silently return only 100.
  const { client, listCalls } = makeStorage({
    "memory-photos": folder(USER, 237),
  });

  const { paths, errors } = await listUserFiles(client, "memory-photos", USER);

  assert.deepEqual(errors, []);
  assert.equal(paths.length, 237);
  assert.equal(new Set(paths).size, 237, "no duplicates across pages");
  assert.equal(listCalls.length, 3, "three list calls: 100, 100, 37");
  assert.deepEqual(
    listCalls.map((c) => c.offset),
    [0, 100, 200],
  );
});

test("listUserFiles skips .emptyFolderPlaceholder", async () => {
  const { client } = makeStorage({
    "family-photos": [
      `${USER}/.emptyFolderPlaceholder`,
      `${USER}/family-1.jpg`,
    ],
  });

  const { paths } = await listUserFiles(client, "family-photos", USER);

  assert.deepEqual(paths, [`${USER}/family-1.jpg`]);
});

// ── sweepBucket ──────────────────────────────────────────────────────────────

test("sweepBucket removes everything and leaves the user's folder empty", async () => {
  const { client, remaining } = makeStorage({
    "memory-photos": [...folder(USER, 13), ...folder(OTHER_USER, 2, "theirs")],
  });

  const result = await sweepBucket(client, "memory-photos", USER);

  assert.equal(result.found, 13);
  assert.equal(result.removed, 13);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    remaining("memory-photos"),
    folder(OTHER_USER, 2, "theirs").sort(),
    "only the other family's files survive",
  );
});

test("REGRESSION: sweepBucket removes files whose url was signed-style, not just public-style", async () => {
  // THIS IS THE 647-of-1025 BUG. The old delete route matched photo_url
  // against "/object/public/memory-photos/" and skipped anything else, so a
  // row holding /object/sign/...?token=... left its file behind forever.
  // The sweep never looks at a url, so both files go.
  const publicStyleFile = `${USER}/public-era.jpg`;
  const signedStyleFile = `${USER}/signed-era.jpg`;

  // The rows these files belong to, kept only to show what the old code saw.
  const memoryRows = [
    {
      photo_url:
        `https://auth.rootedhomeschoolapp.com/storage/v1/object/public/memory-photos/${publicStyleFile}`,
    },
    {
      photo_url:
        `https://auth.rootedhomeschoolapp.com/storage/v1/object/sign/memory-photos/${signedStyleFile}?token=eyJhbGciOi`,
    },
  ];
  const oldMarker = "/object/public/memory-photos/";
  const oldCodeWouldHaveFound = memoryRows.filter((r) => r.photo_url.includes(oldMarker));
  assert.equal(oldCodeWouldHaveFound.length, 1, "the old marker loop only ever saw one of these");

  const { client, remaining, removeCalls } = makeStorage({
    "memory-photos": [publicStyleFile, signedStyleFile],
  });

  const result = await sweepBucket(client, "memory-photos", USER);

  assert.equal(result.found, 2);
  assert.equal(result.removed, 2);
  assert.deepEqual(remaining("memory-photos"), [], "the signed-url file is gone too");
  assert.deepEqual(removeCalls[0].paths.sort(), [publicStyleFile, signedStyleFile].sort());
});

test("sweepBucket batches removals for a 130-file folder", async () => {
  const { client, removeCalls, remaining } = makeStorage({
    "memory-photos": folder(USER, 130),
  });

  const result = await sweepBucket(client, "memory-photos", USER);

  assert.equal(result.found, 130);
  assert.equal(result.removed, 130);
  assert.equal(removeCalls.length, 3, "50 + 50 + 30");
  assert.deepEqual(
    removeCalls.map((c) => c.paths.length),
    [50, 50, 30],
  );
  assert.deepEqual(remaining("memory-photos"), []);
});

test("sweepBucket reports a list failure instead of throwing", async () => {
  const { client, removeCalls } = makeStorage(
    { "memory-photos": folder(USER, 5) },
    { listErrors: { "memory-photos": "bucket unavailable" } },
  );

  const result = await sweepBucket(client, "memory-photos", USER);

  assert.equal(result.found, 0);
  assert.equal(result.removed, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /bucket unavailable/);
  assert.deepEqual(removeCalls, [], "nothing is removed when the listing failed");
});

test("sweepBucket reports a remove failure with found > removed", async () => {
  const { client, remaining } = makeStorage(
    { "memory-photos": folder(USER, 7) },
    { removeErrors: { "memory-photos": "storage 503" } },
  );

  const result = await sweepBucket(client, "memory-photos", USER);

  assert.equal(result.found, 7);
  assert.equal(result.removed, 0);
  assert.ok(result.found > result.removed, "leftover files are visible to the caller");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /storage 503/);
  assert.equal(remaining("memory-photos").length, 7);
});

test("sweepBucket dryRun finds files without deleting them", async () => {
  const { client, removeCalls, remaining } = makeStorage({
    "memory-photos": folder(USER, 9),
  });

  const result = await sweepBucket(client, "memory-photos", USER, { dryRun: true });

  assert.equal(result.found, 9);
  assert.equal(result.removed, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(removeCalls, [], "dry run never calls remove()");
  assert.equal(remaining("memory-photos").length, 9);
});

// ── deleteAllUserStorage ─────────────────────────────────────────────────────

test("deleteAllUserStorage sweeps every bucket and leaves nothing behind", async () => {
  const { client, remaining } = makeStorage({
    "memory-photos": [...folder(USER, 10), ...folder(OTHER_USER, 3, "theirs")],
    "family-photos": [`${USER}/family-a.jpg`, `${USER}/family-b.jpg`],
    memories: [`${USER}/legacy.jpg`],
    "yearbook-covers": [`${USER}/cover.jpg`],
    "year-certificates": [`${USER}/2026-cert.pdf`],
  });

  const results = await deleteAllUserStorage(client, USER);

  assert.deepEqual(
    results.map((r) => r.bucket),
    [...USER_SCOPED_BUCKETS],
    "every user-scoped bucket is swept, in order",
  );
  assert.equal(unremovedCount(results), 0);
  assert.deepEqual(results.flatMap((r) => r.errors), []);
  assert.equal(
    results.reduce((s, r) => s + r.removed, 0),
    15,
  );
  for (const bucket of USER_SCOPED_BUCKETS) {
    assert.ok(
      remaining(bucket).every((p) => !p.startsWith(`${USER}/`)),
      `${bucket} has no files left for the deleted user`,
    );
  }
  assert.equal(remaining("memory-photos").length, 3, "the other family is untouched");
});

test("one bucket failing does not stop the rest", async () => {
  const { client, remaining } = makeStorage(
    {
      "memory-photos": folder(USER, 4),
      "family-photos": [`${USER}/family.jpg`],
      memories: [`${USER}/legacy.jpg`],
      "yearbook-covers": [`${USER}/cover.jpg`],
      "year-certificates": [`${USER}/cert.pdf`],
    },
    { removeErrors: { "memory-photos": "storage 500" } },
  );

  const results = await deleteAllUserStorage(client, USER);

  assert.equal(results.length, USER_SCOPED_BUCKETS.length);
  assert.equal(unremovedCount(results), 4, "only the failing bucket's files are left");
  assert.equal(remaining("memory-photos").length, 4);
  for (const bucket of ["family-photos", "memories", "yearbook-covers", "year-certificates"]) {
    assert.deepEqual(remaining(bucket), [], `${bucket} was still swept`);
  }
});

test("deleteAllUserStorage dryRun reports every bucket without deleting", async () => {
  const { client, removeCalls } = makeStorage({
    "memory-photos": folder(USER, 6),
    "family-photos": [`${USER}/family.jpg`],
  });

  const results = await deleteAllUserStorage(client, USER, { dryRun: true });

  assert.equal(results.reduce((s, r) => s + r.found, 0), 7);
  assert.equal(unremovedCount(results), 7, "a dry run leaves everything unremoved by definition");
  assert.deepEqual(removeCalls, []);
});

// ── bucket list + summary ────────────────────────────────────────────────────

test("media is NOT a user-scoped bucket", () => {
  // media holds app marketing assets at the bucket root (hero.mp4), not user
  // folders. Sweeping it during an account deletion would delete shared site
  // assets for every family.
  assert.ok(!(USER_SCOPED_BUCKETS as readonly string[]).includes("media"));
  assert.deepEqual(
    [...USER_SCOPED_BUCKETS],
    ["memory-photos", "family-photos", "memories", "yearbook-covers", "year-certificates"],
  );
});

test("summarize reports totals and per-bucket counts", () => {
  const line = summarize([
    { bucket: "memory-photos", found: 10, removed: 10, errors: [] },
    { bucket: "family-photos", found: 2, removed: 1, errors: ["nope"] },
  ]);

  assert.match(line, /11\/12/);
  assert.match(line, /memory-photos 10\/10/);
  assert.match(line, /family-photos 1\/2/);
  assert.match(line, /1 error/);
});

test("unremovedCount is 0 for a clean sweep and positive when files are left", () => {
  assert.equal(
    unremovedCount([
      { bucket: "memory-photos", found: 10, removed: 10, errors: [] },
      { bucket: "family-photos", found: 0, removed: 0, errors: [] },
    ]),
    0,
  );
  assert.equal(
    unremovedCount([
      { bucket: "memory-photos", found: 10, removed: 3, errors: [] },
      { bucket: "family-photos", found: 2, removed: 0, errors: [] },
    ]),
    9,
  );
});
