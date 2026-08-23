// Purge storage folders that belong to accounts which no longer exist.
//
// Why there is a backlog to purge: until August 2026 the account-deletion
// route found a family's photos by string-matching memories.photo_url against
// "/object/public/memory-photos/". Storage went private in April, so most rows
// held signed urls (/object/sign/...?token=...) the marker never matched (647
// of 1025 rows), and the memories, yearbook-covers and year-certificates
// buckets were never swept at all. The route is fixed (lib/storage-cleanup.ts
// lists the user's folder instead of parsing urls), but the files those old
// deletions left behind are still sitting in the buckets. This script removes
// them.
//
// Run:
//   npm run purge:orphan-storage             # dry run, prints what it would do
//   npm run purge:orphan-storage -- --apply  # actually deletes
//
// Safety model: a folder is only touched when its name is a uuid that is NOT
// in the live auth.users set. Live families are never touched, and neither is
// anything at a bucket's root (app assets like hero.mp4 live there).

import { getSupabaseAdmin } from "../lib/supabase-admin.ts";
import {
  USER_SCOPED_BUCKETS,
  sweepBucket,
  type SweepResult,
} from "../lib/storage-cleanup.ts";

const APPLY = process.argv.includes("--apply");
const USERS_PER_PAGE = 1000;
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Every user id that still exists in auth.users. */
async function liveUserIds(admin: Admin): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: USERS_PER_PAGE,
    });
    if (error) {
      console.error("[purge] listUsers failed:", error.message);
      process.exit(1);
    }
    const users = data?.users ?? [];
    for (const u of users) if (u?.id) ids.add(u.id);
    if (users.length < USERS_PER_PAGE) break;
  }
  return ids;
}

/**
 * The top-level entries of a bucket. Supabase returns real files with a
 * populated `id` and pseudo-folders with `id: null`, so an entry with an id is
 * a root-level file (hero.mp4 and friends) and must be left alone.
 */
async function listFolderNames(admin: Admin, bucket: string): Promise<string[]> {
  const folders: string[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list("", { limit: LIST_PAGE_SIZE, offset });
    if (error) {
      console.error(`[purge] ${bucket}: root list failed at offset ${offset}: ${error.message}`);
      return folders;
    }
    const entries = data ?? [];
    for (const entry of entries) {
      if (!entry?.name) continue;
      if (entry.id) continue; // a real file at the bucket root, not a folder
      if (!UUID_RE.test(entry.name)) continue; // not a user folder
      folders.push(entry.name);
    }
    if (entries.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return folders;
}

async function main() {
  const admin = getSupabaseAdmin();

  console.log(
    APPLY
      ? "[purge] APPLY mode: orphaned folders will be deleted"
      : "[purge] DRY RUN: nothing will be deleted (pass --apply to delete)",
  );

  const live = await liveUserIds(admin);
  console.log(`[purge] ${live.size} live accounts in auth.users`);

  let totalFound = 0;
  let totalRemoved = 0;
  let orphanFolders = 0;
  let skippedLive = 0;
  const allErrors: string[] = [];

  for (const bucket of USER_SCOPED_BUCKETS) {
    const folders = await listFolderNames(admin, bucket);
    let bucketFound = 0;
    let bucketRemoved = 0;
    let bucketOrphans = 0;

    for (const folder of folders) {
      if (live.has(folder)) {
        skippedLive++;
        continue;
      }
      const result: SweepResult = await sweepBucket(admin, bucket, folder, {
        dryRun: !APPLY,
      });
      if (result.found === 0 && result.errors.length === 0) continue;

      bucketOrphans++;
      orphanFolders++;
      bucketFound += result.found;
      bucketRemoved += result.removed;
      allErrors.push(...result.errors);
      console.log(
        `[purge] ${bucket}/${folder}: ${result.found} file(s)` +
          (APPLY ? `, removed ${result.removed}` : ", would remove"),
      );
      for (const err of result.errors) console.error(`[purge]   ! ${err}`);
    }

    totalFound += bucketFound;
    totalRemoved += bucketRemoved;
    console.log(
      `[purge] ${bucket}: ${folders.length} user folder(s), ${bucketOrphans} orphaned, ${bucketFound} file(s)` +
        (APPLY ? `, removed ${bucketRemoved}` : ""),
    );
  }

  console.log(
    `[purge] done: ${totalFound} file(s) across ${orphanFolders} orphaned folder(s)` +
      (APPLY ? `, removed ${totalRemoved}` : " (dry run, nothing removed)") +
      `; ${skippedLive} live folder(s) left alone; ${allErrors.length} error(s)`,
  );

  if (APPLY && totalRemoved !== totalFound) {
    console.error(
      `[purge] FAILED: removed ${totalRemoved} of ${totalFound} file(s). Re-run to retry the remainder.`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[purge] fatal:", e);
  process.exit(1);
});
