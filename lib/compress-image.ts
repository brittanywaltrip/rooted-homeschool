import { preparePhoto, MEMORY_MAX_DIMENSION } from "./photo-pipeline.ts";

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
 * Client-side image compression: resizes to MEMORY_MAX_DIMENSION and converts
 * to JPEG. The docstring used to say 1200px; that number moved to 2400 when the
 * caps were raised for print, and this function inherited the change silently
 * because it delegates to preparePhoto's default.
 *
 * MEMORY_MAX_DIMENSION is now passed EXPLICITLY so the coupling is visible. Its
 * only caller is FirstDayFrameEditor, which holds the result as a data URL in
 * React state, so the value is a real mobile-memory decision and not an
 * implementation detail to inherit. 2400px is the intended value: the first-day
 * frame is a printable, so the extra pixels are used rather than wasted. If a
 * phone ever struggles with it, change it here and leave the memory-photo cap
 * alone. Do not go back to reading the default.
 *
 * THROWS PhotoReadError (from lib/photo-pipeline) when the file is empty, too
 * large, or undecodable. It used to hang forever in those cases; callers must
 * now handle the rejection and show `userMessage`.
 */
export async function compressImage(file: File): Promise<File> {
  const prepared = await preparePhoto(file, MEMORY_MAX_DIMENSION);
  return prepared.file;
}
