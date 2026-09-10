// Find, and with --apply --yes delete, files in the photo buckets that no
// database row points at.
//
// Why there is a backlog: when a family deletes a memory, the app removes the
// row and calls storage.remove() for the photo. Until 2026-09-10 the
// storage.objects DELETE policy covered only the old `memories` bucket, so
// removes against memory-photos, family-photos and yearbook-covers matched
// zero rows and supabase-js resolved without an error. The row went; the file
// stayed. Migration 20260910000000 added the policies; this script clears
// what the years before it left behind. A family who deleted a photo should
// be able to trust that it is gone.
//
// Run:
//   npm run clean:orphan-photos                    # dry run: tables + CSV
//   npm run clean:orphan-photos -- --apply --yes   # delete what the dry run found
//
// Options:
//   --csv <path>          the dry-run CSV to check against (default: today's)
//   --min-age-hours <n>   how old an unreferenced file must be (default 24)
//
// Safety model
//   - Dry run by default. --apply without --yes refuses.
//   - The reference set is every storage URL or path any row still holds:
//     memories.photo_url, memories.book_cover_url, children.avatar_url,
//     profiles.family_photo_url, year_archive_certificates.certificate_url,
//     yearbook_content cover_photo rows, and legacy app_events memory_photo
//     payloads. A referenced file is never an orphan.
//   - Anything younger than 24 hours is never an orphan, so an upload whose
//     row is still being written is never touched.
//   - Bucket-root files (media/hero.mp4 and friends) are app assets, never
//     orphans. Only <userId>/ folders are considered.
//   - Any listing error exits non-zero before anything is classified, so a
//     partial listing can never turn into a deletion.
//   - --apply re-scans, refuses if the dry-run CSV is missing or its row
//     count differs from the live scan by more than 5, then deletes in
//     batches of 50 and stops on the first failed batch.
//
// The pure rules live in lib/orphan-photos.ts and are unit tested there.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getSupabaseAdmin } from "../lib/supabase-admin.ts";
import { selectAllRows } from "../lib/supabase-all-rows.ts";
import {
  SCANNED_BUCKETS,
  MIN_ORPHAN_AGE_MS,
  classifyObject,
  normalizeStorageRef,
  refKey,
  summarizeOrphans,
  orphansToCsv,
  csvRowCount,
  formatBytes,
  type Classified,
  type ObjectRecord,
} from "../lib/orphan-photos.ts";

type Admin = ReturnType<typeof getSupabaseAdmin>;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const YES = args.includes("--yes");
const CSV_ARG = argValue("--csv");
const MIN_AGE_MS = (() => {
  const h = argValue("--min-age-hours");
  if (h === null) return MIN_ORPHAN_AGE_MS;
  const n = Number(h);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`[orphans] --min-age-hours must be a non-negative number, got ${h}`);
    process.exit(2);
  }
  return n * 60 * 60 * 1000;
})();

const BACKUP_DIR = ".repair-backups";
const USERS_PER_PAGE = 1000;
const LIST_PAGE_SIZE = 100; // Supabase caps list() at 100 per call
const MAX_LIST_PAGES = 500;
const MAX_FOLDER_DEPTH = 4;
const REMOVE_BATCH_SIZE = 50;
const CSV_COUNT_TOLERANCE = 5;
/** Print every orphan row for a bucket when it has this many or fewer. */
const FULL_LIST_THRESHOLD = 25;

function argValue(flag: string): string | null {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`[orphans] ${flag} needs a value`);
    process.exit(2);
  }
  return v;
}

function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fail(msg: string): never {
  console.error(`[orphans] FAILED: ${msg}`);
  process.exit(1);
}

// ── auth.users ───────────────────────────────────────────────────────────────

