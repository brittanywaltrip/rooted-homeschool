import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { signedPhotoUrl, signedPhotoUrls } from "@/lib/photo-url";

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

