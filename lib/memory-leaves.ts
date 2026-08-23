/**
 * Reader-side merge of the `memories` table with the legacy `app_events` rows.
 *
 * Books moved to `memories` (type 'book') in March 2026 and nothing has written
 * an `app_events` row of type 'book_read' since March 20. Several reader pages
 * still queried app_events ALONE, so every book logged after the move was
 * invisible to them (173 production books as of August 2026).
 *
 * The rule this module encodes: the memories table is the source of truth, the
 * handful of pre-March legacy events are merged in behind it, and a book that
 * exists in both sources counts once.
 *
 * Pure functions only — no Supabase import, no "@/" import at module scope, so
 * `node --test` can strip the types and run this file directly.
 */

/** Legacy app_events types that represent a captured memory. */
export const LEGACY_MEMORY_EVENT_TYPES = [
  "book_read",
  "memory_photo",
  "memory_project",
  "memory_book",
  "memory_field_trip",
  "memory_activity",
] as const;

/** Legacy app_events types that represent a book specifically. */
export const LEGACY_BOOK_EVENT_TYPES = ["book_read", "memory_book"] as const;

/** Legacy event type -> the `memories.type` value that replaced it. */
const LEGACY_TYPE_TO_MEMORY_TYPE: Record<string, string> = {
  book_read: "book",
  memory_book: "book",
  memory_photo: "photo",
  memory_project: "project",
  memory_field_trip: "field_trip",
  memory_activity: "activity",
};

export type LegacyMemoryEvent = {
  /** Optional: only the surfaces that need a stable render key select it. */
  id?: string | null;
  type: string;
  payload: {
    title?: string;
    caption?: string;
    photo_url?: string;
    child_id?: string;
    date?: string;
  } | null;
};

export type MemoryTableRow = {
  /** Optional: only the surfaces that need a stable render key select it. */
  id?: string | null;
  child_id: string | null;
  type: string;
  title?: string | null;
  caption?: string | null;
  photo_url?: string | null;
  date?: string | null;
  /** Books only. NULL = whole family. See bookBelongsToChild below. */
  book_child_ids?: string[] | null;
  book_author?: string | null;
  book_pages?: number | null;
  book_cover_url?: string | null;
};

/**
 * One captured memory, from whichever source it came from.
 *
 * `id`, `caption` and `photo_url` are pure passthrough for callers that render
 * the record (a React key, a label fallback, a cover thumbnail). None takes
 * part in the dedupe key — ids differ across the two tables by definition, a
 * book's caption holds "Author: X | Pages: N" rather than anything
 * identifying, and the same book may have a cover in one table and not the
 * other.
 */
export type MemoryRecord = {
  id: string | null;
  child_id: string | null;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  date: string | null;
  /**
   * Books only, from the August 2026 structured-fields migration. NULL means
   * whole family; legacy rows written before the column existed are also NULL,
   * which is why child_id still has to be consulted. See bookBelongsToChild.
   */
  book_child_ids: string[] | null;
  book_author: string | null;
  book_pages: number | null;
  book_cover_url: string | null;
};

function toRecordFromMemory(row: MemoryTableRow): MemoryRecord {
  return {
    id: row.id ?? null,
    child_id: row.child_id ?? null,
    type: row.type,
    title: row.title ?? null,
    caption: row.caption ?? null,
    photo_url: row.photo_url ?? null,
    date: row.date ?? null,
    // An empty array is normalised to null: "selected nobody" and "whole
    // family" are the same intent, and the modal saves null for both, but a
    // hand-written row could still arrive as {}.
    book_child_ids: row.book_child_ids && row.book_child_ids.length > 0 ? row.book_child_ids : null,
    book_author: row.book_author ?? null,
    book_pages: row.book_pages ?? null,
    book_cover_url: row.book_cover_url ?? null,
  };
}

function toRecordFromLegacy(ev: LegacyMemoryEvent): MemoryRecord {
  return {
    id: ev.id ?? null,
    child_id: ev.payload?.child_id ?? null,
    type: LEGACY_TYPE_TO_MEMORY_TYPE[ev.type] ?? ev.type,
    title: ev.payload?.title ?? null,
    caption: ev.payload?.caption ?? null,
    photo_url: ev.payload?.photo_url ?? null,
    date: ev.payload?.date ?? null,
    // Legacy events predate every structured book field. They carry a single
    // payload.child_id at most, so they fall through to the child_id rules in
    // bookBelongsToChild.
    book_child_ids: null,
    book_author: null,
    book_pages: null,
    book_cover_url: null,
  };
}

