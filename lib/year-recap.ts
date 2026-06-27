// ─── Year recap ──────────────────────────────────────────────────────────────
// Families remember their year as real things, not metrics. The recap replaces
// raw counts with named lists built from the actual memories:
//   - "Books we read"        — book titles (type 'book')
//   - "Places we explored"   — field trips by name (type 'field_trip')
//   - "Moments we celebrated"— wins by their text (type 'win')
// Each item is the memory's title (else caption); blank items are dropped and
// exact duplicates collapsed, in chronological order. No numbers anywhere.
//
// Pure + framework-free so the reader and the PDF print path build the recap
// identically, and so it's unit-testable.

export interface RecapMemory {
  type: string;
  title?: string | null;
  caption?: string | null;
  date?: string | null;
  created_at?: string | null;
}

export interface YearRecap {
  books: string[];
  places: string[];
  moments: string[];
}

function namedItem(m: RecapMemory): string | null {
  const title = m.title?.trim();
  if (title) return title;
  const caption = m.caption?.trim();
  if (caption) return caption;
  return null;
}

function sortKey(m: RecapMemory): string {
  return `${m.date ?? ""}|${m.created_at ?? ""}`;
}

function namedListOfType(memories: RecapMemory[], type: string): string[] {
  const items = memories
    .filter((m) => m.type === type)
    .slice()
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))
    .map(namedItem)
    .filter((s): s is string => s !== null);
  // Collapse exact (case-insensitive) duplicates, keeping the first occurrence.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function buildYearRecap(memories: RecapMemory[]): YearRecap {
  return {
    books: namedListOfType(memories, "book"),
    places: namedListOfType(memories, "field_trip"),
    moments: namedListOfType(memories, "win"),
  };
}

/** True when the recap has nothing to show (so the page can render a warm note). */
export function isRecapEmpty(recap: YearRecap): boolean {
  return recap.books.length === 0 && recap.places.length === 0 && recap.moments.length === 0;
}

// ─── Pagination (spill to more pages, never clip) ────────────────────────────
// A long recap flows across as many pages as it needs instead of clipping. Each
// page holds a deterministic line budget (a section header costs HEADER_LINES,
// each item one line); a section that overflows continues on the next page with
// its header repeated. Deterministic → reader and PDF paginate identically.

export interface RecapBlock {
  label: string;
  items: string[];
  /** true when this block continues a section split from the previous page. */
  continued: boolean;
}
export type RecapPageContent = RecapBlock[];

const HEADER_LINES = 2;

export function paginateRecap(recap: YearRecap, linesPerPage = 15): RecapPageContent[] {
  const sections = [
    { label: "Books we read", items: recap.books },
    { label: "Places we explored", items: recap.places },
    { label: "Moments we celebrated", items: recap.moments },
  ].filter((s) => s.items.length > 0);

  const pages: RecapPageContent[] = [];
  let page: RecapBlock[] = [];
  let used = 0;
  const flush = () => {
    if (page.length > 0) {
      pages.push(page);
      page = [];
      used = 0;
    }
  };

  for (const sec of sections) {
    let i = 0;
    let continued = false;
    while (i < sec.items.length) {
      // A header plus at least one item must fit; otherwise start a new page.
      if (used + HEADER_LINES + 1 > linesPerPage && page.length > 0) flush();
      const room = Math.max(1, linesPerPage - used - HEADER_LINES);
      const take = Math.min(sec.items.length - i, room);
      page.push({ label: sec.label, items: sec.items.slice(i, i + take), continued });
      used += HEADER_LINES + take;
      i += take;
      if (i < sec.items.length) {
        flush(); // section spilled → continue on the next page
        continued = true;
      }
    }
  }
  flush();
  return pages;
}
