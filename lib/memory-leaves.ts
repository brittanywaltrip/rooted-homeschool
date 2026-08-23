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
  date?: string | null;
};

/**
 * One captured memory, from whichever source it came from.
 *
 * `id` and `caption` are pure passthrough for callers that render the record
 * (they need a React key and a label fallback). Neither takes part in the
 * dedupe key — ids differ across the two tables by definition, and a book's
 * caption holds "Author: X | Pages: N" rather than anything identifying.
 */
export type MemoryRecord = {
  id: string | null;
  child_id: string | null;
  type: string;
  title: string | null;
  caption: string | null;
  date: string | null;
};

function toRecordFromMemory(row: MemoryTableRow): MemoryRecord {
  return {
    id: row.id ?? null,
    child_id: row.child_id ?? null,
    type: row.type,
    title: row.title ?? null,
    caption: row.caption ?? null,
    date: row.date ?? null,
  };
}

function toRecordFromLegacy(ev: LegacyMemoryEvent): MemoryRecord {
  return {
    id: ev.id ?? null,
    child_id: ev.payload?.child_id ?? null,
    type: LEGACY_TYPE_TO_MEMORY_TYPE[ev.type] ?? ev.type,
    title: ev.payload?.title ?? null,
    caption: ev.payload?.caption ?? null,
    date: ev.payload?.date ?? null,
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
 */
export function countByChild(records: MemoryRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    if (!r.child_id) continue;
    counts[r.child_id] = (counts[r.child_id] ?? 0) + 1;
  }
  return counts;
}