/**
 * Dedupe key for books: title + child_id + date, per the migration contract.
 * Title is trimmed and lowercased because the legacy payload and the memories
 * row were typed by hand at different times and differ in casing / trailing
 * space more often than they differ in substance.
 */
function bookKey(r: MemoryRecord): string {
  return `${(r.title ?? "").trim().toLowerCase()}|${r.child_id ?? ""}|${r.date ?? ""}`;
}

export function isBook(r: MemoryRecord): boolean {
  return r.type === "book";
}

/**
 * Does this record count toward `childId`'s log?
 *
 * Three shapes, in priority order:
 *
 *   1. book_child_ids is set  -> counts for exactly those children. A book
 *      read to Ada and Bea must NEVER appear on Cal's reading log, so this
 *      branch is exact and does not fall back to child_id.
 *   2. book_child_ids is null, child_id is set -> that one child (the legacy
 *      single-child row, and what the modal still writes when exactly one
 *      child is selected).
 *   3. both null -> whole family, counts for every child.
 *
 * `childId` of "all" (the reports page's sentinel for no filter) matches
 * everything, so callers can pass their filter state through unchanged.
 */
export function bookBelongsToChild(r: MemoryRecord, childId: string | null): boolean {
  if (!childId || childId === "all") return true;
  if (r.book_child_ids && r.book_child_ids.length > 0) {
    return r.book_child_ids.includes(childId);
  }
  if (r.child_id) return r.child_id === childId;
  return true;
}

/**
 * Which cover to show. The family's own photo always wins over a stock cover
 * pulled from Open Library — they took it, and it is of their actual book.
 * Returns null when neither exists and the caller should draw its placeholder.
 *
 * The two sources live in different buckets' worth of assumptions: photo_url
 * is a Supabase storage path needing a signed URL, book_cover_url is an
 * absolute https URL from covers.openlibrary.org. Callers must branch on
 * `kind` rather than feeding both to the same <img>.
 */
export type BookCover =
  | { kind: "photo"; src: string }
  | { kind: "external"; src: string }
  | null;

export function bookCover(r: {
  photo_url?: string | null;
  book_cover_url?: string | null;
}): BookCover {
  if (r.photo_url) return { kind: "photo", src: r.photo_url };
  if (r.book_cover_url) return { kind: "external", src: r.book_cover_url };
  return null;
}

/**
 * Merge memories rows with legacy app_events rows.
 *
 * Memories rows are emitted first and win any collision. A legacy BOOK is
 * dropped when a memories book already carries the same (title, child_id,
 * date) — that pair is one book logged once, written to both tables during
 * the March cutover. Non-book legacy types are never deduped against the
 * memories table: they predate it and were never double-written, and two
 * untitled photos on the same day for the same child are two real photos.
 */
export function mergeMemoryRecords(
  memoryRows: MemoryTableRow[] | null | undefined,
  legacyEvents: LegacyMemoryEvent[] | null | undefined,
): MemoryRecord[] {
  const fromMemories = (memoryRows ?? []).map(toRecordFromMemory);
  const seenBooks = new Set<string>();
  for (const r of fromMemories) {
    if (isBook(r)) seenBooks.add(bookKey(r));
  }

  const fromLegacy: MemoryRecord[] = [];
  for (const ev of legacyEvents ?? []) {
    const r = toRecordFromLegacy(ev);
    if (isBook(r)) {
      const key = bookKey(r);
      if (seenBooks.has(key)) continue;
      seenBooks.add(key);
    }
    fromLegacy.push(r);
  }

  return [...fromMemories, ...fromLegacy];
}

/** Merge, then keep only the books. */
export function mergeBookRecords(
  memoryRows: MemoryTableRow[] | null | undefined,
  legacyEvents: LegacyMemoryEvent[] | null | undefined,
): MemoryRecord[] {
  return mergeMemoryRecords(memoryRows, legacyEvents).filter(isBook);
}

/**
 * Count records per child id. Records with no child (a whole-family memory)
 * are skipped, matching how every leaf counter in the app already behaves:
 * a leaf belongs to one child's tree or to none.
 *
 * A book naming several children in book_child_ids credits EACH of them. It
 * really was that child's reading, and without this a family who correctly
 * ticks two children would grow fewer leaves than one who ticked one — the
 * multi-select would quietly punish accurate record-keeping. Whole-family
 * books (both fields null) still credit nobody, unchanged.
 */
export function countByChild(records: MemoryRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    if (r.book_child_ids && r.book_child_ids.length > 0) {
      for (const cid of r.book_child_ids) {
        if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
      }
      continue;
    }
    if (!r.child_id) continue;
    counts[r.child_id] = (counts[r.child_id] ?? 0) + 1;
  }
  return counts;
}