async function liveUserIds(admin: Admin): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) fail(`listUsers page ${page}: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) if (u?.id) ids.add(u.id);
    if (users.length < USERS_PER_PAGE) break;
  }
  return ids;
}

// ── reference set ────────────────────────────────────────────────────────────

type RefSource = {
  label: string;
  /** Every stored value from this source, in whatever shape the column holds. */
  values: () => Promise<(string | null | undefined)[]>;
  /** The bucket a bare path from this source lives in. */
  bareBucket?: string;
};

function refSources(admin: Admin): RefSource[] {
  const page = <T>(table: string, select: string, filter?: (q: any) => any) =>
    selectAllRows<T>((from, to) => {
      let q = admin.from(table).select(select);
      if (filter) q = filter(q);
      return q.order("id").range(from, to);
    });

  return [
    {
      label: "memories.photo_url",
      bareBucket: "memory-photos",
      values: async () =>
        (await page<{ photo_url: string | null }>("memories", "id, photo_url")).map((r) => r.photo_url),
    },
    {
      label: "memories.book_cover_url",
      values: async () =>
        (await page<{ book_cover_url: string | null }>("memories", "id, book_cover_url")).map((r) => r.book_cover_url),
    },
    {
      label: "children.avatar_url",
      bareBucket: "memories",
      values: async () =>
        (await page<{ avatar_url: string | null }>("children", "id, avatar_url")).map((r) => r.avatar_url),
    },
    {
      label: "profiles.family_photo_url",
      bareBucket: "family-photos",
      values: async () =>
        (await page<{ family_photo_url: string | null }>("profiles", "id, family_photo_url")).map((r) => r.family_photo_url),
    },
    {
      label: "year_archive_certificates.certificate_url",
      bareBucket: "year-certificates",
      values: async () =>
        (await page<{ certificate_url: string | null }>("year_archive_certificates", "id, certificate_url")).map((r) => r.certificate_url),
    },
    {
      // The cover upload stores a ten-year signed URL, or the bare path
      // `<userId>/cover.jpg` when signing fails, and lib/photo-url.ts
      // coverBucketFor() reads a bare value as yearbook-covers. The reader
      // falls back to profiles.family_photo_url (already a source above) when
      // no cover row exists, never to the deterministic path, so a cover file
      // with no cover_photo row is genuinely unreachable.
      label: "yearbook_content cover_photo",
      bareBucket: "yearbook-covers",
      values: async () =>
        (await page<{ content: string | null }>("yearbook_content", "id, content", (q) => q.eq("content_type", "cover_photo"))).map((r) => r.content),
    },
    {
      // Legacy memory_photo events predate the memories table and are still
      // rendered through lib/memory-leaves.ts, photo and all.
      label: "app_events memory_photo payload.photo_url",
      bareBucket: "memory-photos",
      values: async () =>
        (await page<{ payload: { photo_url?: string | null } | null }>("app_events", "id, payload", (q) => q.eq("type", "memory_photo"))).map((r) => r.payload?.photo_url ?? null),
    },
  ];
}

async function buildReferenceSet(admin: Admin): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const src of refSources(admin)) {
    let values: (string | null | undefined)[];
    try {
      values = await src.values();
    } catch (e) {
      fail(`reading ${src.label}: ${(e as Error).message}`);
    }
    let refs = 0;
    for (const v of values) {
      const ref = normalizeStorageRef(v, { bareBucket: src.bareBucket });
      if (!ref) continue;
      referenced.add(refKey(ref.bucket, ref.path));
      refs++;
    }
    console.log(`[orphans] refs: ${src.label}: ${values.length} rows, ${refs} storage references`);
  }
  return referenced;
}

// ── storage listing ──────────────────────────────────────────────────────────

type ListEntry = {
  name?: string | null;
  id?: string | null;
  created_at?: string | null;
  metadata?: { size?: number | null } | null;
};

const LIST_RETRIES = 4;
const LIST_RETRY_BASE_MS = 1000;
/** Folders listed at once. Thousands of one-per-family folders take minutes serially. */
const LIST_CONCURRENCY = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One page of list(), retried on transient failures (gateway timeouts and
 * the like) with backoff. A failure that survives every retry is thrown, so
 * the caller can refuse to act on a partial picture. A real error is not
 * retried into silence: it is thrown with its message.
 */
async function listPage(admin: Admin, bucket: string, prefix: string, offset: number): Promise<ListEntry[]> {
  let lastMessage = "";
  for (let attempt = 1; attempt <= LIST_RETRIES; attempt++) {
    try {
      const { data, error } = await admin.storage
        .from(bucket)
        .list(prefix, { limit: LIST_PAGE_SIZE, offset });
      if (!error) return (data ?? []) as ListEntry[];
      lastMessage = error.message;
    } catch (e) {
      lastMessage = (e as Error).message;
    }
    if (attempt < LIST_RETRIES) {
      const wait = LIST_RETRY_BASE_MS * 3 ** (attempt - 1);
      console.warn(`[orphans] ${bucket}/${prefix || "<root>"} offset ${offset}: ${lastMessage}; retry ${attempt}/${LIST_RETRIES - 1} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error(`${bucket}/${prefix || "<root>"}: list failed at offset ${offset} after ${LIST_RETRIES} attempts: ${lastMessage}`);
}

