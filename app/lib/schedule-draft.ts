/**
 * Local draft persistence for the Schedule Builder.
 *
 * WHY THIS EXISTS: the whole builder is local React state until the user
 * taps "Save & build schedule". Everything before that lives only in
 * memory, so anything that unmounts the page throws the work away: a
 * background tab evicted by iOS, a stray tap on the bottom nav, a phone
 * that locks while a mom is halfway through entering four children's
 * curricula. beforeunload is the usual net and it does not fire at all on
 * iOS Safari, which is where most of these families are.
 *
 * So the draft is written to localStorage on every change and restored on
 * mount. localStorage rather than sessionStorage on purpose: sessionStorage
 * dies with the tab, and "iOS killed my tab" is the exact case we're
 * covering.
 *
 * This module deliberately knows nothing about the Row shape beyond the
 * three identity fields it needs to merge. The page owns which fields are
 * user-edited and which must be re-read from the database; see
 * mergeDraftWithDbRows.
 */

const KEY_PREFIX = "rooted_schedule_draft_v1:";

/** Drafts older than this are ignored and cleared on read. */
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type DraftRowLike = {
  localId: string;
  dbId: string | null;
  child_id: string;
};

type StoredDraft<R> = {
  version: 1;
  userId: string;
  savedAt: number;
  rows: R[];
};

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * Every entry point is wrapped: localStorage throws outright in Safari
 * private browsing and when the origin is over quota. A draft that can't
 * be saved must never take the page down with it.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function writeScheduleDraft<R extends DraftRowLike>(
  userId: string,
  rows: R[],
): void {
  const storage = safeStorage();
  if (!storage || !userId) return;
  try {
    const payload: StoredDraft<R> = {
      version: 1,
      userId,
      savedAt: Date.now(),
      rows,
    };
    storage.setItem(keyFor(userId), JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled. The in-memory state is still
    // intact, so the user loses the safety net, not their work in progress.
  }
}

export function clearScheduleDraft(userId: string): void {
  const storage = safeStorage();
  if (!storage || !userId) return;
  try {
    storage.removeItem(keyFor(userId));
  } catch {
    // Nothing to do; a stale draft is handled by the age check on read.
  }
}

export function readScheduleDraft<R extends DraftRowLike>(
  userId: string,
): { rows: R[]; savedAt: number } | null {
  const storage = safeStorage();
  if (!storage || !userId) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(keyFor(userId));
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredDraft<R> | null;
    // Anything that isn't a v1 draft for this exact user is treated as
    // absent and cleared, so a shape change can never resurrect rows the
    // current builder can't render.
    if (
      !parsed ||
      parsed.version !== 1 ||
      parsed.userId !== userId ||
      !Array.isArray(parsed.rows) ||
      typeof parsed.savedAt !== "number"
    ) {
      clearScheduleDraft(userId);
      return null;
    }
    if (Date.now() - parsed.savedAt > MAX_DRAFT_AGE_MS) {
      clearScheduleDraft(userId);
      return null;
    }
    const rows = parsed.rows.filter(
      (r): r is R =>
        Boolean(r) &&
        typeof (r as DraftRowLike).localId === "string" &&
        typeof (r as DraftRowLike).child_id === "string",
    );
    if (rows.length === 0) {
      clearScheduleDraft(userId);
      return null;
    }
    return { rows, savedAt: parsed.savedAt };
  } catch {
    clearScheduleDraft(userId);
    return null;
  }
}

export type DraftMergeResult<R> = {
  rows: R[];
  /** Draft rows pointing at goals or children that no longer exist. */
  droppedCount: number;
  /** Rows that exist in the database but were not in the draft. */
  addedFromDbCount: number;
};

/**
 * Reconcile a restored draft against what the database holds right now.
 *
 * A draft is a snapshot of a moment that may be days old, and the account
 * can have moved since: a goal archived from the Plan page, a child
 * archived in Settings, a new curriculum added on a laptop. Restoring the
 * draft verbatim would resurrect deleted rows, and worse, would silently
 * drop rows the draft never knew about, because the save sweep archives
 * every previously-saved id that isn't present in `rows`.
 *
 * The rules:
 *   - a draft row whose dbId no longer exists is dropped
 *   - a draft row for an archived child is dropped
 *   - a draft row that matches a live goal keeps the user's edits, but
 *     takes its database-derived fields from the fresh row (carryFromDb),
 *     so the save flow still compares against current truth
 *   - a live row missing from the draft is appended, never lost
 */
export function mergeDraftWithDbRows<R extends DraftRowLike>(
  draftRows: R[],
  dbRows: R[],
  validChildIds: Set<string>,
  carryFromDb: (draftRow: R, freshRow: R) => R,
): DraftMergeResult<R> {
  const dbById = new Map<string, R>();
  for (const row of dbRows) {
    if (row.dbId) dbById.set(row.dbId, row);
  }

  const merged: R[] = [];
  const usedDbIds = new Set<string>();
  let droppedCount = 0;

  for (const draftRow of draftRows) {
    if (draftRow.dbId) {
      const fresh = dbById.get(draftRow.dbId);
      if (!fresh) {
        // Archived, completed, or deleted elsewhere since the draft.
        droppedCount++;
        continue;
      }
      usedDbIds.add(draftRow.dbId);
      if (!validChildIds.has(draftRow.child_id)) {
        // Child archived since the draft: keep the live row, drop the edits.
        merged.push(fresh);
        droppedCount++;
        continue;
      }
      merged.push(carryFromDb(draftRow, fresh));
      continue;
    }

    // Never-saved row. Only meaningful if its child is still around.
    if (!validChildIds.has(draftRow.child_id)) {
      droppedCount++;
      continue;
    }
    merged.push(draftRow);
  }

  let addedFromDbCount = 0;
  for (const row of dbRows) {
    if (row.dbId && usedDbIds.has(row.dbId)) continue;
    if (!row.dbId) continue;
    merged.push(row);
    addedFromDbCount++;
  }

  return { rows: merged, droppedCount, addedFromDbCount };
}
