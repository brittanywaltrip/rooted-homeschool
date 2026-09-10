// Split rows into insert batches, in their original order.
//
// PostgREST takes a multi-row insert as one request, so the number of round
// trips a write costs is the number of batches, not the number of rows. The
// Schedule Builder used to insert lessons 100 at a time; a 180-lesson goal
// paid two requests where one would do. 500 is comfortably under the request
// body limit for a lesson row and is what "Add a past year" already uses.

export const LESSON_INSERT_BATCH = 500;

export function batches<T>(rows: readonly T[], size = LESSON_INSERT_BATCH): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`batches: size must be a positive integer, got ${String(size)}`);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
