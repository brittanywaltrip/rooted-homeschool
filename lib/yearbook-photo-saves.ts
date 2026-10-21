/**
 * Reordering yearbook photos, as a decision and as a confirmed write.
 *
 * The editor used to compute the new order inside a React state updater and
 * fire one memories update per photo from there, never reading the results. A
 * failed update left the book in an order nobody chose, while the editor showed
 * the order she did choose. The updater also ran its writes twice under React's
 * strict mode.
 *
 * Pure: no React, no Supabase. The page passes the update in.
 */

import { normalizedPageOrders } from "./photo-order.ts";

/**
 * Move `activeId` to `overId`'s place within their shared group. Null when the
 * drop is a no-op or crosses groups (reordering stays within a chapter).
 */
export function reorderWithinGroup(
  order: Readonly<Record<string, readonly string[]>>,
  activeId: string,
  overId: string,
): { group: string; ids: string[] } | null {
  if (activeId === overId) return null;
  for (const [group, ids] of Object.entries(order)) {
    const from = ids.indexOf(activeId);
    if (from < 0) continue;
    const to = ids.indexOf(overId);
    if (to < 0) return null;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, activeId);
    return { group, ids: next };
  }
  return null;
}

export class PageOrderSaveError extends Error {
  failed: string[];
  constructor(failed: string[]) {
    super(`${failed.length} photo position${failed.length === 1 ? "" : "s"} did not save`);
    this.name = "PageOrderSaveError";
    this.failed = failed;
  }
}

/**
 * Write the group's full order as page_order 0..n-1. Every row is attempted;
 * resolves only when every write is confirmed, otherwise throws naming the
 * photos that failed. Rewriting the whole order is idempotent, so a retry after
 * a partial failure lands exactly the order she chose.
 */
export async function writePageOrders(
  orderedIds: readonly string[],
  update: (id: string, pageOrder: number) => Promise<void>,
): Promise<void> {
  const rows = normalizedPageOrders([...orderedIds]);
  const results = await Promise.allSettled(rows.map(({ id, page_order }) => update(id, page_order)));
  const failed = rows.filter((_, i) => results[i].status === "rejected").map((r) => r.id);
  if (failed.length > 0) throw new PageOrderSaveError(failed);
}
