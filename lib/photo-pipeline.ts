// Photo capture pipeline: decode, resize, encode, upload.
//
// Everything here is written around one rule: a photo save must never leave a
// spinner running forever. The old compressImage() built a Promise that could
// only resolve, so an undecodable file (HEIC on Android Chrome, or the
// zero-byte placeholder the Android picker hands back for a cloud-only Google
// Photos image) meant img.onload never fired, the await never returned, and
// the caller's catch and finally blocks never ran either. Every async step
// below is therefore raced against a timeout and every failure path throws.

import type { SupabaseClient } from "@supabase/supabase-js";

/** A failure the caller can show to a family verbatim via `userMessage`. */
export class PhotoReadError extends Error {
  // Written as an explicit field rather than a `public userMessage` parameter
  // property: node --test runs these files in strip-only mode, which rejects
  // parameter properties outright.
  userMessage: string;

  constructor(message: string, userMessage: string) {
    super(message);
    this.name = "PhotoReadError";
    this.userMessage = userMessage;
  }
}

export type PreparedPhoto = { file: File; width: number; height: number };

export const TEN_YEARS_SECONDS = 60 * 60 * 24 * 365 * 10;
const DECODE_TIMEOUT_MS = 20000;
const HEIC_TIMEOUT_MS = 30000;
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.82;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MEMORY_PHOTOS_BUCKET = "memory-photos";

const EMPTY_FILE_MESSAGE =
  "That photo didn't come through. If it's stored in Google Photos or iCloud, download it to your device first, then try again.";
const TOO_LARGE_MESSAGE = "That photo is too large to upload. Try a smaller one.";
const HEIC_MESSAGE =
  "Your phone saved this photo in a format this browser can't read (HEIC). Try switching your camera to JPEG in your phone's camera settings, or share the photo to yourself first to convert it.";
const UNREADABLE_MESSAGE =
  "We couldn't read that photo. Try a different one, or download it to your device first if it's stored in the cloud.";
const UPLOAD_FAILED_MESSAGE = "Upload failed. Check your connection and try again.";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reject with a timeout error if `work` hasn't settled in `ms`. The timer is
 * always cleared, so a slow-but-successful decode can't hold the process open.
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

/**
 * Decode via `new Image()` for browsers without createImageBitmap (older
 * Safari). BOTH onload and onerror are wired, the whole thing is raced against
 * the decode timeout, and the object URL is revoked on every exit path.
 */
function decodeWithImageElement(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(url);
  };

  const load = new Promise<DecodedImage>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      revoke();
      if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) {
        reject(new Error("Image element loaded with no intrinsic size"));
        return;
      }
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => {},
      });
    };
    img.onerror = () => {
      revoke();
      reject(new Error("Image element could not decode the file"));
    };
    img.src = url;
  });

  // Covers the timeout branch, where neither handler ever fires.
  return withTimeout(load, DECODE_TIMEOUT_MS, "Image decode").catch((err) => {
    revoke();
    throw err;
  });
}

/**
 * Decode a blob to something drawable. createImageBitmap is preferred: it
 * rejects properly on undecodable data and decodes once, where new Image()
 * decodes again at draw time.
 */
async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap !== "function") {
    return decodeWithImageElement(blob);
  }
  const bitmap = await withTimeout(createImageBitmap(blob), DECODE_TIMEOUT_MS, "Image decode");
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => {
      if (typeof bitmap.close === "function") bitmap.close();
    },
  };
}

function looksLikeHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  return type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Last resort for iPhone-format photos: convert to JPEG in the browser, then
 * decode the result once. heic2any is a heavy wasm-ish decoder, so it is
 * imported lazily and costs nothing unless a family actually hands us a HEIC.
 */