/** Run `fn` over `items`, at most `limit` at a time, keeping every result. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Every object under `prefix` in `bucket`, walking pseudo-folders (entries
 * with a null id) down to MAX_FOLDER_DEPTH. Throws on any listing error so
 * the caller can refuse to act on a partial picture.
 */
async function listTree(admin: Admin, bucket: string, prefix: string, depth = 0): Promise<ObjectRecord[]> {
  if (depth > MAX_FOLDER_DEPTH) {
    throw new Error(`${bucket}/${prefix}: folders nested deeper than ${MAX_FOLDER_DEPTH}`);
  }
  const files: ObjectRecord[] = [];
  const folders: string[] = [];
  let offset = 0;
  let finished = false;
  for (let page = 0; page < MAX_LIST_PAGES && !finished; page++) {
    const entries = await listPage(admin, bucket, prefix, offset);
    for (const entry of entries) {
      const name = entry?.name;
      if (!name) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (!entry.id) {
        folders.push(path); // a pseudo-folder, walked below
        continue;
      }
      files.push({
        bucket,
        path,
        size: Number(entry.metadata?.size ?? 0) || 0,
        createdAt: entry.created_at ?? null,
      });
    }
    if (entries.length < LIST_PAGE_SIZE) finished = true;
    else offset += LIST_PAGE_SIZE;
  }
  if (!finished) {
    throw new Error(`${bucket}/${prefix || "<root>"}: still returning full pages after ${MAX_LIST_PAGES} pages`);
  }

  const nested = await mapLimit(folders, LIST_CONCURRENCY, (folder) => listTree(admin, bucket, folder, depth + 1));
  for (const list of nested) files.push(...list);
  return files;
}

/** Every object in every scanned bucket, or exit 1. Never a partial answer. */
async function listAllScanned(admin: Admin): Promise<Map<string, ObjectRecord[]>> {
  const byBucket = new Map<string, ObjectRecord[]>();
  for (const bucket of SCANNED_BUCKETS) {
    try {
      const objects = await listTree(admin, bucket, "");
      byBucket.set(bucket, objects);
      console.log(`[orphans] listed ${bucket}: ${objects.length} object(s)`);
    } catch (e) {
      fail(`listing ${bucket}: ${(e as Error).message}. Nothing was classified or deleted.`);
    }
  }
  return byBucket;
}

// ── scan ─────────────────────────────────────────────────────────────────────

type Scan = {
  rows: Classified[];
  orphans: Classified[];
  totalsBefore: Map<string, number>;
};

async function scan(admin: Admin): Promise<Scan> {
  const liveUsers = await liveUserIds(admin);
  console.log(`[orphans] ${liveUsers.size} live accounts in auth.users`);

  const referenced = await buildReferenceSet(admin);
  console.log(`[orphans] ${referenced.size} distinct referenced objects`);

  const byBucket = await listAllScanned(admin);
  const now = Date.now();
  const rows: Classified[] = [];
  const totalsBefore = new Map<string, number>();
  for (const [bucket, objects] of byBucket) {
    totalsBefore.set(bucket, objects.length);
    for (const o of objects) rows.push(classifyObject(o, { referenced, liveUsers, now, minAgeMs: MIN_AGE_MS }));
  }
  return { rows, orphans: rows.filter((r) => r.orphan), totalsBefore };
}

// ── printing ─────────────────────────────────────────────────────────────────

function table(headers: string[], rows: (string | number | boolean)[][]): string {
  const cells = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const line = (r: string[]) => "  " + r.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(cells[0]), "  " + widths.map((w) => "-".repeat(w)).join("  "), ...cells.slice(1).map(line)].join("\n");
}

