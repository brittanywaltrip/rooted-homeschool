/**
 * Read every row a query matches, not the first 1,000.
 *
 * PostgREST answers with at most `db-max-rows` rows (1,000 on this project)
 * and says nothing about the ones it left behind: no error, no flag, just a
 * short array. Supabase-js hands that array straight back, so a page that
 * does `.select(...).eq("user_id", id)` and counts what it gets is silently
 * wrong for any family whose table has grown past the cap.
 *
 * That is not hypothetical. A family wrote in on 2026-09-09 because the
 * Reports page showed her daughter zero hours and zero courses while the
 * Transcripts page showed three hours of Bible Study for the same child. Her
 * data was fine: nine completed lessons, 600 minutes, all in one week of
 * September. She also had 1,959 lesson rows across three children, and the
 * completed ones sorted past row 1,000, so they never reached the browser.
 * Transcripts reads `transcript_courses` instead, which is why it disagreed.
 *
 * Use this wherever a read can return more rows than the cap for ONE family,
 * or add the filter the query was missing. A read that is already bounded to
 * a week, a month or a single goal does not need it.
 *
 * The builder is handed a `from`/`to` pair and must apply BOTH `.range(from,
 * to)` and a stable `.order(...)`. Order matters: without one, PostgreSQL may
 * return the pages in overlapping or gapped order and the union is wrong.
 * `.order("id")` is the usual answer; any unique column will do.
 *
 *   const rows = await selectAllRows<Lesson>((from, to) =>
 *     supabase.from("lessons").select(COLUMNS)
 *       .eq("user_id", userId).eq("completed", true)
 *       .order("id").range(from, to));
 */

/** The shape of anything a supabase-js query resolves to. */
export type RowPage = {
  data: unknown;
  error: { message: string } | null;
};

/** A supabase-js query builder is a thenable resolving to a RowPage. */
export type RowPageQuery = PromiseLike<RowPage>;

/** PostgREST's own default, and this project's `db-max-rows`. */
export const DEFAULT_PAGE_SIZE = 1000;

/**
 * A builder that ignores `range` would loop forever, so stop after this many
 * pages. At the default page size that is a million rows, far past anything a
 * family could log; reaching it means the query is wrong, not that the family
 * is prolific.
 */
const MAX_PAGES = 1000;

/**
 * Every row the built query matches, fetched a page at a time.
 *
 * Throws if any page errors: a partial answer here is the bug this exists to
 * fix, so it must not be mistaken for a complete one. Callers that would
 * rather degrade than crash should use `selectAllRowsResult`.
 */
export async function selectAllRows<T>(
  build: (from: number, to: number) => RowPageQuery,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`selectAllRows: pageSize must be a positive integer, got ${String(pageSize)}`);
  }

  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) {
      throw new Error(`selectAllRows: page starting at ${from} failed: ${error.message}`);
    }
    const batch = (data ?? []) as T[];
    for (const row of batch) rows.push(row);
    // A short page is the last page. A full one might be, and the next
    // request settles it for the cost of one empty round trip.
    if (batch.length < pageSize) return rows;
  }

  console.warn(
    `[selectAllRows] stopped at ${MAX_PAGES} pages (${rows.length} rows). ` +
      `The query is probably not applying .range(), or needs a filter.`,
  );
  return rows;
}

/**
 * `selectAllRows` in supabase-js's own `{ data, error }` shape, so it can sit
 * in a `Promise.all` beside plain queries and degrade the same way they do
 * (an errored read becomes an empty list, the page still renders).
 */
export async function selectAllRowsResult<T>(
  build: (from: number, to: number) => RowPageQuery,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<{ data: T[] | null; error: Error | null }> {
  try {
    return { data: await selectAllRows<T>(build, pageSize), error: null };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[selectAllRows]", error);
    return { data: null, error };
  }
}
