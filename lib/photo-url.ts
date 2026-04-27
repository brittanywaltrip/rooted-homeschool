// Signed-URL helper for Supabase Storage.
//
// Storage buckets are currently public, but every render site goes through
// these helpers so the Step 2 flip to private is a config-only change.
// `extractPath` accepts URLs in any of the historical Supabase shapes plus
// signed-URL shapes and bare paths; the signing functions never throw and
// return null on any failure so callers can fall back gracefully.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function stripQuery(s: string): string {
  const i = s.indexOf("?");
  return i === -1 ? s : s.slice(0, i);
}

export function extractPath(urlOrPath: string | null | undefined, bucket: string): string | null {
  if (!urlOrPath) return null;
  const input = urlOrPath.trim();
  if (!input) return null;

  const markers = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/${bucket}/`,
    `/object/public/${bucket}/`,
    `/object/sign/${bucket}/`,
    `/object/${bucket}/`,
  ];
  for (const marker of markers) {
    const idx = input.indexOf(marker);
    if (idx !== -1) {
      return stripQuery(input.slice(idx + marker.length));
    }
  }

  // No marker — treat as a bare path if the input has no protocol/host.
  // External URLs (e.g. Google avatars, picsum) hit this branch and we
  // return null so the caller can pass them through unchanged.
  if (input.includes("://") || input.startsWith("//")) return null;
  return stripQuery(input);
}

export async function signedPhotoUrl(
  supabase: SupabaseClient,
  bucket: string,
  urlOrPath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const path = extractPath(urlOrPath, bucket);
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) {
      console.warn(`[photo-url] sign failed for ${bucket}/${path}: ${error?.message ?? "no signedUrl"}`);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.warn(`[photo-url] sign threw for ${bucket}/${path}: ${(err as Error).message}`);
    return null;
  }
}

export async function signedPhotoUrls(
  supabase: SupabaseClient,
  bucket: string,
  urlsOrPaths: string[],
  expiresInSeconds = 3600
): Promise<(string | null)[]> {
  const paths = urlsOrPaths.map((u) => extractPath(u, bucket));
  const valid = paths.filter((p): p is string => !!p);
  if (valid.length === 0) return paths.map(() => null);
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(valid, expiresInSeconds);
    if (error || !data) {
      console.warn(`[photo-url] batch sign failed for ${bucket}: ${error?.message ?? "no data"}`);
      return paths.map(() => null);
    }
    const byPath = new Map<string, string>();
    for (const row of data) {
      if (row.path && row.signedUrl) byPath.set(row.path, row.signedUrl);
    }
    return paths.map((p) => (p ? byPath.get(p) ?? null : null));
  } catch (err) {
    console.warn(`[photo-url] batch sign threw for ${bucket}: ${(err as Error).message}`);
    return paths.map(() => null);
  }
}

export async function signedPhotoUrlAdmin(
  bucket: string,
  urlOrPath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  return signedPhotoUrl(getSupabaseAdmin(), bucket, urlOrPath, expiresInSeconds);
}

export async function signedPhotoUrlsAdmin(
  bucket: string,
  urlsOrPaths: string[],
  expiresInSeconds = 3600
): Promise<(string | null)[]> {
  return signedPhotoUrls(getSupabaseAdmin(), bucket, urlsOrPaths, expiresInSeconds);
}
