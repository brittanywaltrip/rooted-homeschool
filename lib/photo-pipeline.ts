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

/**
 * Which slow step is running, so a caller can say so instead of showing a
 * button that looks broken. "converting" is the one that matters: a wasm HEIC
 * conversion on a phone can run for most of a minute, and until this existed
 * the family had nothing to look at while it did.
 */
export type PhotoStage = "decoding" | "converting" | "encoding" | "uploading";

export const TEN_YEARS_SECONDS = 60 * 60 * 24 * 365 * 10;
// Decode budget. Was 20s, which was generous for a 12MP phone photo and thin
// for the 48MP files the size cap used to refuse outright. A 48MP JPEG decodes
// in a few seconds on a mid-range phone; this covers the slow end of that
// without ever becoming the unbounded wait this file exists to prevent.
const DECODE_TIMEOUT_MS = 45000;
// HEIC conversion budget. Was 30s, and on 2026-09-09 a family lost a drawing
// photo to a conversion that hit exactly that: "HEIC conversion timed out after
// 30000ms" on a 62.jpg that was really HEIC. heic2any decodes in wasm on the
// main thread, so a large HEIC routinely needs longer than a native JPEG
// decode, not less, and a 48MP one on a mid-range phone lands in the tens of
// seconds. 90s covers that; past it the file is not going to convert, and a
// family should be told so rather than watched a spinner. The caller shows
// "Converting your photo" for the whole of it.
const HEIC_TIMEOUT_MS = 90000;
const NETWORK_TIMEOUT_MS = 45000;
/** How long to wait before the one upload retry. */
const UPLOAD_RETRY_DELAY_MS = 1200;
// Upload caps, in pixels on the longest side. Both are print budgets, not
// screen budgets: Lulu prints at 300 PPI, so a photo's printed width in inches
// is its pixel width / 300. The old single 1200px cap printed about 4in, half
// the width of an 8.5in book page, which is why interior photos looked soft.
// 2400px covers an 8in placement on the page; a casewrap cover's front panel is
// 10in once the 0.75in board wrap is added, so covers get 3000px.
//
// The original file is NEVER stored: preparePhoto re-encodes and the picked
// file is discarded, so a photo uploaded under an older, smaller cap cannot be
// recovered at a larger size. Raising these only helps photos uploaded from
// this point forward.
export const MEMORY_MAX_DIMENSION = 2400;  // 8in at 300 PPI
export const COVER_MAX_DIMENSION  = 3000;  // 10in at 300 PPI, casewrap front panel incl. 0.75in wrap
const JPEG_QUALITY = 0.85;
// A ceiling, not a cap on ordinary photos.
//
// This used to be 50MB and it was the FIRST thing a picked file met, before any
// decode. On 2026-09-08 one family was refused three times in five minutes at
// 56MB, 65MB and 99MB: modern phone photos, all of which the pipeline would
// have written down to 2400px on the long side and stored at well under a
// megabyte. The app told a parent her photo was too large for a photo it was
// about to shrink.
//
// What actually risks the tab is not the file's bytes, it is the decoded
// bitmap: width x height x 4. A 48MP photo is ~190MB decoded, which a phone
// browser survives; the file that produced it is 10-100MB depending on format.
// Since the pixel count is only knowable after the decode, the byte number here
// is set to sit above every real still photo (the largest seen in production is
// 99MB, an iPhone ProRAW-sized file) and stop only things that are not photos
// at all: a video, a multi-hundred-megabyte scan, a RAW burst. 200MB is double
// the largest real photo we have ever been handed.
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MEMORY_PHOTOS_BUCKET = "memory-photos";

const EMPTY_FILE_MESSAGE =
  "That photo didn't come through. If it's stored in Google Photos or iCloud, download it to your device first, then try again.";
// Says what actually happened. The old copy, "That photo is too large to
// upload. Try a smaller one.", was wrong twice over: nothing had been uploaded
// yet, and an ordinary phone photo is never too large for this app to store,
// only too large for a browser to open in one piece.
const TOO_LARGE_MESSAGE =
  "That file is bigger than 200 MB, which is more than a browser can open at once. If it's a video or a RAW camera file, try a regular photo instead.";
const HEIC_MESSAGE =
  "Your phone saved this photo in a format this browser can't read (HEIC). Try switching your camera to JPEG in your phone's camera settings, or share the photo to yourself first to convert it.";
const UNREADABLE_MESSAGE =
  "We couldn't read that photo. Try a different one, or download it to your device first if it's stored in the cloud.";
const UPLOAD_FAILED_MESSAGE = "Upload failed. Check your connection and try again.";

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  // Supabase storage errors are plain objects on some paths, and String() on
  // one of those is "[object Object]", which is what the upload warning used to
  // print. Read the fields that actually say something first.
  const raw = (err ?? {}) as { message?: unknown; status?: unknown };
  if (typeof raw.message === "string" && raw.message) {
    return raw.status === undefined ? raw.message : `${raw.message} (status ${String(raw.status)})`;
  }
  return String(err);
}

