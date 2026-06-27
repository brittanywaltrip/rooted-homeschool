// ─── Yearbook photo ordering ─────────────────────────────────────────────────
// The order photos appear within a chapter (and the family chapter) is:
//   1. page_order ascending, when set (a family's explicit drag-to-reorder);
//   2. then date ascending;
//   3. then created_at ascending (stable);
//   4. then id (final deterministic tiebreak).
// All page_order null = today's behavior (date order). Explicitly ordered photos
// sort ahead of un-ordered ones, so a newly added photo lands at the end of a
// previously reordered chapter until it's reordered again.
//
// Pure + framework-free so the reader and the PDF print path order photos
// identically, and so it's unit-testable.

export interface OrderablePhoto {
  id: string;
  page_order?: number | null;
  date?: string | null;
  created_at?: string | null;
}

function asOrder(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function comparePhotoOrder(a: OrderablePhoto, b: OrderablePhoto): number {
  const ao = asOrder(a.page_order);
  const bo = asOrder(b.page_order);
  if (ao !== null && bo !== null) {
    if (ao !== bo) return ao - bo;
  } else if (ao !== null) {
    return -1; // explicitly ordered photos come before un-ordered ones
  } else if (bo !== null) {
    return 1;
  }
  // tie (or both null) → date, then created_at, then id
  const d = cmpStr(a.date ?? "", b.date ?? "");
  if (d !== 0) return d;
  const c = cmpStr(a.created_at ?? "", b.created_at ?? "");
  if (c !== 0) return c;
  return cmpStr(a.id, b.id);
}

/** Stable, non-mutating sort of a chapter's photos into book order. */
export function orderPhotos<T extends OrderablePhoto>(photos: T[]): T[] {
  return [...photos].sort(comparePhotoOrder);
}

/** Normalized 0..n page_order assignments for a freshly reordered chapter. */
export function normalizedPageOrders(orderedIds: string[]): { id: string; page_order: number }[] {
  return orderedIds.map((id, i) => ({ id, page_order: i }));
}