async function decodeHeic(file: File): Promise<DecodedImage> {
  const converted = await withTimeout(
    (async () => {
      const heic2any = (await import("heic2any")).default;
      return heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    })(),
    HEIC_TIMEOUT_MS,
    "HEIC conversion",
  );
  const blob = Array.isArray(converted) ? converted[0] : converted;
  if (!blob) throw new Error("HEIC conversion returned no image");
  return decodeImage(blob);
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return `${base || "photo"}.jpg`;
}

/**
 * Decode, downscale, and re-encode a picked file as JPEG.
 *
 * This function must NEVER hang: every caller awaits it behind a "Saving..."
 * spinner, and a promise that never settles skips the caller's catch AND
 * finally, so the spinner runs forever and nothing is ever logged. It either
 * resolves with a prepared photo or throws PhotoReadError, whose `userMessage`
 * is safe to show a family as-is.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.size === 0) {
    throw new PhotoReadError(`Zero-byte file: ${file.name}`, EMPTY_FILE_MESSAGE);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new PhotoReadError(`File is ${file.size} bytes, over the ${MAX_FILE_BYTES} cap`, TOO_LARGE_MESSAGE);
  }

  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(file);
  } catch (err) {
    if (!looksLikeHeic(file)) {
      throw new PhotoReadError(`Decode failed for ${file.name}: ${describe(err)}`, UNREADABLE_MESSAGE);
    }
    try {
      decoded = await decodeHeic(file);
    } catch (heicErr) {
      throw new PhotoReadError(
        `HEIC fallback failed for ${file.name}: ${describe(heicErr)} (decode: ${describe(err)})`,
        HEIC_MESSAGE,
      );
    }
  }

  // Natural size, captured before the downscale. This is what goes into
  // memories.photo_width / photo_height so the yearbook lays photos out by
  // their real shape.
  const { width, height } = decoded;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  let blob: Blob | null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new PhotoReadError("canvas.getContext('2d') returned null", UNREADABLE_MESSAGE);
    }
    ctx.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);
    decoded.release();

    blob = await withTimeout(
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)),
      DECODE_TIMEOUT_MS,
      "JPEG encode",
    );
  } catch (err) {
    decoded.release();
    if (err instanceof PhotoReadError) throw err;
    throw new PhotoReadError(`Encode failed for ${file.name}: ${describe(err)}`, UNREADABLE_MESSAGE);
  }

  if (!blob) {
    throw new PhotoReadError(`canvas.toBlob returned null for ${file.name}`, UNREADABLE_MESSAGE);
  }

  return {
    file: new File([blob], jpegName(file.name), { type: "image/jpeg" }),
    width,
    height,
  };
}

/**
 * Prepare a picked file and put it in the memory-photos bucket, returning the
 * signed URL and the natural dimensions the memories row records.
 *
 * The client is a parameter, not the "@/lib/supabase" singleton, because
 * app/dashboard/layout.tsx builds its own with createSupabaseBrowserClient().
 *
 * PhotoReadError from preparePhoto bubbles up untouched so the caller can show
 * its userMessage; an upload failure throws a plain Error instead.
 */
export async function uploadMemoryPhoto(
  client: SupabaseClient,
  userId: string,
  file: File,
): Promise<{ photoUrl: string; width: number; height: number }> {
  const prepared = await preparePhoto(file);

  const safeName = prepared.file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const path = `${userId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await client.storage
    .from(MEMORY_PHOTOS_BUCKET)
    .upload(path, prepared.file, { contentType: "image/jpeg", upsert: false });
  if (upErr) {
    console.warn(`[photo-pipeline] upload failed for ${path}: ${upErr.message}`);
    throw new Error(UPLOAD_FAILED_MESSAGE);
  }

  // Imported lazily so this module stays loadable outside a browser bundle:
  // photo-url pulls in the service-role admin client at module scope.
  const { signedPhotoUrl } = await import("./photo-url.ts");
  const signed = await signedPhotoUrl(client, MEMORY_PHOTOS_BUCKET, path, TEN_YEARS_SECONDS);

  return { photoUrl: signed ?? path, width: prepared.width, height: prepared.height };
}
