import { preparePhoto } from "./photo-pipeline.ts";

const READ_SIZE_TIMEOUT_MS = 20000;

/**
 * Read an image file's natural width/height. Returns null if it can't load,
 * so callers treat the dimensions as unknown (never throws). Used to record
 * memories.photo_width / photo_height so the yearbook can lay photos out by
 * shape without cropping tall ones.
 *
 * Resolves null on decode failure AND on timeout, so a file the browser can
 * never decode can't leave the caller waiting.
 */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let settled = false;
    let url: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (url !== null) URL.revokeObjectURL(url);
      resolve(result);
    };

    try {
      url = URL.createObjectURL(file);
      timer = setTimeout(() => finish(null), READ_SIZE_TIMEOUT_MS);
      const img = new Image();
      img.onload = () =>
        finish(
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? { width: img.naturalWidth, height: img.naturalHeight }
            : null,
        );
      img.onerror = () => finish(null);
      img.src = url;
    } catch {
      finish(null);
    }
  });
}

/**
 * Client-side image compression: resizes to max 1200px and converts to JPEG.
 * Keeps photos sharp on retina screens while reducing file size ~80%.
 *
 * THROWS PhotoReadError (from lib/photo-pipeline) when the file is empty, too
 * large, or undecodable. It used to hang forever in those cases; callers must
 * now handle the rejection and show `userMessage`.
 */
export async function compressImage(file: File): Promise<File> {
  const prepared = await preparePhoto(file);
  return prepared.file;
}
