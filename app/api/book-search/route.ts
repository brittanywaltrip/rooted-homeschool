import { NextRequest, NextResponse } from "next/server";

/**
 * Title autofill for the book modal, proxied through our server.
 *
 * Server-side on purpose: a family's browser never talks to openlibrary.org,
 * so their IP address and their children's reading list never reach a third
 * party. Open Library is not in the privacy policy's third-party list and this
 * route is what keeps that true.
 *
 * The modal must work completely without this. Every failure path — bad query,
 * timeout, non-200, malformed payload, network down — returns
 * `{ results: [] }` with a 200, because "no suggestions" is a normal, silent
 * state in the UI and an error banner over a typing field is not.
 */

export const runtime = "nodejs";
// Suggestions are per-keystroke-ish and personal to the typing session; there
// is nothing worth caching at the edge.
export const dynamic = "force-dynamic";

const OPEN_LIBRARY_TIMEOUT_MS = 3000;
const MAX_RESULTS = 5;
/** Long enough for a real title, short enough that nobody pastes an essay. */
const MAX_QUERY_LENGTH = 120;

export type BookSearchResult = {
  title: string;
  author: string | null;
  pages: number | null;
  coverUrl: string | null;
};

type OpenLibraryDoc = {
  title?: unknown;
  author_name?: unknown;
  number_of_pages_median?: unknown;
  cover_i?: unknown;
};

const EMPTY = { results: [] as BookSearchResult[] };

function toResult(doc: OpenLibraryDoc): BookSearchResult | null {
  const title = typeof doc.title === "string" ? doc.title.trim() : "";
  // A suggestion with no title is not a suggestion.
  if (!title) return null;

  const authors = Array.isArray(doc.author_name) ? doc.author_name : [];
  const firstAuthor = typeof authors[0] === "string" ? authors[0].trim() : "";

  const pagesRaw = doc.number_of_pages_median;
  const pages =
    typeof pagesRaw === "number" && Number.isFinite(pagesRaw) && pagesRaw > 0
      ? Math.round(pagesRaw)
      : null;

  // cover_i is Open Library's cover id. Anything else (missing, string, 0)
  // means no cover rather than a broken image.
  const coverId = doc.cover_i;
  const coverUrl =
    typeof coverId === "number" && Number.isFinite(coverId) && coverId > 0
      ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
      : null;

  return { title, author: firstAuthor || null, pages, coverUrl };
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // Two characters is not a search, it is the start of typing.
  if (q.length < 3) return NextResponse.json(EMPTY);

  const query = q.slice(0, MAX_QUERY_LENGTH);
  const url =
    "https://openlibrary.org/search.json" +
    `?q=${encodeURIComponent(query)}` +
    "&fields=title,author_name,number_of_pages_median,cover_i" +
    `&limit=${MAX_RESULTS}`;

  // AbortController rather than Promise.race: race would leave the request
  // running in the background after we stopped caring about it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPEN_LIBRARY_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Open Library asks identifying callers to say who they are.
        "User-Agent": "Rooted Homeschool (hello@rootedhomeschoolapp.com)",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json(EMPTY);

    const body = (await res.json()) as { docs?: unknown };
    const docs = Array.isArray(body?.docs) ? body.docs : [];

    const results = docs
      .slice(0, MAX_RESULTS)
      .map((d) => toResult((d ?? {}) as OpenLibraryDoc))
      .filter((r): r is BookSearchResult => r !== null);

    return NextResponse.json({ results });
  } catch {
    // Timeout, abort, DNS, malformed JSON — all the same to the modal.
    return NextResponse.json(EMPTY);
  } finally {
    clearTimeout(timer);
  }
}