function printScan(s: Scan): void {
  const summary = summarizeOrphans(s.orphans, SCANNED_BUCKETS);
  console.log("\nOrphans per bucket (unreferenced, older than the age floor):\n");
  console.log(
    table(
      ["bucket", "orphans", "bytes", "families", "of objects"],
      summary.map((b) => [b.bucket, b.count, formatBytes(b.bytes), b.families, s.totalsBefore.get(b.bucket) ?? 0]),
    ),
  );

  const verdicts = new Map<string, number>();
  for (const r of s.rows) verdicts.set(r.verdict, (verdicts.get(r.verdict) ?? 0) + 1);
  console.log(
    "\nEvery object, by verdict: " +
      [...verdicts.entries()].map(([k, v]) => `${k} ${v}`).join(", "),
  );

  for (const bucket of SCANNED_BUCKETS) {
    const list = s.orphans.filter((r) => r.bucket === bucket);
    if (list.length === 0) continue;
    const shown = list.length <= FULL_LIST_THRESHOLD ? list : list.slice(0, 10);
    console.log(`\n${bucket}: ${list.length} orphan(s)${shown.length < list.length ? `, first ${shown.length} (the rest are in the CSV)` : ""}:\n`);
    console.log(
      table(
        ["path", "bytes", "created_at", "owner_exists", "reason"],
        shown.map((r) => [r.path, r.size, (r.createdAt ?? "").slice(0, 19), r.ownerExists, r.verdict]),
      ),
    );
  }
  console.log("");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function dryRun(admin: Admin): Promise<void> {
  console.log("[orphans] DRY RUN: nothing will be deleted (pass --apply --yes to delete)");
  const s = await scan(admin);
  printScan(s);

  mkdirSync(BACKUP_DIR, { recursive: true });
  const csvPath = join(BACKUP_DIR, `orphan-photos-${localDateStr()}.csv`);
  writeFileSync(csvPath, orphansToCsv(s.orphans));
  console.log(`[orphans] wrote ${s.orphans.length} orphan row(s) to ${csvPath}`);
}

async function apply(admin: Admin): Promise<void> {
  console.log("[orphans] APPLY: deleted files CANNOT be recovered. Storage keeps no trash.");
  if (!YES) fail("--apply needs --yes as well, after you have read the dry run.");

  const csvPath = CSV_ARG ?? join(BACKUP_DIR, `orphan-photos-${localDateStr()}.csv`);
  if (!existsSync(csvPath)) fail(`no dry-run CSV at ${csvPath}. Run the dry run first, or pass --csv <path>.`);
  const csvCount = csvRowCount(readFileSync(csvPath, "utf8"));

  const s = await scan(admin);
  printScan(s);

  const diff = Math.abs(s.orphans.length - csvCount);
  if (diff > CSV_COUNT_TOLERANCE) {
    fail(`live scan found ${s.orphans.length} orphan(s) but ${csvPath} holds ${csvCount}; that differs by ${diff}, more than ${CSV_COUNT_TOLERANCE}. Re-run the dry run and read it again.`);
  }
  console.log(`[orphans] live scan ${s.orphans.length} vs CSV ${csvCount}: within tolerance, proceeding`);

  let removedTotal = 0;
  for (const bucket of SCANNED_BUCKETS) {
    const paths = s.orphans.filter((r) => r.bucket === bucket).map((r) => r.path);
    if (paths.length === 0) continue;
    const batches = Math.ceil(paths.length / REMOVE_BATCH_SIZE);
    for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
      const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
      const n = i / REMOVE_BATCH_SIZE + 1;
      const { data, error } = await admin.storage.from(bucket).remove(batch);
      if (error) {
        fail(`${bucket} batch ${n}/${batches}: ${error.message}. ${removedTotal} file(s) were removed before this; re-run to continue.`);
      }
      const removed = Array.isArray(data) ? data.length : batch.length;
      removedTotal += removed;
      console.log(`[orphans] ${bucket} batch ${n}/${batches}: removed ${removed} of ${batch.length}`);
      if (removed < batch.length) {
        fail(`${bucket} batch ${n}/${batches}: storage reported ${removed} removed of ${batch.length}. Stopping; re-run the dry run to see what is left.`);
      }
    }
  }

  console.log(`[orphans] removed ${removedTotal} file(s). Recounting...`);
  const after = await listAllScanned(admin);
  console.log("\nObjects per bucket, before and after:\n");
  console.log(
    table(
      ["bucket", "before", "after", "removed"],
      SCANNED_BUCKETS.map((b) => {
        const before = s.totalsBefore.get(b) ?? 0;
        const now = after.get(b)?.length ?? 0;
        return [b, before, now, before - now];
      }),
    ),
  );
}

async function main() {
  const admin = getSupabaseAdmin();
  if (APPLY) await apply(admin);
  else await dryRun(admin);
}

main().catch((e) => {
  console.error("[orphans] fatal:", e);
  process.exit(1);
});
