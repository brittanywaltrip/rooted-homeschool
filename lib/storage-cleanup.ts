// Deleting a family's uploaded files, by asking storage what is in their
// folder instead of parsing urls.
//
// THE BUG THIS REPLACES
// app/api/account/delete/route.ts used to collect photo paths by scanning
// every memories.photo_url for one marker string,
// "/object/public/memory-photos/", and slicing the path out of whatever
// followed. That worked while the bucket was public. Storage went private in
// April 2026, so rows written after that hold SIGNED urls of the shape
// /object/sign/memory-photos/<path>?token=..., which the public marker never
// matches. Measured against production on August 22, 2026: 647 of 1025
// photo_url values were signed-style, so roughly two thirds of a deleting
// family's photo files stayed in the bucket after their database rows were
// gone. The memories, yearbook-covers and year-certificates buckets were
// never swept at all, and the family photo was removed by guessing three
// filenames (family.jpg / .png / .webp).
//
// WHY LISTING THE FOLDER BEATS PARSING URLS
// Every user-uploaded object in every bucket is stored at
// <userId>/<filename>, exactly one level deep. Verified across all 1,889
// production objects. So the user's folder IS the complete, authoritative
// list of their files, and we never have to know what a url looked like at
// the time it was written. It also catches files that no database row points
// at any more, which url parsing structurally cannot:
//   - replaced family photos (each upload writes a new filename)
//   - failed or abandoned uploads that never got a row
//   - photos whose memory row was deleted months ago
// A url format change can silently break parsing. It cannot break list().

/**
 * Every bucket that stores user-owned files under a <userId>/ prefix.
 *
 * The `media` bucket is DELIBERATELY EXCLUDED. It holds app marketing assets
 * at the bucket root (hero.mp4 and friends), not user data. There is no
 * <userId>/ folder in it to sweep, and sweeping it by mistake would delete
 * shared site assets for everyone.
 */
export const USER_SCOPED_BUCKETS = [
  "memory-photos",
  "family-photos",
  "memories",
  "yearbook-covers",
  "year-certificates",
] as const;

export type UserScopedBucket = (typeof USER_SCOPED_BUCKETS)[number];

/** Supabase caps list() at 100 rows per call regardless of a higher limit. */
const LIST_PAGE_SIZE = 100;

/**
 * Hard ceiling on list() pages. At 100 files a page this is 20,000 files,
 * far beyond any real family. It exists so a storage bug that keeps
 * returning full pages cannot spin forever inside a request handler.
 */
const MAX_LIST_PAGES = 200;

/** Supabase's remove() takes an array; keep each call modest. */
const REMOVE_BATCH_SIZE = 50;

/**
 * Supabase creates this zero-byte object to make an empty "folder" visible.
 * It is not a user file and removing it is pointless noise.
 */
const EMPTY_FOLDER_PLACEHOLDER = ".emptyFolderPlaceholder";

export type SweepResult = {
  bucket: string;
  /** Files found in the user's folder. */
  found: number;
  /** Files storage confirmed removed. Equals `found` on a clean sweep. */
  removed: number;
  /** Human-readable failures. Empty on a clean sweep. */
  errors: string[];
};

type StorageListEntry = { name?: string | null; id?: string | null };

type StorageErrorLike = { message?: string | null } | null;

/**
 * The slice of a Supabase client this module touches. Typing the parameter
 * structurally (rather than as SupabaseClient) keeps the unit tests able to
 * pass a fake without casting, while a real SupabaseClient still satisfies it.
 */
export type StorageCapableClient = {
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options: { limit: number; offset: number },
      ): Promise<{ data: StorageListEntry[] | null; error: StorageErrorLike }>;
      remove(
        paths: string[],
      ): Promise<{ data?: unknown; error: StorageErrorLike }>;
    };
  };
};

function errText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Every file in `<bucket>/<userId>/`, as full storage paths.
 *
 * Pages through list() until a short page comes back. Never throws: a caller
 * mid-deletion has to keep going, so a failure is reported in `errors` and
 * whatever was listed before it is still returned.
 */
export async function listUserFiles(
  client: StorageCapableClient,
  bucket: string,
  userId: string,
): Promise<{ paths: string[]; errors: string[] }> {
  const paths: string[] = [];
  const errors: string[] = [];

  let offset = 0;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    let entries: StorageListEntry[];
    try {
      const { data, error } = await client.storage
        .from(bucket)
        .list(userId, { limit: LIST_PAGE_SIZE, offset });
      if (error) {
        errors.push(`${bucket}: list failed at offset ${offset}: ${errText(error)}`);
        return { paths, errors };
      }
      entries = data ?? [];
    } catch (e) {
      errors.push(`${bucket}: list threw at offset ${offset}: ${errText(e)}`);
      return { paths, errors };
    }

    for (const entry of entries) {
      const name = entry?.name;
      if (!name) continue;
      if (name === EMPTY_FOLDER_PLACEHOLDER) continue;
      paths.push(`${userId}/${name}`);
    }

    if (entries.length < LIST_PAGE_SIZE) return { paths, errors };
    offset += LIST_PAGE_SIZE;
  }

  errors.push(
    `${bucket}: stopped after ${MAX_LIST_PAGES} list pages (${paths.length} files); folder may be incompletely swept`,
  );
  return { paths, errors };
}

/**
 * List then remove everything in one bucket's `<userId>/` folder.
 *
 * Never throws. `found > removed` or a non-empty `errors` means files were
 * left behind and the caller should report it.
 */
export async function sweepBucket(
  client: StorageCapableClient,
  bucket: string,
  userId: string,
  opts: { dryRun?: boolean } = {},
): Promise<SweepResult> {
  const { paths, errors } = await listUserFiles(client, bucket, userId);
  const result: SweepResult = {
    bucket,
    found: paths.length,
    removed: 0,
    errors: [...errors],
  };

  if (opts.dryRun) return result;

  for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
    try {
      const { error } = await client.storage.from(bucket).remove(batch);
      if (error) {
        result.errors.push(
          `${bucket}: remove failed for ${batch.length} file(s): ${errText(error)}`,
        );
        continue;
      }
      result.removed += batch.length;
    } catch (e) {
      result.errors.push(
        `${bucket}: remove threw for ${batch.length} file(s): ${errText(e)}`,
      );
    }
  }

  return result;
}

/**
 * Sweep every user-scoped bucket for one user.
 *
 * Buckets are swept one after another and a failure in one is recorded, not
 * rethrown, so the remaining buckets are always attempted.
 */
export async function deleteAllUserStorage(
  client: StorageCapableClient,
  userId: string,
  opts: { dryRun?: boolean } = {},
): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  for (const bucket of USER_SCOPED_BUCKETS) {
    results.push(await sweepBucket(client, bucket, userId, opts));
  }
  return results;
}

/** Files that were found but not removed, across every bucket. */
export function unremovedCount(results: SweepResult[]): number {
  return results.reduce((sum, r) => sum + (r.found - r.removed), 0);
}

/** One-line log summary of a sweep. */
export function summarize(results: SweepResult[]): string {
  const found = results.reduce((s, r) => s + r.found, 0);
  const removed = results.reduce((s, r) => s + r.removed, 0);
  const errors = results.reduce((s, r) => s + r.errors.length, 0);
  const perBucket = results
    .map((r) => `${r.bucket} ${r.removed}/${r.found}`)
    .join(", ");
  return `${removed}/${found} files removed across ${results.length} buckets (${perBucket}); ${errors} error(s)`;
}