/**
 * Reject with a timeout error if `work` hasn't settled in `ms`. The timer is
 * always cleared, so a slow-but-successful decode can't hold the process open.
 *
 * `onTimeout` replaces the rejection value on the timeout branch only. Errors
 * from `work` itself always propagate unchanged.
 *
 * Exported for its test. The clearTimeout in the `finally` is the whole point
 * of the helper and the easiest line in this file to lose in a refactor: drop
 * it and every successful decode leaves a live timer behind, which is how a
 * page ends up holding a phone awake after the save is long finished.
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(onTimeout ? onTimeout() : new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * The same race, for network work.
 *
 * Decode was bounded first, but a `finally` block cannot run while an await is
 * still pending, so an UNBOUNDED network call reproduces the original bug
 * exactly: a half-open socket on flaky cellular leaves the caller parked on
 * "Saving 2 of 3..." forever, its catch and finally never reached, nothing
 * logged. Every network wait therefore needs the same treatment decode got.
 *
 * A timeout surfaces as UPLOAD_FAILED_MESSAGE so the family reads copy that
 * already exists rather than a raw timeout string.
 */
function withNetworkTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return withTimeout(work, NETWORK_TIMEOUT_MS, label, () => {
    console.warn(`[photo-pipeline] ${label} timed out after ${NETWORK_TIMEOUT_MS}ms`);
    return new Error(UPLOAD_FAILED_MESSAGE);
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
 *
 * imageOrientation is passed explicitly because its default varies by browser
 * and version. Where it resolves to "none", a portrait phone photo lands on the
 * canvas sideways. "from-image" applies the EXIF rotation, which is what the
 * old new Image() path did and what decodeWithImageElement below still does, so
 * both paths agree. The bitmap is measured AFTER that rotation is applied, so a
 * portrait photo reports portrait width/height and memories.photo_width /
 * photo_height match the shape the family actually sees.
 */
async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap !== "function") {
    return decodeWithImageElement(blob);
  }
  const bitmap = await withTimeout(
    createImageBitmap(blob, { imageOrientation: "from-image" }),
    DECODE_TIMEOUT_MS,
    "Image decode",
  );
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
 * Last resort for any file the browser refused to decode: convert to JPEG in
 * the browser, then decode the result once. heic2any is a heavy wasm-ish
 * decoder, so it is imported lazily and only ever loads after a decode has
 * already failed, which means it costs nothing on the happy path.
 */
async function decodeHeic(file: File, onStage?: (stage: PhotoStage) => void): Promise<DecodedImage> {
  // Announced BEFORE the import, because loading the converter is itself part
  // of the wait the family is looking at.
  onStage?.("converting");
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
 *
 * `maxDimension` caps the longest side of the JPEG that gets written. It
 * defaults to MEMORY_MAX_DIMENSION; the yearbook cover passes
 * COVER_MAX_DIMENSION. The returned width/height are the NATURAL size either
 * way, not the capped size.
 *
 * `onStage` is called as each slow step starts, so a caller can keep a family
 * informed instead of showing a button that looks dead. Optional: a caller that
 * passes nothing behaves exactly as before.
 */
export async function preparePhoto(
  file: File,
  maxDimension: number = MEMORY_MAX_DIMENSION,
  onStage?: (stage: PhotoStage) => void,
): Promise<PreparedPhoto> {
  if (file.size === 0) {
    throw new PhotoReadError(`Zero-byte file: ${file.name}`, EMPTY_FILE_MESSAGE);
  }
  // The ONLY size refusal, and it sits far above any real photo. A large
  // ordinary file goes to the decoder and gets written down to maxDimension
  // like every other photo; see MAX_FILE_BYTES for why the number is where it
  // is. Keeping the message shape ("File is N bytes, over the M cap") so the
  // Sentry issue that caught the 2026-09-08 refusals stays comparable.
  if (file.size > MAX_FILE_BYTES) {
    throw new PhotoReadError(`File is ${file.size} bytes, over the ${MAX_FILE_BYTES} cap`, TOO_LARGE_MESSAGE);
  }

  let decoded: DecodedImage;
  try {
    onStage?.("decoding");
    decoded = await decodeImage(file);
  } catch (err) {
    // The converter runs on ANY decode failure, not just files that announce
    // themselves as HEIC. Android's Google Photos picker frequently hands back
    // a HEIC under a generic filename and mime type, so gating on the name or
    // type here would skip the one thing that can still rescue those photos.
    // looksLikeHeic only decides which message the family sees when the
    // conversion fails too.
    try {
      decoded = await decodeHeic(file, onStage);
    } catch (heicErr) {
      throw new PhotoReadError(
        `Decode and conversion both failed for ${file.name}: ${describe(heicErr)} (decode: ${describe(err)})`,
        looksLikeHeic(file) ? HEIC_MESSAGE : UNREADABLE_MESSAGE,
      );
    }
  }

  // Natural size, captured before the downscale. This is what goes into
  // memories.photo_width / photo_height so the yearbook lays photos out by
  // their real shape.
  const { width, height } = decoded;

  const scale = Math.min(1, maxDimension / Math.max(width, height));
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

    onStage?.("encoding");
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
 * Is this upload failure worth one more try, or did the server mean it?
 *
 * supabase-js draws the line for us. A request that reached Storage and was
 * refused comes back as a StorageApiError carrying an HTTP `status`: 401 and
 * 403 are auth and RLS policy, 409 is an object that already exists, 413 is
 * over the bucket's size limit. Retrying any of those just fails again a second
 * later, and a family waits twice as long for the same answer. A request that
 * never got an answer comes back as a StorageUnknownError wrapping a TypeError
 * with NO status, which is the dropped-connection shape the two "Upload failed"
 * reports from 2026-08-22 and 2026-09-11 almost certainly are.
 *
 * So: a status we recognise as transient, or no status at all, is worth
 * retrying. Any other status is the server's real answer. Exported for the
 * tests, because getting this backwards is how a policy rejection turns into
 * two policy rejections.
 */
export function isRetriableUploadFailure(err: unknown): boolean {
  const status = (err as { status?: unknown; statusCode?: unknown } | null)?.status;
  const numeric =
    typeof status === "number"
      ? status
      : typeof status === "string" && /^\d+$/.test(status)
        ? Number(status)
        : null;
  // 408 request timeout, 425 too early, 429 rate limited, 5xx server side.
  if (numeric !== null) return numeric === 408 || numeric === 425 || numeric === 429 || numeric >= 500;
  // No HTTP status: the request never completed. That includes our own network
  // timeout, which rejects with UPLOAD_FAILED_MESSAGE and no status.
  return true;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One upload attempt, returning the storage error rather than throwing, so the
 * retry above it can read the shape before deciding.
 */
async function attemptUpload(
  client: SupabaseClient,
  path: string,
  file: File,
): Promise<unknown | null> {
  try {
    const { error } = await withNetworkTimeout(
      client.storage
        .from(MEMORY_PHOTOS_BUCKET)
        .upload(path, file, { contentType: "image/jpeg", upsert: false }),
      "Storage upload",
    );
    return error ?? null;
  } catch (thrown) {
    // withNetworkTimeout's own rejection, or a throw from inside supabase-js.
    // Both are answers this function reports rather than raises.
    return thrown;
  }
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
  onStage?: (stage: PhotoStage) => void,
): Promise<{ photoUrl: string; width: number; height: number }> {
  const prepared = await preparePhoto(file, MEMORY_MAX_DIMENSION, onStage);

  const safeName = prepared.file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  onStage?.("uploading");

  // Two attempts at most, and the second only for a failure that never got an
  // answer. Each attempt gets its OWN path: upsert is false on purpose, so
  // reusing the first path would turn a dropped connection whose bytes did land
  // into a 409 and lose the photo a second time.
  let path = `${userId}/${Date.now()}-${safeName}`;
  let upErr = await attemptUpload(client, path, prepared.file);
  if (upErr && isRetriableUploadFailure(upErr)) {
    console.warn(`[photo-pipeline] upload attempt 1 failed, retrying: ${describe(upErr)}`);
    await sleep(UPLOAD_RETRY_DELAY_MS);
    path = `${userId}/${Date.now()}-${safeName}`;
    upErr = await attemptUpload(client, path, prepared.file);
  }
  if (upErr) {
    console.warn(`[photo-pipeline] upload failed for ${path}: ${describe(upErr)}`);
    // The same message a family and Sentry have always seen for this. The cause
    // is attached so the underlying storage error is finally visible in the
    // issue instead of only in a console nobody reads.
    throw new Error(UPLOAD_FAILED_MESSAGE, { cause: upErr });
  }

  // Bounded like the upload, but a timeout here degrades instead of throwing:
  // the file IS already in storage by this point. Throwing would tell the
  // family the upload failed when it did not, orphan the object, and invite a
  // duplicate on retry. Falling back to the bare path is an already-supported
  // state (signedPhotoUrl returns null on failure and this line handled it),
  // and SignedImage re-signs from a stored path at render time.
  //
  // The lazy import is INSIDE the same try. photo-url pulls in the
  // service-role admin client at module scope, so it is imported here rather
  // than at the top to keep this module loadable outside a browser bundle, and
  // a chunk that fails to load on a flaky connection is exactly as survivable
  // as a signing call that times out: the photo is already stored either way.
  let signed: string | null = null;
  try {
    const { signedPhotoUrl } = await import("./photo-url.ts");
    signed = await withNetworkTimeout(
      signedPhotoUrl(client, MEMORY_PHOTOS_BUCKET, path, TEN_YEARS_SECONDS),
      "Signed URL",
    );
  } catch (err) {
    console.warn(`[photo-pipeline] signing ${path} failed, storing bare path: ${describe(err)}`);
  }

  return { photoUrl: signed ?? path, width: prepared.width, height: prepared.height };
}
