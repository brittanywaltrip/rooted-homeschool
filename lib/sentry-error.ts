import * as Sentry from "@sentry/nextjs";

/**
 * Shape of a Supabase / PostgREST error. These are plain objects, NOT Error
 * instances, so `error instanceof Error` is false and Sentry has no message
 * to title the issue with.
 */
type SupabaseErrorLike = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
};

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const raw = (error ?? {}) as SupabaseErrorLike;
  if (typeof raw.message === "string" && raw.message.length > 0) return raw.message;
  if (typeof error === "string" && error.length > 0) return error;
  try {
    return JSON.stringify(error ?? null);
  } catch {
    return String(error);
  }
}

/**
 * Report an error to Sentry with a readable title.
 *
 * Passing a raw Supabase error object to captureException produced issues
 * titled "Object captured as exception with keys: code, details, hint,
 * message". The actual failure never appeared in the issue list, so every
 * one of these had to be opened individually to learn anything. This wraps
 * the error in a real Error whose message is `${context}: ${error.message}`
 * and moves code / details / hint into `extra`, where they stay readable.
 *
 * Safe to call from code that also runs under `node --test`: @sentry/nextjs
 * loaded through node ESM leaves captureException undefined, so we guard
 * before calling it (same reason as the guard in lib/school-days.ts).
 */
export function captureSupabaseError(
  context: string,
  error: unknown,
  options: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    /**
     * Sentry severity. Defaults to Sentry's own default ("error") when
     * omitted, so every existing call site is unchanged. Pass "warning" for
     * something worth seeing that is NOT a failure — e.g. the Schedule Builder
     * reporting that a family stacked more hand-placed lessons on a date than
     * the goal's per-day cap. That is supported behavior, not a bug, and it
     * must not page anyone.
     */
    level?: "fatal" | "error" | "warning" | "log" | "info" | "debug";
  } = {},
): void {
  const raw = (error ?? {}) as SupabaseErrorLike;
  const wrapped = new Error(`${context}: ${readMessage(error)}`);
  // Keep the original stack when there is one. The wrapper only exists to
  // give the issue a title, it should not hide where the throw came from.
  if (error instanceof Error && error.stack) wrapped.stack = error.stack;

  const upload = uploadDiagnosticsOf(error);

  if (typeof Sentry.captureException !== "function") return;
  Sentry.captureException(wrapped, {
    tags: upload ? { upload_outcome: upload.outcome, ...options.tags } : options.tags,
    ...(options.level ? { level: options.level } : {}),
    extra: {
      code: raw.code ?? null,
      details: raw.details ?? null,
      hint: raw.hint ?? null,
      ...(upload ? { upload } : {}),
      ...options.extra,
    },
  });
}

/**
 * The redacted diagnostics an UploadFailedError (lib/photo-pipeline) carries.
 *
 * The wrapper above builds a NEW Error, so the storage error the pipeline
 * attached as `cause` never reached Sentry and every photo failure read as the
 * bare "Upload failed. Check your connection" with nothing behind it. The
 * pipeline already reduced its evidence to statuses, error names and redacted
 * messages (no path, URL, token or photo bytes); this passes exactly that on
 * and nothing else. Read structurally rather than by instanceof so this module
 * does not import the pipeline.
 */
export function uploadDiagnosticsOf(error: unknown): { outcome: string; [key: string]: unknown } | null {
  const diagnostics = (error as { diagnostics?: unknown } | null)?.diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const outcome = (diagnostics as { outcome?: unknown }).outcome;
  if (typeof outcome !== "string") return null;
  return diagnostics as { outcome: string; [key: string]: unknown };
}
