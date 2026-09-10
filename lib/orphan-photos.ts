// Orphan detection for the photo buckets: pure functions only, so
// scripts/clean-orphan-photos.ts can be unit tested without a Supabase client.
//
// WHY THERE IS A BACKLOG
// When a family deletes a memory, the app removes the row and calls
// storage.remove() for the photo. Until 2026-09-10, storage.objects had a
// DELETE policy only for the old `memories` bucket, so removes against
// memory-photos, family-photos and yearbook-covers matched zero rows and
// supabase-js resolved without an error. The row went; the file stayed.
// Migration 20260910000000 added the policies. This module finds what those
// silent failures left behind.
//
// THE RULE
// An object is an orphan when no database row points at it AND it is older
// than MIN_ORPHAN_AGE_MS, so an upload whose row is still being written is
// never touched. Objects at a bucket root (no <userId>/ folder) are app
// assets, never orphans: media/hero.mp4 is the marketing video, not a
// family's file. A referenced object is never an orphan, whatever its age.
//
// No "@/" imports here: node --test runs this file with type stripping only.

export const SCANNED_BUCKETS = [
  "memory-photos",
  "family-photos",
  "yearbook-covers",
  "media",
] as const;

export type ScannedBucket = (typeof SCANNED_BUCKETS)[number];

/** An object older than this with no reference is an orphan. */
export const MIN_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** Supabase's zero-byte marker that makes an empty "folder" listable. */
export const EMPTY_FOLDER_PLACEHOLDER = ".emptyFolderPlaceholder";

export type StorageRef = { bucket: string; path: string };

/** The one key shape everything compares on: `<bucket>/<path>`. */
export function refKey(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

function stripQuery(s: string): string {
  const i = s.search(/[?#]/);
  return i === -1 ? s : s.slice(0, i);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Where a signed or public storage URL names its bucket. The optional group
 * covers /object/public/, /object/sign/ and /object/authenticated/; the older
 * unprefixed /object/<bucket>/ shape falls through to the bare bucket match.
 */
const STORAGE_URL_RE =
  /\/object\/(?:public\/|sign\/|authenticated\/)?([^/?#]+)\/([^?#]+)/;

/**
 * Normalize a stored value to bucket/path.
 *
 * Accepts a public URL, a signed URL (the ?token= is dropped), the older
 * unprefixed /object/<bucket>/ shape, and a bare path. A bare path carries no
 * bucket, so the caller says which bucket its column writes to via
 * `bareBucket`; without it a bare path is not a reference. External URLs
 * (Google avatars, Open Library covers) return null: they are not ours.
 */
export function normalizeStorageRef(
  value: string | null | undefined,
  opts: { bareBucket?: string } = {},
): StorageRef | null {
  if (!value) return null;
  const input = value.trim();
  if (!input) return null;

  const m = input.match(STORAGE_URL_RE);
  if (m) {
    const path = safeDecode(stripQuery(m[2]));
    if (!path) return null;
    return { bucket: m[1], path };
  }

  // A URL that is not a storage URL is external and never a reference.
  if (input.includes("://") || input.startsWith("//")) return null;

  if (!opts.bareBucket) return null;
  const path = stripQuery(input).replace(/^\/+/, "");
  if (!path) return null;
  return { bucket: opts.bareBucket, path };
}

/** The `<userId>` folder an object sits in, or null for a bucket-root file. */
export function ownerOf(path: string): string | null {
  const i = path.indexOf("/");
  return i <= 0 ? null : path.slice(0, i);
}

export type ObjectRecord = {
  bucket: string;
  path: string;
  /** Bytes, 0 when storage did not report a size. */
  size: number;
  /** ISO timestamp from storage, null when it did not report one. */
  createdAt: string | null;
};

export type Verdict =
  | "referenced"
  | "recent"
  | "root_asset"
  | "placeholder"
  | "unreferenced"
  | "owner_missing";

export type Classified = ObjectRecord & {
  ownerId: string | null;
  ownerExists: boolean;
  verdict: Verdict;
  /** True only for `unreferenced` and `owner_missing`. */
  orphan: boolean;
};

export type ClassifyContext = {
  /** refKey() of every object some database row points at. */
  referenced: ReadonlySet<string>;
  /** Every id in auth.users. */
  liveUsers: ReadonlySet<string>;
  /** Date.now() at scan time, injected so the age rule is testable. */
  now: number;
  minAgeMs?: number;
};

/**
 * Decide what one object is. Order matters: a placeholder or root asset is
 * never an orphan whatever else is true; a referenced object is never an
 * orphan whatever its age; an object too young to judge is left alone even
 * when nothing points at it yet. An unparseable created_at counts as recent,
 * because "I cannot tell how old this is" must not become "delete it".
 */
export function classifyObject(obj: ObjectRecord, ctx: ClassifyContext): Classified {
  const ownerId = ownerOf(obj.path);
  const ownerExists = ownerId !== null && ctx.liveUsers.has(ownerId);
  const base = { ...obj, ownerId, ownerExists };
  const name = obj.path.slice(obj.path.lastIndexOf("/") + 1);

  if (name === EMPTY_FOLDER_PLACEHOLDER) {
    return { ...base, verdict: "placeholder", orphan: false };
  }
  if (ownerId === null) {
    return { ...base, verdict: "root_asset", orphan: false };
  }
  if (ctx.referenced.has(refKey(obj.bucket, obj.path))) {
    return { ...base, verdict: "referenced", orphan: false };
  }

  const created = obj.createdAt ? Date.parse(obj.createdAt) : Number.NaN;
  const minAge = ctx.minAgeMs ?? MIN_ORPHAN_AGE_MS;
  if (Number.isNaN(created) || ctx.now - created < minAge) {
    return { ...base, verdict: "recent", orphan: false };
  }

  return {
    ...base,
    verdict: ownerExists ? "unreferenced" : "owner_missing",
    orphan: true,
  };
}

export type BucketSummary = {
  bucket: string;
  count: number;
  bytes: number;
  /** Distinct owner folders among the orphans. */
  families: number;
};

/** Per-bucket totals of the orphans only, one row per bucket, in the order given. */
export function summarizeOrphans(
  rows: readonly Classified[],
  buckets: readonly string[],
): BucketSummary[] {
  return buckets.map((bucket) => {
    const owners = new Set<string>();
    let count = 0;
    let bytes = 0;
    for (const r of rows) {
      if (!r.orphan || r.bucket !== bucket) continue;
      count++;
      bytes += r.size;
      if (r.ownerId) owners.add(r.ownerId);
    }
    return { bucket, count, bytes, families: owners.size };
  });
}

export const CSV_HEADER = [
  "bucket",
  "path",
  "size",
  "created_at",
  "owner_id",
  "owner_exists",
  "reason",
] as const;

function csvCell(v: string | number | boolean | null): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The orphan rows only, as CSV with CSV_HEADER. */
export function orphansToCsv(rows: readonly Classified[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    if (!r.orphan) continue;
    lines.push(
      [r.bucket, r.path, r.size, r.createdAt ?? "", r.ownerId ?? "", r.ownerExists, r.verdict]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * How many data rows a dry-run CSV holds. Counts physical lines after the
 * header, which is exact for orphansToCsv output: no field this script
 * writes can contain a newline (paths and timestamps never do).
 */
export function csvRowCount(text: string): number {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
